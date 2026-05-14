// =============================================================================
// OJT Tracker — Supabase API Layer
// Replaces Sheet.best functions from common.js
// =============================================================================

const API = {

  // -------------------------------------------------------------------------
  // AUTH
  // -------------------------------------------------------------------------
  async login(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data.user
  },

  async signup({ name, email, password, role, course, school }) {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { name, course, school }
      }
    })
    if (error) throw error
    return data.user
  },

  async logout() {
    await sb.auth.signOut()
  },

  async getSession() {
    const { data: { session } } = await sb.auth.getSession()
    return session
  },

  // -------------------------------------------------------------------------
  // PROFILES
  // -------------------------------------------------------------------------
  async getMyProfile() {
    const session = await this.getSession()
    if (!session) return null
    const { data, error } = await sb
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
    if (error) throw error
    return data
  },

  async getProfileById(id) {
    const { data, error } = await sb
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single()
    if (error) throw error
    return data
  },

  async getAllStudents(page = 0, pageSize = 50) {
    const from = page * pageSize
    const to = from + pageSize - 1
    const { data, error, count } = await sb
      .from('profiles')
      .select('*', { count: 'exact' })
      .eq('role', 'user')
      .order('name')
      .range(from, to)
    if (error) throw error
    return { data, total: count, page, pageSize }
  },

  async updateProfile(id, updates) {
    const session = await this.getSession()
    const { error } = await sb
      .from('profiles')
      .update({ ...updates, updated_by: session?.user?.id || id })
      .eq('id', id)
    if (error) throw error
  },

  // -------------------------------------------------------------------------
  // TASKS (user-facing)
  // -------------------------------------------------------------------------
  async getUserTasks(userId) {
    const { data, error } = await sb
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('date', { ascending: false })
    if (error) throw error
    return data
  },

  async createTask(task) {
    const session = await this.getSession()
    const { data, error } = await sb
      .from('tasks')
      .insert({
        user_id: task.user_id,
        date: task.date,
        description: task.description,
        regular_hours: task.regular_hours,
        status: task.status || 'Pending',
        ot_hours: task.ot_hours || 0,
        is_ot_only: task.is_ot_only || false,
        created_by: session?.user?.id || task.user_id
      })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async updateTask(id, updates) {
    const session = await this.getSession()
    const { data, error } = await sb
      .from('tasks')
      .update({ ...updates, updated_by: session?.user?.id })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async deleteTask(id) {
    const session = await this.getSession()
    await sb
      .from('tasks')
      .update({ deleted_at: new Date().toISOString(), updated_by: session?.user?.id })
      .eq('id', id)
  },

  // -------------------------------------------------------------------------
  // OVERTIME
  // -------------------------------------------------------------------------
  async submitOTRequest(taskId, { otHours, otReason, otDate, otDescription, existingTask }) {
    const session = await this.getSession()
    if (existingTask) {
      const { error } = await sb
        .from('tasks')
        .update({
          ot_hours: otHours,
          ot_status: 'pending',
          ot_reason: otReason,
          ot_request_date: new Date().toISOString(),
          updated_by: session?.user?.id
        })
        .eq('id', existingTask.id)
      if (error) throw error
    } else {
      const { data, error } = await sb
        .from('tasks')
        .insert({
          user_id: session.user.id,
          date: otDate,
          description: otDescription,
          regular_hours: 0,
          status: 'Pending',
          ot_hours: otHours,
          ot_status: 'pending',
          ot_reason: otReason,
          ot_request_date: new Date().toISOString(),
          is_ot_only: true,
          created_by: session.user.id
        })
        .select()
        .single()
      if (error) throw error
      return data
    }
  },

  async cancelOTRequest(taskId) {
    const session = await this.getSession()
    const { error } = await sb
      .from('tasks')
      .update({
        ot_hours: 0,
        ot_status: null,
        ot_reason: null,
        ot_request_date: null,
        updated_by: session?.user?.id
      })
      .eq('id', taskId)
    if (error) throw error
  },

  // -------------------------------------------------------------------------
  // ADMIN
  // -------------------------------------------------------------------------
  async getAllTasksWithUsers(page = 0, pageSize = 50) {
    const from = page * pageSize
    const to = from + pageSize - 1
    const { data, error, count } = await sb
      .from('tasks')
      .select('*, profiles(name, email)', { count: 'exact' })
      .is('deleted_at', null)
      .order('date', { ascending: false })
      .range(from, to)
    if (error) throw error
    return { data, total: count, page, pageSize }
  },

  async getPendingOTRequests() {
    const { data, error } = await sb
      .from('tasks')
      .select('*, profiles(name, email)')
      .eq('ot_status', 'pending')
      .is('deleted_at', null)
      .order('ot_request_date', { ascending: false })
    if (error) throw error
    return data
  },

  async updateTaskOTStatus(taskId, status) {
    const session = await this.getSession()
    const { error } = await sb
      .from('tasks')
      .update({ ot_status: status, updated_by: session?.user?.id })
      .eq('id', taskId)
    if (error) throw error
  },

  async createStudent({ name, email, password, course, school }) {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { name, course, school } }
    })
    if (error) throw error
    return data.user
  },

  async deleteUserViaEdge(userId) {
    const session = await this.getSession()
    if (!session) throw new Error('Not authenticated')
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
  },

  // -------------------------------------------------------------------------
  // REPORTS
  // -------------------------------------------------------------------------
  async getAllStudentsForReport() {
    const { data, error } = await sb
      .from('profiles')
      .select('*')
      .eq('role', 'user')
      .order('name')
    if (error) throw error
    return data
  },

  async getAllTasksForReport() {
    const { data, error } = await sb
      .from('tasks')
      .select('*, profiles(name, email)')
      .is('deleted_at', null)
      .order('date', { ascending: false })
    if (error) throw error
    return data
  }

}

// Expose globally for backwards compatibility with script tags
window.API = API
