const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

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

// Load existing data
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading data:', e);
    }
    return { agents: [], lastUpdated: null, previousData: null };
}

// Save data
function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Initialize data
let dashboardData = loadData();

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
function processExcelFiles(files) {
    // Save previous data for comparison
    if (dashboardData.agents.length > 0) {
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

                        const name = row[1] || `Qarzdor ${debtorCount}`;
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

    // Save to file
    saveData(dashboardData);

    return agents;
}

// ============ API ENDPOINTS ============

// Get dashboard data (for Mini App)
app.get('/api/data', (req, res) => {
    res.json(dashboardData);
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
app.post('/api/upload', upload.array('files'), (req, res) => {
    const password = req.headers['x-admin-password'];

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ruxsat yo\'q' });
    }

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Fayllar yuklanmadi' });
    }

    const agents = processExcelFiles(req.files);

    res.json({
        success: true,
        message: `${agents.length} ta agent ma'lumotlari yuklandi`,
        agents: agents.length,
        lastUpdated: dashboardData.lastUpdated
    });
});

// Serve admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        agents: dashboardData.agents.length,
        lastUpdated: dashboardData.lastUpdated
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin`);
});




