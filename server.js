const express = require('express');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { eq, or } = require('drizzle-orm');

const { initDB, getDB } = require('./database/index');
const { runCoreMigrations } = require('./database/migrate');
const { users } = require('./database/schema/users');
const { posts } = require("./database/schema/posts");
const { requireAuth, checkAuth } = require('./core/middlewares/auth');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/public', express.static(path.join(__dirname, 'public')));

// Fungsi Restart cPanel
const triggerRestart = () => {
    const restartFile = path.join(__dirname, 'tmp', 'restart.txt');
    try {
        if (!fs.existsSync(path.join(__dirname, 'tmp'))) fs.mkdirSync(path.join(__dirname, 'tmp'));
        const time = new Date();
        fs.utimesSync(restartFile, time, time);
        console.log('🔄 Application restart triggered for cPanel Passenger.');
    } catch (err) {
        fs.writeFileSync(restartFile, 'Restart Triggered');
        console.log('🔄 tmp/restart.txt created. App will restart.');
    }
};

// Middleware Cek Installasi
app.use((req, res, next) => {
    const isInstalled = fs.existsSync(path.join(__dirname, '.env'));
    if (!isInstalled && !req.path.startsWith('/install') && !req.path.startsWith('/public')) {
        return res.redirect('/install');
    }
    if (isInstalled && req.path.startsWith('/install')) {
        return res.redirect('/admin');
    }
    next();
});

// --- ROUTES INSTALASI ---
app.get('/install', (req, res) => {
    res.render('install/index.ejs');
});

app.post('/install', async (req, res) => {
    const { dbType, tablePrefix, dbHost, dbPort, dbName, dbUser, dbPass, adminUser, adminEmail, adminPass } = req.body;
    const prefix = tablePrefix ? tablePrefix.trim() : 'frizk_';
    let envContent = `NODE_ENV=production\nPORT=3000\nDB_TYPE=${dbType}\nDB_PREFIX=${prefix}\n`;

    if (dbType === 'sqlite') {
        envContent += `DB_SQLITE_PATH=./database/frizk.sqlite\n`;
    } else {
        const dialect = dbType === 'postgres' ? 'postgresql' : 'mysql';
        const portStr = dbPort ? `:${dbPort}` : '';
        envContent += `DATABASE_URL="${dialect}://${dbUser}:${dbPass}@${dbHost}${portStr}/${dbName}"\n`;
    }

    envContent += `SESSION_SECRET="${require('crypto').randomBytes(32).toString('hex')}"\n`;

    try {
        fs.writeFileSync(path.join(__dirname, '.env'), envContent);
        dotenv.config({ override: true });
        const db = await initDB();
        await runCoreMigrations(dbType, prefix);
        const hashedPassword = await bcrypt.hash(adminPass, 10);
        await db.insert(users).values({ username: adminUser, email: adminEmail, password: hashedPassword, role: 'admin' });
        triggerRestart();
        res.send('<div class="auth-wrapper"><div class="frizk-card" style="text-align:center;"><h1>Installation Complete!</h1><p style="margin-bottom:1rem;">Welcome to FrizkCMS.</p><a href="/admin" class="btn btn-primary">Go to Admin Panel</a></div></div>');
    } catch (error) {
        console.error(error);
        if (fs.existsSync(path.join(__dirname, '.env'))) fs.unlinkSync(path.join(__dirname, '.env'));
        res.status(500).send(`Installation Failed: ${error.message}. <a href="/install">Try Again</a>`);
    }
});


// --- ROUTES AUTENTIKASI ---
app.get('/admin/login', (req, res) => {
    const token = req.cookies.token;
    if (token) {
        try {
            jwt.verify(token, process.env.SESSION_SECRET);
            return res.redirect('/admin');
        } catch (e) {
            res.clearCookie('token');
        }
    }
    const errorMsg = req.query.error === 'failed' ? 'Invalid credentials.' : req.query.error === 'expired' ? 'Session expired.' : null;
    // Menggunakan auth-wrapper untuk menengahkan halaman login
    res.send(`
        <!DOCTYPE html><html><head><title>Login - FrizkCMS</title><link rel="stylesheet" href="/public/admin/css/frizk-ui.css"></head>
        <body><div class="auth-wrapper">
    ` + require('ejs').render(fs.readFileSync(path.join(__dirname, 'views/admin/login.ejs'), 'utf8'), { error: errorMsg }) + `
        </div></body></html>
    `);
});

app.post('/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const db = getDB();
        const result = await db.select().from(users).where(or(eq(users.username, username), eq(users.email, username))).limit(1);
        const user = result[0];

        if (!user || !(await bcrypt.compare(password, user.password))) return res.redirect('/admin/login?error=failed');

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.SESSION_SECRET, { expiresIn: '24h' });
        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 });
        res.redirect('/admin');
    } catch (error) {
        res.redirect('/admin/login?error=failed');
    }
});

app.get('/admin/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/admin/login');
});


// --- ROUTES ADMIN TERPROTEKSI ---
app.get('/admin', requireAuth, (req, res) => {
    res.render('admin/dashboard.ejs', { 
        title: 'Dashboard', path: '/admin', user: req.user, dbType: process.env.DB_TYPE
    }, (err, html) => {
        if (err) return res.status(500).send(`EJS Error: ${err.message}`);
        res.send(html);
    });
});

// 1. Tampilkan daftar Posts
app.get('/admin/posts', requireAuth, async (req, res) => {
    try {
        const db = getDB();
        const allPosts = await db.select().from(posts); // Bisa ditambahkan order by nanti
        
        res.render('admin/posts/index.ejs', { 
            title: 'Posts', path: '/admin/posts', user: req.user, posts: allPosts 
        });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// 2. Tampilkan form buat Post baru
app.get('/admin/posts/new', requireAuth, (req, res) => {
    res.render('admin/posts/form.ejs', { 
        title: 'New Post', path: '/admin/posts', user: req.user 
    });
});

// 3. Proses simpan Post baru
app.post('/admin/posts/new', requireAuth, async (req, res) => {
    try {
        const { title, content, status } = req.body;
        // Generate slug sederhana (hilangkan spasi, huruf kecil)
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
        
        const db = getDB();
        await db.insert(posts).values({
            title,
            slug,
            content,
            status
        });
        
        res.redirect('/admin/posts');
    } catch (error) {
        res.status(500).send("Error creating post. Slug might already exist. " + error.message);
    }
});


// --- API ROUTES ---
app.get('/api/v1/posts', (req, res) => {
    res.json({ success: true, message: "FrizkCMS API is running", data: [] });
});


// --- FRONTEND THEME (FALLBACK) DENGAN ADMIN BAR ---
app.get('*', checkAuth, (req, res) => {
    let html = `<!DOCTYPE html><html><head><title>My FrizkCMS Website</title><link rel="stylesheet" href="/public/admin/css/frizk-ui.css"></head><body style="${req.user ? 'padding-top: 56px;' : ''}">`;
    
    // Inject Master Navbar jika login
    if (req.user) {
        const topbarPath = path.join(__dirname, 'views', 'partials', 'topbar.ejs');
        html += require('ejs').render(fs.readFileSync(topbarPath, 'utf8'), { user: req.user, path: req.path });
    }

    html += `<div style="max-width: 800px; margin: 4rem auto; padding: 2rem;">
        <h1>Hello World!</h1><p>Ini adalah halaman publik dari website Anda.</p><p>Coba buka <a href="/admin">Dashboard Admin</a>.</p>
    </div></body></html>`;
    
    res.send(html);
});


// --- START SERVER ---
const startServer = async () => {
    if (fs.existsSync(path.join(__dirname, '.env'))) {
        try {
            await initDB();
        } catch (err) {
            console.log("⚠️ Could not connect to database.");
        }
    }
    app.listen(PORT, () => { console.log(`🚀 FrizkCMS is running on http://localhost:${PORT}`); });
};

startServer();