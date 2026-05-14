// =============================================================================
// OJT Tracker — Sheet.best to Supabase Migration Script
// Version: 1.0.0
// =============================================================================
// This script:
//   1. Fetches raw data from Sheet.best API
//   2. Cleans, deduplicates, and normalizes records
//   3. Creates auth users in Supabase (trigger auto-creates profiles)
//   4. Updates profiles with role, course, school, join_date
//   5. Migrates tasks with mapped user IDs
//   6. Is resumable, idempotent, and produces detailed reports
//
// Usage:
//   node scripts/migrate-to-supabase.js [--stage staging|production]
//
// Environment variables:
//   SUPABASE_URL               — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY  — Service role key (KEEP SECRET)
//   SHEET_BEST_USERS_URL       — Sheet.best users API URL
//   SHEET_BEST_TASKS_URL       — Sheet.best tasks API URL
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.resolve(__dirname, '..', 'migration-state.json');
const ORPHANS_FILE = path.resolve(__dirname, '..', 'orphans-report.json');
const REPORT_FILE = path.resolve(__dirname, '..', 'migration-report.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHEET_BEST_USERS_URL = process.env.SHEET_BEST_USERS_URL;
const SHEET_BEST_TASKS_URL = process.env.SHEET_BEST_TASKS_URL;

const BATCH_SIZE = 50;  // Supabase admin API batch limit

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validateEnv() {
    const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
                       'SHEET_BEST_USERS_URL', 'SHEET_BEST_TASKS_URL'];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length > 0) {
        console.error(`Missing required env vars: ${missing.join(', ')}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// State management (resumability)
// ---------------------------------------------------------------------------
const DEFAULT_STATE = {
    completedUsers: [],
    completedTaskIds: [],
    failedUsers: [],
    userIdMap: {},
    tasksMigrated: 0,
    tasksFailed: [],
    orphansSkipped: 0,
    executions: []
};

async function loadState() {
    try {
        const data = await fs.readFile(STATE_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        // Merge with defaults to handle schema evolution
        return { ...DEFAULT_STATE, ...parsed };
    } catch {
        return { ...DEFAULT_STATE };
    }
}

async function saveState(state) {
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Sheet.best data fetching
// ---------------------------------------------------------------------------
async function fetchFromSheetBest(url, label) {
    console.log(`\nFetching ${label} from Sheet.best...`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${label}: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    console.log(`  Received ${data.length} raw records`);
    return data;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------
function deduplicateUsers(rawUsers) {
    const map = new Map();
    for (const u of rawUsers) {
        const email = (u.email || '').toLowerCase().trim();
        if (!email) continue;
        if (!map.has(email)) {
            map.set(email, u);
        } else {
            // Keep the one with the most recent joinDate
            const existing = map.get(email);
            if (new Date(u.joinDate || 0) > new Date(existing.joinDate || 0)) {
                map.set(email, u);
            }
        }
    }
    return [...map.values()];
}

function deduplicateTasks(rawTasks) {
    const map = new Map();
    for (const t of rawTasks) {
        if (t.id && !map.has(t.id)) {
            map.set(t.id, t);
        }
    }
    return [...map.values()];
}

// ---------------------------------------------------------------------------
// Field normalization
// ---------------------------------------------------------------------------
function validateDate(str) {
    if (!str) return null;
    // Handle Google Sheets serial date numbers (e.g. "46153")
    if (/^\d+$/.test(str.trim())) {
        const serial = parseInt(str, 10);
        // Excel epoch: 1899-12-30 (accounting for the Lotus 123 leap year bug)
        const d = new Date((serial - 25569) * 86400 * 1000);
        return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

function clamp(value, min, max) {
    return Math.min(Math.max(parseFloat(value) || 0, min), max);
}

const VALID_STATUSES = new Set(['Pending', 'In Progress', 'Completed']);
const VALID_OT_STATUSES = new Set(['pending', 'approved', 'rejected']);

function normalizeUser(u) {
    return {
        old_id: u.id,
        email: (u.email || '').toLowerCase().trim(),
        name: (u.name || 'Unknown').trim(),
        password: u.password || '',
        role: u.role === 'admin' ? 'admin' : 'user',
        course: u.course || '',
        school: u.school || '',
        join_date: validateDate(u.joinDate) || new Date().toISOString().split('T')[0],
    };
}

function normalizeTask(t) {
    return {
        old_id: t.id,
        old_user_id: t.userId,
        date: validateDate(t.date) || '1970-01-01',
        description: (t.description || 'No description').trim(),
        regular_hours: clamp(t.regularHours || t.hours, 0, 8),
        status: VALID_STATUSES.has(t.status) ? t.status : 'Pending',
        ot_hours: clamp(t.otHours, 0, 2),
        ot_status: VALID_OT_STATUSES.has(t.otStatus) ? t.otStatus : null,
        ot_reason: t.otReason || null,
        ot_request_date: t.otRequestDate
            ? (new Date(t.otRequestDate).toISOString() || null)
            : null,
        is_ot_only: t.isOTOnly === true || t.isOTOnly === 'true',
    };
}

// ---------------------------------------------------------------------------
// Supabase client setup
// ---------------------------------------------------------------------------
function createAdminClient() {
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        realtime: { transport: WebSocket }
    });
}

// ---------------------------------------------------------------------------
// Profile wait (poll-based, no arbitrary sleep)
// ---------------------------------------------------------------------------
async function waitForProfile(supabase, authUserId, maxRetries = 15) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const { data } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', authUserId)
            .maybeSingle();
        if (data) return data;
        // Exponential backoff: 200ms, 400ms, 800ms, ...
        await new Promise(r => setTimeout(r, 200 * Math.pow(1.5, attempt)));
    }
    throw new Error(`Profile not created after ${maxRetries} retries (auth user ${authUserId})`);
}

// ---------------------------------------------------------------------------
// Migration phases
// ---------------------------------------------------------------------------

/**
 * Phase A: Migrate a single user.
 * Returns true on success, false on failure.
 */
async function migrateUser(supabase, user, state) {
    // Skip if already completed
    if (state.completedUsers.includes(user.email)) {
        console.log(`  [SKIP] ${user.email} — already migrated`);
        if (state.userIdMap[user.old_id]) {
            return true;  // mapping exists
        }
    }

    // Check if auth user already exists (idempotency)
    const { data: { users: existingUsers } } = await supabase.auth.admin.listUsers();
    const existingAuthUser = existingUsers.find(u => u.email === user.email);

    let authUserId;

    if (existingAuthUser) {
        console.log(`  [RESUME] ${user.email} — auth user exists, updating profile`);
        authUserId = existingAuthUser.id;
    } else {
        // Create auth user (trigger auto-creates profile with role='user')
        console.log(`  [CREATE] ${user.email}`);
        const { data, error } = await supabase.auth.admin.createUser({
            email: user.email,
            password: user.password,
            email_confirm: true,
            user_metadata: { name: user.name }  // NO role in metadata
        });

        if (error || !data?.user) {
            console.error(`  [FAIL] ${user.email}: ${error?.message || 'No user returned'}`);
            state.failedUsers.push({ email: user.email, error: error?.message, step: 'create_user' });
            return false;
        }
        authUserId = data.user.id;
    }

    // Wait for trigger-created profile
    try {
        await waitForProfile(supabase, authUserId);
    } catch (err) {
        console.error(`  [FAIL] ${user.email}: profile wait failed — ${err.message}`);
        state.failedUsers.push({ email: user.email, error: err.message, step: 'wait_for_profile' });
        return false;
    }

    // UPDATE profile (not INSERT — trigger already created it)
    const updates = {};
    if (user.course) updates.course = user.course;
    if (user.school) updates.school = user.school;
    if (user.join_date) updates.join_date = user.join_date;
    if (user.role === 'admin') updates.role = 'admin';  // promote to admin

    const { error: updateError } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', authUserId);

    if (updateError) {
        console.error(`  [FAIL] ${user.email}: profile update failed — ${updateError.message}`);
        state.failedUsers.push({ email: user.email, error: updateError.message, step: 'update_profile' });
        return false;
    }

    // Record success
    state.userIdMap[user.old_id] = authUserId;
    state.completedUsers.push(user.email);
    console.log(`  [OK]   ${user.email} → ${authUserId}${user.role === 'admin' ? ' (admin)' : ''}`);
    return true;
}

/**
 * Phase B: Migrate all tasks.
 */
async function migrateTasks(supabase, tasks, state) {
    console.log(`\nMigrating ${tasks.length} tasks...`);
    let migrated = 0;
    const completedIds = new Set(state.completedTaskIds || []);

    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const newUserId = state.userIdMap[task.old_user_id];

        if (!newUserId) {
            console.log(`  [SKIP] Task ${task.old_id} — no mapped user (orphan)`);
            state.orphansSkipped++;
            continue;
        }

        if (completedIds.has(task.old_id)) {
            console.log(`  [SKIP] Task ${task.old_id} — already migrated`);
            migrated++;
            continue;
        }

        // Build task insert payload (no id — let DB generate UUID)
        const payload = {
            user_id: newUserId,
            date: task.date,
            description: task.description,
            regular_hours: task.regular_hours,
            status: task.status,
            ot_hours: task.ot_hours,
            ot_status: task.ot_status,
            ot_reason: task.ot_reason,
            ot_request_date: task.ot_request_date,
            is_ot_only: task.is_ot_only,
            created_by: newUserId,
        };

        const { error } = await supabase
            .from('tasks')
            .insert(payload);

        if (error) {
            console.error(`  [FAIL] Task ${task.old_id}: ${error.message}`);
            state.tasksFailed.push({ task_id: task.old_id, error: error.message });
        } else {
            state.completedTaskIds.push(task.old_id);
            migrated++;
            if (migrated % 100 === 0) {
                console.log(`  ... ${migrated} tasks migrated`);
            }
        }
    }

    state.tasksMigrated += migrated;
    console.log(`  Tasks migrated: ${migrated}, failed: ${state.tasksFailed.length}, orphans skipped: ${state.orphansSkipped}`);
}

// ---------------------------------------------------------------------------
// Main migration orchestration
// ---------------------------------------------------------------------------
async function main() {
    validateEnv();
    console.log('=== OJT Tracker — Sheet.best → Supabase Migration ===\n');

    // 1. Load resume state
    const state = await loadState();
    const startTime = new Date().toISOString();
    console.log(`Previous runs: ${state.executions.length}`);
    console.log(`Already migrated: ${state.completedUsers.length} users, ${state.tasksMigrated} tasks`);
    if (state.failedUsers.length > 0) {
        console.log(`Previously failed: ${state.failedUsers.length} users (will retry)`);
    }

    // 2. Create admin client
    const supabase = createAdminClient();

    // 3. Fetch raw data from Sheet.best
    const rawUsers = await fetchFromSheetBest(SHEET_BEST_USERS_URL, 'users');
    const rawTasks = await fetchFromSheetBest(SHEET_BEST_TASKS_URL, 'tasks');

    // 4. Clean and normalize
    console.log('\nCleaning data...');
    const dedupedUsers = deduplicateUsers(rawUsers);
    const dedupedTasks = deduplicateTasks(rawTasks);
    console.log(`  Users: ${rawUsers.length} → ${dedupedUsers.length} (removed ${rawUsers.length - dedupedUsers.length} dupes)`);
    console.log(`  Tasks: ${rawTasks.length} → ${dedupedTasks.length} (removed ${rawTasks.length - dedupedTasks.length} dupes)`);

    const normalizedUsers = dedupedUsers.map(normalizeUser);
    const normalizedTasks = dedupedTasks.map(normalizeTask);

    // 5. Build auth user email map for O(1) lookups
    const { data: { users: allAuthUsers } } = await supabase.auth.admin.listUsers();
    const authUserByEmail = new Map(allAuthUsers.map(u => [u.email, u]));

    // 6. Phase A: Migrate users
    console.log('\n=== Phase A: User Migration ===');
    let userSuccessCount = 0;

    for (const user of normalizedUsers) {
        // Skip if already completed (from state file)
        if (state.completedUsers.includes(user.email)) {
            // Still need old_id → UUID mapping if not present
            if (!state.userIdMap[user.old_id]) {
                const existing = authUserByEmail.get(user.email);
                if (existing) {
                    state.userIdMap[user.old_id] = existing.id;
                }
            }
            userSuccessCount++;
            continue;
        }

        const ok = await migrateUser(supabase, user, state);
        if (ok) userSuccessCount++;

        // Save state periodically (every 10 users)
        if ((userSuccessCount % 10) === 0) {
            await saveState(state);
        }
    }

    await saveState(state);
    console.log(`\nPhase A complete: ${userSuccessCount}/${normalizedUsers.length} users migrated`);

    // 7. Phase B: Migrate tasks
    console.log('\n=== Phase B: Task Migration ===');
    await migrateTasks(supabase, normalizedTasks, state);
    await saveState(state);

    // 8. Generate orphan report
    const orphanedTasks = normalizedTasks.filter(t => !state.userIdMap[t.old_user_id]);
    if (orphanedTasks.length > 0) {
        await fs.writeFile(ORPHANS_FILE, JSON.stringify(orphanedTasks, null, 2));
        console.log(`\nOrphan report written to ${ORPHANS_FILE}`);
    }

    // 9. Record execution
    const endTime = new Date().toISOString();
    state.executions.push({
        timestamp: startTime,
        completed_at: endTime,
        users_migrated: userSuccessCount,
        tasks_migrated: state.tasksMigrated,
        users_failed: state.failedUsers.length,
        tasks_failed: state.tasksFailed.length,
    });

    // 10. Generate final report
    const report = {
        execution_start: startTime,
        execution_end: endTime,
        users: {
            raw: rawUsers.length,
            deduped: dedupedUsers.length,
            migrated: userSuccessCount,
            skipped: state.completedUsers.length,
            failed: state.failedUsers.length,
        },
        tasks: {
            raw: rawTasks.length,
            deduped: dedupedTasks.length,
            migrated: state.tasksMigrated,
            failed: state.tasksFailed.length,
            orphans_skipped: state.orphansSkipped,
        },
        failed_users: state.failedUsers,
        failed_tasks: state.tasksFailed,
    };

    await fs.writeFile(REPORT_FILE, JSON.stringify(report, null, 2));
    await saveState(state);

    // 11. Summary
    console.log('\n=== Migration Complete ===');
    console.log(`  Users migrated:    ${userSuccessCount}`);
    console.log(`  Users failed:      ${state.failedUsers.length}`);
    console.log(`  Tasks migrated:    ${state.tasksMigrated}`);
    console.log(`  Tasks failed:      ${state.tasksFailed.length}`);
    console.log(`  Orphans skipped:   ${state.orphansSkipped}`);
    console.log(`  Report:            ${REPORT_FILE}`);
    console.log(`  State:             ${STATE_FILE}`);

    if (state.failedUsers.length > 0 || state.tasksFailed.length > 0) {
        console.log('\n⚠️  Some records failed. Check migration-report.json and re-run to retry.');
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------
main().catch(err => {
    console.error('\nFatal migration error:', err);
    process.exit(1);
});
