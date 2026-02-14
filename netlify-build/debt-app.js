// Debt Analytics Dashboard - READ-ONLY MODE
// Fetches data from server API

// Server API URL
const API_URL = 'https://qarzdorlik.onrender.com';

// App Password
const APP_PASSWORD = '1';

let agentsData = [];
let previousData = null;
let clientComments = {};
let lastPaymentsData = null; // To'lovlar eksport uchun
let allHistoricalData = []; // Barcha yuklangan excel ma'lumotlari

// Initialize
document.addEventListener('DOMContentLoaded', function () {
    // Initialize Telegram Web App
    if (window.Telegram && window.Telegram.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();

        // Apply Telegram theme
        document.body.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color || '#ffffff');
        document.body.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color || '#000000');
    }

    // Check if already logged in
    if (sessionStorage.getItem('appLoggedIn') === 'true') {
        showApp();
    } else {
        showLogin();
    }
});

// Password check - fetch from server
async function checkPassword(e) {
    e.preventDefault();
    const password = document.getElementById('appPassword').value;
    const errorEl = document.getElementById('loginError');

    try {
        // Fetch current password from server
        const res = await fetch(`${API_URL}/api/app-password`);
        const data = await res.json();
        const serverPassword = data.password || '1';

        if (password === serverPassword) {
            sessionStorage.setItem('appLoggedIn', 'true');
            showApp();
        } else {
            errorEl.classList.remove('hidden');
            document.getElementById('appPassword').value = '';
        }
    } catch (err) {
        // Fallback to hardcoded password if server fails
        if (password === APP_PASSWORD) {
            sessionStorage.setItem('appLoggedIn', 'true');
            showApp();
        } else {
            errorEl.classList.remove('hidden');
            document.getElementById('appPassword').value = '';
        }
    }
}

// Show login screen
function showLogin() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('dashboardContent').classList.add('hidden');
}

// Show app after login
async function showApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    initSearch();
    updateDate();
    fetchExchangeRate();

    // Izohlarni yuklash
    await loadComments();

    // Cache-first: avval localStorage'dan darhol ko'rsatish
    const cachedData = loadDataFromLocalStorage();
    if (cachedData && cachedData.agents && cachedData.agents.length > 0) {
        agentsData = cachedData.agents;
        previousData = cachedData.previousData;
        updateLastUpdatedDate(cachedData.lastUpdated || cachedData.savedAt);
        showDashboard();
        updateStats();
        renderCharts();
        renderTable();
        console.log('✅ Cache\'dan darhol ko\'rsatildi, serverdan yangilanmoqda...');
        console.log('📊 previousData mavjudmi:', previousData ? 'Ha (' + previousData.length + ' ta agent)' : 'Yo\'q');
        // Orqa fonda serverdan yangilash
        loadDataSilent();
        // Tarix sanalarini yuklash
        loadHistoryDates();
    } else {
        // Cache yo'q - serverdan yuklash (loading spinner bilan)
        loadData();
    }
}

function updateDate() {
    const now = new Date();
    document.getElementById('currentDate').textContent = now.toLocaleDateString('uz-UZ');
}

function updateLastUpdatedDate(isoDate) {
    const el = document.getElementById('lastUpdatedDate');
    if (!el) return;
    if (!isoDate) {
        el.textContent = 'Ma\'lumot yo\'q';
        return;
    }
    const d = new Date(isoDate);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    el.textContent = `${day}.${month}.${year} ${hours}:${minutes}`;
}

// Fetch USD/UZS exchange rate from server
async function fetchExchangeRate() {
    try {
        const res = await fetch(`${API_URL}/api/exchange-rate`);
        const data = await res.json();

        if (data.rate) {
            const rate = parseFloat(data.rate).toLocaleString('uz-UZ');
            document.getElementById('exchangeRate').textContent = `1$ = ${rate} so'm`;
        }
    } catch (err) {
        console.log('Exchange rate fetch error:', err);
        document.getElementById('exchangeRate').textContent = '1$ = ~12,900 so\'m';
    }
}

// Fetch data from server (with loading spinner)
async function loadData() {
    showLoading();

    // Izohlarni yuklash
    await loadComments();

    try {
        const res = await fetch(`${API_URL}/api/data`);
        const data = await res.json();

        if (data.agents && data.agents.length > 0) {
            agentsData = data.agents;
            previousData = data.previousData;

            // Ma'lumotlarni localStorage'da saqlash
            saveDataToLocalStorage(data);

            console.log('📊 Serverdan yuklandi. previousData:', previousData ? 'Ha (' + previousData.length + ' ta agent)' : 'Yo\'q');

            updateLastUpdatedDate(data.lastUpdated);
            showDashboard();
            updateStats();
            renderCharts();
            renderTable();
            loadHistoryDates();
        } else {
            // Server ma'lumot bermasa, localStorage'dan yuklab ko'ramiz
            const cachedData = loadDataFromLocalStorage();
            if (cachedData && cachedData.agents && cachedData.agents.length > 0) {
                agentsData = cachedData.agents;
                previousData = cachedData.previousData;
                updateLastUpdatedDate(cachedData.lastUpdated || cachedData.savedAt);
                showDashboard();
                updateStats();
                renderCharts();
                renderTable();
            } else {
                showEmpty();
            }
        }
    } catch (err) {
        console.error('Error loading data:', err);

        // Server xatosi bo'lsa, localStorage'dan yuklaymiz
        const cachedData = loadDataFromLocalStorage();
        if (cachedData && cachedData.agents && cachedData.agents.length > 0) {
            agentsData = cachedData.agents;
            previousData = cachedData.previousData;
            updateLastUpdatedDate(cachedData.lastUpdated || cachedData.savedAt);
            showDashboard();
            updateStats();
            renderCharts();
            renderTable();
            console.log('Server bilan bog\'lanib bo\'lmadi, cached data ishlatilmoqda');
        } else {
            if (window.Telegram && window.Telegram.WebApp) {
                alert('API Error: ' + err.message + '\nURL: ' + API_URL);
            }
            showEmpty();
        }
    }
}

// Orqa fonda serverdan yangilash (loading spinner ko'rsatmasdan)
async function loadDataSilent() {
    try {
        const res = await fetch(`${API_URL}/api/data`);
        const data = await res.json();

        if (data.agents && data.agents.length > 0) {
            agentsData = data.agents;
            previousData = data.previousData;

            // Ma'lumotlarni localStorage'da saqlash
            saveDataToLocalStorage(data);

            console.log('🔄 Serverdan yangilandi. previousData:', previousData ? 'Ha (' + previousData.length + ' ta agent)' : 'Yo\'q');

            updateLastUpdatedDate(data.lastUpdated);
            updateStats();
            renderCharts();
            renderTable();
        }
    } catch (err) {
        console.log('⚠️ Orqa fonda yangilash xatosi (cache ishlatilmoqda):', err.message);
    }
}

// Ma'lumotlarni localStorage'da saqlash
function saveDataToLocalStorage(data) {
    try {
        // Joriy ma'lumotlarni saqlash
        localStorage.setItem('debt_current_data', JSON.stringify({
            agents: data.agents,
            previousData: data.previousData,
            lastUpdated: data.lastUpdated,
            savedAt: new Date().toISOString()
        }));

        // Tarixiy ma'lumotlarni saqlash
        let history = JSON.parse(localStorage.getItem('debt_history') || '[]');

        // Yangi versiyani tarixga qo'shish (maksimum 10 ta versiya)
        history.unshift({
            agents: data.agents,
            savedAt: new Date().toISOString()
        });

        // Faqat oxirgi 10 ta versiyani saqlash
        if (history.length > 10) {
            history = history.slice(0, 10);
        }

        localStorage.setItem('debt_history', JSON.stringify(history));
        allHistoricalData = history;

        console.log('Ma\'lumotlar saqlandi. Tarix soni:', history.length);
    } catch (err) {
        console.error('localStorage saqlash xatosi:', err);
    }
}

// localStorage'dan ma'lumotlarni yuklash
function loadDataFromLocalStorage() {
    try {
        const cached = localStorage.getItem('debt_current_data');
        if (cached) {
            const data = JSON.parse(cached);
            console.log('Cached data yuklandi, saqlangan vaqt:', data.savedAt);
            return data;
        }
    } catch (err) {
        console.error('localStorage yuklash xatosi:', err);
    }
    return null;
}

// Tarixiy ma'lumotlarni yuklash
function loadHistoryFromLocalStorage() {
    try {
        const history = localStorage.getItem('debt_history');
        if (history) {
            allHistoricalData = JSON.parse(history);
            console.log('Tarix yuklandi, versiyalar soni:', allHistoricalData.length);
        }
    } catch (err) {
        console.error('Tarix yuklash xatosi:', err);
    }
}

function showLoading() {
    document.getElementById('loadingState').classList.remove('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('dashboardContent').classList.add('hidden');
}

function showEmpty() {
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('emptyState').classList.remove('hidden');
    document.getElementById('dashboardContent').classList.add('hidden');
}

function showDashboard() {
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('dashboardContent').classList.remove('hidden');
}

function updateStats() {
    const totalAgents = agentsData.length;
    const totalDebtors = agentsData.reduce((sum, a) => sum + a.debtorCount, 0);
    const totalUSD = agentsData.reduce((sum, a) => sum + a.totalUSD, 0);
    const totalUZS = agentsData.reduce((sum, a) => sum + a.totalUZS, 0);

    animateValue('totalAgents', totalAgents);
    animateValue('totalDebtors', totalDebtors);
    animateValue('totalUSD', totalUSD, '$');
    animateValue('totalUZS', totalUZS, 'UZS');

    // Oldingi ma'lumotlar bilan solishtirish
    updateDebtChange(totalUSD, totalUZS);
}

// Klient bo'yicha to'lovlarni hisoblash (showPayments bilan bir xil logika)
function calculatePayments(currency) {
    if (!previousData || previousData.length === 0) return 0;

    let totalPayment = 0;

    // Qarz kamaygan klientlar
    for (const agent of agentsData) {
        const prevAgent = previousData.find(a => normalizeName(a.name) === normalizeName(agent.name));
        if (!prevAgent) continue;

        for (const debtor of agent.debtors) {
            const prevDebtor = findPrevDebtor(prevAgent.debtors, debtor.name);
            if (!prevDebtor) continue;

            const payment = currency === 'usd'
                ? prevDebtor.usd - debtor.usd
                : prevDebtor.uzs - debtor.uzs;

            if (payment > 0.01) {
                totalPayment += payment;
            }
        }
    }

    // To'liq to'lagan klientlar (yangi faylda yo'q)
    for (const prevAgent of previousData) {
        const currentAgent = agentsData.find(a => normalizeName(a.name) === normalizeName(prevAgent.name));
        if (!prevAgent.debtors) continue;

        for (const prevDebtor of prevAgent.debtors) {
            const prevAmount = currency === 'usd' ? prevDebtor.usd : prevDebtor.uzs;
            if (prevAmount <= 0) continue;

            let foundInCurrent = false;
            if (currentAgent && currentAgent.debtors) {
                foundInCurrent = !!findPrevDebtor(currentAgent.debtors, prevDebtor.name);
            }

            if (!foundInCurrent) {
                totalPayment += prevAmount;
            }
        }
    }

    return totalPayment;
}

function updateDebtChange(currentUSD, currentUZS) {
    const changeUSDEl = document.getElementById('changeUSD');
    const changeUZSEl = document.getElementById('changeUZS');

    if (!changeUSDEl || !changeUZSEl) return;

    if (!previousData || previousData.length === 0) {
        changeUSDEl.textContent = '';
        changeUZSEl.textContent = '';
        return;
    }

    // Klient bo'yicha hisoblash (showPayments bilan bir xil)
    const diffUSD = -calculatePayments('usd');
    const diffUZS = -calculatePayments('uzs');

    // USD o'zgarish
    if (Math.abs(diffUSD) > 0.01) {
        if (diffUSD < 0) {
            changeUSDEl.innerHTML = `<span class="change-down">▼ -$${Math.abs(diffUSD).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
        } else {
            changeUSDEl.innerHTML = `<span class="change-up">▲ +$${diffUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
        }
    } else {
        changeUSDEl.innerHTML = `<span class="change-neutral">— o'zgarmagan</span>`;
    }

    // UZS o'zgarish
    if (Math.abs(diffUZS) > 1) {
        if (diffUZS < 0) {
            changeUZSEl.innerHTML = `<span class="change-down">▼ -${Math.abs(Math.round(diffUZS)).toLocaleString('uz-UZ')} so'm</span>`;
        } else {
            changeUZSEl.innerHTML = `<span class="change-up">▲ +${Math.round(diffUZS).toLocaleString('uz-UZ')} so'm</span>`;
        }
    } else {
        changeUZSEl.innerHTML = `<span class="change-neutral">— o'zgarmagan</span>`;
    }
}

function animateValue(id, value, prefix = '') {
    const el = document.getElementById(id);
    if (!el) return;

    const duration = 1000;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const current = value * progress;

        if (prefix === '$') {
            el.textContent = '$' + current.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } else if (prefix === 'UZS') {
            el.textContent = Math.floor(current).toLocaleString('uz-UZ');
        } else {
            el.textContent = Math.floor(current).toLocaleString('uz-UZ');
        }

        if (progress < 1) requestAnimationFrame(update);
    }

    requestAnimationFrame(update);
}

function renderCharts() {
    renderBarChart('agentChartUSD', 'totalUSD', '$', '#34c759');
    renderBarChart('agentChartUZS', 'totalUZS', 'UZS', '#ff3b30');
    renderPieChart('pieChartUSD', 'totalUSD');
    renderPieChart('pieChartUZS', 'totalUZS');
}

function renderBarChart(canvasId, field, prefix, color) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const existingChart = Chart.getChart(ctx);
    if (existingChart) existingChart.destroy();

    const sorted = [...agentsData].sort((a, b) => b[field] - a[field]).filter(a => a[field] > 0);

    if (sorted.length === 0) {
        ctx.parentElement.innerHTML = '<p style="text-align:center;color:#86868b;padding:60px;">Ma\'lumot yo\'q</p>';
        return;
    }

    const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 250);
    gradient.addColorStop(0, color + 'cc');
    gradient.addColorStop(1, color + '33');

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(a => a.name),
            datasets: [{
                data: sorted.map(a => a[field]),
                backgroundColor: gradient,
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#fff',
                    titleColor: '#1d1d1f',
                    bodyColor: '#6e6e73',
                    borderColor: 'rgba(0,0,0,0.1)',
                    borderWidth: 1,
                    cornerRadius: 10,
                    padding: 12,
                    callbacks: {
                        label: (ctx) => prefix === '$'
                            ? '$' + ctx.parsed.y.toLocaleString('en-US', { minimumFractionDigits: 2 })
                            : ctx.parsed.y.toLocaleString('uz-UZ') + ' so\'m'
                    }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#86868b', font: { size: 10 } } },
                y: {
                    grid: { color: 'rgba(0,0,0,0.04)' },
                    ticks: {
                        color: '#86868b',
                        callback: (v) => prefix === '$' ? '$' + v : (v / 1000000).toFixed(1) + 'M'
                    }
                }
            }
        }
    });
}

function renderPieChart(canvasId, field) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const existingChart = Chart.getChart(ctx);
    if (existingChart) existingChart.destroy();

    const colors = ['#ff3b30', '#ff9f0a', '#34c759', '#0071e3', '#bf4dff', '#ff2d55'];
    const top5 = [...agentsData].sort((a, b) => b[field] - a[field]).filter(a => a[field] > 0).slice(0, 5);

    if (top5.length === 0) {
        ctx.parentElement.innerHTML = '<p style="text-align:center;color:#86868b;padding:40px;">Ma\'lumot yo\'q</p>';
        return;
    }

    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: top5.map(a => a.name),
            datasets: [{
                data: top5.map(a => a[field]),
                backgroundColor: colors,
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true, font: { size: 10 } } }
            }
        }
    });
}

// Currency filter
let currentCurrencyFilter = 'all';

function showDebtorsList(currency) {
    currentCurrencyFilter = currency;

    document.querySelectorAll('.debtors-tab').forEach((btn, i) => {
        btn.classList.remove('active');
        if ((currency === 'all' && i === 0) ||
            (currency === 'usd' && i === 1) ||
            (currency === 'uzs' && i === 2)) {
            btn.classList.add('active');
        }
    });

    const usdTab = document.getElementById('usdTab');
    const uzsTab = document.getElementById('uzsTab');

    if (currency === 'uzs') {
        usdTab.classList.add('hidden');
        uzsTab.classList.remove('hidden');
    } else {
        usdTab.classList.remove('hidden');
        uzsTab.classList.add('hidden');
    }

    renderTableFiltered(currency);
}

function renderTable(filter = '') {
    renderTableFiltered('all', filter);
}

function renderTableFiltered(currency, searchFilter = '') {
    const tbody = document.getElementById('agentsTableBody');

    let filtered = [...agentsData];

    if (searchFilter) {
        filtered = filtered.filter(a => a.name.toLowerCase().includes(searchFilter.toLowerCase()));
    }

    if (currency === 'usd') {
        filtered = filtered.filter(a => a.totalUSD > 0);
        filtered.sort((a, b) => b.totalUSD - a.totalUSD);
    } else if (currency === 'uzs') {
        filtered = filtered.filter(a => a.totalUZS > 0);
        filtered.sort((a, b) => b.totalUZS - a.totalUZS);
    } else {
        filtered.sort((a, b) => (b.totalUSD + b.totalUZS) - (a.totalUSD + a.totalUZS));
    }

    tbody.innerHTML = filtered.map((agent, i) => {
        const showUSD = currency === 'all' || currency === 'usd';
        const showUZS = currency === 'all' || currency === 'uzs';

        // Format numbers for mobile - shorter format
        const formatUSD = (val) => {
            if (val >= 1000000) return '$' + (val / 1000000).toFixed(1) + 'M';
            if (val >= 1000) return '$' + (val / 1000).toFixed(1) + 'K';
            return '$' + val.toFixed(0);
        };

        const formatUZS = (val) => {
            if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
            if (val >= 1000) return (val / 1000).toFixed(0) + 'K';
            return val.toFixed(0);
        };

        return `
            <tr class="clickable-row" onclick="showAgentDetails('${agent.name.replace(/'/g, "\\'")}')">
                <td>${i + 1}</td>
                <td><strong>${agent.name}</strong></td>
                <td>${agent.debtorCount}</td>
                <td class="usd-amount">${showUSD ? formatUSD(agent.totalUSD) : '-'}</td>
                <td class="uzs-amount">${showUZS ? formatUZS(agent.totalUZS) : '-'}</td>
            </tr>
        `;
    }).join('');
}

function initSearch() {
    const searchInput = document.getElementById('searchAgent');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => renderTableFiltered(currentCurrencyFilter, e.target.value));
    }
}

// Modal Functions
// Normalize name for comparison
function normalizeName(name) {
    return name.toLowerCase().replace(/[^a-z0-9а-яёўқғҳ]/gi, '');
}

// ============ IZOHLAR (COMMENTS) ============

// Serverdan izohlarni yuklash
async function loadComments() {
    try {
        const res = await fetch(`${API_URL}/api/comments`);
        if (res.ok) {
            const data = await res.json();
            clientComments = data.comments || {};
        }
    } catch (e) {
        console.error('Izohlarni yuklashda xatolik:', e);
    }
}

// Izohni serverga saqlash
async function saveComment(agent, client, comment) {
    const key = `${agent}::${client}`;
    if (comment && comment.trim()) {
        clientComments[key] = { text: comment.trim(), date: new Date().toISOString() };
    } else {
        delete clientComments[key];
    }
    // Sanani darhol yangilash
    const dateCell = document.querySelector(`[data-date-key="${CSS.escape(key)}"]`);
    if (dateCell) {
        dateCell.textContent = comment && comment.trim() ? formatCommentDate(new Date().toISOString()) : '';
    }
    try {
        await fetch(`${API_URL}/api/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent, client, comment })
        });
    } catch (e) {
        console.error('Izoh saqlashda xatolik:', e);
    }
}

// Izoh sanasini formatlash
function formatCommentDate(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hr = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${day}.${mon}.${year} ${hr}:${min}`;
}

// Izoh ob'yektidan matnni olish (eski string yoki yangi {text,date})
function getCommentText(commentData) {
    if (!commentData) return '';
    if (typeof commentData === 'string') return commentData;
    return commentData.text || '';
}

function getCommentDate(commentData) {
    if (!commentData) return '';
    if (typeof commentData === 'string') return '';
    return commentData.date || '';
}

// Fuzzy name matching - topilmasa, boshini solishtirish
function findPrevDebtor(prevDebtors, currentName) {
    if (!prevDebtors || prevDebtors.length === 0) return null;
    const normalized = normalizeName(currentName);
    // 1. To'liq moslik
    let found = prevDebtors.find(d => normalizeName(d.name) === normalized);
    if (found) return found;
    // 2. Boshi bilan moslik (kamida 5 ta belgi)
    if (normalized.length >= 5) {
        found = prevDebtors.find(d => {
            const prev = normalizeName(d.name);
            return prev.startsWith(normalized.substring(0, 5)) || normalized.startsWith(prev.substring(0, 5));
        });
        if (found) return found;
    }
    return null;
}

function showAgentDetails(agentName) {
    const agent = agentsData.find(a => a.name === agentName);
    if (!agent) return;

    // Find previous agent data for comparison
    let prevAgent = null;
    if (previousData) {
        prevAgent = previousData.find(a => normalizeName(a.name) === normalizeName(agentName));
    }

    document.getElementById('modalAgentName').textContent = agent.name;
    document.getElementById('modalDebtorCount').textContent = agent.debtorCount;
    document.getElementById('modalTotalUSD').textContent = '$' + agent.totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2 });
    document.getElementById('modalTotalUZS').textContent = agent.totalUZS.toLocaleString('uz-UZ');

    const sortedDebtors = [...agent.debtors].sort((a, b) => (b.usd + b.uzs) - (a.usd + a.uzs));

    const tbody = document.getElementById('modalTableBody');
    tbody.innerHTML = sortedDebtors.map((debtor, i) => {
        // Calculate change from previous data
        let changeHtml = '';
        if (prevAgent && prevAgent.debtors && prevAgent.debtors.length > 0) {
            // Find matching debtor - fuzzy matching
            const prevDebtor = findPrevDebtor(prevAgent.debtors, debtor.name);

            if (prevDebtor) {
                const usdChange = debtor.usd - prevDebtor.usd;
                const uzsChange = debtor.uzs - prevDebtor.uzs;

                // Only show significant changes (min $10 or 100,000 UZS)
                if (usdChange > 10) {
                    changeHtml = `<span class="change increase">▲ +$${Math.round(usdChange)}</span>`;
                } else if (usdChange < -10) {
                    changeHtml = `<span class="change decrease">▼ -$${Math.round(Math.abs(usdChange))}</span>`;
                } else if (uzsChange > 100000) {
                    changeHtml = `<span class="change increase">▲ +${Math.round(uzsChange).toLocaleString('uz-UZ')}</span>`;
                } else if (uzsChange < -100000) {
                    changeHtml = `<span class="change decrease">▼ -${Math.round(Math.abs(uzsChange)).toLocaleString('uz-UZ')}</span>`;
                }
            } else {
                // New debtor
                changeHtml = `<span class="change increase">🆕 Yangi</span>`;
            }
        }

        // Izohni olish
        const commentKey = `${agentName}::${debtor.name}`;
        const commentData = clientComments[commentKey];
        const existingComment = getCommentText(commentData);
        const commentDate = getCommentDate(commentData);

        return `
        <tr>
            <td>${i + 1}</td>
            <td>${debtor.name} ${changeHtml}</td>
            <td class="comment-cell">
                <input type="text" class="comment-input" 
                    value="${existingComment.replace(/"/g, '&quot;')}" 
                    placeholder="Izoh..."
                    data-agent="${agentName.replace(/"/g, '&quot;')}" 
                    data-client="${debtor.name.replace(/"/g, '&quot;')}"
                    onfocus="this.classList.add('editing')"
                    onblur="this.classList.remove('editing'); saveComment(this.dataset.agent, this.dataset.client, this.value)" />
            </td>
            <td class="comment-date" data-date-key="${commentKey.replace(/"/g, '&quot;')}">${formatCommentDate(commentDate)}</td>
            <td class="usd-amount">${debtor.usd > 0 ? '$' + debtor.usd.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-'}</td>
            <td class="uzs-amount">${debtor.uzs > 0 ? debtor.uzs.toLocaleString('uz-UZ') : '-'}</td>
        </tr>
    `;
    }).join('');

    document.getElementById('clientModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    document.getElementById('clientModal').classList.add('hidden');
    document.body.style.overflow = '';
}

// Close modal on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
        closePaymentsModal();
    }
});

// Show payments - clients who paid (debt decreased)
function showPayments(currency) {
    if (!previousData || previousData.length === 0) {
        alert("Oldingi ma'lumotlar mavjud emas. Kamida 2 marta Excel yuklash kerak.");
        return;
    }

    const payments = [];
    let totalPayment = 0;

    // Compare current data with previous data
    for (const agent of agentsData) {
        const prevAgent = previousData.find(a => normalizeName(a.name) === normalizeName(agent.name));
        if (!prevAgent) continue;

        for (const debtor of agent.debtors) {
            const prevDebtor = findPrevDebtor(prevAgent.debtors, debtor.name);
            if (!prevDebtor) continue;

            let payment = 0;
            if (currency === 'usd') {
                payment = prevDebtor.usd - debtor.usd;
            } else {
                payment = prevDebtor.uzs - debtor.uzs;
            }

            // If payment > 0, debt decreased (client paid)
            if (payment > 0.01) {
                payments.push({
                    agent: agent.name,
                    client: debtor.name,
                    payment: payment,
                    currency: currency,
                    fullyPaid: false
                });
                totalPayment += payment;
            }
        }
    }

    // ====== To'liq to'lagan klientlar ======
    // previousData'dagi klientlar yangi faylda umuman yo'q bo'lsa — to'liq to'lagan
    for (const prevAgent of previousData) {
        const currentAgent = agentsData.find(a => normalizeName(a.name) === normalizeName(prevAgent.name));

        if (!prevAgent.debtors) continue;

        for (const prevDebtor of prevAgent.debtors) {
            const prevAmount = currency === 'usd' ? prevDebtor.usd : prevDebtor.uzs;
            if (prevAmount <= 0) continue;

            let foundInCurrent = false;
            if (currentAgent && currentAgent.debtors) {
                foundInCurrent = !!findPrevDebtor(currentAgent.debtors, prevDebtor.name);
            }

            if (!foundInCurrent) {
                payments.push({
                    agent: prevAgent.name,
                    client: prevDebtor.name,
                    payment: prevAmount,
                    currency: currency,
                    fullyPaid: true
                });
                totalPayment += prevAmount;
            }
        }
    }

    // Sort by payment amount (highest first)
    payments.sort((a, b) => b.payment - a.payment);

    // Update modal
    const titleEl = document.getElementById('paymentsModalTitle');
    const countEl = document.getElementById('paymentsCount');
    const totalEl = document.getElementById('paymentsTotalAmount');
    const tbody = document.getElementById('paymentsTableBody');
    const noPaymentsEl = document.getElementById('noPaymentsMessage');
    const tableWrapper = document.querySelector('#paymentsModal .modal-table-wrapper');

    if (currency === 'usd') {
        titleEl.textContent = "💵 USD To'lovlar";
        totalEl.textContent = '$' + totalPayment.toLocaleString('en-US', { minimumFractionDigits: 2 });
        totalEl.parentElement.classList.remove('uzs');
        totalEl.parentElement.classList.add('usd');
    } else {
        titleEl.textContent = "🇺🇿 UZS To'lovlar";
        totalEl.textContent = totalPayment.toLocaleString('uz-UZ') + " so'm";
        totalEl.parentElement.classList.remove('usd');
        totalEl.parentElement.classList.add('uzs');
    }

    countEl.textContent = payments.length;

    if (payments.length === 0) {
        noPaymentsEl.classList.remove('hidden');
        tableWrapper.classList.add('hidden');
    } else {
        noPaymentsEl.classList.add('hidden');
        tableWrapper.classList.remove('hidden');

        tbody.innerHTML = payments.map((p, i) => `
            <tr class="${p.fullyPaid ? 'fully-paid-row' : ''}">
                <td>${i + 1}</td>
                <td>${p.agent}</td>
                <td>${p.client}${p.fullyPaid ? ' <span class="fully-paid-badge">✅ To\'landi</span>' : ''}</td>
                <td class="${currency === 'usd' ? 'usd-amount' : 'uzs-amount'}">
                    ${currency === 'usd'
                ? '$' + p.payment.toLocaleString('en-US', { minimumFractionDigits: 2 })
                : p.payment.toLocaleString('uz-UZ')}
                </td>
            </tr>
        `).join('');
    }

    // Eksport uchun saqlash
    lastPaymentsData = { payments, totalPayment, currency };

    document.getElementById('paymentsModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closePaymentsModal() {
    document.getElementById('paymentsModal').classList.add('hidden');
    document.body.style.overflow = '';
}

// Excel'ga eksport qilish
function exportPaymentsToExcel() {
    if (!lastPaymentsData || lastPaymentsData.payments.length === 0) {
        alert("Eksport qilish uchun ma'lumot yo'q");
        return;
    }

    const { payments, totalPayment, currency } = lastPaymentsData;

    // Ma'lumotlarni tayyorlash
    const rows = payments.map((p, i) => ({
        '№': i + 1,
        'Agent': p.agent,
        'Klient': p.client + (p.fullyPaid ? ' ✅ To\'landi' : ''),
        'To\'lov': p.payment
    }));

    // Jami qator
    rows.push({
        '№': '',
        'Agent': '',
        'Klient': 'JAMI:',
        'To\'lov': totalPayment
    });

    // Excel yaratish
    const ws = XLSX.utils.json_to_sheet(rows);

    // Ustun kengliklarini sozlash
    ws['!cols'] = [
        { wch: 5 },   // №
        { wch: 25 },  // Agent
        { wch: 35 },  // Klient
        { wch: 15 }   // To'lov
    ];

    const wb = XLSX.utils.book_new();
    const sheetName = currency === 'usd' ? 'USD Tolovlar' : 'UZS Tolovlar';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    // Fayl nomini yaratish
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    const fileName = `Tolovlar_${currency.toUpperCase()}_${dateStr}.xlsx`;

    // Yuklab olish
    XLSX.writeFile(wb, fileName);
}

// ============ TARIX (HISTORY) FUNKSIYALARI ============

let isHistoryMode = false;
let savedCurrentData = null; // Joriy ma'lumotni saqlash (tarixdan qaytish uchun)

// Serverdan mavjud sanalarni yuklash
async function loadHistoryDates() {
    try {
        const res = await fetch(`${API_URL}/api/history`);
        const data = await res.json();

        const select = document.getElementById('historyDateSelect');
        if (!select || !data.dates || data.dates.length === 0) return;

        // Selectni tozalash va "Bugungi" ni qo'shish
        select.innerHTML = '<option value="today">📊 Bugungi holat</option>';

        // Sanalarni qo'shish
        data.dates.forEach(item => {
            const option = document.createElement('option');
            option.value = item.date;
            // Sanani chiroyli formatda ko'rsatish
            const d = new Date(item.date + 'T00:00:00');
            const day = String(d.getDate()).padStart(2, '0');
            const months = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
            const monthName = months[d.getMonth()];
            option.textContent = `📅 ${day}-${monthName} ${d.getFullYear()}`;
            select.appendChild(option);
        });

        console.log('📅 Tarix sanalari yuklandi:', data.dates.length, 'ta kun');
    } catch (err) {
        console.log('⚠️ Tarix sanalarini yuklash xatosi:', err.message);
    }
}

// Sana tanlanganda
async function onHistoryDateChange(value) {
    if (value === 'today') {
        backToToday();
        return;
    }

    try {
        // Joriy ma'lumotlarni saqlash (keyinroq qaytish uchun)
        if (!isHistoryMode) {
            savedCurrentData = {
                agents: agentsData,
                previousData: previousData
            };
        }

        const res = await fetch(`${API_URL}/api/history/${value}`);
        if (!res.ok) {
            alert('Bu sana uchun ma\'lumot topilmadi');
            return;
        }
        const snapshot = await res.json();

        // Tarixiy ma'lumotlarni agentsData formatiga o'tkazish
        agentsData = snapshot.summary.map(s => ({
            name: s.name,
            totalUSD: s.totalUSD,
            totalUZS: s.totalUZS,
            debtorCount: s.debtorCount,
            debtors: [] // Tarixda batafsil debtor ro'yxati yo'q
        }));

        isHistoryMode = true;

        // UI ni yangilash
        updateStats();
        renderCharts();
        renderTable();
        updateLastUpdatedDate(snapshot.lastUpdated);

        // Tarixiy rejim ko'rsatkichini ko'rsatish
        document.getElementById('historyBadge').classList.remove('hidden');

        // To'lov tugmalarini yashirish (tarixda debtor tafsilotlari yo'q)
        const paymentBtns = document.querySelector('.payment-buttons');
        if (paymentBtns) paymentBtns.classList.add('hidden');

        // Change indikatorlarini tozalash
        const changeUSD = document.getElementById('changeUSD');
        const changeUZS = document.getElementById('changeUZS');
        if (changeUSD) changeUSD.textContent = '';
        if (changeUZS) changeUZS.textContent = '';

        console.log('📅 Tarixiy ma\'lumot yuklandi:', value);
    } catch (err) {
        console.error('Tarixiy ma\'lumot yuklash xatosi:', err);
        alert('Xatolik yuz berdi: ' + err.message);
    }
}

// Bugungi holatga qaytish
function backToToday() {
    if (savedCurrentData) {
        agentsData = savedCurrentData.agents;
        previousData = savedCurrentData.previousData;
        savedCurrentData = null;
    }

    isHistoryMode = false;

    // Select ni "Bugungi" ga qaytarish
    const select = document.getElementById('historyDateSelect');
    if (select) select.value = 'today';

    // Tarixiy rejim badge ni yashirish
    document.getElementById('historyBadge').classList.add('hidden');

    // To'lov tugmalarini qaytarish
    const paymentBtns = document.querySelector('.payment-buttons');
    if (paymentBtns) paymentBtns.classList.remove('hidden');

    // UI ni qayta chizish
    updateStats();
    renderCharts();
    renderTable();

    // Serverdan yangi ma'lumotlarni yuklash
    loadDataSilent();

    console.log('📊 Bugungi holatga qaytildi');
}
