import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
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

  // Validate caller JWT with anon client (never service role here)
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

  // Verify caller is admin
  const { data: profile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .single()

  if (profile?.role !== 'admin') {
    return new Response('Forbidden', { status: 403 })
  }

  // Self-deletion guard
  if (caller.id === userId) {
    return new Response(
      JSON.stringify({ error: 'Admins cannot delete themselves' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Last-admin guard
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

  // Perform deletion with service-role client
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

  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
