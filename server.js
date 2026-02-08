const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();

// CORS - Allow all origins for local testing
app.use(cors());

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve Mini App files
app.use('/app', express.static(path.join(__dirname, '..', 'netlify-build')));


// Data file path
const DATA_FILE = path.join(__dirname, 'data.json');

// Admin password (change this!)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// ============ JSONBin.io CLOUD STORAGE ============
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID || '';
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY || '';
const JSONBIN_API_URL = JSONBIN_BIN_ID ? `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}` : '';

// Load data from JSONBin.io (cloud)
async function loadFromCloud() {
    if (!JSONBIN_API_URL || !JSONBIN_API_KEY) {
        console.log('⚠️  JSONBin sozlanmagan, lokal data.json ishlatiladi');
        return null;
    }
    try {
        console.log('☁️  JSONBin\'dan ma\'lumot yuklanmoqda...');
        const res = await fetch(`${JSONBIN_API_URL}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_API_KEY }
        });
        if (res.ok) {
            const json = await res.json();
            const record = json.record || {};
            // Ma'lumotni validatsiya qilish
            if (!record.agents) record.agents = [];
            if (!record.lastUpdated) record.lastUpdated = null;
            if (!record.previousData) record.previousData = null;
            if (!record.appPassword) record.appPassword = '1';
            console.log('✅ JSONBin\'dan ma\'lumot muvaffaqiyatli yuklandi');
            return record;
        } else {
            console.error('❌ JSONBin xatosi:', res.status, await res.text());
            return null;
        }
    } catch (e) {
        console.error('❌ JSONBin ulanish xatosi:', e.message);
        return null;
    }
}

// Save data to JSONBin.io (cloud)
async function saveToCloud(data) {
    if (!JSONBIN_API_URL || !JSONBIN_API_KEY) return false;
    try {
        // previousData ni to'liq saqlash (debtors bilan)
        // Bu to'lov qilgan klientlarni aniqlash uchun kerak
        const cloudData = { ...data };
        if (cloudData.previousData && Array.isArray(cloudData.previousData)) {
            cloudData.previousData = cloudData.previousData.map(a => ({
                name: a.name,
                totalUSD: a.totalUSD || 0,
                totalUZS: a.totalUZS || 0,
                debtorCount: a.debtorCount || 0,
                debtors: [] // debtors ro'yxatini olib tashlash (hajmni kamaytirish)
            }));
        }

        const res = await fetch(JSONBIN_API_URL, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_API_KEY
            },
            body: JSON.stringify(cloudData)
        });
        if (res.ok) {
            console.log('✅ JSONBin\'ga ma\'lumot saqlandi');
            return true;
        } else {
            console.error('❌ JSONBin saqlash xatosi:', res.status, await res.text());
            return false;
        }
    } catch (e) {
        console.error('❌ JSONBin saqlash ulanish xatosi:', e.message);
        return false;
    }
}

// Load from local file (fallback)
function loadFromFile() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            if (!data.appPassword) {
                data.appPassword = '1';
            }
            return data;
        }
    } catch (e) {
        console.error('Error loading local data:', e);
    }
    return { agents: [], lastUpdated: null, previousData: null, appPassword: '1' };
}

// Save data (cloud + local)
async function saveData(data) {
    // Lokal faylga saqlash (zaxira)
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Lokal saqlash xatosi:', e);
    }
    // Bulutga saqlash (xato bo'lsa ham davom etadi)
    try {
        await saveToCloud(data);
    } catch (e) {
        console.error('Bulutga saqlashda xatolik:', e.message);
    }
}

// Initialize data
let dashboardData = loadFromFile();

// File upload setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, Buffer.from(file.originalname, 'latin1').toString('utf8'))
});
const upload = multer({ storage });

// Process Excel files
async function processExcelFiles(files) {
    // Save previous data for comparison
    if (dashboardData.agents && dashboardData.agents.length > 0) {
        dashboardData.previousData = [...dashboardData.agents];
    }

    const agents = [];

    for (const file of files) {
        try {
            const workbook = XLSX.readFile(file.path);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

            const agentName = file.originalname.replace(/\s*\d+\.\d+\.\d+\.xlsx?$/i, '').replace(/\.xlsx?$/i, '').trim();

            let totalUSD = 0;
            let totalUZS = 0;
            let debtorCount = 0;
            const debtors = [];

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row) continue;

                const dVal = row[3];
                const eVal = row[4];

                if (typeof dVal === 'number' || typeof eVal === 'number') {
                    const usd = (typeof dVal === 'number') ? dVal : 0;
                    const uzs = (typeof eVal === 'number') ? eVal : 0;

                    if (usd > 0 || uzs > 0) {
                        totalUSD += usd;
                        totalUZS += uzs;
                        debtorCount++;

                        // Klient nomini topish - turli ustun strukturalarini qo'llab-quvvatlash
                        let name = null;

                        // A, B, C ustunlaridan birinchi matnli qiymatni topish
                        for (let col = 0; col <= 2; col++) {
                            const cellValue = row[col];
                            // Agar qiymat string va kamida 2 ta harf bo'lsa
                            if (typeof cellValue === 'string' && cellValue.trim().length >= 2) {
                                // Faqat raqamdan iborat bo'lmagan stringni olish
                                if (!/^\d+$/.test(cellValue.trim())) {
                                    name = cellValue.trim();
                                    break;
                                }
                            }
                        }

                        // Agar nom topilmasa, default nom berish
                        if (!name) {
                            name = `Qarzdor ${debtorCount}`;
                        }

                        debtors.push({ name: String(name), usd, uzs });
                    }
                }
            }

            agents.push({
                name: agentName,
                debtors,
                totalUSD,
                totalUZS,
                debtorCount
            });

            // Clean up uploaded file
            try { fs.unlinkSync(file.path); } catch (e) { }

        } catch (err) {
            console.error('Error processing file:', file.originalname, err);
        }
    }

    dashboardData.agents = agents;
    dashboardData.lastUpdated = new Date().toISOString();

    // Save to file and cloud
    await saveData(dashboardData);

    return agents;
}

// ============ API ENDPOINTS ============

// Get dashboard data (for Mini App)
app.get('/api/data', (req, res) => {
    res.json(dashboardData);
});

// Get app password (for Mini App login)
app.get('/api/app-password', (req, res) => {
    res.json({ password: dashboardData.appPassword || '1' });
});

// Update app password (admin only)
app.post('/api/app-password', async (req, res) => {
    const adminPass = req.headers['x-admin-password'];
    if (adminPass !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ruxsat yo\'q' });
    }

    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 1) {
        return res.status(400).json({ error: 'Parol bo\'sh bo\'lmasligi kerak' });
    }

    dashboardData.appPassword = newPassword;
    await saveData(dashboardData);
    res.json({ success: true, message: 'Parol o\'zgartirildi' });
});

// Set exchange rate (admin only)
app.post('/api/exchange-rate', async (req, res) => {
    const password = req.headers['x-admin-password'];

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ruxsat yo\'q' });
    }

    const { rate } = req.body;
    if (!rate || isNaN(rate)) {
        return res.status(400).json({ error: 'Kurs noto\'g\'ri' });
    }

    dashboardData.exchangeRate = parseFloat(rate);
    await saveData(dashboardData);
    res.json({ success: true, message: 'Kurs o\'zgartirildi' });
});

// Get exchange rate
app.get('/api/exchange-rate', (req, res) => {
    res.json({ rate: dashboardData.exchangeRate || 12900 });
});

// Admin authentication check
app.post('/api/auth', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Noto\'g\'ri parol' });
    }
});

// Upload files (admin only)
app.post('/api/upload', upload.array('files'), async (req, res) => {
    const password = req.headers['x-admin-password'];

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ruxsat yo\'q' });
    }

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Fayllar yuklanmadi' });
    }

    const agents = await processExcelFiles(req.files);

    res.json({
        success: true,
        message: `${agents.length} ta agent ma'lumotlari yuklandi`,
        agents: agents.length,
        lastUpdated: dashboardData.lastUpdated
    });
});

// Serve admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        agents: dashboardData.agents.length,
        lastUpdated: dashboardData.lastUpdated
    });
});

// Start server with cloud data sync
const PORT = process.env.PORT || 3000;

async function startServer() {
    // Avval bulutdan ma'lumot yuklash
    const cloudData = await loadFromCloud();
    if (cloudData) {
        dashboardData = cloudData;
        // Lokal faylga ham saqlash (zaxira)
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify(dashboardData, null, 2));
        } catch (e) {
            console.error('Lokal zaxira saqlash xatosi:', e);
        }
        console.log(`📊 Bulutdan ${dashboardData.agents?.length || 0} ta agent yuklandi`);
    } else {
        console.log(`📊 Lokal fayldan ${dashboardData.agents?.length || 0} ta agent yuklandi`);
    }

    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Admin panel: http://localhost:${PORT}/admin`);
        if (JSONBIN_BIN_ID) {
            console.log('☁️  JSONBin.io cloud storage: FAOL');
        } else {
            console.log('⚠️  JSONBin.io sozlanmagan - faqat lokal saqlash');
        }
    });
}

startServer();

