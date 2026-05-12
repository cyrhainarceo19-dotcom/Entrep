document.addEventListener('DOMContentLoaded', async () => {
    await loadFromSheetBest();
    checkAdminAuth();
    document.getElementById('userForm').addEventListener('submit', handleSaveUser);
});

function checkAdminAuth() {
    const savedUser = sessionStorage.getItem('currentUser');
    if (!savedUser) { 
        window.location.href = 'index.html'; 
        return; 
    }
    currentUser = JSON.parse(savedUser);
    if (currentUser.role !== 'admin') { 
        window.location.href = 'user.html'; 
        return; 
    }
    document.getElementById('adminName').textContent = currentUser.name;
    updateAdminStats();
    loadAllUsers();
    loadAllTasks();
    loadOTRequests();
}

function updateAdminStats() {
    const regularUsers = users.filter(u => u.role !== 'admin');
    const allTasks = tasks.filter(t => { 
        const user = users.find(u => u.id === t.userId); 
        return user && user.role !== 'admin'; 
    });
    const totalHours = allTasks.reduce((sum, t) => sum + (parseFloat(t.hours) || 0), 0);
    
    document.getElementById('totalUsers').textContent = regularUsers.length;
    document.getElementById('totalAllTasks').textContent = allTasks.length;
    document.getElementById('totalAllHours').textContent = totalHours.toFixed(1);
}

function showTab(tabName) {
    const tabs = document.querySelectorAll('.admin-tab');
    const contents = document.querySelectorAll('.tab-content');
    tabs.forEach(t => t.classList.remove('active'));
    contents.forEach(c => c.classList.remove('active'));
    
    if (tabName === 'users') {
        tabs[0].classList.add('active');
        document.getElementById('usersTab').classList.add('active');
        loadAllUsers();
    } else if (tabName === 'tasks') {
        tabs[1].classList.add('active');
        document.getElementById('tasksTab').classList.add('active');
        loadAllTasks();
    } else if (tabName === 'ot') {
        tabs[2].classList.add('active');
        document.getElementById('otTab').classList.add('active');
        loadOTRequests();
    } else {
        tabs[3].classList.add('active');
        document.getElementById('reportsTab').classList.add('active');
        generateReport();
    }
}

function loadAllUsers() {
    const tbody = document.getElementById('usersTableBody');
    const userList = users.filter(u => u.role !== 'admin');
    
    if (userList.length === 0) { 
        tbody.innerHTML = '<tr><td colspan="8" class="loading-text">No students found.</td</tr>'; 
        return; 
    }
    
    tbody.innerHTML = userList.map(user => {
        const userTasks = tasks.filter(t => t.userId === user.id);
        const totalHours = userTasks.reduce((sum, t) => sum + (parseFloat(t.hours) || 0), 0);
        
        return `
            <tr>
                <td>${escapeHtml(user.name)}</td>
                <td>${user.email}</td>
                <td>${escapeHtml(user.course || 'N/A')}</td>
                <td>${escapeHtml(user.school || 'N/A')}</td>
                <td>${totalHours.toFixed(1)} hrs</td>
                <td>${userTasks.length}</td>
                <td>${formatDate(user.joinDate)}</td>
                <td>
                    <button class="btn-view" onclick="viewUserTasks('${user.id}')"><i class="fas fa-eye"></i> View</button>
                    <button class="btn-delete" onclick="deleteUser('${user.id}')"><i class="fas fa-trash"></i> Delete</button>
                </td>
             </tr>
        `;
    }).join('');
}

function loadAllTasks(searchTerm = '') {
    const tbody = document.getElementById('tasksTableBody');
    let allTasks = [];
    
    tasks.forEach(task => { 
        const user = users.find(u => u.id === task.userId); 
        if (user && user.role !== 'admin') { 
            allTasks.push({ ...task, userName: user.name }); 
        } 
    });
    
    if (searchTerm) { 
        allTasks = allTasks.filter(t => 
            t.userName.toLowerCase().includes(searchTerm.toLowerCase()) || 
            t.description.toLowerCase().includes(searchTerm.toLowerCase())
        ); 
    }
    
    if (allTasks.length === 0) { 
        tbody.innerHTML = '<tr><td colspan="7" class="loading-text">No tasks found.</td></tr>'; 
        return; 
    }
    
    tbody.innerHTML = allTasks.map(task => {
        let otStatusHtml = '';
        if (task.otStatus === 'pending') {
            otStatusHtml = '<span class="ot-badge ot-pending">Pending</span>';
        } else if (task.otStatus === 'approved') {
            otStatusHtml = '<span class="ot-badge ot-approved">Approved</span>';
        } else if (task.otStatus === 'rejected') {
            otStatusHtml = '<span class="ot-badge ot-rejected">Rejected</span>';
        } else {
            otStatusHtml = '<span class="ot-badge">Regular</span>';
        }
        
        return `
            <tr>
                <td>${escapeHtml(task.userName)}</td>
                <td>${formatDate(task.date)}</td>
                <td>${escapeHtml(task.description)}</td>
                <td>${task.hours}</td>
                <td><span class="status-badge status-${task.status.replace(' ', '-')}">${task.status}</span></td>
                <td>${otStatusHtml}</td>
                <td>
                    <button class="btn-delete" onclick="deleteTaskAsAdmin('${task.id}')"><i class="fas fa-trash"></i> Delete</button>
                </td>
            </tr>
        `;
    }).join('');
    
    const searchInput = document.getElementById('searchTasks');
    if (searchInput && !searchInput.hasListener) { 
        searchInput.addEventListener('input', (e) => loadAllTasks(e.target.value)); 
        searchInput.hasListener = true; 
    }
}

// OT REQUESTS FUNCTIONS
async function approveOT(taskId) {
    if (confirm('Approve this OT request?')) {
        const taskIndex = tasks.findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
            tasks[taskIndex].otStatus = 'approved';
            await saveToSheetBest();
            backupToLocal();
            loadOTRequests();
            loadAllTasks();
            showToast('OT request approved!');
        }
    }
}

async function rejectOT(taskId) {
    if (confirm('Reject this OT request?')) {
        const taskIndex = tasks.findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
            tasks[taskIndex].otStatus = 'rejected';
            await saveToSheetBest();
            backupToLocal();
            loadOTRequests();
            loadAllTasks();
            showToast('OT request rejected.');
        }
    }
}

function loadOTRequests() {
    const tbody = document.getElementById('otTableBody');
    if (!tbody) return;
    
    const pendingOT = tasks.filter(t => t.otStatus === 'pending');
    const userTasks = [];
    
    pendingOT.forEach(task => {
        const user = users.find(u => u.id === task.userId);
        if (user && user.role !== 'admin') {
            userTasks.push({ ...task, userName: user.name });
        }
    });
    
    if (userTasks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading-text">No pending OT requests.</td><tr>'; 
        return;
    }
    
    tbody.innerHTML = userTasks.map(task => `
        <tr>
            <td>${escapeHtml(task.userName)}</td>
            <td>${formatDate(task.date)}</td>
            <td>${escapeHtml(task.description)}</td>
            <td>${task.otHours || 0} hrs</td> 
            <td>${escapeHtml(task.otReason || 'No reason provided')}</td> 
            <td>${formatDate(task.otRequestDate)}</td> 
            <td><span class="ot-badge ot-pending">Pending</span></td> 
            <td>
                <button class="btn-approve" onclick="approveOT('${task.id}')"><i class="fas fa-check"></i> Approve</button>
                <button class="btn-reject" onclick="rejectOT('${task.id}')"><i class="fas fa-times"></i> Reject</button>
            </td> 
         </tr>
    `).join('');
}

async function viewUserTasks(userId) {
    const user = users.find(u => u.id === userId);
    const userTasks = tasks.filter(t => t.userId === userId);
    const totalHours = userTasks.reduce((sum, t) => sum + (parseFloat(t.hours) || 0), 0);
    const completed = userTasks.filter(t => t.status === 'Completed').length;
    const content = document.getElementById('viewTasksContent');
    
    let tasksHtml = '';
    for (const task of userTasks) {
        let otStatusHtml = '';
        if (task.otStatus === 'pending') {
            otStatusHtml = '<span class="ot-badge ot-pending">Pending</span>';
        } else if (task.otStatus === 'approved') {
            otStatusHtml = '<span class="ot-badge ot-approved">Approved</span>';
        } else if (task.otStatus === 'rejected') {
            otStatusHtml = '<span class="ot-badge ot-rejected">Rejected</span>';
        } else {
            otStatusHtml = 'Regular';
        }
        
        tasksHtml += `
            <tr>
                <td>${formatDate(task.date)}</td>
                <td>${escapeHtml(task.description)}</td>
                <td>${task.hours}</td>
                <td><span class="status-badge status-${task.status.replace(' ', '-')}">${task.status}</span></td>
                <td>${otStatusHtml}</td>
                <td><button class="btn-delete" onclick="deleteTaskAsAdmin('${task.id}'); closeViewTasksModal();"><i class="fas fa-trash"></i> Delete</button></td>
            </tr>
        `;
    }
    
    content.innerHTML = `
        <div class="student-info">
            <h3><i class="fas fa-user-graduate"></i> ${escapeHtml(user.name)}</h3>
            <p><strong>Email:</strong> ${user.email}</p>
            <p><strong>Course:</strong> ${escapeHtml(user.course || 'N/A')}</p>
            <p><strong>School:</strong> ${escapeHtml(user.school || 'N/A')}</p>
        </div>
        <div class="student-tasks-summary">
            <p><strong>Summary:</strong> Total Hours: ${totalHours.toFixed(1)} hrs | Tasks: ${userTasks.length} | Completed: ${completed}</p>
        </div>
        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr><th>Date</th><th>Task</th><th>Hours</th><th>Status</th><th>OT Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                    ${tasksHtml}
                </tbody>
            </table>
        </div>
    `;
    
    document.getElementById('viewTasksTitle').innerHTML = `<i class="fas fa-tasks"></i> Tasks: ${escapeHtml(user.name)}`;
    document.getElementById('viewTasksModal').style.display = 'block';
}

function closeViewTasksModal() { 
    document.getElementById('viewTasksModal').style.display = 'none'; 
}

// ============ FIXED DELETE FUNCTIONS ============

// DELETE USER - with proper database deletion
async function deleteUser(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    
    const userTaskCount = tasks.filter(t => t.userId === userId).length;
    const confirmMessage = `Delete user: ${user.name}?\n\nEmail: ${user.email}\nTasks: ${userTaskCount} tasks\n\n⚠️ This will delete ALL their tasks permanently!\n\nThis action cannot be undone!`;
    
    if (confirm(confirmMessage)) {
        const confirmText = prompt(`Type "${user.name}" to confirm deletion:`);
        if (confirmText === user.name) {
            showToast('Deleting user and tasks...', false);
            
            // Remove user's tasks from array
            tasks = tasks.filter(t => t.userId !== userId);
            // Remove user from array
            users = users.filter(u => u.id !== userId);
            
            // Save to Sheet.best (DELETE and POST)
            const saved = await saveToSheetBest();
            
            if (saved) {
                backupToLocal();
                loadAllUsers(); 
                loadAllTasks(); 
                loadOTRequests(); 
                updateAdminStats();
                showToast(`✅ Deleted user: ${user.name} and their ${userTaskCount} tasks`);
            } else {
                showToast('❌ Error deleting user from database!', true);
                // Reload data to restore
                await loadFromSheetBest();
                loadAllUsers(); 
                loadAllTasks();
            }
        } else {
            showToast('Deletion cancelled - name mismatch', true);
        }
    }
}

// DELETE TASK AS ADMIN - with proper database deletion
async function deleteTaskAsAdmin(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    const user = users.find(u => u.id === task.userId);
    const userName = user ? user.name : 'Unknown';
    
    const confirmMessage = `Delete this task?\n\nStudent: ${userName}\nDate: ${formatDate(task.date)}\nTask: ${task.description.substring(0, 60)}\nHours: ${task.hours} hrs\n\nThis action cannot be undone!`;
    
    if (confirm(confirmMessage)) {
        showToast('Deleting task from database...', false);
        
        // Remove task from array
        tasks = tasks.filter(t => t.id !== taskId);
        
        // Save to Sheet.best (DELETE and POST)
        const saved = await saveToSheetBest();
        
        if (saved) {
            backupToLocal();
            loadAllTasks(); 
            loadOTRequests(); 
            updateAdminStats();
            showToast('✅ Task deleted successfully!');
        } else {
            showToast('❌ Error deleting task from database!', true);
            // Reload data to restore
            await loadFromSheetBest();
            loadAllTasks();
        }
    }
}

function openAddUserModal() {
    document.getElementById('userModalTitle').innerHTML = '<i class="fas fa-user-plus"></i> Add New Student';
    document.getElementById('userForm').reset();
    document.getElementById('editUserId').value = '';
    document.getElementById('userModal').style.display = 'block';
}

function closeUserModal() { 
    document.getElementById('userModal').style.display = 'none'; 
}

async function handleSaveUser(e) {
    e.preventDefault();
    const userId = document.getElementById('editUserId').value;
    const userData = { 
        name: document.getElementById('userName').value, 
        email: document.getElementById('userEmail').value, 
        password: document.getElementById('userPassword').value, 
        course: document.getElementById('userCourse').value, 
        school: document.getElementById('userSchool').value, 
        role: 'user', 
        joinDate: new Date().toISOString().split('T')[0] 
    };
    
    if (userData.password.length < 6) { 
        showToast('Password must be at least 6 characters!', true); 
        return; 
    }
    
    if (userId) {
        const index = users.findIndex(u => u.id === userId);
        if (index !== -1) { 
            users[index] = { ...userData, id: userId }; 
            showToast('Student updated!'); 
        }
    } else {
        if (users.find(u => u.email === userData.email)) { 
            showToast('Email already exists!', true); 
            return; 
        }
        userData.id = generateUniqueId(); 
        users.push(userData); 
        showToast('Student added!');
    }
    
    const saved = await saveToSheetBest(); 
    if (saved) {
        backupToLocal(); 
        closeUserModal();
        loadAllUsers(); 
        updateAdminStats();
    } else {
        showToast('Error saving user!', true);
    }
}

function generateReport() {
    const reportDiv = document.getElementById('reportContent');
    const userList = users.filter(u => u.role !== 'admin');
    let html = ''; 
    let grandTotalHours = 0; 
    let grandTotalTasks = 0;
    
    for (const user of userList) {
        const userTasks = tasks.filter(t => t.userId === user.id);
        const totalHours = userTasks.reduce((sum, t) => sum + (parseFloat(t.hours) || 0), 0);
        const completed = userTasks.filter(t => t.status === 'Completed').length;
        
        grandTotalHours += totalHours; 
        grandTotalTasks += userTasks.length;
        
        let tasksHtml = '';
        for (const t of userTasks) {
            tasksHtml += `
                <tr>
                    <td>${formatDate(t.date)}</td>
                    <td>${escapeHtml(t.description)}</td>
                    <td>${t.hours}</td>
                    <td><span class="status-badge status-${t.status.replace(' ', '-')}">${t.status}</span></td>
                    <td>${t.otStatus ? t.otStatus : 'Regular'}</td>
                </tr>
            `;
        }
        
        html += `
            <div class="report-user">
                <h3><i class="fas fa-user"></i> ${escapeHtml(user.name)}</h3>
                <p><strong>Email:</strong> ${user.email}</p>
                <p><strong>Course:</strong> ${escapeHtml(user.course || 'N/A')} | <strong>School:</strong> ${escapeHtml(user.school || 'N/A')}</p>
                <p><strong>Total Hours:</strong> ${totalHours.toFixed(1)} hrs | <strong>Tasks:</strong> ${userTasks.length} | <strong>Completed:</strong> ${completed}</p>
                ${userTasks.length > 0 ? `
                <div class="table-container">
                    <table class="report-table">
                        <thead><tr><th>Date</th><th>Task Description</th><th>Hours</th><th>Status</th><th>OT Status</th></tr></thead>
                        <tbody>${tasksHtml}</tbody>
                    </table>
                </div>
                ` : '<p><em>No tasks yet.</em></p>'}
            </div>
        `;
    }
    
    html += `
        <div class="grand-total">
            <h3><i class="fas fa-chart-line"></i> Overall Summary</h3>
            <p><strong>Total Students:</strong> ${userList.length}</p>
            <p><strong>Total Hours Rendered:</strong> ${grandTotalHours.toFixed(1)} hrs</p>
            <p><strong>Total Tasks:</strong> ${grandTotalTasks}</p>
        </div>
    `;
    
    reportDiv.innerHTML = html;
}

function exportToCSV() {
    let csvData = [['Student', 'Email', 'Course', 'School', 'Date', 'Task', 'Hours', 'Status', 'OT Status']];
    
    for (const task of tasks) {
        const user = users.find(u => u.id === task.userId);
        if (user && user.role !== 'admin') {
            csvData.push([
                user.name, user.email, user.course || 'N/A', user.school || 'N/A',
                task.date, task.description, task.hours, task.status, task.otStatus || 'Regular'
            ]);
        }
    }
    
    const csvContent = csvData.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ojt_full_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Report exported successfully!');
}

function logout() { 
    sessionStorage.removeItem('currentUser'); 
    window.location.href = 'index.html'; 
}

// Make functions global
window.showTab = showTab;
window.viewUserTasks = viewUserTasks;
window.closeViewTasksModal = closeViewTasksModal;
window.deleteUser = deleteUser;
window.deleteTaskAsAdmin = deleteTaskAsAdmin;
window.openAddUserModal = openAddUserModal;
window.closeUserModal = closeUserModal;
window.exportToCSV = exportToCSV;
window.logout = logout;
window.approveOT = approveOT;
window.rejectOT = rejectOT;