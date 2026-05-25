let currentProfile = null
let currentAttendance = null
let timerInterval = null

document.addEventListener('DOMContentLoaded', async () => {
  const session = await API.getSession()
  if (!session) { window.location.href = 'index.html'; return }

  currentProfile = await API.getMyProfile()
  if (!currentProfile) { window.location.href = 'index.html'; return }

  if (currentProfile.role === 'admin') { window.location.href = 'admin.html'; return }

  document.getElementById('userName').textContent = currentProfile.name
  document.getElementById('userNameDisplay').textContent = currentProfile.name

  document.getElementById('taskForm').addEventListener('submit', handleSaveTask)
  document.getElementById('otRequestForm').addEventListener('submit', handleOTRequest)

  const otHoursInput = document.getElementById('otHours')
  if (otHoursInput) otHoursInput.addEventListener('input', validateOTHours)

  const hoursInput = document.getElementById('taskHours')
  if (hoursInput) hoursInput.addEventListener('input', validateRegularHours)

  await Promise.all([loadUserTasks(), loadAttendance()])
})

function validateRegularHours() {
  const hours = parseFloat(document.getElementById('taskHours').value)
  const warning = document.getElementById('hoursWarning')
  if (hours > 8) {
    warning.innerHTML = '⚠️ Regular hours cannot exceed 8 hours. Please use OT Request for extra hours.'
    warning.style.color = '#dc3545'
    document.getElementById('taskHours').value = 8
  } else {
    warning.innerHTML = ''
  }
}

function validateOTHours() {
  const hours = parseFloat(document.getElementById('otHours').value)
  const warning = document.querySelector('.ot-limit-warning')
  if (hours > 2) {
    warning.innerHTML = '⚠️ OT hours cannot exceed 2 hours! Maximum is 2 hours.'
    warning.style.color = '#dc3545'
    document.getElementById('otHours').value = 2
  } else if (hours < 0.5) {
    warning.innerHTML = '⚠️ Minimum OT hours is 0.5 hour (30 minutes).'
    warning.style.color = '#dc3545'
  } else {
    warning.innerHTML = 'Maximum of 2 hours only'
    warning.style.color = '#17a2b8'
  }
}

async function loadUserTasks() {
  try {
    const tasks = await API.getUserTasks(currentProfile.id)
    renderTasks(tasks)
    updateStats(tasks)
    checkPendingOT(tasks)
  } catch (err) {
    showToast('Error loading tasks: ' + err.message, true)
  }
}

function renderTasks(tasks) {
  const tbody = document.getElementById('tasksTableBody')
  if (!tasks || tasks.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading-text">📋 No tasks yet. Click "Add Task" to start!</td></tr>'
    return
  }
  tbody.innerHTML = tasks.map(task => `
    <tr>
      <td>${formatDate(task.date)}</td>
      <td>${escapeHtml(task.description)}</td>
      <td>${task.regular_hours || 0} hrs</td>
      <td>${task.ot_hours || 0} hrs</td>
      <td><span class="status-badge status-${(task.status || '').replace(/ /g, '-')}">${task.status}</span></td>
      <td>
        ${task.ot_status
          ? `<span class="ot-badge ot-${task.ot_status}">${
              task.ot_status === 'pending' ? '⏳ OT Pending'
              : task.ot_status === 'approved' ? '✅ OT Approved'
              : '❌ OT Rejected'
            }</span>`
          : '<span class="ot-badge" style="background:#e0e0e0;">No OT</span>'}
      </td>
      <td>
        <button class="btn-edit" onclick="editTask('${task.id}')"><i class="fas fa-edit"></i> Edit</button>
        <button class="btn-delete" onclick="deleteTask('${task.id}')"><i class="fas fa-trash"></i> Delete</button>
        ${task.ot_status === 'pending' ? `<button class="btn-edit" onclick="cancelOTRequest('${task.id}')"><i class="fas fa-times"></i> Cancel OT</button>` : ''}
      </td>
    </tr>
  `).join('')
}

function updateStats(tasks) {
  if (!tasks) return
  const totalRegular = tasks.reduce((s, t) => s + (parseFloat(t.regular_hours) || 0), 0)
  const totalOT = tasks.reduce((s, t) => s + (parseFloat(t.ot_hours) || 0), 0)
  const completed = tasks.filter(t => t.status === 'Completed').length
  const uniqueDays = new Set(tasks.map(t => t.date)).size
  document.getElementById('totalHours').textContent = (totalRegular + totalOT).toFixed(1)
  document.getElementById('totalTasks').textContent = completed
  document.getElementById('totalDays').textContent = uniqueDays
}

function checkPendingOT(tasks) {
  const pending = tasks.filter(t => t.ot_status === 'pending')
  const warning = document.getElementById('otWarning')
  if (pending.length > 0) {
    warning.style.display = 'flex'
    warning.innerHTML = `<i class="fas fa-exclamation-triangle"></i><span>You have ${pending.length} pending OT request(s) awaiting approval!</span>`
  } else {
    warning.style.display = 'none'
  }
}

function openAddTaskModal() {
  document.getElementById('modalTitle').textContent = 'Add New Task'
  document.getElementById('taskForm').reset()
  document.getElementById('taskId').value = ''
  document.getElementById('taskDate').value = new Date().toISOString().split('T')[0]
  document.getElementById('taskModal').style.display = 'block'
}

function editTask(id) {
  const tbody = document.getElementById('tasksTableBody')
  const button = tbody.querySelector(`button[onclick*="'${id}'"]`)
  if (!button) return
  const tr = button.closest('tr')
  const cells = tr.querySelectorAll('td')
  document.getElementById('modalTitle').textContent = 'Edit Task'
  document.getElementById('taskId').value = id
  document.getElementById('taskDate').value = formatDateForInput(cells[0].textContent)
  document.getElementById('taskDescription').value = cells[1].textContent.trim()
  document.getElementById('taskHours').value = parseFloat(cells[2].textContent) || 0
  const statusText = cells[4].textContent.trim()
  document.getElementById('taskStatus').value = statusText
  document.getElementById('taskModal').style.display = 'block'
}

function formatDateForInput(dateStr) {
  if (!dateStr || dateStr === 'N/A') return ''
  try {
    const d = new Date(dateStr)
    return d.toISOString().split('T')[0]
  } catch { return '' }
}

async function handleSaveTask(e) {
  e.preventDefault()
  const id = document.getElementById('taskId').value
  const regularHours = parseFloat(document.getElementById('taskHours').value)
  if (regularHours > 8) { showToast('Regular hours cannot exceed 8 hours!', true); return }

  const taskData = {
    user_id: currentProfile.id,
    date: document.getElementById('taskDate').value,
    description: document.getElementById('taskDescription').value,
    regular_hours: regularHours,
    status: document.getElementById('taskStatus').value
  }

  try {
    if (id && id !== '') {
      await API.updateTask(id, taskData)
      showToast('✅ Task updated!')
    } else {
      await API.createTask(taskData)
      showToast('✅ Task added!')
    }
    closeModal()
    await loadUserTasks()
  } catch (err) {
    showToast('❌ Error saving task: ' + err.message, true)
  }
}

async function deleteTask(taskId) {
  if (!confirm('Delete this task permanently? This cannot be undone.')) return
  try {
    await API.deleteTask(taskId)
    showToast('✅ Task deleted!')
    await loadUserTasks()
  } catch (err) {
    showToast('❌ Error deleting task: ' + err.message, true)
  }
}

function openOTRequestModal() {
  document.getElementById('otRequestForm').reset()
  document.getElementById('otDate').value = new Date().toISOString().split('T')[0]
  document.getElementById('otRequestModal').style.display = 'block'
}

function closeOTRequestModal() {
  document.getElementById('otRequestModal').style.display = 'none'
}

async function handleOTRequest(e) {
  e.preventDefault()
  const otDate = document.getElementById('otDate').value
  const otDescription = document.getElementById('otDescription').value
  const otHours = parseFloat(document.getElementById('otHours').value)
  const otReason = document.getElementById('otReason').value

  if (otHours > 2) { showToast('OT hours cannot exceed 2 hours!', true); return }
  if (otHours < 0.5) { showToast('Minimum OT hours is 0.5 hour (30 minutes)!', true); return }

  const existingTasks = await API.getUserTasks(currentProfile.id)
  const existingTask = existingTasks.find(t => t.date === otDate)

  if (existingTask && existingTask.ot_status === 'pending') {
    showToast('You already have a pending OT request for this date!', true)
    return
  }

  try {
    await API.submitOTRequest(existingTask ? existingTask.id : null, {
      otHours, otReason, otDate, otDescription, existingTask
    })
    closeOTRequestModal()
    await loadUserTasks()
    showToast('✅ OT request submitted for approval!')
  } catch (err) {
    showToast('❌ Error submitting OT request: ' + err.message, true)
  }
}

async function cancelOTRequest(taskId) {
  if (!confirm('Cancel this OT request?')) return
  try {
    await API.cancelOTRequest(taskId)
    await loadUserTasks()
    showToast('OT request cancelled.')
  } catch (err) {
    showToast('Error cancelling OT request: ' + err.message, true)
  }
}

function showOTRequests() {
  const content = document.getElementById('otRequestsContent')
  const tbody = document.getElementById('tasksTableBody')
  const rows = tbody.querySelectorAll('tr')
  let otTasks = []

  rows.forEach(tr => {
    const otCell = tr.querySelector('.ot-badge')
    if (otCell && otCell.textContent.includes('OT')) {
      const onclick = tr.querySelector('button')?.getAttribute('onclick') || ''
      const idMatch = onclick.match(/'([^']+)'/)
      otTasks.push({ id: idMatch ? idMatch[1] : '' })
    }
  })

  if (otTasks.length === 0) {
    content.innerHTML = '<div class="loading-text">No overtime requests found.</div>'
  } else {
    loadOTRequestsDetail(content, otTasks)
  }
  document.getElementById('otRequestsModal').style.display = 'block'
}

async function loadOTRequestsDetail(content, otTasks) {
  const tasks = await API.getUserTasks(currentProfile.id)
  const userOT = tasks.filter(t => t.ot_hours > 0 || t.ot_status)
  if (userOT.length === 0) {
    content.innerHTML = '<div class="loading-text">No overtime requests found.</div>'
    return
  }
  content.innerHTML = userOT.map(task => `
    <div class="ot-request-card ${task.ot_status || 'pending'}">
      <div class="ot-request-header">
        <div><strong>📅 ${formatDate(task.date)}</strong><span class="ot-request-hours">${task.ot_hours || 0} hours OT</span></div>
        <span class="ot-request-status ot-${task.ot_status || 'pending'}">${
          task.ot_status === 'approved' ? '✅ Approved'
          : task.ot_status === 'rejected' ? '❌ Rejected'
          : '⏳ Pending'
        }</span>
      </div>
      <div class="ot-request-reason">
        <strong>Task:</strong> ${escapeHtml(task.description)}<br>
        <strong>Reason:</strong> ${escapeHtml(task.ot_reason || 'No reason provided')}
      </div>
      <div class="ot-request-date">Requested on: ${formatDate(task.ot_request_date)}</div>
      ${task.ot_status === 'pending' ? `<div style="margin-top:10px;"><button class="btn-delete" onclick="cancelOTRequest('${task.id}')">Cancel Request</button></div>` : ''}
    </div>
  `).join('')
}

function closeOTRequestsModal() {
  document.getElementById('otRequestsModal').style.display = 'none'
}

function showSettings() {
  document.getElementById('settingsName').textContent = currentProfile.name
  document.getElementById('settingsEmail').textContent = currentProfile.email
  document.getElementById('settingsCourse').textContent = currentProfile.course || 'N/A'
  document.getElementById('settingsSchool').textContent = currentProfile.school || 'N/A'
  document.getElementById('settingsJoinDate').textContent = formatDate(currentProfile.join_date)
  document.getElementById('settingsModal').style.display = 'block'
}

function closeSettings() {
  document.getElementById('settingsModal').style.display = 'none'
}

async function deleteMyAccount() {
  if (!confirm('⚠️ WARNING: This will delete your account and ALL your tasks forever!\n\nAre you sure?')) return
  const confirmText = prompt('Type "DELETE" to confirm:')
  if (confirmText !== 'DELETE') return
  try {
    await API.deleteUserViaEdge(currentProfile.id)
    showToast('Account deleted. Goodbye!')
    setTimeout(async () => {
      await API.logout()
      window.location.href = 'index.html'
    }, 1500)
  } catch (err) {
    showToast('Error deleting account: ' + err.message, true)
  }
}

async function logout() {
  await API.logout()
  window.location.href = 'index.html'
}

function closeModal() {
  document.getElementById('taskModal').style.display = 'none'
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A'
  try { return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) }
  catch { return 'N/A' }
}

function escapeHtml(text) {
  if (!text) return ''
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function showToast(message, isError = false) {
  const container = document.getElementById('toastContainer')
  if (!container) return
  const toast = document.createElement('div')
  toast.className = `toast ${isError ? 'toast-error' : ''}`
  toast.textContent = message
  container.appendChild(toast)
  setTimeout(() => toast.remove(), 3000)
}

// ---------------------------------------------------------------------------
// ATTENDANCE
// ---------------------------------------------------------------------------
async function loadAttendance() {
  try {
    currentAttendance = await API.getMyAttendance()
    renderAttendanceCard()
    loadAttendanceHistory()
  } catch (err) {
    showToast('Error loading attendance: ' + err.message, true)
  }
}

function formatHoursForDisplay(hours) {
  if (hours == null || hours === 0) return '0.0 hrs'
  if (hours < 0.1) return 'Less than 1 min'
  return hours.toFixed(1) + ' hrs'
}

function renderAttendanceCard() {
  const today = new Date()
  const dateEl = document.getElementById('currentDateDisplay')
  if (dateEl) {
    dateEl.textContent = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  }

  const statusIcon = document.getElementById('attendanceStatusIcon')
  const statusText = document.getElementById('attendanceStatusText')
  const subtext = document.getElementById('attendanceSubtext')
  const todayHours = document.getElementById('todayHours')
  const todayHoursLabel = document.getElementById('todayHoursLabel')
  const hoursBlock = document.getElementById('attendanceHoursBlock')
  const actions = document.getElementById('attendanceActions')
  const timer = document.getElementById('elapsedTimer')

  if (!currentAttendance) {
    if (statusIcon) statusIcon.innerHTML = '<i class="fas fa-circle" style="color: #6c757d;"></i>'
    if (statusText) statusText.textContent = 'Not Clocked In'
    if (subtext) subtext.textContent = 'Start your shift for today.'
    if (todayHours) todayHours.textContent = '0.0 hrs'
    if (todayHoursLabel) todayHoursLabel.textContent = 'Rendered Today'
    if (hoursBlock) hoursBlock.style.display = 'block'
    if (actions) actions.innerHTML = '<button class="btn-clock-in" onclick="clockIn()"><i class="fas fa-sign-in-alt"></i> Time In</button>'
    if (timer) timer.style.display = 'none'
  } else if (currentAttendance.time_in && !currentAttendance.time_out) {
    if (statusIcon) statusIcon.innerHTML = '<i class="fas fa-circle" style="color: #28a745;"></i>'
    if (statusText) statusText.textContent = 'Clocked In'
    if (subtext) subtext.textContent = 'Your shift is currently active.'
    if (hoursBlock) hoursBlock.style.display = 'none'
    if (actions) actions.innerHTML = '<button class="btn-clock-out" onclick="handleClockOut()"><i class="fas fa-sign-out-alt"></i> Time Out</button>'
    if (timer) { timer.style.display = 'flex'; startTimer(currentAttendance.time_in) }
  } else {
    if (statusIcon) statusIcon.innerHTML = '<i class="fas fa-check-circle" style="color: #28a745;"></i>'
    if (statusText) statusText.textContent = 'Shift Completed'
    if (subtext) subtext.textContent = 'Attendance recorded for today.'
    if (todayHours) todayHours.textContent = formatHoursForDisplay(currentAttendance.hours_rendered)
    if (todayHoursLabel) todayHoursLabel.textContent = 'Rendered Today'
    if (hoursBlock) hoursBlock.style.display = 'block'
    if (actions) actions.innerHTML = ''
    if (timer) timer.style.display = 'none'
  }
}

function startTimer(timeIn) {
  if (timerInterval) clearInterval(timerInterval)
  const timeInMs = new Date(timeIn).getTime()
  timerInterval = setInterval(() => {
    const diff = Math.max(0, Date.now() - timeInMs)
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    const s = Math.floor((diff % 60000) / 1000)
    const el = document.getElementById('elapsedTime')
    if (el) el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }, 1000)
}

async function clockIn() {
  try {
    const result = await API.clockIn()
    showToast('Clocked in!')
    currentAttendance = result
    renderAttendanceCard()
    loadAttendanceHistory()
  } catch (err) {
    showToast(err.message, true)
  }
}

function handleClockOut() {
  if (!currentAttendance || !currentAttendance.id || !currentAttendance.time_in) return
  const timeInMs = new Date(currentAttendance.time_in).getTime()
  const elapsedMin = (Date.now() - timeInMs) / 60000
  const under5 = elapsedMin < 5

  const body = document.getElementById('timeOutModalBody')
  const footer = document.getElementById('timeOutModalFooter')
  const warning = document.getElementById('timeOutWarning')

  if (body) body.innerHTML = '<p>You are about to time out for today. You will not be able to time in again unless an admin resets your attendance. Continue?</p>'

  if (warning) {
    warning.style.display = under5 ? 'block' : 'none'
  }

  if (footer) {
    footer.innerHTML = `
      <button class="btn-cancel" onclick="closeTimeOutModal()">Cancel</button>
      ${under5 ? '<button class="btn-submit btn-warning" onclick="confirmTimeOut()" style="background:#dc3545;color:white">Time Out Anyway</button>'
               : '<button class="btn-submit" onclick="confirmTimeOut()">Confirm Time Out</button>'}
    `
  }

  document.getElementById('timeOutConfirmModal').style.display = 'block'
}

function closeTimeOutModal() {
  document.getElementById('timeOutConfirmModal').style.display = 'none'
}

async function confirmTimeOut() {
  closeTimeOutModal()
  if (!currentAttendance || !currentAttendance.id) return
  try {
    const result = await API.clockOut(currentAttendance.id)
    if (timerInterval) clearInterval(timerInterval)
    showToast(`Clocked out! ${formatHoursForDisplay(result.hours_rendered)}`)
    currentAttendance = result
    renderAttendanceCard()
    loadAttendanceHistory()
  } catch (err) {
    showToast(err.message, true)
  }
}

async function loadAttendanceHistory() {
  try {
    const records = await API.getMyAttendanceHistory()
    const tbody = document.getElementById('attendanceHistoryBody')
    if (!tbody) return
    if (!records || records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading-text">No attendance records yet.</td></tr>'
      return
    }
    tbody.innerHTML = records.slice(0, 10).map(r => `
      <tr>
        <td>${formatDate(r.date)}</td>
        <td>${formatTime(r.time_in)}</td>
        <td>${r.time_out ? formatTime(r.time_out) : '—'}</td>
        <td>${r.hours_rendered != null ? r.hours_rendered.toFixed(1) : '—'}</td>
        <td><span class="status-badge status-${r.status}">${r.status}</span></td>
      </tr>
    `).join('')
  } catch (err) {
    console.error('Error loading attendance history:', err)
  }
}

function formatTime(isoStr) {
  if (!isoStr) return '—'
  try { return new Date(isoStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) }
  catch { return '—' }
}

window.clockIn = clockIn
window.handleClockOut = handleClockOut
window.confirmTimeOut = confirmTimeOut
window.closeTimeOutModal = closeTimeOutModal
window.openAddTaskModal = openAddTaskModal
window.editTask = editTask
window.deleteTask = deleteTask
window.closeModal = closeModal
window.showSettings = showSettings
window.closeSettings = closeSettings
window.deleteMyAccount = deleteMyAccount
window.logout = logout
window.openOTRequestModal = openOTRequestModal
window.closeOTRequestModal = closeOTRequestModal
window.showOTRequests = showOTRequests
window.closeOTRequestsModal = closeOTRequestsModal
window.cancelOTRequest = cancelOTRequest
