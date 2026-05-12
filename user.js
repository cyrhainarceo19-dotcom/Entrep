document.addEventListener('DOMContentLoaded', async () => {
    await loadFromSheetBest();
    await checkAuth();
    
    document.getElementById('taskForm').addEventListener('submit', handleSaveTask);
    document.getElementById('otRequestForm').addEventListener('submit', handleOTRequest);
    
    const otHoursInput = document.getElementById('otHours');
    if (otHoursInput) {
        otHoursInput.addEventListener('input', validateOTHours);
    }
    
    const hoursInput = document.getElementById('taskHours');
    if (hoursInput) {
        hoursInput.addEventListener('input', validateRegularHours);
    }
});

async function checkAuth() {
    const savedUser = sessionStorage.getItem('currentUser');
    if (!savedUser) {
        window.location.href = 'index.html';
        return;
    }
    
    currentUser = JSON.parse(savedUser);
    
    if (currentUser.role === 'admin') {
        window.location.href = 'admin.html';
        return;
    }
    
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userNameDisplay').textContent = currentUser.name;
    
    loadUserTasks();
    checkPendingOT();
}

function validateRegularHours() {
    const hours = parseFloat(document.getElementById('taskHours').value);
    const warningSpan = document.getElementById('hoursWarning');
    
    if (hours > 8) {
        warningSpan.innerHTML = '⚠️ Regular hours cannot exceed 8 hours. Please use OT Request for extra hours.';
        warningSpan.style.color = '#dc3545';
        document.getElementById('taskHours').value = 8;
    } else {
        warningSpan.innerHTML = '';
    }
}

function validateOTHours() {
    const hours = parseFloat(document.getElementById('otHours').value);
    const warningSpan = document.querySelector('.ot-limit-warning');
    
    if (hours > 2) {
        warningSpan.innerHTML = '⚠️ OT hours cannot exceed 2 hours! Maximum is 2 hours.';
        warningSpan.style.color = '#dc3545';
        document.getElementById('otHours').value = 2;
    } else if (hours < 0.5) {
        warningSpan.innerHTML = '⚠️ Minimum OT hours is 0.5 hour (30 minutes).';
        warningSpan.style.color = '#dc3545';
    } else {
        warningSpan.innerHTML = 'Maximum of 2 hours only';
        warningSpan.style.color = '#17a2b8';
    }
}

function loadUserTasks() {
    const userTasks = tasks.filter(t => t.userId === currentUser.id);
    renderTasks(userTasks);
    updateStats(userTasks);
}

function renderTasks(userTasks) {
    const tbody = document.getElementById('tasksTableBody');
    
    if (userTasks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-text">📋 No tasks yet. Click "Add Task" to start!</td</tr>';
        return;
    }
    
    tbody.innerHTML = userTasks.map(task => `
        <tr>
            <td>${formatDate(task.date)}</td>
            <td>${escapeHtml(task.description)}</td>
            <td>${task.regularHours || task.hours || 0} hrs</td>
            <td>${task.otHours || 0} hrs</td>
            <td><span class="status-badge status-${task.status.replace(' ', '-')}">${task.status}</span></td>
            <td>
                ${task.otStatus ? `<span class="ot-badge ot-${task.otStatus}">${task.otStatus === 'pending' ? '⏳ OT Pending' : task.otStatus === 'approved' ? '✅ OT Approved' : '❌ OT Rejected'}</span>` : '<span class="ot-badge" style="background:#e0e0e0;">No OT</span>'}
             </td>
            <tr>
                <button class="btn-edit" onclick="editTask('${task.id}')"><i class="fas fa-edit"></i> Edit</button>
                <button class="btn-delete" onclick="deleteTask('${task.id}')"><i class="fas fa-trash"></i> Delete</button>
                ${task.otStatus === 'pending' ? `<button class="btn-edit" onclick="cancelOTRequest('${task.id}')"><i class="fas fa-times"></i> Cancel OT</button>` : ''}
              </td>
         `).join('');
}

function updateStats(userTasks) {
    const totalRegularHours = userTasks.reduce((sum, t) => sum + (parseFloat(t.regularHours || t.hours) || 0), 0);
    const totalOTHours = userTasks.reduce((sum, t) => sum + (parseFloat(t.otHours) || 0), 0);
    const completedTasks = userTasks.filter(t => t.status === 'Completed').length;
    const uniqueDays = new Set(userTasks.map(t => t.date)).size;
    
    document.getElementById('totalHours').textContent = (totalRegularHours + totalOTHours).toFixed(1);
    document.getElementById('totalTasks').textContent = completedTasks;
    document.getElementById('totalDays').textContent = uniqueDays;
}

function checkPendingOT() {
    const pendingOT = tasks.filter(t => t.userId === currentUser.id && t.otStatus === 'pending');
    const warningDiv = document.getElementById('otWarning');
    
    if (pendingOT.length > 0) {
        warningDiv.style.display = 'flex';
        warningDiv.innerHTML = `
            <i class="fas fa-exclamation-triangle"></i>
            <span>You have ${pendingOT.length} pending OT request(s) awaiting approval!</span>
        `;
    } else {
        warningDiv.style.display = 'none';
    }
}

function openAddTaskModal() {
    document.getElementById('modalTitle').textContent = 'Add New Task';
    document.getElementById('taskForm').reset();
    document.getElementById('taskId').value = '';
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
        document.getElementById('taskHours').value = task.regularHours || task.hours;
        document.getElementById('taskStatus').value = task.status;
        document.getElementById('taskModal').style.display = 'block';
    }
}

async function handleSaveTask(e) {
    e.preventDefault();
    
    const id = document.getElementById('taskId').value;
    const regularHours = parseFloat(document.getElementById('taskHours').value);
    
    if (regularHours > 8) {
        showToast('Regular hours cannot exceed 8 hours!', true);
        return;
    }
    
    let taskData = {
        date: document.getElementById('taskDate').value,
        description: document.getElementById('taskDescription').value,
        regularHours: regularHours,
        hours: regularHours,
        status: document.getElementById('taskStatus').value,
        userId: currentUser.id,
        otHours: 0,
        otStatus: null,
        otReason: null
    };
    
    if (id && id !== '') {
        const index = tasks.findIndex(t => t.id === id);
        if (index !== -1) {
            taskData.otHours = tasks[index].otHours || 0;
            taskData.otStatus = tasks[index].otStatus;
            taskData.otReason = tasks[index].otReason;
            tasks[index] = { ...taskData, id: id };
            showToast('✅ Task updated!');
        }
    } else {
        taskData.id = generateUniqueId();
        tasks.push(taskData);
        showToast('✅ Task added!');
    }
    
    await saveToSheetBest();
    backupToLocal();
    closeModal();
    loadUserTasks();
}

function openOTRequestModal() {
    document.getElementById('otRequestForm').reset();
    document.getElementById('otDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('otRequestModal').style.display = 'block';
}

function closeOTRequestModal() {
    document.getElementById('otRequestModal').style.display = 'none';
}

async function handleOTRequest(e) {
    e.preventDefault();
    
    const otDate = document.getElementById('otDate').value;
    const otDescription = document.getElementById('otDescription').value;
    const otHours = parseFloat(document.getElementById('otHours').value);
    const otReason = document.getElementById('otReason').value;
    
    if (otHours > 2) {
        showToast('OT hours cannot exceed 2 hours!', true);
        return;
    }
    
    if (otHours < 0.5) {
        showToast('Minimum OT hours is 0.5 hour (30 minutes)!', true);
        return;
    }
    
    const existingTask = tasks.find(t => t.date === otDate && t.userId === currentUser.id);
    
    if (existingTask && existingTask.otStatus === 'pending') {
        showToast('You already have a pending OT request for this date!', true);
        return;
    }
    
    const otRequestData = {
        id: generateUniqueId(),
        date: otDate,
        description: otDescription,
        regularHours: existingTask ? (existingTask.regularHours || 0) : 0,
        hours: existingTask ? (existingTask.regularHours || 0) : 0,
        otHours: otHours,
        status: existingTask ? existingTask.status : 'Pending',
        userId: currentUser.id,
        otStatus: 'pending',
        otReason: otReason,
        otRequestDate: new Date().toISOString(),
        isOTOnly: !existingTask
    };
    
    if (existingTask) {
        const index = tasks.findIndex(t => t.id === existingTask.id);
        if (index !== -1) {
            tasks[index].otHours = otHours;
            tasks[index].otStatus = 'pending';
            tasks[index].otReason = otReason;
            tasks[index].otRequestDate = new Date().toISOString();
        }
    } else {
        tasks.push(otRequestData);
    }
    
    await saveToSheetBest();
    backupToLocal();
    closeOTRequestModal();
    loadUserTasks();
    checkPendingOT();
    showToast('✅ OT request submitted for approval!');
}

async function cancelOTRequest(taskId) {
    if (confirm('Cancel this OT request?')) {
        const index = tasks.findIndex(t => t.id === taskId);
        if (index !== -1) {
            tasks[index].otStatus = null;
            tasks[index].otHours = 0;
            tasks[index].otReason = null;
            
            await saveToSheetBest();
            backupToLocal();
            loadUserTasks();
            checkPendingOT();
            showToast('OT request cancelled.');
        }
    }
}

// UPDATED: Delete Task function with confirmation
async function deleteTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    // Show detailed confirmation
    const confirmMessage = `Delete this task?\n\n📅 Date: ${formatDate(task.date)}\n📝 Task: ${task.description.substring(0, 50)}\n⏱️ Hours: ${task.hours} hrs\n\nThis action cannot be undone!`;
    
    if (confirm(confirmMessage)) {
        // Remove task from array
        tasks = tasks.filter(t => t.id !== taskId);
        
        // Save to database
        await saveToSheetBest();
        backupToLocal();
        
        // Refresh display
        loadUserTasks();
        checkPendingOT();
        showToast('✅ Task deleted successfully!');
    }
}

function showOTRequests() {
    const userOTRequests = tasks.filter(t => t.userId === currentUser.id && (t.otHours > 0 || t.otStatus));
    const content = document.getElementById('otRequestsContent');
    
    if (userOTRequests.length === 0) {
        content.innerHTML = '<div class="loading-text">No overtime requests found.</div>';
    } else {
        content.innerHTML = userOTRequests.map(task => `
            <div class="ot-request-card ${task.otStatus || 'pending'}">
                <div class="ot-request-header">
                    <div>
                        <strong>📅 ${formatDate(task.date)}</strong>
                        <span class="ot-request-hours">${task.otHours || 0} hours OT</span>
                    </div>
                    <span class="ot-request-status ot-${task.otStatus || 'pending'}">
                        ${task.otStatus === 'approved' ? '✅ Approved' : task.otStatus === 'rejected' ? '❌ Rejected' : '⏳ Pending'}
                    </span>
                </div>
                <div class="ot-request-reason">
                    <strong>Task:</strong> ${escapeHtml(task.description)}<br>
                    <strong>Reason for OT:</strong> ${escapeHtml(task.otReason || 'No reason provided')}
                </div>
                <div class="ot-request-date">
                    Requested on: ${formatDate(task.otRequestDate)}
                </div>
                ${task.otStatus === 'pending' ? `<div style="margin-top: 10px;"><button class="btn-delete" onclick="cancelOTRequest('${task.id}')">Cancel Request</button></div>` : ''}
            </div>
        `).join('');
    }
    
    document.getElementById('otRequestsModal').style.display = 'block';
}

function closeOTRequestsModal() {
    document.getElementById('otRequestsModal').style.display = 'none';
}

function showSettings() {
    document.getElementById('settingsName').textContent = currentUser.name;
    document.getElementById('settingsEmail').textContent = currentUser.email;
    document.getElementById('settingsCourse').textContent = currentUser.course || 'N/A';
    document.getElementById('settingsSchool').textContent = currentUser.school || 'N/A';
    document.getElementById('settingsJoinDate').textContent = formatDate(currentUser.joinDate);
    document.getElementById('settingsModal').style.display = 'block';
}

function closeSettings() {
    document.getElementById('settingsModal').style.display = 'none';
}

async function deleteMyAccount() {
    if (confirm('⚠️ WARNING: This will delete your account and ALL your tasks forever!\n\nAre you sure?')) {
        const confirmText = prompt('Type "DELETE" to confirm:');
        if (confirmText === 'DELETE') {
            tasks = tasks.filter(t => t.userId !== currentUser.id);
            users = users.filter(u => u.id !== currentUser.id);
            
            await saveToSheetBest();
            backupToLocal();
            
            showToast('Account deleted. Goodbye!');
            setTimeout(() => {
                sessionStorage.removeItem('currentUser');
                window.location.href = 'index.html';
            }, 1500);
        }
    }
}

function logout() {
    sessionStorage.removeItem('currentUser');
    window.location.href = 'index.html';
}

function closeModal() {
    document.getElementById('taskModal').style.display = 'none';
}

// Make functions global
window.openAddTaskModal = openAddTaskModal;
window.editTask = editTask;
window.deleteTask = deleteTask;
window.closeModal = closeModal;
window.showSettings = showSettings;
window.closeSettings = closeSettings;
window.deleteMyAccount = deleteMyAccount;
window.logout = logout;
window.openOTRequestModal = openOTRequestModal;
window.closeOTRequestModal = closeOTRequestModal;
window.showOTRequests = showOTRequests;
window.closeOTRequestsModal = closeOTRequestsModal;
window.cancelOTRequest = cancelOTRequest;