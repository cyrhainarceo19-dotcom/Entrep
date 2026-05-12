// Sheet.best Configuration
const USERS_SHEET_URL = 'https://api.sheetbest.com/sheets/6caf5507-437a-4cff-94f3-386b79a13abf';
const TASKS_SHEET_URL = 'https://api.sheetbest.com/sheets/aa948b23-dd34-402e-8c54-9303ea4ac593';

// Global Variables
let users = [];
let tasks = [];
let currentUser = null;
let isSyncing = false;
let isInitialLoad = true;

// Generate UNIQUE ID
function generateUniqueId() {
    return Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
}

// LOAD from Sheet.best
async function loadFromSheetBest() {
    try {
        // Load users
        const usersRes = await fetch(USERS_SHEET_URL);
        if (usersRes.ok) {
            const data = await usersRes.json();
            if (data && data.length > 0) {
                // Remove duplicates based on email
                const uniqueUsers = [];
                const emailSet = new Set();
                for (const user of data) {
                    if (!emailSet.has(user.email)) {
                        emailSet.add(user.email);
                        uniqueUsers.push(user);
                    }
                }
                users = uniqueUsers;
                console.log('Users loaded:', users.length);
            } else if (isInitialLoad) {
                users = [{
                    id: generateUniqueId(),
                    name: "Admin User",
                    email: "admin@ojt.com",
                    password: "admin123",
                    course: "System Admin",
                    school: "OJT System",
                    role: "admin",
                    joinDate: new Date().toISOString().split('T')[0]
                }];
                await saveToSheetBest();
            }
        } else if (isInitialLoad) {
            users = [{
                id: generateUniqueId(),
                name: "Admin User",
                email: "admin@ojt.com",
                password: "admin123",
                course: "System Admin",
                school: "OJT System",
                role: "admin",
                joinDate: new Date().toISOString().split('T')[0]
            }];
            await saveToSheetBest();
        }
        
        // Load tasks - UPDATED with OT fields support
        const tasksRes = await fetch(TASKS_SHEET_URL);
        if (tasksRes.ok) {
            const data = await tasksRes.json();
            if (data && data.length > 0) {
                // Remove duplicates based on id
                const uniqueTasks = [];
                const idSet = new Set();
                for (const task of data) {
                    if (!idSet.has(task.id)) {
                        idSet.add(task.id);
                        uniqueTasks.push({
                            id: task.id,
                            date: task.date,
                            description: task.description,
                            hours: parseFloat(task.hours) || 0,
                            status: task.status || 'Pending',
                            userId: task.userId,
                            // OT Fields - NEW
                            regularHours: task.regularHours ? parseFloat(task.regularHours) : (parseFloat(task.hours) || 0),
                            otHours: parseFloat(task.otHours) || 0,
                            otStatus: task.otStatus || null,
                            otReason: task.otReason || null,
                            otRequestDate: task.otRequestDate || null
                        });
                    }
                }
                tasks = uniqueTasks;
                console.log('Tasks loaded:', tasks.length);
            } else {
                tasks = [];
            }
        } else {
            tasks = [];
        }
        
        isInitialLoad = false;
        return true;
        
    } catch (error) {
        console.error('Load error:', error);
        isInitialLoad = false;
        return false;
    }
}

// SAVE to Sheet.best - UPDATED with OT fields
async function saveToSheetBest() {
    if (isSyncing) {
        console.log('Already syncing, skipping...');
        return false;
    }
    
    isSyncing = true;
    
    try {
        // Clear all existing data
        await fetch(USERS_SHEET_URL, { method: 'DELETE' });
        await fetch(TASKS_SHEET_URL, { method: 'DELETE' });
        
        // Save users
        if (users.length > 0) {
            const userRes = await fetch(USERS_SHEET_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(users)
            });
            if (!userRes.ok) throw new Error('Users save failed');
            console.log('Users saved:', users.length);
        }
        
        // Save tasks with OT fields
        if (tasks.length > 0) {
            const tasksToSave = tasks.map(task => ({
                id: task.id,
                date: task.date,
                description: task.description,
                hours: task.regularHours || task.hours || 0,
                status: task.status,
                userId: task.userId,
                regularHours: task.regularHours || task.hours || 0,
                otHours: task.otHours || 0,
                otStatus: task.otStatus || null,
                otReason: task.otReason || null,
                otRequestDate: task.otRequestDate || null
            }));
            
            const taskRes = await fetch(TASKS_SHEET_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tasksToSave)
            });
            if (!taskRes.ok) throw new Error('Tasks save failed');
            console.log('Tasks saved:', tasks.length);
        }
        
        console.log('Save successful!');
        isSyncing = false;
        return true;
        
    } catch (error) {
        console.error('Save error:', error);
        isSyncing = false;
        return false;
    }
}

// Emergency function to clear all duplicates
async function clearAllDuplicates() {
    if (confirm('⚠️ WARNING: This will remove ALL duplicate entries from the database.\n\nThis action CANNOT be undone!\n\nClick OK to continue.')) {
        const confirmText = prompt('Type "CLEAR DUPLICATES" to confirm:');
        if (confirmText === 'CLEAR DUPLICATES') {
            // Remove duplicates in memory
            const uniqueUsers = [];
            const userEmailSet = new Set();
            for (const user of users) {
                if (!userEmailSet.has(user.email)) {
                    userEmailSet.add(user.email);
                    uniqueUsers.push(user);
                }
            }
            users = uniqueUsers;
            
            const uniqueTasks = [];
            const taskIdSet = new Set();
            for (const task of tasks) {
                if (!taskIdSet.has(task.id)) {
                    taskIdSet.add(task.id);
                    uniqueTasks.push(task);
                }
            }
            tasks = uniqueTasks;
            
            await saveToSheetBest();
            showToast(`Cleaned up! Removed duplicates. Users: ${users.length}, Tasks: ${tasks.length}`);
            console.log('Cleanup complete');
        }
    }
}

// Backup to localStorage
function backupToLocal() {
    localStorage.setItem('ojt_users_backup', JSON.stringify(users));
    localStorage.setItem('ojt_tasks_backup', JSON.stringify(tasks));
}

function restoreFromLocal() {
    const backupUsers = localStorage.getItem('ojt_users_backup');
    const backupTasks = localStorage.getItem('ojt_tasks_backup');
    if (backupUsers) users = JSON.parse(backupUsers);
    if (backupTasks) tasks = JSON.parse(backupTasks);
}

function showToast(message, isError = false) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${isError ? 'toast-error' : ''}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Make functions global
window.generateUniqueId = generateUniqueId;
window.loadFromSheetBest = loadFromSheetBest;
window.saveToSheetBest = saveToSheetBest;
window.clearAllDuplicates = clearAllDuplicates;
window.backupToLocal = backupToLocal;
window.restoreFromLocal = restoreFromLocal;
window.showToast = showToast;
window.formatDate = formatDate;
window.escapeHtml = escapeHtml;