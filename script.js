// Sheet.best Configuration
const USERS_SHEET_URL = 'https://api.sheetbest.com/sheets/6caf5507-437a-4cff-94f3-386b79a13abf';
const TASKS_SHEET_URL = 'https://api.sheetbest.com/sheets/aa948b23-dd34-402e-8c54-9303ea4ac593';

// Global Variables
let users = [];
let tasks = [];
let currentUser = null;

// Debug Function
function debugLog(message, data = null) {
    const panel = document.getElementById('debugPanel');
    if (!panel) return;
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    console.log(logEntry, data || '');
    panel.innerHTML += `<br>${logEntry}`;
    panel.scrollTop = panel.scrollHeight;
    if (panel.innerHTML.length > 3000) {
        panel.innerHTML = panel.innerHTML.slice(-2500);
    }
}

function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.background = isError ? '#dc3545' : '#28a745';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function showLoading(show) {
    const loader = document.getElementById('loadingOverlay');
    if (loader) {
        loader.style.display = show ? 'flex' : 'none';
    }
}

// Generate UNIQUE ID - FIXED!
function generateUniqueId() {
    return Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
}

// DATABASE FUNCTIONS
async function loadUsersFromSheetBest() {
    try {
        const response = await fetch(USERS_SHEET_URL);
        if (response.ok) {
            users = await response.json();
            debugLog(`Loaded ${users.length} users`);
            return true;
        }
        return false;
    } catch (error) {
        debugLog(`Error loading users: ${error.message}`);
        return false;
    }
}

async function loadTasksFromSheetBest() {
    try {
        const response = await fetch(TASKS_SHEET_URL);
        if (response.ok) {
            tasks = await response.json();
            debugLog(`Loaded ${tasks.length} tasks from database`);
            return true;
        }
        return false;
    } catch (error) {
        debugLog(`Error loading tasks: ${error.message}`);
        return false;
    }
}

async function saveAllTasksToSheetBest() {
    debugLog(`Saving ${tasks.length} tasks to database...`);
    try {
        // Clear all existing tasks
        await fetch(TASKS_SHEET_URL, { method: 'DELETE' });
        
        // Save current tasks
        if (tasks.length > 0) {
            const response = await fetch(TASKS_SHEET_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tasks)
            });
            debugLog(`Save response: ${response.status}`);
            return response.ok;
        }
        return true;
    } catch (error) {
        debugLog(`Error saving tasks: ${error.message}`);
        return false;
    }
}

async function refreshData() {
    showLoading(true);
    await loadUsersFromSheetBest();
    await loadTasksFromSheetBest();
    showLoading(false);
    if (currentUser) {
        renderUserTasks();
        updateStats();
    }
}

// TASK RENDERING
function renderUserTasks() {
    const userTasks = tasks.filter(t => t.userId === currentUser.id);
    const tbody = document.getElementById('tasksTableBody');
    
    debugLog(`Rendering ${userTasks.length} tasks for user ${currentUser.name}`);
    
    if (userTasks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-text">✅ No tasks found! Click "Add Task" to get started!</td</tr>';
        return;
    }
    
    tbody.innerHTML = userTasks.map(task => `
        <tr>
            <td>${formatDate(task.date)}</td>
            <td>${escapeHtml(task.description)}</td>
            <td>${task.hours}</td>
            <td><span class="status-badge status-${task.status.replace(' ', '-')}">${task.status}</span></td>
            <td>
                <button class="btn-edit" onclick="editTask('${task.id}')"><i class="fas fa-edit"></i> Edit</button>
                <button class="btn-delete" onclick="deleteTask('${task.id}')"><i class="fas fa-trash"></i> Delete</button>
            </td>
        </tr>
    `).join('');
}

function updateStats() {
    const userTasks = tasks.filter(t => t.userId === currentUser.id);
    const totalHours = userTasks.reduce((sum, t) => sum + (parseFloat(t.hours) || 0), 0);
    const completedTasks = userTasks.filter(t => t.status === 'Completed').length;
    document.getElementById('totalHours').textContent = totalHours.toFixed(1);
    document.getElementById('totalTasks').textContent = completedTasks;
}

// DELETE TASK - FIXED
async function deleteTask(taskId) {
    debugLog(`Delete requested for task ID: ${taskId}`);
    
    const confirmDelete = confirm(`⚠️ Delete this task?\n\nThis action cannot be undone!`);
    if (!confirmDelete) return;
    
    showLoading(true);
    
    const beforeCount = tasks.length;
    tasks = tasks.filter(t => t.id !== taskId);
    debugLog(`Deleted 1 task (${beforeCount} → ${tasks.length})`);
    
    const success = await saveAllTasksToSheetBest();
    
    showLoading(false);
    
    if (success) {
        renderUserTasks();
        updateStats();
        showToast(`✅ Task deleted!`);
        debugLog(`✅ Delete successful`);
    } else {
        showToast(`❌ Delete failed!`, true);
        await refreshData();
    }
}

// SAVE TASK - FIXED with UNIQUE ID
async function handleSaveTask(e) {
    e.preventDefault();
    showLoading(true);
    
    const id = document.getElementById('taskId').value;
    const taskData = {
        date: document.getElementById('taskDate').value,
        description: document.getElementById('taskDescription').value,
        hours: parseFloat(document.getElementById('taskHours').value),
        status: document.getElementById('taskStatus').value,
        userId: currentUser.id
    };
    
    if (id && id !== '') {
        // Update existing task - keep the same ID
        const index = tasks.findIndex(t => t.id === id);
        if (index !== -1) {
            tasks[index] = { ...taskData, id: id };
            debugLog(`Updated task ${id}`);
        } else {
            debugLog(`Task ${id} not found for update`);
            showLoading(false);
            return;
        }
    } else {
        // NEW TASK - generate UNIQUE ID
        const newId = generateUniqueId();
        taskData.id = newId;
        tasks.push(taskData);
        debugLog(`Added NEW task with UNIQUE ID: ${newId}`);
    }
    
    const success = await saveAllTasksToSheetBest();
    showLoading(false);
    
    if (success) {
        closeModal();
        renderUserTasks();
        updateStats();
        showToast(id ? `✅ Task updated!` : `✅ Task added!`);
        debugLog(`✅ Save successful`);
    } else {
        showToast(`❌ Error saving!`, true);
    }
}

function openAddTaskModal() {
    document.getElementById('modalTitle').textContent = 'Add New Task';
    document.getElementById('taskForm').reset();
    document.getElementById('taskId').value = ''; // IMPORTANT: empty ID means new task
    document.getElementById('taskDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('taskModal').style.display = 'block';
}

function editTask(id) {
    const task = tasks.find(t => t.id === id && t.userId === currentUser.id);
    if (task) {
        document.getElementById('modalTitle').textContent = 'Edit Task';
        document.getElementById('taskId').value = task.id;
        document.getElementById('taskDate').value = task.date;
        document.getElementById('taskDescription').value = task.description;
        document.getElementById('taskHours').value = task.hours;
        document.getElementById('taskStatus').value = task.status;
        document.getElementById('taskModal').style.display = 'block';
    }
}

function closeModal() {
    document.getElementById('taskModal').style.display = 'none';
}

// EMERGENCY RESET - Clears ALL tasks for current user
async function emergencyResetMyTasks() {
    if (!currentUser) return;
    
    const userTaskCount = tasks.filter(t => t.userId === currentUser.id).length;
    
    const confirmReset = confirm(`⚠️⚠️⚠️ EMERGENCY RESET ⚠️⚠️⚠️\n\nThis will DELETE ALL ${userTaskCount} tasks for ${currentUser.name}.\n\nThis action CANNOT be undone!\n\nClick OK to continue.`);
    
    if (!confirmReset) return;
    
    const confirmation = prompt(`Type "RESET MY TASKS" to confirm deletion of ${userTaskCount} tasks:`);
    if (confirmation !== 'RESET MY TASKS') {
        alert('Reset cancelled - wrong confirmation text');
        return;
    }
    
    showLoading(true);
    
    // Remove all tasks for current user
    const beforeCount = tasks.length;
    tasks = tasks.filter(t => t.userId !== currentUser.id);
    const deletedCount = beforeCount - tasks.length;
    debugLog(`Emergency reset: deleting ${deletedCount} tasks`);
    
    const success = await saveAllTasksToSheetBest();
    
    showLoading(false);
    
    if (success) {
        debugLog(`✅ Emergency reset complete! Deleted ${deletedCount} tasks.`);
        renderUserTasks();
        updateStats();
        showToast(`✅ Reset complete! Deleted ${deletedCount} tasks.`);
    } else {
        debugLog(`❌ Emergency reset failed!`);
        showToast(`❌ Reset failed!`, true);
    }
}

// AUTHENTICATION
async function handleLogin(e) {
    e.preventDefault();
    showLoading(true);
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    await refreshData();
    
    const user = users.find(u => u.email === email && u.password === password);
    
    showLoading(false);
    
    if (user) {
        currentUser = user;
        sessionStorage.setItem('currentUser', JSON.stringify(user));
        
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('dashboardPage').style.display = 'block';
        document.getElementById('userName').textContent = user.name;
        document.getElementById('userNameDisplay').textContent = user.name;
        
        renderUserTasks();
        updateStats();
        showToast(`Welcome back, ${user.name}!`);
        addEmergencyButton();
    } else {
        alert('❌ Invalid credentials!\n\nAdmin: admin@ojt.com / ojt123');
    }
}

function addEmergencyButton() {
    const navUser = document.querySelector('.nav-user');
    if (navUser && !document.getElementById('emergencyResetBtn')) {
        const resetBtn = document.createElement('button');
        resetBtn.id = 'emergencyResetBtn';
        resetBtn.innerHTML = '<i class="fas fa-broom"></i> Reset All My Tasks';
        resetBtn.style.background = '#dc3545';
        resetBtn.style.color = 'white';
        resetBtn.style.padding = '8px 15px';
        resetBtn.style.border = 'none';
        resetBtn.style.borderRadius = '8px';
        resetBtn.style.cursor = 'pointer';
        resetBtn.style.marginRight = '10px';
        resetBtn.onclick = emergencyResetMyTasks;
        navUser.insertBefore(resetBtn, navUser.firstChild);
    }
}

async function handleSignup(e) {
    e.preventDefault();
    showLoading(true);
    
    const newUser = {
        id: generateUniqueId(),
        name: document.getElementById('signupName').value,
        email: document.getElementById('signupEmail').value,
        password: document.getElementById('signupPassword').value,
        course: document.getElementById('signupCourse').value,
        school: document.getElementById('signupSchool').value,
        role: 'User',
        joinDate: new Date().toISOString().split('T')[0]
    };
    
    if (users.find(u => u.email === newUser.email)) {
        alert('Email already exists!');
        showLoading(false);
        return;
    }
    
    users.push(newUser);
    
    // Save users
    try {
        await fetch(USERS_SHEET_URL, { method: 'DELETE' });
        await fetch(USERS_SHEET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(users)
        });
        showLoading(false);
        alert('✅ Account created! You can now login.');
        switchTab('login');
        document.getElementById('signupForm').reset();
    } catch (error) {
        showLoading(false);
        alert('❌ Error creating account!');
    }
}

function logout() {
    currentUser = null;
    sessionStorage.removeItem('currentUser');
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('dashboardPage').style.display = 'none';
    showToast('Logged out');
}

function switchTab(tab) {
    const tabs = document.querySelectorAll('.tab-btn');
    const forms = document.querySelectorAll('.auth-form');
    tabs.forEach(btn => btn.classList.remove('active'));
    forms.forEach(form => form.classList.remove('active'));
    if (tab === 'login') {
        tabs[0].classList.add('active');
        document.getElementById('loginForm').classList.add('active');
    } else {
        tabs[1].classList.add('active');
        document.getElementById('signupForm').classList.add('active');
    }
}

// UTILITIES
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

// INITIALIZE
document.addEventListener('DOMContentLoaded', async () => {
    debugLog('🚀 App starting...');
    
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('signupForm').addEventListener('submit', handleSignup);
    document.getElementById('taskForm').addEventListener('submit', handleSaveTask);
    
    await refreshData();
    
    const savedUser = sessionStorage.getItem('currentUser');
    if (savedUser) {
        const parsed = JSON.parse(savedUser);
        const userExists = users.find(u => u.id === parsed.id);
        if (userExists) {
            currentUser = userExists;
            document.getElementById('loginPage').style.display = 'none';
            document.getElementById('dashboardPage').style.display = 'block';
            document.getElementById('userName').textContent = currentUser.name;
            document.getElementById('userNameDisplay').textContent = currentUser.name;
            renderUserTasks();
            updateStats();
            addEmergencyButton();
            debugLog(`✅ Session restored for ${currentUser.name}`);
        } else {
            sessionStorage.removeItem('currentUser');
        }
    }
    
    debugLog('✅ App ready!');
});

// Make functions global
window.switchTab = switchTab;
window.logout = logout;
window.openAddTaskModal = openAddTaskModal;
window.editTask = editTask;
window.deleteTask = deleteTask;
window.closeModal = closeModal;
window.emergencyResetMyTasks = emergencyResetMyTasks;