// 全局变量
let socket;
let currentGroup = null;
let groups = [];
let roles = [];
let voters = [];
let currentVoter = null;
let photoCarouselInterval;

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
    
    // 检查URL参数，如果有group参数则显示手机端页面
    const urlParams = new URLSearchParams(window.location.search);
    const groupId = urlParams.get('group');
    if (groupId) {
        showMobilePage(groupId);
    }
}

// 设置导航
function setupNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const targetPage = this.id.replace('Btn', 'Page');
            showPage(targetPage);
            
            // 更新按钮状态
            navButtons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });
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
    
    closeBtn.addEventListener('click', function() {
        modal.classList.remove('active');
    });
    
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
}

// 加载初始数据
async function loadInitialData() {
    try {
        await Promise.all([
            loadGroups(),
            loadRoles(),
            loadVoters()
        ]);
        
        if (groups.length > 0) {
            selectGroup(groups[0]);
        }
    } catch (error) {
        console.error('加载初始数据失败:', error);
        showMessage('加载数据失败，请刷新页面重试', 'error');
    }
}

// API调用函数
async function apiCall(url, options = {}) {
    try {
        const response = await fetch(API_BASE + url, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('API调用失败:', error);
        throw error;
    }
}

// 加载小组数据
async function loadGroups() {
    groups = await apiCall('/groups');
    renderGroupTabs();
}

// 加载职务数据
async function loadRoles() {
    roles = await apiCall('/roles');
}

// 加载评价人数据
async function loadVoters() {
    voters = await apiCall('/voters');
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
    generateQRCode();
    
    // 加入WebSocket房间
    if (socket) {
        socket.emit('join_group', { group_id: group.id });
    }
}

// 更新小组显示
function updateGroupDisplay() {
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
    updateVoteStats(currentGroup.vote_stats);
    
    // 更新照片轮播
    updatePhotoCarousel();
}

// 更新投票统计
function updateVoteStats(stats) {
    const likeCount = document.getElementById('likeCount');
    const dislikeCount = document.getElementById('dislikeCount');
    
    if (likeCount) likeCount.textContent = stats.likes || 0;
    if (dislikeCount) dislikeCount.textContent = stats.dislikes || 0;
    
    // 添加动画效果
    [likeCount, dislikeCount].forEach(el => {
        if (el) {
            el.classList.add('pulse');
            setTimeout(() => el.classList.remove('pulse'), 2000);
        }
    });
}

// 加载小组成员
async function loadGroupMembers() {
    if (!currentGroup) return;
    
    try {
        const members = await apiCall(`/groups/${currentGroup.id}/members`);
        renderMembersList(members);
    } catch (error) {
        console.error('加载成员失败:', error);
    }
}

// 渲染成员列表
function renderMembersList(members) {
    const membersList = document.getElementById('membersList');
    if (!membersList) return;
    
    membersList.innerHTML = '';
    
    if (members.length === 0) {
        membersList.innerHTML = '<p style="text-align: center; color: #B0C4DE;">暂无成员</p>';
        return;
    }
    
    members.forEach(member => {
        const memberItem = document.createElement('div');
        memberItem.className = 'member-item fade-in';
        memberItem.innerHTML = `
            <div class="member-name">${member.name}</div>
            <div class="member-role">${member.role_name || '未设置职务'}</div>
        `;
        membersList.appendChild(memberItem);
    });
}

// 更新照片轮播
function updatePhotoCarousel() {
    const photoSlides = document.getElementById('photoSlides');
    const carouselDots = document.getElementById('carouselDots');
    
    if (!photoSlides || !carouselDots || !currentGroup) return;
    
    // 清除现有轮播
    if (photoCarouselInterval) {
        clearInterval(photoCarouselInterval);
    }
    
    const photos = currentGroup.photos || [];
    
    if (photos.length === 0) {
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
    
    // 自动轮播
    let currentSlide = 0;
    photoCarouselInterval = setInterval(() => {
        currentSlide = (currentSlide + 1) % photos.length;
        showPhotoSlide(currentSlide);
    }, 5000);
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
}

// 生成二维码
function generateQRCode() {
    const qrContainer = document.getElementById('qrcode');
    if (!qrContainer || !currentGroup) return;
    
    qrContainer.innerHTML = '';
    
    const qrUrl = `${window.location.origin}?group=${currentGroup.id}`;
    
    QRCode.toCanvas(qrContainer, qrUrl, {
        width: 200,
        height: 200,
        margin: 2,
        color: {
            dark: '#0A2E5D',
            light: '#FFFFFF'
        }
    }, function(error) {
        if (error) {
            console.error('生成二维码失败:', error);
            qrContainer.innerHTML = '<p>二维码生成失败</p>';
        }
    });
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
function loadAdminData() {
    loadAdminGroups();
    loadAdminVoters();
    loadAdminRoles();
}

function switchAdminTab(tabName) {
    const contents = document.querySelectorAll('.admin-content');
    contents.forEach(content => content.classList.remove('active'));
    
    const targetContent = document.getElementById(tabName + 'Tab');
    if (targetContent) {
        targetContent.classList.add('active');
    }
}

// 加载后台小组管理
async function loadAdminGroups() {
    try {
        const groups = await apiCall('/groups');
        renderAdminGroups(groups);
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

// 加载后台评价人管理
async function loadAdminVoters() {
    try {
        const voters = await apiCall('/voters');
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
        const roles = await apiCall('/roles');
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

// 排名相关函数
async function loadRankingData() {
    try {
        const ranking = await apiCall('/ranking');
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
        
        let crown = '';
        if (item.rank === 1) crown = '<div class="ranking-crown">👑</div>';
        else if (item.rank === 2) crown = '<div class="ranking-crown">🥈</div>';
        else if (item.rank === 3) crown = '<div class="ranking-crown">🥉</div>';
        
        rankingItem.innerHTML = `
            ${crown}
            <div class="ranking-name">${item.name.substring(0, 6)}</div>
            <div class="ranking-score">${item.total_score}分</div>
            <div class="ranking-position">第${item.rank}名</div>
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

function showModal(title, content) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modalBody');
    
    modalBody.innerHTML = `
        <h3 style="color: #FFD700; margin-bottom: 1rem;">${title}</h3>
        ${content}
    `;
    
    modal.classList.add('active');
}

// 后台管理操作函数
async function toggleGroupLock(groupId, lock) {
    try {
        await apiCall(`/groups/${groupId}/lock`, {
            method: 'POST',
            body: JSON.stringify({ lock: lock })
        });
        
        showMessage(lock ? '小组已锁定' : '小组已解锁', 'success');
        loadAdminGroups();
        loadGroups(); // 刷新主页面数据
    } catch (error) {
        showMessage('操作失败: ' + error.message, 'error');
    }
}

async function deleteGroup(groupId) {
    if (!confirm('确定要删除这个小组吗？')) return;
    
    try {
        await apiCall(`/groups/${groupId}`, { method: 'DELETE' });
        showMessage('小组已删除', 'success');
        loadAdminGroups();
        loadGroups();
    } catch (error) {
        showMessage('删除失败: ' + error.message, 'error');
    }
}

async function deleteVoter(voterId) {
    if (!confirm('确定要删除这个评价人吗？')) return;
    
    try {
        await apiCall(`/voters/${voterId}`, { method: 'DELETE' });
        showMessage('评价人已删除', 'success');
        loadAdminVoters();
        loadVoters();
    } catch (error) {
        showMessage('删除失败: ' + error.message, 'error');
    }
}

async function deleteRole(roleId) {
    if (!confirm('确定要删除这个职务吗？')) return;
    
    try {
        await apiCall(`/roles/${roleId}`, { method: 'DELETE' });
        showMessage('职务已删除', 'success');
        loadAdminRoles();
        loadRoles();
    } catch (error) {
        showMessage('删除失败: ' + error.message, 'error');
    }
}

// 初始化数据
async function initializeData() {
    try {
        await apiCall('/init-data', { method: 'POST' });
        showMessage('初始化数据成功', 'success');
        loadInitialData();
        loadAdminData();
    } catch (error) {
        showMessage('初始化失败: ' + error.message, 'error');
    }
}

// 设置初始化按钮事件
document.addEventListener('DOMContentLoaded', function() {
    const initDataBtn = document.getElementById('initDataBtn');
    if (initDataBtn) {
        initDataBtn.addEventListener('click', initializeData);
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

