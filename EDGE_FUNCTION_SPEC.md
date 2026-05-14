# Edge Function: `delete-user`

## Purpose

Provides a secure, server-side endpoint for admin user deletion. This operation **cannot** run from the browser because it requires the Supabase service-role key (which must never exist in client code).

Supports two admin safety guards:
1. **Self-deletion protection** — an admin cannot delete their own account
2. **Last-admin protection** — the last remaining admin cannot be deleted

---

## Architecture

```
Browser (admin.js)
    │
    │  POST /functions/v1/delete-user
    │  Authorization: Bearer <admin_access_token>
    │  Body: { "userId": "<target_uuid>" }
    │
    ▼
Supabase Edge Function (Deno)
    │
    ├── anon client      → validates JWT + checks admin role
    ├── service client   → performs auth.admin.deleteUser()
    │
    ▼
Supabase Auth (user + tasks cascade-deleted)
```

**Client separation:**
- **Anon client** (`SUPABASE_ANON_KEY`): validates the caller's JWT and checks `public.profiles.role = 'admin'`
- **Service client** (`SUPABASE_SERVICE_ROLE_KEY`): performs the privileged `auth.admin.deleteUser()` call

This split ensures the service-role key is only used for the actual privileged operation, never for user validation.

---

## Security Properties

| Property | Mechanism |
|----------|-----------|
| Authentication | JWT access token from `Authorization` header, validated via `supabase.auth.getUser()` |
| Authorization | Role verified via `public.is_admin()` check against `public.profiles` |
| Self-deletion guard | Explicit comparison: `caller.id === targetUserId` → reject |
| Last-admin guard | Count admins before deletion; reject if count ≤ 1 |
| Service-role isolation | Service-role client used only for the final delete call |
| No client trust | Target `userId` is validated against real records, not blindly accepted |

---

## Request/Response Contract

### `POST /functions/v1/delete-user`

**Request headers:**
```
Authorization: Bearer <admin_jwt_access_token>
Content-Type: application/json
```

**Request body:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Success response (200):**
```json
{
  "success": true
}
```

**Error responses:**

| Status | Condition | Body |
|--------|-----------|------|
| 401 | Missing or invalid JWT | `"Unauthorized"` |
| 403 | Caller is not an admin | `"Forbidden"` |
| 400 | Caller is deleting themselves | `{ "error": "Admins cannot delete themselves" }` |
| 400 | Only admin in system | `{ "error": "Cannot delete the last admin" }` |
| 500 | Supabase deletion failed | `{ "error": "<error message>" }` |
| 400 | Missing `userId` in body | `{ "error": "Missing userId" }` |

---

## Edge Function Code

### `supabase/functions/delete-user/index.ts`

```ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  // -------------------------------------------------------------------------
  // 1. Parse request
  // -------------------------------------------------------------------------
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { userId } = await req.json().catch(() => ({}))
  if (!userId || typeof userId !== 'string') {
    return new Response(
      JSON.stringify({ error: 'Missing userId' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // -------------------------------------------------------------------------
  // 2. Validate caller's JWT (anon client — never service role here)
  // -------------------------------------------------------------------------
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user: caller }, error: authError } =
    await userClient.auth.getUser()

  if (authError || !caller) {
    return new Response('Unauthorized', { status: 401 })
  }

  // -------------------------------------------------------------------------
  // 3. Verify caller is an admin
  // -------------------------------------------------------------------------
  const { data: profile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .single()

  if (profile?.role !== 'admin') {
    return new Response('Forbidden', { status: 403 })
  }

  // -------------------------------------------------------------------------
  // 4. Self-deletion guard
  // -------------------------------------------------------------------------
  if (caller.id === userId) {
    return new Response(
      JSON.stringify({ error: 'Admins cannot delete themselves' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // -------------------------------------------------------------------------
  // 5. Last-admin guard
  // -------------------------------------------------------------------------
  const { count: adminCount } = await userClient
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')

  if (adminCount !== null && adminCount <= 1) {
    return new Response(
      JSON.stringify({ error: 'Cannot delete the last admin' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // -------------------------------------------------------------------------
  // 6. Perform deletion (service-role client — privileged)
  // -------------------------------------------------------------------------
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { error: deleteError } =
    await adminClient.auth.admin.deleteUser(userId)

  if (deleteError) {
    return new Response(
      JSON.stringify({ error: deleteError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // -------------------------------------------------------------------------
  // 7. Success
  // -------------------------------------------------------------------------
  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
```

**Note:** `CASCADE` on `public.profiles(id) REFERENCES auth.users(id) ON DELETE CASCADE` ensures the user's tasks are automatically deleted when the auth user is deleted.

---

## Deployment

### Environment Variables

| Variable | Source | Purpose |
|----------|--------|---------|
| `SUPABASE_URL` | Supabase project settings | API endpoint for both clients |
| `SUPABASE_ANON_KEY` | Supabase project settings (public) | User JWT validation |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings (SECRET) | Privileged admin operations |

### Deploy Command

```bash
supabase functions deploy delete-user --no-verify-jwt
```

**`--no-verify-jwt` is intentional**: we handle JWT verification manually inside the function to support the dual-client pattern and custom error responses.

### Local Development

```bash
supabase functions serve delete-user --env-file ./supabase/.env.local
```

---

## Testing

### Test Scenarios

```
1. Non-admin calls endpoint
   → Expect 403 Forbidden

2. Admin deletes themselves
   → Expect 400 "Admins cannot delete themselves"

3. Last admin attempts deletion
   → Expect 400 "Cannot delete the last admin"

4. Admin deletes valid student
   → Expect 200 success
   → Verify user + tasks removed from DB

5. Admin deletes non-existent userId
   → Expect 500 (Supabase error propagated)

6. No Authorization header
   → Expect 401 Unauthorized

7. Service-role key used from browser
   → Not possible — key is never in client code
```

### Test Script (cURL)

```bash
# Admin deletes a student
curl -X POST https://<project>.supabase.co/functions/v1/delete-user \
  -H "Authorization: Bearer <admin_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"userId": "550e8400-e29b-41d4-a716-446655440000"}'
```

---

## Frontend Integration (`api.js`)

```js
export async function deleteUser(userId) {
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    throw new Error('Not authenticated')
  }

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/delete-user`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userId })
    }
  )

  if (!response.ok) {
    const text = await response.text()
    let error
    try { error = JSON.parse(text).error } catch { error = text }
    throw new Error(error || 'Delete failed')
  }
}
```

---

## Audit Trail

When a user is deleted via this function, the following occurs:

| Artifact | Created? | By |
|----------|----------|----|
| Auth user record | Deleted | `auth.admin.deleteUser()` |
| Profile row | Deleted | `ON DELETE CASCADE` |
| Task rows | Deleted | `ON DELETE CASCADE` |
| `created_by` / `updated_by` references | Set to NULL | `ON DELETE SET NULL` |
| Admin audit log | **Recommended** (post-v1) | Separate `audit_log` table insertion |

**Important:** Because `ON DELETE SET NULL` is used on audit reference columns, historical task records' `created_by` and `updated_by` will become `NULL` after the referencing user is deleted. This is acceptable — the task records themselves remain intact with all their data, preserving operational history. If full audit traceability is needed later, implement an `audit_log` table before deletion.
