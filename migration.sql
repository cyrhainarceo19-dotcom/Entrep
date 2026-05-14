-- =============================================================================
-- OJT Tracker — Supabase/Postgres Migration
-- Schema Version: 1.1.0 (fully idempotent)
-- =============================================================================
-- This file can be re-run safely. Every statement is idempotent:
--   CREATE TABLE IF NOT EXISTS
--   CREATE INDEX IF NOT EXISTS
--   CREATE OR REPLACE FUNCTION
--   DROP IF EXISTS + CREATE (triggers, policies)
-- =============================================================================

-- =============================================================================
-- PHASE 1: EXTENSIONS
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- PHASE 2: TABLES (must come before functions, triggers, or policies)
-- =============================================================================

-- 2a. Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'user'
                    CONSTRAINT valid_role CHECK (role IN ('user', 'admin')),
    course      TEXT,
    school      TEXT,
    join_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 2b. Tasks
-- NOTE: Soft delete column (deleted_at) exists but is not active in v1.0.
-- When activated, ALL policies will need AND deleted_at IS NULL.
CREATE TABLE IF NOT EXISTS public.tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    description     TEXT NOT NULL,
    regular_hours   NUMERIC(4,1) NOT NULL
                        CONSTRAINT valid_regular_hours
                        CHECK (regular_hours >= 0 AND regular_hours <= 8.0),
    status          TEXT NOT NULL DEFAULT 'Pending'
                        CONSTRAINT valid_status
                        CHECK (status IN ('Pending', 'In Progress', 'Completed')),
    ot_hours        NUMERIC(3,1) DEFAULT 0
                        CONSTRAINT valid_ot_hours
                        CHECK (ot_hours >= 0 AND ot_hours <= 2.0),
    ot_status       TEXT
                        CONSTRAINT valid_ot_status
                        CHECK (ot_status IN ('pending', 'approved', 'rejected')),
    ot_reason       TEXT,
    ot_request_date TIMESTAMPTZ,
    is_ot_only      BOOLEAN DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- =============================================================================
-- PHASE 3: INDEXES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_tasks_user_id      ON public.tasks (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_date_desc     ON public.tasks (date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_pending_ot    ON public.tasks (user_id)
    WHERE ot_status = 'pending' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_user_date     ON public.tasks (user_id, date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_status_date   ON public.tasks (status, date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_active        ON public.tasks (user_id, date DESC) WHERE deleted_at IS NULL;

-- =============================================================================
-- PHASE 4: FUNCTIONS
-- =============================================================================
-- NOTE: All SECURITY DEFINER functions pin search_path. All owned by postgres.

-- 4a. Admin check (used by RLS policies below)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'admin'
    );
$$;

ALTER FUNCTION public.is_admin() OWNER TO postgres;

-- 4b. Audit fields setter (used by triggers below)
CREATE OR REPLACE FUNCTION public.set_audit_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.updated_by = auth.uid();
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.set_audit_fields() OWNER TO postgres;

-- 4c. New user handler (used by signup trigger below)
--     Role is ALWAYS hardcoded to 'user'. Never trusts client metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
        'user'
    );
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- =============================================================================
-- PHASE 5: TRIGGERS
-- =============================================================================

DROP TRIGGER IF EXISTS trg_profiles_audit ON public.profiles;
CREATE TRIGGER trg_profiles_audit
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_audit_fields();

DROP TRIGGER IF EXISTS trg_tasks_audit ON public.tasks;
CREATE TRIGGER trg_tasks_audit
    BEFORE UPDATE ON public.tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.set_audit_fields();

DROP TRIGGER IF EXISTS trg_after_signup ON auth.users;
CREATE TRIGGER trg_after_signup
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- PHASE 6: ROW LEVEL SECURITY
-- =============================================================================

-- 6a. Enable RLS on both tables (idempotent)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tasks    FORCE ROW LEVEL SECURITY;

-- 6b. Profiles policies (drop first for idempotent re-runs)
DROP POLICY IF EXISTS "users_read_own_profile"      ON public.profiles;
DROP POLICY IF EXISTS "admins_read_all_profiles"     ON public.profiles;
DROP POLICY IF EXISTS "users_update_own_profile"     ON public.profiles;
DROP POLICY IF EXISTS "admins_update_profiles"       ON public.profiles;
DROP POLICY IF EXISTS "admins_insert_profiles"       ON public.profiles;
DROP POLICY IF EXISTS "admins_delete_profiles"       ON public.profiles;

CREATE POLICY "users_read_own_profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "admins_read_all_profiles"
    ON public.profiles FOR SELECT
    USING (public.is_admin());

CREATE POLICY "users_update_own_profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

CREATE POLICY "admins_update_profiles"
    ON public.profiles FOR UPDATE
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY "admins_insert_profiles"
    ON public.profiles FOR INSERT
    WITH CHECK (public.is_admin());

CREATE POLICY "admins_delete_profiles"
    ON public.profiles FOR DELETE
    USING (public.is_admin());

-- 6c. Tasks policies (drop first for idempotent re-runs)
DROP POLICY IF EXISTS "users_read_own_tasks"        ON public.tasks;
DROP POLICY IF EXISTS "admins_read_all_tasks"        ON public.tasks;
DROP POLICY IF EXISTS "users_insert_own_tasks"       ON public.tasks;
DROP POLICY IF EXISTS "users_update_own_tasks"       ON public.tasks;
DROP POLICY IF EXISTS "admins_update_any_task"       ON public.tasks;
DROP POLICY IF EXISTS "users_delete_own_tasks"       ON public.tasks;
DROP POLICY IF EXISTS "admins_delete_any_task"       ON public.tasks;

CREATE POLICY "users_read_own_tasks"
    ON public.tasks FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "admins_read_all_tasks"
    ON public.tasks FOR SELECT
    USING (public.is_admin());

CREATE POLICY "users_insert_own_tasks"
    ON public.tasks FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_update_own_tasks"
    ON public.tasks FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admins_update_any_task"
    ON public.tasks FOR UPDATE
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY "users_delete_own_tasks"
    ON public.tasks FOR DELETE
    USING (auth.uid() = user_id);

CREATE POLICY "admins_delete_any_task"
    ON public.tasks FOR DELETE
    USING (public.is_admin());

-- =============================================================================
-- POST-MIGRATION VERIFICATION QUERIES
-- =============================================================================
-- Run these after schema deployment to verify state:
--
-- 1. Tables + RLS:
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
--
-- 2. FORCE RLS (pg_class, not pg_tables):
--   SELECT relname, relrowsecurity, relforcerowsecurity
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'r';
--
-- 3. Policies:
--   SELECT tablename, policyname, cmd,
--     qual IS NOT NULL AS has_using,
--     with_check IS NOT NULL AS has_with_check
--   FROM pg_policies WHERE schemaname = 'public'
--   ORDER BY tablename, policyname;
--
-- 4. Triggers:
--   SELECT tgname AS trigger_name, relname AS table_name
--   FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid
--   WHERE c.relname IN ('profiles','tasks') AND NOT t.tgisinternal;
--
-- 5. Functions:
--   SELECT proname FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' ORDER BY proname;
--
-- 6. Indexes:
--   SELECT indexname, tablename FROM pg_indexes
--   WHERE schemaname = 'public' ORDER BY tablename, indexname;
-- =============================================================================
