document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('loginForm').addEventListener('submit', handleLogin)
  document.getElementById('signupForm').addEventListener('submit', handleSignup)

  // Signup is user-only. Admin creation is privileged through admin panel.

  const session = await API.getSession()
  if (session) {
    try {
      const profile = await API.getMyProfile()
      if (profile) redirectToDashboard(profile)
    } catch { /* no profile yet */ }
  }
})

function switchTab(tab) {
  const tabs = document.querySelectorAll('.tab-btn')
  const forms = document.querySelectorAll('.auth-form')
  tabs.forEach(btn => btn.classList.remove('active'))
  forms.forEach(form => form.classList.remove('active'))
  if (tab === 'login') {
    tabs[0].classList.add('active')
    document.getElementById('loginForm').classList.add('active')
  } else {
    tabs[1].classList.add('active')
    document.getElementById('signupForm').classList.add('active')
  }
}

async function handleLogin(e) {
  e.preventDefault()
  const email = document.getElementById('loginEmail').value
  const password = document.getElementById('loginPassword').value
  try {
    const user = await API.login(email, password)
    const profile = await API.getMyProfile()
    if (!profile) throw new Error('Profile not found')
    showToast(`Welcome ${profile.name}! (${profile.role === 'admin' ? 'Admin' : 'Student'})`)
    setTimeout(() => redirectToDashboard(profile), 500)
  } catch (err) {
    showToast(err.message || 'Invalid email or password!', true)
  }
}

function redirectToDashboard(profile) {
  if (profile.role === 'admin') window.location.href = 'admin.html'
  else window.location.href = 'user.html'
}

async function handleSignup(e) {
  e.preventDefault()
  const name = document.getElementById('signupName').value
  const email = document.getElementById('signupEmail').value
  const password = document.getElementById('signupPassword').value
  const course = document.getElementById('signupCourse').value
  const school = document.getElementById('signupSchool').value

  if (password.length < 6) { showToast('Password must be at least 6 characters!', true); return }
  if (!course || !school) { showToast('Please fill in Course and School!', true); return }

  try {
    await API.signup({ name, email, password, role: 'user', course, school })
    showToast('OJT Student account created! Please login.')
    switchTab('login')
    document.getElementById('signupForm').reset()
  } catch (err) {
    showToast(err.message || 'Error creating account!', true)
  }
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A'
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return 'N/A' }
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

window.switchTab = switchTab
