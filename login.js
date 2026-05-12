document.addEventListener('DOMContentLoaded', async () => {
    await loadFromSheetBest();
    backupToLocal();
    
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('signupForm').addEventListener('submit', handleSignup);
    
    const roleSelect = document.getElementById('signupRole');
    const studentFields = document.getElementById('studentFields');
    const adminNote = document.getElementById('adminNote');
    
    roleSelect.addEventListener('change', function() {
        if (this.value === 'admin') {
            studentFields.style.display = 'none';
            adminNote.style.display = 'block';
            document.getElementById('signupCourse').required = false;
            document.getElementById('signupSchool').required = false;
        } else {
            studentFields.style.display = 'block';
            adminNote.style.display = 'none';
            document.getElementById('signupCourse').required = true;
            document.getElementById('signupSchool').required = true;
        }
    });
    
    const savedUser = sessionStorage.getItem('currentUser');
    if (savedUser) {
        const user = JSON.parse(savedUser);
        const userExists = users.find(u => u.id === user.id);
        if (userExists) {
            redirectToDashboard(userExists);
        }
    }
});

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

async function handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    await loadFromSheetBest();
    
    const user = users.find(u => u.email === email && u.password === password);
    
    if (user) {
        sessionStorage.setItem('currentUser', JSON.stringify(user));
        showToast(`Welcome ${user.name}! (${user.role === 'admin' ? 'Admin' : 'Student'})`);
        
        setTimeout(() => {
            if (user.role === 'admin') {
                window.location.href = 'admin.html';
            } else {
                window.location.href = 'user.html';
            }
        }, 500);
    } else {
        showToast('Invalid email or password!', true);
    }
}

function redirectToDashboard(user) {
    if (user.role === 'admin') {
        window.location.href = 'admin.html';
    } else {
        window.location.href = 'user.html';
    }
}

async function handleSignup(e) {
    e.preventDefault();
    
    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const role = document.getElementById('signupRole').value;
    
    if (password.length < 6) {
        showToast('Password must be at least 6 characters!', true);
        return;
    }
    
    await loadFromSheetBest();
    
    // Check if email already exists (case insensitive)
    const existingUser = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existingUser) {
        showToast('Email already registered!', true);
        return;
    }
    
    let newUser = {
        id: generateUniqueId(), // This ensures unique ID
        name: name,
        email: email,
        password: password,
        role: role,
        joinDate: new Date().toISOString().split('T')[0]
    };
    
    if (role === 'user') {
        const course = document.getElementById('signupCourse').value;
        const school = document.getElementById('signupSchool').value;
        
        if (!course || !school) {
            showToast('Please fill in Course and School for student account!', true);
            return;
        }
        
        newUser.course = course;
        newUser.school = school;
    } else {
        newUser.course = 'Administrator';
        newUser.school = 'OJT System';
    }
    
    users.push(newUser);
    const saved = await saveToSheetBest();
    
    if (saved) {
        const roleName = role === 'admin' ? 'Admin' : 'OJT Student';
        showToast(`${roleName} account created! Please login.`);
        switchTab('login');
        document.getElementById('signupForm').reset();
        document.getElementById('studentFields').style.display = 'block';
        document.getElementById('adminNote').style.display = 'none';
    } else {
        showToast('Error creating account!', true);
    }
}

window.switchTab = switchTab;