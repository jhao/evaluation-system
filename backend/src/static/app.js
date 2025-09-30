// 全局变量
let socket;
let currentGroup = null;
let groups = [];
let roles = [];
let rolesCourseId = null;
let adminGroups = [];
let adminGroupsCourseId = null;
let voters = [];
let currentVoter = null;
let photoCarouselInterval;
let currentPhotoSlide = 0;
let manualFullscreen = false;
let fullscreenTargetPageId = null;

let courses = [];
let currentCourseId = null;
let currentCourse = null;
let activeCourseId = null;
let activeCourse = null;

const ADMIN_TOKEN_STORAGE_KEY = 'evaluationAdminToken';
let adminToken = localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '';
let adminAuthPromptVisible = false;

const DISPLAY_STAGE_BASE_WIDTH = 1600;
const DISPLAY_STAGE_BASE_HEIGHT = 900;

// API基础URL
const API_BASE = '/api';

// 初始化应用
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

// 初始化应用
function initializeApp() {
    setupNavigation();
    setupSocketConnection();
    setupEventListeners();
    loadInitialData();
    updateAdminAuthUI();

    // 检查URL参数，如果有小组参数则显示手机端页面
    const urlParams = new URLSearchParams(window.location.search);
    const groupId = urlParams.get('g') || urlParams.get('group');
    if (groupId) {
        showMobilePage(groupId);
    }
}

// 设置导航
function setupNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        if (btn.id === 'fullscreenToggle') {
            return;
        }

        if (btn.id === 'adminLogoutBtn') {
            btn.addEventListener('click', handleAdminLogout);
            return;
        }

        btn.addEventListener('click', function() {
            const targetPage = this.dataset.targetPage || this.id.replace('Btn', 'Page');

            if (targetPage === 'adminPage' && !ensureAdminAuthenticated()) {
                return;
            }

            showPage(targetPage);
            setActiveNavButton(this.id);
        });
    });
}

function setActiveNavButton(buttonId) {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        if (btn.id === 'fullscreenToggle') {
            btn.classList.remove('active');
            return;
        }
        btn.classList.toggle('active', btn.id === buttonId);
    });
}

function getAdminToken() {
    return adminToken || '';
}

function updateAdminAuthUI() {
    const adminLogoutBtn = document.getElementById('adminLogoutBtn');
    if (adminLogoutBtn) {
        const isAuthenticated = Boolean(getAdminToken());
        adminLogoutBtn.classList.toggle('hidden', !isAuthenticated);
    }
}

function setAdminToken(token) {
    adminToken = token || '';
    if (adminToken) {
        localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, adminToken);
    } else {
        localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    }
    updateAdminAuthUI();
}

function clearAdminToken() {
    setAdminToken('');
}

function ensureAdminAuthenticated() {
    if (getAdminToken()) {
        return true;
    }
    showAdminLoginModal();
    return false;
}

function getActiveCourseId() {
    return activeCourseId;
}

function getCurrentCourseId() {
    return currentCourseId || activeCourseId;
}

function findCourseById(id) {
    if (!id) return null;
    const numericId = typeof id === 'string' ? parseInt(id, 10) : id;
    return courses.find(course => course.id === numericId) || null;
}

function setActiveCourseData(course) {
    activeCourse = course || null;
    activeCourseId = course ? course.id : null;
    updateCourseDisplays();
}

function setCurrentCourseData(course) {
    currentCourse = course || null;
    currentCourseId = course ? course.id : null;
    updateCourseDisplays();
    updateAdminCourseSelector();
}

function buildCourseUrl(path, courseId) {
    const targetId = courseId ?? getCurrentCourseId();
    if (!targetId) {
        return path;
    }

    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}course_id=${encodeURIComponent(targetId)}`;
}

function buildActiveCourseUrl(path) {
    const activeId = getActiveCourseId();
    if (!activeId) {
        return path;
    }
    return buildCourseUrl(path, activeId);
}

function withCourseId(payload, courseId) {
    const targetId = courseId ?? getCurrentCourseId();
    if (!targetId) {
        return { ...payload };
    }
    return { ...payload, course_id: targetId };
}

function appendCourseIdToFormData(formData, courseId) {
    const targetId = courseId ?? getCurrentCourseId();
    if (!targetId) {
        return formData;
    }
    if (!formData.has('course_id')) {
        formData.append('course_id', targetId);
    }
    return formData;
}

function updateCourseDisplays() {
    const courseName = (activeCourse && activeCourse.name) || '未设置课程';

    const navCourseEl = document.getElementById('navCourseName');
    if (navCourseEl) {
        navCourseEl.textContent = courseName;
    }

    const rankingCourseEl = document.getElementById('rankingCourseBadge');
    if (rankingCourseEl) {
        rankingCourseEl.textContent = courseName;
    }

    if (courseName) {
        document.title = `${courseName} - 小组评价系统`;
    } else {
        document.title = '小组评价系统';
    }
}

function updateAdminCourseSelector() {
    const selector = document.getElementById('adminCourseSelector');
    if (!selector) {
        return;
    }

    selector.innerHTML = '';

    if (!courses.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '暂无课程';
        selector.appendChild(option);
        selector.disabled = true;
        const activateBtn = document.getElementById('adminActivateCourseBtn');
        if (activateBtn) {
            activateBtn.disabled = true;
            activateBtn.textContent = '设为大屏课程';
        }
        return;
    }

    selector.disabled = false;

    courses.forEach(course => {
        const option = document.createElement('option');
        option.value = String(course.id);
        option.textContent = course.name + (course.is_active ? '（大屏展示）' : '');
        selector.appendChild(option);
    });

    const targetId = getCurrentCourseId();
    if (targetId) {
        selector.value = String(targetId);
    } else {
        selector.selectedIndex = 0;
    }

    const activateBtn = document.getElementById('adminActivateCourseBtn');
    if (activateBtn) {
        const selectedId = selector.value;
        const isActiveCourse = activeCourseId && selectedId === String(activeCourseId);
        activateBtn.disabled = !selectedId || isActiveCourse;
        activateBtn.textContent = isActiveCourse ? '当前为大屏课程' : '设为大屏课程';
    }
}

function showAdminLoginModal() {
    const modal = document.getElementById('adminLoginModal');
    const passwordInput = document.getElementById('adminPassword');
    const errorEl = document.getElementById('adminLoginError');

    if (errorEl) {
        errorEl.textContent = '';
    }

    if (passwordInput) {
        passwordInput.value = '';
        passwordInput.classList.remove('has-value');
        passwordInput.focus();
    }

    if (modal) {
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
    }

    adminAuthPromptVisible = true;
}

function hideAdminLoginModal() {
    const modal = document.getElementById('adminLoginModal');
    if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    }
    adminAuthPromptVisible = false;
}

async function handleAdminLoginSubmit(event) {
    event.preventDefault();

    const usernameInput = document.getElementById('adminUsername');
    const passwordInput = document.getElementById('adminPassword');
    const errorEl = document.getElementById('adminLoginError');
    const submitBtn = event.target.querySelector('button[type="submit"]');

    const username = usernameInput ? usernameInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!password) {
        if (errorEl) {
            errorEl.textContent = '请输入管理员密码';
        }
        if (passwordInput) {
            passwordInput.focus();
        }
        return;
    }

    if (errorEl) {
        errorEl.textContent = '';
    }

    if (submitBtn) {
        submitBtn.disabled = true;
    }

    try {
        await loginAdmin(username, password);
        hideAdminLoginModal();
        showMessage('登录成功', 'success');
        setActiveNavButton('adminBtn');
        showPage('adminPage');
    } catch (error) {
        if (errorEl) {
            errorEl.textContent = error.message || '登录失败，请重试';
        }
        if (passwordInput) {
            passwordInput.focus();
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
        }
    }
}

async function loginAdmin(username, password) {
    const response = await fetch(API_BASE + '/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });

    const resultText = await response.text();
    let result = {};
    if (resultText) {
        try {
            result = JSON.parse(resultText);
        } catch (error) {
            console.warn('解析登录响应失败:', error);
        }
    }

    if (!response.ok || !result.token) {
        const message = result.error || '账号或密码错误';
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }

    setAdminToken(result.token);
    adminAuthPromptVisible = false;
    return result;
}

async function requestAdminLogout() {
    const token = getAdminToken();
    if (!token) {
        return;
    }

    const response = await authorizedFetch(API_BASE + '/admin/logout', {
        method: 'POST'
    });

    if (!response.ok && response.status !== 401) {
        let message = '退出登录失败';
        const responseText = await response.text().catch(() => '');
        if (responseText) {
            try {
                const data = JSON.parse(responseText);
                message = data.error || data.message || message;
            } catch (parseError) {
                console.warn('解析退出响应失败:', parseError);
            }
        }

        const error = new Error(message);
        error.status = response.status;
        throw error;
    }
}

function finalizeAdminLogout(message = '已退出登录', messageType = 'success') {
    const adminPage = document.getElementById('adminPage');
    const wasAdminActive = adminPage && adminPage.classList.contains('active');

    adminAuthPromptVisible = false;
    clearAdminToken();

    if (wasAdminActive) {
        showPage('displayPage');
        setActiveNavButton('displayBtn');
    }

    if (message) {
        showMessage(message, messageType);
    }
}

async function handleAdminLogout(event) {
    if (event) {
        event.preventDefault();
    }

    const trigger = event ? event.currentTarget : null;
    if (trigger) {
        trigger.disabled = true;
    }

    let feedbackMessage = '已退出登录';
    let feedbackType = 'success';

    try {
        await requestAdminLogout();
    } catch (error) {
        if (!error.status || error.status !== 401) {
            console.error('退出登录失败:', error);
            feedbackMessage = error.message || '退出登录失败，请稍后重试';
            feedbackType = 'error';
        }
    } finally {
        if (trigger) {
            trigger.disabled = false;
        }
    }

    finalizeAdminLogout(feedbackMessage, feedbackType);
}

function handleAdminUnauthorized() {
    const hadToken = Boolean(getAdminToken());
    clearAdminToken();

    const adminPage = document.getElementById('adminPage');
    const isAdminActive = adminPage && adminPage.classList.contains('active');

    if (!isAdminActive) {
        adminAuthPromptVisible = false;
        return;
    }

    if (!adminAuthPromptVisible && hadToken) {
        showMessage('登录已过期，请重新登录', 'error');
        showAdminLoginModal();
    }

    setActiveNavButton('adminBtn');
}

// 显示页面
function showPage(pageId) {
    const pages = document.querySelectorAll('.page');
    pages.forEach(page => page.classList.remove('active'));
    
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.add('active');
        
        // 根据页面执行特定初始化
        switch(pageId) {
            case 'adminPage':
                loadAdminData();
                break;
            case 'rankingPage':
                loadRankingData();
                break;
            case 'displayPage':
                loadDisplayData();
                break;
        }
    }
}

// 设置WebSocket连接
function setupSocketConnection() {
    socket = io();
    
    socket.on('connect', function() {
        console.log('WebSocket连接成功');
    });
    
    socket.on('vote_updated', function(data) {
        if (currentGroup && data.group_id === currentGroup.id) {
            updateVoteStats(data.stats);
        }
    });
    
    socket.on('disconnect', function() {
        console.log('WebSocket连接断开');
    });
}

// 设置事件监听器
function setupEventListeners() {
    // 模态框关闭
    const modal = document.getElementById('modal');
    const closeBtn = document.querySelector('.close');

    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            modal.classList.remove('active');
        });
    }

    window.addEventListener('click', function(event) {
        if (event.target === modal) {
            modal.classList.remove('active');
        }
    });

    // 后台管理标签切换
    const adminTabs = document.querySelectorAll('.admin-tab');
    adminTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const targetTab = this.dataset.tab;
            switchAdminTab(targetTab);
            
            adminTabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
        });
    });
    
    // 手机端表单提交
    const verifyForm = document.getElementById('verifyForm');
    if (verifyForm) {
        verifyForm.addEventListener('submit', handleVerifySubmit);
    }

    // 大屏评价二维码交互
    const evaluationQrWrapper = document.getElementById('evaluationQrWrapper');
    if (evaluationQrWrapper) {
        const handleOpenMobile = (event) => {
            event.preventDefault();
            openMobilePage();
        };

        evaluationQrWrapper.addEventListener('click', handleOpenMobile);
        evaluationQrWrapper.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
                event.preventDefault();
                openMobilePage();
            }
        });
    }

    const photoPrevBtn = document.getElementById('photoPrevBtn');
    if (photoPrevBtn) {
        photoPrevBtn.addEventListener('click', showPreviousPhoto);
    }

    const photoNextBtn = document.getElementById('photoNextBtn');
    if (photoNextBtn) {
        photoNextBtn.addEventListener('click', showNextPhoto);
    }

    // 投票按钮
    const likeBtn = document.getElementById('likeBtn');
    const dislikeBtn = document.getElementById('dislikeBtn');
    
    if (likeBtn) likeBtn.addEventListener('click', () => submitVote(1));
    if (dislikeBtn) dislikeBtn.addEventListener('click', () => submitVote(-1));
    
    // 返回按钮
    const backToVerifyBtn = document.getElementById('backToVerifyBtn');
    if (backToVerifyBtn) {
        backToVerifyBtn.addEventListener('click', function() {
            showMobileStep('verifyStep');
            currentVoter = null;
        });
    }

    const fullscreenToggle = document.getElementById('fullscreenToggle');
    if (fullscreenToggle) {
        fullscreenToggle.addEventListener('click', enterFullscreenMode);
    }

    const exitFullscreenBtn = document.getElementById('exitFullscreenBtn');
    if (exitFullscreenBtn) {
        exitFullscreenBtn.addEventListener('click', exitFullscreenMode);
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('keydown', handleFullscreenKeydown);

    window.addEventListener('resize', handleWindowResize);

    const adminLoginForm = document.getElementById('adminLoginForm');
    if (adminLoginForm) {
        adminLoginForm.addEventListener('submit', handleAdminLoginSubmit);
        initializeAdminLoginInputStyles(adminLoginForm);
    }

    const adminLoginModal = document.getElementById('adminLoginModal');
    if (adminLoginModal) {
        adminLoginModal.addEventListener('click', (event) => {
            if (event.target === adminLoginModal) {
                hideAdminLoginModal();
            }
        });
    }

    const adminLoginCloseBtn = document.getElementById('adminLoginCloseBtn');
    if (adminLoginCloseBtn) {
        adminLoginCloseBtn.addEventListener('click', hideAdminLoginModal);
    }

    const adminLoginCancelBtn = document.getElementById('adminLoginCancelBtn');
    if (adminLoginCancelBtn) {
        adminLoginCancelBtn.addEventListener('click', hideAdminLoginModal);
    }

    const adminCourseSelector = document.getElementById('adminCourseSelector');
    if (adminCourseSelector) {
        adminCourseSelector.addEventListener('change', handleAdminCourseChange);
    }

    const adminActivateCourseBtn = document.getElementById('adminActivateCourseBtn');
    if (adminActivateCourseBtn) {
        adminActivateCourseBtn.addEventListener('click', handleAdminActivateCourse);
    }

    // 后台管理按钮事件绑定
    setupAdminButtonEvents();
}

function initializeAdminLoginInputStyles(form) {
    const loginInputs = form.querySelectorAll('input');
    loginInputs.forEach((input) => {
        const toggleValueClass = () => {
            if (input.value && input.value.trim() !== '') {
                input.classList.add('has-value');
            } else {
                input.classList.remove('has-value');
            }
        };

        toggleValueClass();
        input.addEventListener('input', toggleValueClass);
        input.addEventListener('blur', toggleValueClass);
    });
}

function prepareFullscreenTargetPage() {
    const activePage = document.querySelector('.page.active');

    if (activePage && (activePage.id === 'displayPage' || activePage.id === 'rankingPage')) {
        fullscreenTargetPageId = activePage.id;
        return activePage;
    }

    fullscreenTargetPageId = 'displayPage';
    showPage('displayPage');
    setActiveNavButton('displayBtn');
    return document.getElementById('displayPage');
}

async function enterFullscreenMode() {
    const targetPage = prepareFullscreenTargetPage();
    if (!targetPage) {
        return;
    }

    if (document.fullscreenElement || manualFullscreen) {
        activateFullscreenUI();
        return;
    }

    const targetElement = document.documentElement;

    if (targetElement && targetElement.requestFullscreen) {
        try {
            await targetElement.requestFullscreen();
        } catch (error) {
            console.warn('启动全屏失败:', error);
            manualFullscreen = true;
            activateFullscreenUI();
        }
    } else {
        manualFullscreen = true;
        activateFullscreenUI();
    }
}

async function exitFullscreenMode() {
    if (manualFullscreen) {
        manualFullscreen = false;
        deactivateFullscreenUI();
        fullscreenTargetPageId = null;
        return;
    }

    if (document.fullscreenElement) {
        try {
            await document.exitFullscreen();
        } catch (error) {
            console.warn('退出全屏失败:', error);
            deactivateFullscreenUI();
            fullscreenTargetPageId = null;
        }
    } else {
        deactivateFullscreenUI();
        fullscreenTargetPageId = null;
    }
}

function handleFullscreenChange() {
    const isActive = Boolean(document.fullscreenElement);

    if (isActive) {
        activateFullscreenUI();
    } else if (!manualFullscreen) {
        deactivateFullscreenUI();
    }

    if (!isActive) {
        manualFullscreen = false;
        fullscreenTargetPageId = null;
    }
}

function handleFullscreenKeydown(event) {
    if (event.key === 'Escape' && manualFullscreen) {
        manualFullscreen = false;
        deactivateFullscreenUI();
    }
}

function handleWindowResize() {
    if (document.body.classList.contains('fullscreen-mode')) {
        updateDisplayScale();
    }
}

function activateFullscreenUI() {
    document.body.classList.add('fullscreen-mode');
    if (fullscreenTargetPageId) {
        document.body.setAttribute('data-fullscreen-page', fullscreenTargetPageId);
    } else {
        document.body.removeAttribute('data-fullscreen-page');
    }
    updateDisplayScale();
}

function deactivateFullscreenUI() {
    document.body.classList.remove('fullscreen-mode');
    document.body.removeAttribute('data-fullscreen-page');
    updateDisplayScale();
}

function updateDisplayScale() {
    const stage = document.querySelector('#displayPage .display-stage');
    if (!stage) {
        return;
    }

    const inFullscreen = document.body.classList.contains('fullscreen-mode') && fullscreenTargetPageId === 'displayPage';

    if (inFullscreen) {
        const scaleX = window.innerWidth / DISPLAY_STAGE_BASE_WIDTH;
        const scaleY = window.innerHeight / DISPLAY_STAGE_BASE_HEIGHT;
        const scale = Math.min(scaleX, scaleY);

        stage.style.transform = `scale(${scale})`;
        stage.style.width = `${DISPLAY_STAGE_BASE_WIDTH}px`;
        stage.style.height = `${DISPLAY_STAGE_BASE_HEIGHT}px`;
        stage.classList.add('scaled');
    } else {
        stage.style.transform = '';
        stage.style.width = '';
        stage.style.height = '';
        stage.classList.remove('scaled');
    }
}

// 设置后台管理按钮事件
function setupAdminButtonEvents() {
    const addCourseBtn = document.getElementById('addCourseBtn');
    if (addCourseBtn) {
        addCourseBtn.addEventListener('click', showAddCourseModal);
    }

    // 添加小组按钮
    const addGroupBtn = document.getElementById('addGroupBtn');
    if (addGroupBtn) {
        addGroupBtn.addEventListener('click', showAddGroupModal);
    }
    
    // 添加评价人按钮
    const addVoterBtn = document.getElementById('addVoterBtn');
    if (addVoterBtn) {
        addVoterBtn.addEventListener('click', showAddVoterModal);
    }
    
    // 添加职务按钮
    const addRoleBtn = document.getElementById('addRoleBtn');
    if (addRoleBtn) {
        addRoleBtn.addEventListener('click', showAddRoleModal);
    }
    
    // 下载模板按钮
    const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');
    if (downloadTemplateBtn) {
        downloadTemplateBtn.addEventListener('click', downloadVotersTemplate);
    }
    
    // 批量导入按钮
    const importVotersBtn = document.getElementById('importVotersBtn');
    if (importVotersBtn) {
        importVotersBtn.addEventListener('click', showImportVotersModal);
    }
    
    // 文件选择事件
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', handleFileImport);
    }
}

async function loadCourses() {
    try {
        const data = await apiCall('/courses');
        courses = Array.isArray(data) ? data : [];
    } catch (error) {
        console.error('加载课程失败:', error);
        courses = [];
    }

    if (!courses.length) {
        setActiveCourseData(null);
        setCurrentCourseData(null);
        renderAdminCoursesList();
        return courses;
    }

    const active = courses.find(course => course.is_active) || courses[0];
    setActiveCourseData(active);

    const desiredCurrentId = currentCourseId;
    const current = desiredCurrentId ? findCourseById(desiredCurrentId) : null;
    setCurrentCourseData(current || active);

    renderAdminCoursesList();

    return courses;
}

// 加载初始数据
async function loadInitialData() {
    try {
        await loadCourses();

        const displayCourseId = getActiveCourseId();
        const managementCourseId = getCurrentCourseId();

        const initialTasks = [];

        initialTasks.push(loadGroups(displayCourseId));
        initialTasks.push(loadRoles(managementCourseId));

        if (getAdminToken()) {
            initialTasks.push(loadVoters({ silent: true, courseId: managementCourseId }));
        } else {
            voters = [];
        }

        await Promise.all(initialTasks);

        if (groups.length > 0) {
            selectGroup(groups[0]);
        }
    } catch (error) {
        console.error('加载初始数据失败:', error);
        showMessage('加载数据失败，请刷新页面重试', 'error');
    }
}

async function loadDisplayData() {
    const previousGroupId = currentGroup ? currentGroup.id : null;

    try {
        await loadGroups(getActiveCourseId());

        if (groups.length === 0) {
            currentGroup = null;
            const membersList = document.getElementById('membersList');
            if (membersList) {
                membersList.innerHTML = '<p style="text-align: center; color: #B0C4DE;">暂无小组数据</p>';
            }
            updateGroupDisplay();
            return;
        }

        const matchedGroup = previousGroupId ? groups.find(group => group.id === previousGroupId) : null;
        if (matchedGroup) {
            selectGroup(matchedGroup);
        } else {
            selectGroup(groups[0]);
        }
    } catch (error) {
        console.error('刷新大屏数据失败:', error);
        showMessage('刷新大屏数据失败', 'error');
    }
}

function authorizedFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = getAdminToken();

    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    return fetch(url, { ...options, headers });
}

// API调用函数
async function apiCall(url, options = {}) {
    const isFormData = options.body instanceof FormData;
    const headers = new Headers(options.headers || {});

    if (!isFormData && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    try {
        const response = await authorizedFetch(API_BASE + url, {
            ...options,
            headers
        });

        if (!response.ok) {
            let errorData = {};
            try {
                errorData = await response.json();
            } catch (parseError) {
                errorData = {};
            }

            if (response.status === 401) {
                handleAdminUnauthorized();
            }

            const error = new Error(errorData.error || `HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        }

        if (response.status === 204) {
            return null;
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const text = await response.text();
            return text ? JSON.parse(text) : null;
        }

        return await response.json();
    } catch (error) {
        if (error.status !== 401) {
            console.error('API调用失败:', error);
        }
        throw error;
    }
}

// 加载小组数据
async function loadGroups(courseId, options = {}) {
    const targetCourseId = courseId ?? getCurrentCourseId() ?? getActiveCourseId();
    const url = buildCourseUrl('/groups', targetCourseId);
    groups = await apiCall(url);
    if (!options.skipRenderTabs) {
        renderGroupTabs();
    }
    return groups;
}

// 加载职务数据
async function loadRoles(courseId) {
    const targetCourseId = courseId ?? getCurrentCourseId();
    const url = buildCourseUrl('/roles', targetCourseId);
    roles = await apiCall(url);
    rolesCourseId = targetCourseId;
    return roles;
}

// 加载评价人数据
async function loadVoters(options = {}) {
    try {
        const url = buildCourseUrl('/voters', options.courseId);
        voters = await apiCall(url);
        return voters;
    } catch (error) {
        if (error.status === 401) {
            voters = [];
            if (!options.silent) {
                throw error;
            }
            return voters;
        }

        if (!options.silent) {
            throw error;
        }

        console.error('加载评价人失败:', error);
        voters = [];
        return voters;
    }
}

// 渲染小组标签
function renderGroupTabs() {
    const tabsContainer = document.getElementById('groupTabs');
    if (!tabsContainer) return;
    
    tabsContainer.innerHTML = '';
    
    groups.forEach(group => {
        const tab = document.createElement('button');
        tab.className = 'group-tab';
        tab.textContent = group.name;
        tab.addEventListener('click', () => selectGroup(group));
        tabsContainer.appendChild(tab);
    });
}

// 选择小组
function selectGroup(group) {
    currentGroup = group;
    
    // 更新标签状态
    const tabs = document.querySelectorAll('.group-tab');
    tabs.forEach((tab, index) => {
        tab.classList.toggle('active', groups[index] === group);
    });
    
    // 更新显示内容
    updateGroupDisplay();
    loadGroupMembers();
    
    // 加入WebSocket房间
    if (socket) {
        socket.emit('join_group', { group_id: group.id });
    }
}

// 更新小组显示
function updateGroupDisplay() {
    const shareLinkElement = document.getElementById('evaluationShareLink');
    let mobileUrl = null;
    if (currentGroup) {
        mobileUrl = buildMobileEvaluationUrl(currentGroup.id);
        if (shareLinkElement) {
            shareLinkElement.textContent = mobileUrl;
            shareLinkElement.href = mobileUrl;
        }
    } else if (shareLinkElement) {
        shareLinkElement.textContent = '请选择小组';
        shareLinkElement.href = '#';
    }

    updateEvaluationQrCode(currentGroup, mobileUrl);

    if (!currentGroup) return;

    const groupName = document.getElementById('groupName');
    const groupLogo = document.getElementById('groupLogo');

    if (groupName) groupName.textContent = currentGroup.name;
    if (groupLogo) {
        if (currentGroup.logo) {
            groupLogo.src = currentGroup.logo;
            groupLogo.style.display = 'block';
        } else {
            groupLogo.style.display = 'none';
        }
    }

    // 更新投票统计
    updateVoteStats(currentGroup ? currentGroup.vote_stats : null);

    // 更新照片轮播
    updatePhotoCarousel();
}

function updateEvaluationQrCode(group, mobileUrl) {
    const qrContainer = document.getElementById('evaluationQrCode');
    if (!qrContainer) return;

    if (!group) {
        qrContainer.innerHTML = '<div class="qr-placeholder">请选择小组</div>';
        return;
    }

    const targetMobileUrl = mobileUrl || buildMobileEvaluationUrl(group.id);
    const qrImageUrl = `${buildGroupQrCodeImageUrl(group.id)}?t=${Date.now()}`;

    const qrImage = document.createElement('img');
    qrImage.src = qrImageUrl;
    qrImage.alt = `小组${group.name || ''}评价二维码`;
    qrImage.loading = 'lazy';
    qrImage.decoding = 'async';

    qrImage.addEventListener('error', (error) => {
        console.error('二维码加载失败', error);
        qrContainer.innerHTML = '<div class="qr-placeholder">二维码加载失败</div>';
    });

    qrImage.addEventListener('load', () => {
        // 将二维码图片加载成功后，确保显示正确的移动端链接
        const shareLinkElement = document.getElementById('evaluationShareLink');
        if (shareLinkElement) {
            shareLinkElement.textContent = targetMobileUrl;
            shareLinkElement.href = targetMobileUrl;
        }
    });

    qrContainer.innerHTML = '';
    qrContainer.appendChild(qrImage);
}

// 更新投票统计
function updateVoteStats(stats) {
    // 如果没有传入stats参数，尝试从currentGroup获取
    if (!stats && currentGroup && currentGroup.vote_stats) {
        stats = currentGroup.vote_stats;
    }
    
    // 如果仍然没有stats，使用默认值
    if (!stats) {
        stats = { likes: 0, dislikes: 0 };
    }
    
    const totalScore = document.getElementById('totalScore');
    
    // 计算总计分：赞的分数总和 - 踩的分数总和
    const score = (stats.likes || 0) - (stats.dislikes || 0);
    if (totalScore) totalScore.textContent = score;
    
    // 添加动画效果
    if (totalScore) {
        totalScore.style.transform = 'scale(1.1)';
        setTimeout(() => {
            totalScore.style.transform = 'scale(1)';
        }, 200);
    }
}

// 加载小组成员
async function loadGroupMembers() {
    if (!currentGroup) return;
    
    try {
        const members = await apiCall(`/groups/${currentGroup.id}/members`);
        renderMembersList(members);
    } catch (error) {
        console.error('加载成员失败:', error);
        const membersList = document.getElementById('membersList');
        if (membersList) {
            membersList.innerHTML = '<p style="text-align: center; color: #B0C4DE;">加载成员失败</p>';
        }
    }
}

// 渲染成员列表
function renderMembersList(members) {
    const membersList = document.getElementById('membersList');
    if (!membersList) return;

    const safeMembers = Array.isArray(members) ? members : [];
    let memberCards = [];

    if (safeMembers.length === 0) {
        memberCards.push(`
            <div class="member-card member-card-placeholder">
                <div class="member-card-name">暂无成员</div>
                <div class="member-card-meta">等待添加</div>
            </div>
        `);
    } else {
        memberCards = safeMembers.map(member => {
            const metaParts = [member.role_name || '未知职务'];
            if (member.company) {
                metaParts.push(member.company);
            }

            return `
                <div class="member-card">
                    <div class="member-card-name">${member.name}</div>
                    <div class="member-card-meta">${metaParts.join(' ｜ ')}</div>
                </div>
            `;
        });
    }

    const placeholdersNeeded = Math.max(0, 15 - memberCards.length);
    const placeholders = Array.from({ length: placeholdersNeeded }).map(() => `
        <div class="member-card member-card-placeholder">
            <div class="member-card-name"></div>
            <div class="member-card-meta"></div>
        </div>
    `);

    membersList.innerHTML = [...memberCards, ...placeholders].join('');
}

// 更新照片轮播
function updatePhotoCarousel() {
    const photoSlides = document.getElementById('photoSlides');
    const carouselDots = document.getElementById('carouselDots');
    const prevButton = document.getElementById('photoPrevBtn');
    const nextButton = document.getElementById('photoNextBtn');

    if (!photoSlides || !carouselDots || !currentGroup) return;

    // 清除现有轮播
    if (photoCarouselInterval) {
        clearInterval(photoCarouselInterval);
    }

    const photos = currentGroup.photos || [];

    if (prevButton) {
        prevButton.disabled = photos.length <= 1;
        prevButton.style.display = photos.length === 0 ? 'none' : 'flex';
    }

    if (nextButton) {
        nextButton.disabled = photos.length <= 1;
        nextButton.style.display = photos.length === 0 ? 'none' : 'flex';
    }

    if (photos.length === 0) {
        currentPhotoSlide = 0;
        photoSlides.innerHTML = '<div class="photo-slide"><div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #B0C4DE;">暂无照片</div></div>';
        carouselDots.innerHTML = '';
        return;
    }

    // 渲染照片
    photoSlides.innerHTML = '';
    carouselDots.innerHTML = '';

    photos.forEach((photo, index) => {
        const slide = document.createElement('div');
        slide.className = 'photo-slide';
        slide.innerHTML = `<img src="${photo}" alt="小组照片${index + 1}">`;
        photoSlides.appendChild(slide);

        const dot = document.createElement('div');
        dot.className = `carousel-dot ${index === 0 ? 'active' : ''}`;
        dot.addEventListener('click', () => showPhotoSlide(index));
        carouselDots.appendChild(dot);
    });

    currentPhotoSlide = 0;
    showPhotoSlide(currentPhotoSlide);

    // 自动轮播
    photoCarouselInterval = setInterval(() => {
        currentPhotoSlide = (currentPhotoSlide + 1) % photos.length;
        showPhotoSlide(currentPhotoSlide);
    }, 4000);
}

// 显示指定照片
function showPhotoSlide(index) {
    const photoSlides = document.getElementById('photoSlides');
    const dots = document.querySelectorAll('.carousel-dot');

    if (photoSlides) {
        photoSlides.style.transform = `translateX(-${index * 100}%)`;
    }

    dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === index);
    });

    currentPhotoSlide = index;
}

function showPreviousPhoto() {
    const photoSlides = document.getElementById('photoSlides');
    if (!photoSlides || photoSlides.children.length === 0) return;

    const totalSlides = photoSlides.children.length;
    const targetIndex = (currentPhotoSlide - 1 + totalSlides) % totalSlides;
    showPhotoSlide(targetIndex);
}

function showNextPhoto() {
    const photoSlides = document.getElementById('photoSlides');
    if (!photoSlides || photoSlides.children.length === 0) return;

    const totalSlides = photoSlides.children.length;
    const targetIndex = (currentPhotoSlide + 1) % totalSlides;
    showPhotoSlide(targetIndex);
}

// 打开手机端评价页面
function buildMobileEvaluationUrl(groupId) {
    return `${window.location.origin}/m?g=${groupId}`;
}

function buildGroupQrCodeImageUrl(groupId) {
    return `${API_BASE}/groups/${groupId}/qrcode`;
}

function openMobilePage() {
    if (!currentGroup) {
        showMessage('请先选择一个小组', 'error');
        return;
    }

    const mobileUrl = buildMobileEvaluationUrl(currentGroup.id);
    window.open(mobileUrl, '_blank');
}

// 显示手机端页面
function showMobilePage(groupId) {
    const group = groups.find(g => g.id == groupId);
    if (!group) {
        showMessage('小组不存在', 'error');
        return;
    }
    
    currentGroup = group;
    showPage('mobilePage');
    
    // 隐藏导航栏
    const navbar = document.querySelector('.navbar');
    if (navbar) navbar.style.display = 'none';
    
    // 更新小组名称
    const voteGroupName = document.getElementById('voteGroupName');
    if (voteGroupName) voteGroupName.textContent = `${group.name} - 评价`;
}

// 显示手机端步骤
function showMobileStep(stepId) {
    const steps = document.querySelectorAll('.mobile-step');
    steps.forEach(step => step.classList.remove('active'));
    
    const targetStep = document.getElementById(stepId);
    if (targetStep) {
        targetStep.classList.add('active');
    }
}

// 处理身份验证提交
async function handleVerifySubmit(event) {
    event.preventDefault();
    
    const name = document.getElementById('voterName').value.trim();
    const phone = document.getElementById('voterPhone').value.trim();
    
    if (!name || !phone) {
        showMessage('请填写完整信息', 'error');
        return;
    }
    
    try {
        const result = await apiCall('/verify-voter', {
            method: 'POST',
            body: JSON.stringify({
                name: name,
                phone: phone,
                group_id: currentGroup.id
            })
        });
        
        currentVoter = result;
        
        // 更新投票页面信息
        const voterInfo = document.getElementById('voterInfo');
        if (voterInfo) {
            voterInfo.textContent = `${result.name}，您的投票权重为 ${result.weight}`;
        }
        
        showMobileStep('voteStep');
        
    } catch (error) {
        showMessage(error.message, 'error');
    }
}

// 提交投票
async function submitVote(voteType) {
    if (!currentVoter || !currentGroup) return;
    
    try {
        const result = await apiCall('/vote', {
            method: 'POST',
            body: JSON.stringify({
                voter_id: currentVoter.voter_id,
                group_id: currentGroup.id,
                vote_type: voteType
            })
        });
        
        showMessage(result.message, 'success');
        showMobileStep('completeStep');
        
        // 通过WebSocket广播更新
        if (socket) {
            socket.emit('vote_update', {
                group_id: currentGroup.id,
                stats: result.stats
            });
        }
        
    } catch (error) {
        showMessage(error.message, 'error');
    }
}

// 后台管理相关函数
async function loadAdminData(options = {}) {
    if (!options.skipCourses) {
        await loadCourses();
    }
    await Promise.all([
        loadAdminGroups(),
        loadAdminVoters(),
        loadAdminRoles()
    ]);
    await loadVotesData();
}

function switchAdminTab(tabName) {
    const contents = document.querySelectorAll('.admin-content');
    contents.forEach(content => content.classList.remove('active'));

    const targetContent = document.getElementById(tabName + 'Tab');
    if (targetContent) {
        targetContent.classList.add('active');
        if (tabName === 'votes') {
            loadVotesData();
        }
    }
}

// 加载后台小组管理
async function loadAdminGroups() {
    try {
        const result = await apiCall(buildCourseUrl('/groups', getCurrentCourseId()));
        adminGroups = Array.isArray(result) ? result : [];
        adminGroupsCourseId = getCurrentCourseId();
        renderAdminGroups(adminGroups);
        updateVoteGroupFilter(adminGroups);
    } catch (error) {
        console.error('加载小组失败:', error);
    }
}

function renderAdminGroups(groups) {
    const groupsList = document.getElementById('groupsList');
    if (!groupsList) return;
    
    groupsList.innerHTML = '';
    
    groups.forEach(group => {
        const item = document.createElement('div');
        item.className = 'admin-item';
        item.innerHTML = `
            <div class="admin-item-info">
                <div class="admin-item-title">${group.name}</div>
                <div class="admin-item-details">
                    状态: ${group.status === 0 ? '进行中' : '已锁定'} | 
                    赞: ${group.vote_stats.likes} | 
                    踩: ${group.vote_stats.dislikes}
                </div>
            </div>
            <div class="admin-item-actions">
                <button class="btn btn-secondary" onclick="editGroup(${group.id})">编辑</button>
                <button class="btn btn-info" onclick="manageGroupMembers(${group.id})">管理成员</button>
                <button class="btn btn-secondary" onclick="manageGroupPhotos(${group.id})">风采管理</button>
                <button class="btn ${group.status === 0 ? 'btn-danger' : 'btn-primary'}"
                        onclick="toggleGroupLock(${group.id}, ${group.status === 0})">
                    ${group.status === 0 ? '锁定' : '解锁'}
                </button>
                <button class="btn btn-danger" onclick="deleteGroup(${group.id})">删除</button>
            </div>
        `;
        groupsList.appendChild(item);
    });
}

function updateVoteGroupFilter(groups) {
    const filter = document.getElementById('voteGroupFilter');
    if (!filter) return;

    const previousValue = filter.value;
    filter.innerHTML = '<option value="">全部小组</option>' +
        groups.map(group => `<option value="${group.id}">${group.name}</option>`).join('');

    if (previousValue && groups.some(group => String(group.id) === previousValue)) {
        filter.value = previousValue;
    }
}

// 加载后台评价人管理
async function loadAdminVoters() {
    try {
        const voters = await apiCall(buildCourseUrl('/voters', getCurrentCourseId()));
        renderAdminVoters(voters);
    } catch (error) {
        console.error('加载评价人失败:', error);
    }
}

function renderAdminVoters(voters) {
    const votersList = document.getElementById('votersList');
    if (!votersList) return;
    
    votersList.innerHTML = '';
    
    voters.forEach(voter => {
        const item = document.createElement('div');
        item.className = 'admin-item';
        item.innerHTML = `
            <div class="admin-item-info">
                <div class="admin-item-title">${voter.name}</div>
                <div class="admin-item-details">
                    手机号: ${voter.phone} | 权重: ${voter.weight}
                </div>
            </div>
            <div class="admin-item-actions">
                <button class="btn btn-secondary" onclick="editVoter(${voter.id})">编辑</button>
                <button class="btn btn-danger" onclick="deleteVoter(${voter.id})">删除</button>
            </div>
        `;
        votersList.appendChild(item);
    });
}

// 加载后台职务管理
async function loadAdminRoles() {
    try {
        const result = await apiCall(buildCourseUrl('/roles', getCurrentCourseId()));
        roles = Array.isArray(result) ? result : [];
        rolesCourseId = getCurrentCourseId();
        renderAdminRoles(roles);
    } catch (error) {
        console.error('加载职务失败:', error);
    }
}

function renderAdminRoles(roles) {
    const rolesList = document.getElementById('rolesList');
    if (!rolesList) return;

    rolesList.innerHTML = '';

    roles.forEach(role => {
        const item = document.createElement('div');
        item.className = 'admin-item';
        item.innerHTML = `
            <div class="admin-item-info">
                <div class="admin-item-title">${role.name}</div>
            </div>
            <div class="admin-item-actions">
                <button class="btn btn-danger" onclick="deleteRole(${role.id})">删除</button>
            </div>
        `;
        rolesList.appendChild(item);
    });
}

// 课程管理
function renderAdminCoursesList() {
    const coursesList = document.getElementById('coursesList');
    if (!coursesList) return;

    coursesList.innerHTML = '';

    if (!courses.length) {
        coursesList.innerHTML = '<p style="text-align: center; color: #B0C4DE;">暂无课程，请先创建课程</p>';
        return;
    }

    courses.forEach(course => {
        const item = document.createElement('div');
        item.className = 'admin-item';

        const createdAt = course.created_at ? new Date(course.created_at).toLocaleString() : '未知时间';
        const escapedName = escapeHtml(course.name || '');
        const descriptionHtml = course.description
            ? `<div class="admin-item-details">${escapeHtml(course.description)}</div>`
            : '';
        const statusBadge = course.is_active ? '<span class="admin-status-badge">大屏展示中</span>' : '';

        item.innerHTML = `
            <div class="admin-item-info">
                <div class="admin-item-title">${escapedName}${statusBadge}</div>
                <div class="admin-item-details">创建时间: ${createdAt}</div>
                ${descriptionHtml}
            </div>
            <div class="admin-item-actions">
                <button class="btn btn-secondary" onclick="setManagementCourse(${course.id})">管理数据</button>
                ${course.is_active ? '' : `<button class="btn btn-info" onclick="activateCourseFromList(${course.id})">设为大屏</button>`}
                <button class="btn btn-secondary" onclick="showEditCourseModal(${course.id})">编辑</button>
                <button class="btn btn-danger" onclick="deleteCourse(${course.id})">删除</button>
            </div>
        `;

        coursesList.appendChild(item);
    });
}

async function setManagementCourse(courseId, options = {}) {
    const course = findCourseById(courseId);
    if (!course) {
        if (options.notify !== false) {
            showMessage('课程不存在', 'error');
        }
        return;
    }

    setCurrentCourseData(course);
    await loadAdminData({ skipCourses: true });

    if (options.notify !== false) {
        showMessage(`已切换到「${course.name}」课程`, 'success');
    }
}

async function handleAdminCourseChange(event) {
    const selectedId = parseInt(event.target.value, 10);
    if (!selectedId) {
        return;
    }
    await setManagementCourse(selectedId, { notify: false });
}

async function activateCourseRequest(courseId) {
    if (!courseId) {
        showMessage('请选择课程', 'error');
        return;
    }

    try {
        await apiCall(`/courses/${courseId}/activate`, { method: 'POST' });
        currentCourseId = courseId;
        await loadCourses();
        await loadAdminData({ skipCourses: true });
        await Promise.all([loadDisplayData(), loadRankingData()]);
        const course = findCourseById(courseId);
        showMessage(`已切换「${course ? course.name : '所选'}」为大屏课程`, 'success');
    } catch (error) {
        showMessage('切换课程失败: ' + error.message, 'error');
    }
}

function activateCourseFromList(courseId) {
    activateCourseRequest(courseId);
}

async function handleAdminActivateCourse(event) {
    if (event) {
        event.preventDefault();
    }
    const selector = document.getElementById('adminCourseSelector');
    if (!selector) return;

    const selectedId = parseInt(selector.value, 10);
    if (!selectedId) {
        showMessage('请选择课程', 'error');
        return;
    }
    await activateCourseRequest(selectedId);
}

function showAddCourseModal() {
    const content = `
        <h3>新建课程</h3>
        <form id="addCourseForm">
            <div class="form-group">
                <label for="courseName">课程名称</label>
                <input type="text" id="courseName" name="name" required>
            </div>
            <div class="form-group">
                <label for="courseDescription">课程简介（可选）</label>
                <textarea id="courseDescription" name="description" rows="3" placeholder="请输入课程简介"></textarea>
            </div>
            <div class="form-actions">
                <button type="submit">保存</button>
                <button type="button" onclick="closeModal()">取消</button>
            </div>
        </form>
    `;
    showModal(content);

    const form = document.getElementById('addCourseForm');
    if (form) {
        form.addEventListener('submit', handleAddCourse);
    }
}

async function handleAddCourse(event) {
    event.preventDefault();

    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData);

    try {
        const course = await apiCall('/courses', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        currentCourseId = course.id;
        await loadCourses();
        await loadAdminData({ skipCourses: true });

        closeModal();
        showMessage('课程创建成功', 'success');
    } catch (error) {
        showMessage('创建课程失败: ' + error.message, 'error');
    }
}

function showEditCourseModal(courseId) {
    const course = findCourseById(courseId);
    if (!course) {
        showMessage('课程不存在', 'error');
        return;
    }

    const content = `
        <h3>编辑课程</h3>
        <form id="editCourseForm">
            <div class="form-group">
                <label for="editCourseName">课程名称</label>
                <input type="text" id="editCourseName" name="name" value="${course.name}" required>
            </div>
            <div class="form-group">
                <label for="editCourseDescription">课程简介（可选）</label>
                <textarea id="editCourseDescription" name="description" rows="3">${course.description || ''}</textarea>
            </div>
            <div class="form-actions">
                <button type="submit">保存</button>
                <button type="button" onclick="closeModal()">取消</button>
            </div>
        </form>
    `;
    showModal(content);

    const form = document.getElementById('editCourseForm');
    if (form) {
        form.addEventListener('submit', function(event) {
            event.preventDefault();
            handleEditCourse(courseId, event);
        });
    }
}

async function handleEditCourse(courseId, event) {
    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData);

    try {
        await apiCall(`/courses/${courseId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });

        await loadCourses();
        await loadAdminData({ skipCourses: true });

        closeModal();
        showMessage('课程更新成功', 'success');
    } catch (error) {
        showMessage('更新课程失败: ' + error.message, 'error');
    }
}

async function deleteCourse(courseId) {
    const course = findCourseById(courseId);
    const courseName = course ? course.name : '该课程';

    if (!confirm(`确定要删除「${courseName}」吗？此操作无法撤销。`)) {
        return;
    }

    try {
        await apiCall(`/courses/${courseId}`, { method: 'DELETE' });
        await loadCourses();
        await loadAdminData({ skipCourses: true });
        showMessage('课程已删除', 'success');
    } catch (error) {
        showMessage('删除课程失败: ' + error.message, 'error');
    }
}

// 排名相关函数
async function loadRankingData() {
    try {
        const ranking = await apiCall(buildActiveCourseUrl('/ranking'));
        renderRanking(ranking);
    } catch (error) {
        console.error('加载排名失败:', error);
        showMessage('加载排名失败', 'error');
    }
}

function renderRanking(ranking) {
    const rankingDisplay = document.getElementById('rankingDisplay');
    if (!rankingDisplay) return;
    
    rankingDisplay.innerHTML = '';
    
    if (ranking.length === 0) {
        rankingDisplay.innerHTML = '<p style="color: #B0C4DE;">暂无排名数据</p>';
        return;
    }
    
    ranking.forEach(item => {
        const rankingItem = document.createElement('div');
        rankingItem.className = `ranking-item rank-${item.rank} fade-in`;

        let order = item.rank;
        if (item.rank === 1) {
            order = 2;
        } else if (item.rank === 2) {
            order = 1;
        } else if (item.rank === 3) {
            order = 3;
        }
        rankingItem.style.order = order;
        
        let crown = '';
        if (item.rank === 1) crown = '<div class="ranking-crown">👑</div>';
        else if (item.rank === 2) crown = '<div class="ranking-crown">🥈</div>';
        else if (item.rank === 3) crown = '<div class="ranking-crown">🥉</div>';

        rankingItem.innerHTML = `
            ${crown}
            <div class="ranking-content">
                <div class="ranking-name">${item.name.substring(0, 6)}</div>
                <div class="ranking-score">${item.total_score}分</div>
            </div>
            <div class="ranking-position">
                <span class="ranking-position-prefix">第</span>
                <span class="ranking-position-number">${item.rank}</span>
                <span class="ranking-position-suffix">名</span>
            </div>
        `;

        rankingDisplay.appendChild(rankingItem);
    });
}

// 工具函数
function showMessage(message, type = 'info') {
    // 创建消息提示
    const messageEl = document.createElement('div');
    messageEl.className = `message message-${type}`;
    messageEl.textContent = message;
    messageEl.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 2rem;
        border-radius: 10px;
        color: white;
        font-weight: bold;
        z-index: 3000;
        animation: slideIn 0.3s ease-out;
    `;
    
    switch(type) {
        case 'success':
            messageEl.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
            break;
        case 'error':
            messageEl.style.background = 'linear-gradient(135deg, #f44336, #d32f2f)';
            break;
        default:
            messageEl.style.background = 'linear-gradient(135deg, #2196F3, #1976D2)';
    }
    
    document.body.appendChild(messageEl);
    
    setTimeout(() => {
        messageEl.remove();
    }, 3000);
}

function showModal(content) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modalBody');

    modalBody.innerHTML = content;
    modal.classList.add('active');
    
    // 添加关闭按钮事件
    const closeBtn = modal.querySelector('.close');
    if (closeBtn) {
        closeBtn.onclick = closeModal;
    }
    
    // 点击模态框外部关闭
    modal.onclick = function(event) {
        if (event.target === modal) {
            closeModal();
        }
    };
}

function initializeLogoUpload({
    fileInputId,
    hiddenInputId,
    previewContainerId,
    previewImageId,
    initialUrl = ''
}) {
    const fileInput = document.getElementById(fileInputId);
    const hiddenInput = document.getElementById(hiddenInputId);
    const previewContainer = document.getElementById(previewContainerId);
    const previewImage = document.getElementById(previewImageId);

    const updatePreview = (url) => {
        if (!previewContainer || !previewImage) return;

        if (url) {
            previewImage.src = url;
            previewContainer.style.display = 'flex';
        } else {
            previewImage.removeAttribute('src');
            previewContainer.style.display = 'none';
        }
    };

    const resolveInitialValue = () => {
        if (!hiddenInput) {
            updatePreview(initialUrl);
            return;
        }

        if (!hiddenInput.value && initialUrl) {
            hiddenInput.value = initialUrl;
        }
        updatePreview(hiddenInput.value || '');
    };

    resolveInitialValue();

    if (!fileInput) {
        return;
    }

    fileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const previousValue = hiddenInput ? hiddenInput.value : '';

        const uploadData = new FormData();
        uploadData.append('file', file);

        try {
            const response = await authorizedFetch(`${API_BASE}/upload`, {
                method: 'POST',
                body: uploadData
            });

            const responseText = await response.text();
            let result = {};
            try {
                result = responseText ? JSON.parse(responseText) : {};
            } catch (error) {
                console.warn('解析上传响应失败:', error);
            }

            if (!response.ok) {
                throw new Error(result.error || '上传失败');
            }

            if (!result.file_path) {
                throw new Error('上传失败');
            }

            if (hiddenInput) {
                hiddenInput.value = result.file_path;
            }

            updatePreview(result.file_path);
            showMessage('Logo上传成功', 'success');
        } catch (error) {
            console.error('Logo上传失败:', error);
            showMessage(error.message || 'Logo上传失败', 'error');

            if (hiddenInput) {
                hiddenInput.value = previousValue;
            }

            updatePreview(previousValue);
        } finally {
            fileInput.value = '';
        }
    });
}

// 编辑小组
function editGroup(groupId) {
    const group = adminGroups.find(g => g.id === groupId);
    if (!group) return;
    
    const content = `
        <h3>编辑小组</h3>
        <form id="editGroupForm">
            <div class="form-group">
                <label for="editGroupName">小组名称:</label>
                <input type="text" id="editGroupName" name="name" value="${group.name}" required>
            </div>
            <div class="form-group">
                <label for="editGroupLogoUpload">小组Logo:</label>
                <input type="file" id="editGroupLogoUpload" accept="image/*">
                <input type="hidden" id="editGroupLogoInput" name="logo" value="${group.logo || ''}">
                <p class="form-helper">支持 PNG/JPG/GIF，上传后会自动保存新的Logo。</p>
                <div id="editGroupLogoPreview" class="logo-preview" style="display: none;">
                    <img src="${group.logo || ''}" alt="小组Logo预览" id="editGroupLogoPreviewImg">
                </div>
            </div>
            <div class="form-actions">
                <button type="submit">保存</button>
                <button type="button" onclick="closeModal()">取消</button>
            </div>
        </form>
    `;
    showModal(content);

    initializeLogoUpload({
        fileInputId: 'editGroupLogoUpload',
        hiddenInputId: 'editGroupLogoInput',
        previewContainerId: 'editGroupLogoPreview',
        previewImageId: 'editGroupLogoPreviewImg',
        initialUrl: group.logo || ''
    });

    document.getElementById('editGroupForm').addEventListener('submit', async function(event) {
        event.preventDefault();

        const formData = new FormData(event.target);
        const data = Object.fromEntries(formData);
        const payload = withCourseId(data, group.course_id);

        try {
            await apiCall(`/groups/${groupId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });

            showMessage('小组更新成功', 'success');
            closeModal();
            await loadAdminGroups();
            if (getActiveCourseId() === group.course_id) {
                await loadGroups(getActiveCourseId());
            }
        } catch (error) {
            showMessage('更新失败: ' + error.message, 'error');
        }
    });
}

// 管理小组成员
async function manageGroupMembers(groupId) {
    try {
        const group = adminGroups.find(g => g.id === groupId);
        const courseId = group ? group.course_id : getCurrentCourseId();
        const [members, roleList] = await Promise.all([
            apiCall(`/groups/${groupId}/members`),
            apiCall(buildCourseUrl('/roles', courseId))
        ]);

        roles = roleList;

        const groupName = group ? group.name : '未知小组';

        const content = `
            <h3>管理小组成员 - ${groupName}</h3>
            <div class="member-management">
                <div class="admin-header">
                    <div class="admin-actions">
                        <button class="btn btn-primary" onclick="showAddMemberModal(${groupId})">添加成员</button>
                        <button class="btn btn-info" onclick="showBulkAddMembersModal(${groupId})">批量添加</button>
                        <button class="btn btn-secondary" onclick="showBulkEditMembersModal(${groupId})">批量编辑</button>
                    </div>
                </div>
                <div id="groupMembersManageList" class="admin-list"></div>
            </div>
        `;
        showModal(content);
        renderMembersManagementList(members);

    } catch (error) {
        showMessage('加载小组成员失败: ' + error.message, 'error');
    }
}

function renderMembersManagementList(members) {
    const listEl = document.getElementById('groupMembersManageList');
    if (!listEl) return;

    if (members.length === 0) {
        listEl.innerHTML = '<p style="text-align: center; color: #B0C4DE;">暂无成员</p>';
        return;
    }

    listEl.innerHTML = members.map(member => `
        <div class="admin-item">
            <div class="admin-item-info">
                <div class="admin-item-title">${member.name}</div>
                <div class="admin-item-details">
                    ${member.company ? `公司: ${member.company} | ` : ''}职务: ${member.role_name || '未知'}
                </div>
            </div>
            <div class="admin-item-actions">
                <button class="btn btn-secondary" onclick="editMember(${member.group_id}, ${member.id})">编辑</button>
                <button class="btn btn-danger" onclick="deleteMember(${member.group_id}, ${member.id})">删除</button>
            </div>
        </div>
    `).join('');
}

function formatMemberLine(member) {
    const company = member.company || '';
    const roleName = member.role_name || '';
    return `${member.name}, ${company}, ${roleName}`.trim();
}

function escapeHtml(text) {
    if (text === undefined || text === null) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function ensureRolesLoaded(courseId) {
    const targetCourseId = courseId ?? getCurrentCourseId();
    if (!roles || roles.length === 0 || rolesCourseId !== targetCourseId) {
        await loadRoles(targetCourseId);
    }
}

async function showBulkAddMembersModal(groupId) {
    const group = adminGroups.find(g => g.id === groupId);
    await ensureRolesLoaded(group ? group.course_id : undefined);
    const roleNames = roles.length > 0 ? roles.map(role => role.name).join('、') : '暂无职务，请先在职务管理中添加';

    const content = `
        <h3>批量添加小组成员</h3>
        <form id="bulkAddMembersForm">
            <div class="form-group">
                <label for="bulkAddMembersInput">成员信息（每行：姓名, 公司, 职务）</label>
                <textarea id="bulkAddMembersInput" rows="10" placeholder="张三, XX科技公司, 组员\n李四, XX集团, 组长"></textarea>
            </div>
            <p class="form-helper">支持中文逗号或英文逗号分隔，缺少公司时请保留空白。</p>
            <p class="form-helper">当前职务列表：${roleNames}</p>
            <div class="form-actions">
                <button type="submit">批量添加</button>
                <button type="button" onclick="closeModal()">取消</button>
            </div>
        </form>
    `;
    showModal(content);

    const form = document.getElementById('bulkAddMembersForm');
    if (form) {
        form.addEventListener('submit', async function(event) {
            event.preventDefault();
            const entries = document.getElementById('bulkAddMembersInput').value.trim();
            await submitBulkMembers(groupId, entries, false);
        });
    }
}

async function showBulkEditMembersModal(groupId) {
    try {
        const group = adminGroups.find(g => g.id === groupId);
        await ensureRolesLoaded(group ? group.course_id : undefined);
        const members = await apiCall(`/groups/${groupId}/members`);
        const roleNames = roles.length > 0 ? roles.map(role => role.name).join('、') : '暂无职务，请先在职务管理中添加';
        const defaultText = members.map(formatMemberLine).join('\n');
        const escapedText = escapeHtml(defaultText);

        const content = `
            <h3>批量编辑小组成员</h3>
            <form id="bulkEditMembersForm">
                <div class="form-group">
                    <label for="bulkEditMembersInput">成员信息（每行：姓名, 公司, 职务）</label>
                    <textarea id="bulkEditMembersInput" rows="12" placeholder="张三, XX科技公司, 组员">${escapedText}</textarea>
                </div>
                <p class="form-helper">保存后将覆盖当前小组成员信息，请谨慎操作。</p>
                <p class="form-helper">当前职务列表：${roleNames}</p>
                <div class="form-actions">
                    <button type="submit">保存</button>
                    <button type="button" onclick="closeModal()">取消</button>
                </div>
            </form>
        `;
        showModal(content);

        const form = document.getElementById('bulkEditMembersForm');
        if (form) {
            form.addEventListener('submit', async function(event) {
                event.preventDefault();
                const entries = document.getElementById('bulkEditMembersInput').value.trim();
                await submitBulkMembers(groupId, entries, true);
            });
        }
    } catch (error) {
        showMessage('加载成员信息失败: ' + error.message, 'error');
    }
}

async function submitBulkMembers(groupId, entries, replace = false) {
    if (!entries) {
        showMessage('请输入成员信息', 'error');
        return;
    }

    try {
        const group = adminGroups.find(g => g.id === groupId);
        const courseId = group ? group.course_id : getCurrentCourseId();
        const payload = withCourseId({ entries }, courseId);
        const result = await apiCall(`/groups/${groupId}/members/bulk`, {
            method: replace ? 'PUT' : 'POST',
            body: JSON.stringify(payload)
        });

        showMessage(result.message || '操作成功', 'success');
        closeModal();
        manageGroupMembers(groupId);
        if (currentGroup && currentGroup.id === groupId) {
            await loadDisplayData();
        }
        await loadRoles(courseId);
    } catch (error) {
        showMessage(error.message, 'error');
    }
}

// 显示添加成员模态框
async function showAddMemberModal(groupId) {
    try {
        const group = adminGroups.find(g => g.id === groupId);
        const courseId = group ? group.course_id : getCurrentCourseId();
        const roles = await apiCall(buildCourseUrl('/roles', courseId));

        const content = `
            <h3>添加小组成员</h3>
            <form id="addMemberForm">
                <div class="form-group">
                    <label for="memberName">成员姓名:</label>
                    <input type="text" id="memberName" name="name" required>
                </div>
                <div class="form-group">
                    <label for="memberCompany">公司名称:</label>
                    <input type="text" id="memberCompany" name="company">
                </div>
                <div class="form-group">
                    <label for="memberRole">职务:</label>
                    <select id="memberRole" name="role_id" required>
                        <option value="">请选择职务</option>
                        ${roles.map(role => `<option value="${role.id}">${role.name}</option>`).join('')}
                    </select>
                </div>
                <div class="form-actions">
                    <button type="submit">添加</button>
                    <button type="button" onclick="closeModal()">取消</button>
                </div>
            </form>
        `;
        showModal(content);
        
        document.getElementById('addMemberForm').addEventListener('submit', async function(event) {
            event.preventDefault();

            const formData = new FormData(event.target);
            const data = Object.fromEntries(formData);
            data.role_id = parseInt(data.role_id);
            const payload = withCourseId(data, courseId);

            try {
                await apiCall(`/groups/${groupId}/members`, {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });

                showMessage('成员添加成功', 'success');
                closeModal();
                manageGroupMembers(groupId); // 刷新成员列表
                loadGroupMembers(); // 刷新主页面成员显示
            } catch (error) {
                showMessage('添加失败: ' + error.message, 'error');
            }
        });

    } catch (error) {
        showMessage('加载职务列表失败: ' + error.message, 'error');
    }
}

async function manageGroupPhotos(groupId) {
    try {
        const photos = await apiCall(`/groups/${groupId}/photos`);
        const group = adminGroups.find(g => g.id === groupId);
        const groupName = group ? group.name : '未知小组';

        const content = `
            <h3>风采管理 - ${groupName}</h3>
            <div class="photo-management">
                <form id="uploadGroupPhotosForm">
                    <div class="form-group">
                        <label for="groupPhotosInput">上传小组风采照片</label>
                        <input type="file" id="groupPhotosInput" name="photos" accept="image/*" multiple required>
                    </div>
                    <p class="form-helper">支持同时选择多张图片，建议上传清晰度较高的横图。</p>
                    <div class="form-actions">
                        <button type="submit">上传</button>
                        <button type="button" onclick="closeModal()">关闭</button>
                    </div>
                </form>
                <div id="groupPhotosList" class="photo-grid-container">
                    ${renderGroupPhotosList(photos, groupId)}
                </div>
            </div>
        `;

        showModal(content);

        const uploadForm = document.getElementById('uploadGroupPhotosForm');
        if (uploadForm) {
            uploadForm.addEventListener('submit', async function(event) {
                event.preventDefault();
                const input = document.getElementById('groupPhotosInput');
                const files = input ? Array.from(input.files || []) : [];

                if (!files.length) {
                    showMessage('请选择要上传的图片', 'error');
                    return;
                }

                const formData = new FormData();
                files.forEach(file => formData.append('photos', file));

                try {
                    const response = await authorizedFetch(`${API_BASE}/groups/${groupId}/photos`, {
                        method: 'POST',
                        body: formData
                    });
                    const result = await response.json();

                    if (!response.ok) {
                        throw new Error(result.error || '上传失败');
                    }

                    showMessage(result.message || '上传成功', 'success');
                    await refreshGroupData(groupId);
                    manageGroupPhotos(groupId);
                } catch (error) {
                    showMessage(error.message, 'error');
                }
            });
        }
    } catch (error) {
        showMessage('加载小组风采失败: ' + error.message, 'error');
    }
}

function renderGroupPhotosList(photos, groupId) {
    if (!photos || photos.length === 0) {
        return '<p style="text-align: center; color: #B0C4DE;">暂无风采图片</p>';
    }

    const items = photos.map((photo, index) => `
        <div class="photo-grid-item">
            <img src="${photo.url}" alt="小组风采${index + 1}">
            <div class="photo-grid-actions">
                <span>照片${index + 1}</span>
                <button class="btn btn-danger btn-small" onclick="deleteGroupPhoto(${groupId}, ${photo.id})">删除</button>
            </div>
        </div>
    `);

    return `<div class="photo-grid">${items.join('')}</div>`;
}

async function deleteGroupPhoto(groupId, photoId) {
    if (!confirm('确定要删除这张照片吗？')) return;

    try {
        await apiCall(`/groups/${groupId}/photos/${photoId}`, { method: 'DELETE' });
        showMessage('照片已删除', 'success');
        await refreshGroupData(groupId);
        manageGroupPhotos(groupId);
    } catch (error) {
        showMessage('删除失败: ' + error.message, 'error');
    }
}

async function refreshGroupData(groupId) {
    await loadGroups();
    const matchedGroup = groups.find(group => group.id === groupId);
    if (matchedGroup) {
        selectGroup(matchedGroup);
    } else if (groups.length > 0 && !currentGroup) {
        selectGroup(groups[0]);
    }
}

// 编辑成员
async function editMember(groupId, memberId) {
    try {
        const [members, roles] = await Promise.all([
            apiCall(`/groups/${groupId}/members`),
            apiCall('/roles')
        ]);
        
        const member = members.find(m => m.id === memberId);
        if (!member) {
            showMessage('成员不存在', 'error');
            return;
        }
        
        const content = `
            <h3>编辑小组成员</h3>
            <form id="editMemberForm">
                <div class="form-group">
                    <label for="editMemberName">成员姓名:</label>
                    <input type="text" id="editMemberName" name="name" value="${member.name}" required>
                </div>
                <div class="form-group">
                    <label for="editMemberCompany">公司名称:</label>
                    <input type="text" id="editMemberCompany" name="company" value="${member.company || ''}">
                </div>
                <div class="form-group">
                    <label for="editMemberRole">职务:</label>
                    <select id="editMemberRole" name="role_id" required>
                        <option value="">请选择职务</option>
                        ${roles.map(role => `
                            <option value="${role.id}" ${role.id === member.role_id ? 'selected' : ''}>
                                ${role.name}
                            </option>
                        `).join('')}
                    </select>
                </div>
                <div class="form-actions">
                    <button type="submit">保存</button>
                    <button type="button" onclick="closeModal()">取消</button>
                </div>
            </form>
        `;
        showModal(content);
        
        document.getElementById('editMemberForm').addEventListener('submit', async function(event) {
            event.preventDefault();
            
            const formData = new FormData(event.target);
            const data = Object.fromEntries(formData);
            data.role_id = parseInt(data.role_id);
            
            try {
                await apiCall(`/groups/${groupId}/members/${memberId}`, {
                    method: 'PUT',
                    body: JSON.stringify(data)
                });
                
                showMessage('成员更新成功', 'success');
                closeModal();
                manageGroupMembers(groupId); // 刷新成员列表
                loadGroupMembers(); // 刷新主页面成员显示
            } catch (error) {
                showMessage('更新失败: ' + error.message, 'error');
            }
        });
        
    } catch (error) {
        showMessage('加载成员信息失败: ' + error.message, 'error');
    }
}

// 删除成员
async function deleteMember(groupId, memberId) {
    if (!confirm('确定要删除这个成员吗？')) return;
    
    try {
        await apiCall(`/groups/${groupId}/members/${memberId}`, { method: 'DELETE' });
        showMessage('成员已删除', 'success');
        manageGroupMembers(groupId); // 刷新成员列表
        loadGroupMembers(); // 刷新主页面成员显示
    } catch (error) {
        showMessage('删除失败: ' + error.message, 'error');
    }
}

// 编辑评价人
function editVoter(voterId) {
    const voter = voters.find(v => v.id === voterId);
    if (!voter) return;
    
    const content = `
        <h3>编辑评价人</h3>
        <form id="editVoterForm">
            <div class="form-group">
                <label for="editVoterName">姓名:</label>
                <input type="text" id="editVoterName" name="name" value="${voter.name}" required>
            </div>
            <div class="form-group">
                <label for="editVoterPhone">手机号:</label>
                <input type="tel" id="editVoterPhone" name="phone" value="${voter.phone}" required>
            </div>
            <div class="form-group">
                <label for="editVoterWeight">投票权重:</label>
                <input type="number" id="editVoterWeight" name="weight" min="1" value="${voter.weight}" required>
            </div>
            <div class="form-actions">
                <button type="submit">保存</button>
                <button type="button" onclick="closeModal()">取消</button>
            </div>
        </form>
    `;
    showModal(content);
    
    document.getElementById('editVoterForm').addEventListener('submit', async function(event) {
        event.preventDefault();

        const formData = new FormData(event.target);
        const data = Object.fromEntries(formData);
        data.weight = parseInt(data.weight);
        const payload = withCourseId(data, getCurrentCourseId());

        try {
            await apiCall(`/voters/${voterId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });

            showMessage('评价人更新成功', 'success');
            closeModal();
            loadAdminVoters();
            loadVoters({ courseId: getCurrentCourseId() });
        } catch (error) {
            showMessage('更新失败: ' + error.message, 'error');
        }
    });
}

// 后台管理操作函数
async function toggleGroupLock(groupId, lock) {
    try {
        const group = adminGroups.find(g => g.id === groupId);
        const courseId = group ? group.course_id : getCurrentCourseId();
        const payload = withCourseId({ lock: lock }, courseId);

        await apiCall(`/groups/${groupId}/lock`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        showMessage(lock ? '小组已锁定' : '小组已解锁', 'success');
        await loadAdminGroups();
        if (group && getActiveCourseId() === group.course_id) {
            await loadGroups(getActiveCourseId());
        }
    } catch (error) {
        showMessage('操作失败: ' + error.message, 'error');
    }
}

async function deleteGroup(groupId) {
    if (!confirm('确定要删除这个小组吗？')) return;

    try {
        const group = adminGroups.find(g => g.id === groupId);
        const courseId = group ? group.course_id : getCurrentCourseId();
        await apiCall(`/groups/${groupId}?course_id=${courseId}`, { method: 'DELETE' });
        showMessage('小组已删除', 'success');
        await loadAdminGroups();
        if (group && getActiveCourseId() === group.course_id) {
            await loadGroups(getActiveCourseId());
        }
    } catch (error) {
        showMessage('删除失败: ' + error.message, 'error');
    }
}

async function deleteVoter(voterId) {
    if (!confirm('确定要删除这个评价人吗？')) return;

    try {
        await apiCall(`/voters/${voterId}`, { method: 'DELETE' });
        showMessage('评价人已删除', 'success');
        await loadAdminVoters();
        await loadVoters({ courseId: getCurrentCourseId() });
    } catch (error) {
        showMessage('删除失败: ' + error.message, 'error');
    }
}

async function deleteRole(roleId) {
    if (!confirm('确定要删除这个职务吗？')) return;

    try {
        await apiCall(`/roles/${roleId}`, { method: 'DELETE' });
        showMessage('职务已删除', 'success');
        await loadAdminRoles();
        await loadRoles(getCurrentCourseId());
    } catch (error) {
        showMessage('删除失败: ' + error.message, 'error');
    }
}

// 初始化数据
async function initializeData() {
    try {
        const payload = withCourseId({}, getCurrentCourseId());
        await apiCall('/init-data', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        showMessage('初始化数据成功', 'success');
        await loadInitialData();
        await loadAdminData();
    } catch (error) {
        showMessage('初始化失败: ' + error.message, 'error');
    }
}

// 投票数据管理函数
async function loadVotesData() {
    try {
        const groupFilter = document.getElementById('voteGroupFilter');
        const groupId = groupFilter ? groupFilter.value : '';

        let url = '/votes';
        if (groupId) {
            url += `?group_id=${groupId}`;
        }
        url = buildCourseUrl(url, getCurrentCourseId());

        const votes = await apiCall(url);

        renderVotesData(votes);
    } catch (error) {
        console.error('加载投票数据失败:', error);
        showMessage('加载投票数据失败', 'error');
    }
}

function renderVotesData(votes) {
    const votesList = document.getElementById('votesList');
    if (!votesList) return;
    
    votesList.innerHTML = '';
    
    if (votes.length === 0) {
        votesList.innerHTML = '<p style="text-align: center; color: #B0C4DE;">暂无投票数据</p>';
        return;
    }
    
    votes.forEach(vote => {
        const item = document.createElement('div');
        item.className = 'admin-item';

        const voteTypeText = vote.vote_type === 1 ? '赞' : '踩';
        const voteTypeClass = vote.vote_type === 1 ? 'vote-like' : 'vote-dislike';
        const voteTime = vote.created_at ? new Date(vote.created_at).toLocaleString() : '未知时间';

        item.innerHTML = `
            <div class="admin-item-info">
                <div class="admin-item-title">
                    ${vote.voter_name || '未知评价人'}
                    <span class="vote-type ${voteTypeClass}">${voteTypeText}</span>
                </div>
                <div class="admin-item-details">
                    小组: ${vote.group_name || '未知小组'} | 权重: ${vote.vote_weight} | 时间: ${voteTime}
                </div>
            </div>
            <div class="admin-item-actions">
                <button class="btn btn-secondary" onclick="editVote(${vote.id})">编辑</button>
                <button class="btn btn-danger" onclick="deleteVote(${vote.id})">删除</button>
            </div>
        `;
        votesList.appendChild(item);
    });
}

async function editVote(voteId) {
    try {
        const votes = await apiCall('/votes');
        const vote = votes.find(v => v.id === voteId);
        
        if (!vote) {
            showMessage('投票数据不存在', 'error');
            return;
        }
        
        const content = `
            <h3>编辑投票数据</h3>
            <form id="editVoteForm">
                <div class="form-group">
                    <label for="editVoteType">投票类型:</label>
                    <select id="editVoteType" name="vote_type" required>
                        <option value="1" ${vote.vote_type === 1 ? 'selected' : ''}>赞</option>
                        <option value="-1" ${vote.vote_type === -1 ? 'selected' : ''}>踩</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="editVoteWeight">投票权重:</label>
                    <input type="number" id="editVoteWeight" name="vote_weight" min="1" value="${vote.vote_weight}" required>
                </div>
                <div class="form-actions">
                    <button type="submit">保存</button>
                    <button type="button" onclick="closeModal()">取消</button>
                </div>
            </form>
        `;
        showModal(content);
        
        document.getElementById('editVoteForm').addEventListener('submit', async function(event) {
            event.preventDefault();
            
            const formData = new FormData(event.target);
            const data = Object.fromEntries(formData);
            data.vote_type = parseInt(data.vote_type);
            data.vote_weight = parseInt(data.vote_weight);
            
            try {
                await apiCall(`/votes/${voteId}`, {
                    method: 'PUT',
                    body: JSON.stringify(data)
                });
                
                showMessage('投票数据更新成功', 'success');
                closeModal();
                loadVotesData();
                
                // 刷新主页面数据
                if (currentGroup) {
                    updateVoteStats();
                }
            } catch (error) {
                showMessage('更新失败: ' + error.message, 'error');
            }
        });
        
    } catch (error) {
        showMessage('加载投票数据失败: ' + error.message, 'error');
    }
}

async function deleteVote(voteId) {
    if (!confirm('确定要删除这条投票数据吗？')) return;
    
    try {
        await apiCall(`/votes/${voteId}`, { method: 'DELETE' });
        showMessage('投票数据已删除', 'success');
        loadVotesData();
        
        // 刷新主页面数据
        if (currentGroup) {
            updateVoteStats();
        }
    } catch (error) {
        showMessage('删除失败: ' + error.message, 'error');
    }
}

// 显示添加小组模态框
function showAddGroupModal() {
    const content = `
        <h3>添加小组</h3>
        <form id="addGroupForm">
            <div class="form-group">
                <label for="groupName">小组名称:</label>
                <input type="text" id="groupName" name="name" required>
            </div>
            <div class="form-group">
                <label for="groupLogoUpload">小组Logo:</label>
                <input type="file" id="groupLogoUpload" accept="image/*">
                <input type="hidden" id="groupLogoInput" name="logo">
                <p class="form-helper">支持 PNG/JPG/GIF，上传后会自动生成Logo链接。</p>
                <div id="groupLogoPreview" class="logo-preview" style="display: none;">
                    <img src="" alt="小组Logo预览" id="groupLogoPreviewImg">
                </div>
            </div>
            <div class="form-actions">
                <button type="submit">添加</button>
                <button type="button" onclick="closeModal()">取消</button>
            </div>
        </form>
    `;
    showModal(content);

    initializeLogoUpload({
        fileInputId: 'groupLogoUpload',
        hiddenInputId: 'groupLogoInput',
        previewContainerId: 'groupLogoPreview',
        previewImageId: 'groupLogoPreviewImg'
    });

    document.getElementById('addGroupForm').addEventListener('submit', handleAddGroup);
}

// 显示添加评价人模态框
function showAddVoterModal() {
    const content = `
        <h3>添加评价人</h3>
        <form id="addVoterForm">
            <div class="form-group">
                <label for="voterName">姓名:</label>
                <input type="text" id="voterName" name="name" required>
            </div>
            <div class="form-group">
                <label for="voterPhone">手机号:</label>
                <input type="tel" id="voterPhone" name="phone" required>
            </div>
            <div class="form-group">
                <label for="voterWeight">投票权重:</label>
                <input type="number" id="voterWeight" name="weight" min="1" value="1" required>
            </div>
            <div class="form-actions">
                <button type="submit">添加</button>
                <button type="button" onclick="closeModal()">取消</button>
            </div>
        </form>
    `;
    showModal(content);
    
    document.getElementById('addVoterForm').addEventListener('submit', handleAddVoter);
}

// 显示添加职务模态框
function showAddRoleModal() {
    const content = `
        <h3>添加职务</h3>
        <form id="addRoleForm">
            <div class="form-group">
                <label for="roleName">职务名称:</label>
                <input type="text" id="roleName" name="name" required>
            </div>
            <div class="form-actions">
                <button type="submit">添加</button>
                <button type="button" onclick="closeModal()">取消</button>
            </div>
        </form>
    `;
    showModal(content);
    
    document.getElementById('addRoleForm').addEventListener('submit', handleAddRole);
}

// 关闭模态框
function closeModal() {
    const modal = document.getElementById('modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// 处理添加小组
async function handleAddGroup(event) {
    event.preventDefault();

    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData);
    const payload = withCourseId(data, getCurrentCourseId());

    try {
        await apiCall('/groups', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        showMessage('小组添加成功', 'success');
        closeModal();
        await loadAdminGroups();
        if (getActiveCourseId() === getCurrentCourseId()) {
            await loadGroups(getActiveCourseId());
        }
    } catch (error) {
        showMessage('添加失败: ' + error.message, 'error');
    }
}

// 处理添加评价人
async function handleAddVoter(event) {
    event.preventDefault();

    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData);
    data.weight = parseInt(data.weight);
    const payload = withCourseId(data, getCurrentCourseId());

    try {
        await apiCall('/voters', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        showMessage('评价人添加成功', 'success');
        closeModal();
        await loadAdminVoters();
        await loadVoters({ courseId: getCurrentCourseId() });
    } catch (error) {
        showMessage('添加失败: ' + error.message, 'error');
    }
}

// 处理添加职务
async function handleAddRole(event) {
    event.preventDefault();

    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData);
    const payload = withCourseId(data, getCurrentCourseId());

    try {
        await apiCall('/roles', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        showMessage('职务添加成功', 'success');
        closeModal();
        await loadAdminRoles();
        await loadRoles(getCurrentCourseId());
    } catch (error) {
        showMessage('添加失败: ' + error.message, 'error');
    }
}

// 下载评价人导入模板
async function downloadVotersTemplate() {
    try {
        const response = await authorizedFetch(API_BASE + '/voters/template');

        if (!response.ok) {
            if (response.status === 401) {
                handleAdminUnauthorized();
            }
            throw new Error('下载模板失败，请重新登录后重试');
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = '评价人导入模板.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        showMessage(error.message || '下载模板失败', 'error');
    }
}

// 显示导入评价人模态框
function showImportVotersModal() {
    const content = `
        <h3>批量导入评价人</h3>
        <div class="import-instructions">
            <p>请按照以下步骤进行批量导入：</p>
            <ol>
                <li>点击"下载模板"获取Excel模板文件</li>
                <li>在模板中填写评价人信息（姓名、手机号为必填项）</li>
                <li>权重默认为1，老师建议设为10</li>
                <li>保存Excel文件后，点击"选择文件"上传</li>
            </ol>
        </div>
        <div class="import-actions">
            <button type="button" class="btn btn-secondary" onclick="downloadVotersTemplate()">下载模板</button>
            <button type="button" class="btn btn-primary" onclick="selectImportFile()">选择文件</button>
            <button type="button" class="btn btn-default" onclick="closeModal()">取消</button>
        </div>
        <div id="importProgress" class="import-progress" style="display: none;">
            <p>正在导入，请稍候...</p>
        </div>
        <div id="importResult" class="import-result" style="display: none;"></div>
    `;
    showModal(content);
}

// 选择导入文件
function selectImportFile() {
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.click();
    }
}

// 处理文件导入
async function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // 显示进度
    const progressDiv = document.getElementById('importProgress');
    const resultDiv = document.getElementById('importResult');
    
    if (progressDiv) progressDiv.style.display = 'block';
    if (resultDiv) {
        resultDiv.style.display = 'none';
        resultDiv.innerHTML = '';
    }
    
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('course_id', getCurrentCourseId() || '');

        const response = await authorizedFetch(API_BASE + '/voters/import', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (progressDiv) progressDiv.style.display = 'none';
        
        if (response.ok) {
            let resultHtml = `
                <div class="import-success">
                    <h4>导入结果</h4>
                    <p>${result.message}</p>
                    <p>成功导入: ${result.success_count} 条</p>
                    ${result.error_count > 0 ? `<p>失败: ${result.error_count} 条</p>` : ''}
                </div>
            `;
            
            if (result.errors && result.errors.length > 0) {
                resultHtml += `
                    <div class="import-errors">
                        <h5>错误详情:</h5>
                        <ul>
                            ${result.errors.map(error => `<li>${error}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }
            
            if (resultDiv) {
                resultDiv.innerHTML = resultHtml;
                resultDiv.style.display = 'block';
            }
            
            // 刷新评价人列表
            if (result.success_count > 0) {
                await loadAdminVoters();
                await loadVoters({ courseId: getCurrentCourseId() });
            }

        } else {
            if (resultDiv) {
                resultDiv.innerHTML = `
                    <div class="import-error">
                        <h4>导入失败</h4>
                        <p>${result.error}</p>
                    </div>
                `;
                resultDiv.style.display = 'block';
            }
        }
        
    } catch (error) {
        if (progressDiv) progressDiv.style.display = 'none';
        if (resultDiv) {
            resultDiv.innerHTML = `
                <div class="import-error">
                    <h4>导入失败</h4>
                    <p>网络错误或服务器异常</p>
                </div>
            `;
            resultDiv.style.display = 'block';
        }
        console.error('导入失败:', error);
    }
    
    // 清空文件选择
    event.target.value = '';
}

// 设置初始化按钮事件
document.addEventListener('DOMContentLoaded', function() {
    const initDataBtn = document.getElementById('initDataBtn');
    if (initDataBtn) {
        initDataBtn.addEventListener('click', initializeData);
    }
    
    // 投票数据管理事件
    const refreshVotesBtn = document.getElementById('refreshVotesBtn');
    if (refreshVotesBtn) {
        refreshVotesBtn.addEventListener('click', loadVotesData);
    }
    
    const voteGroupFilter = document.getElementById('voteGroupFilter');
    if (voteGroupFilter) {
        voteGroupFilter.addEventListener('change', loadVotesData);
    }
});

// 页面加载完成后的额外设置
window.addEventListener('load', function() {
    // 如果是手机端访问，调整样式
    if (window.innerWidth <= 768) {
        document.body.classList.add('mobile-device');
    }
    
    // 监听窗口大小变化
    window.addEventListener('resize', function() {
        if (window.innerWidth <= 768) {
            document.body.classList.add('mobile-device');
        } else {
            document.body.classList.remove('mobile-device');
        }
    });
});

