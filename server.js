const express = require('express');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { eq, or, desc, and } = require('drizzle-orm');

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
app.get('/admin', requireAuth, async (req, res) => {
    try {
        const db = getDB();
        // Ambil semua post untuk dihitung jumlahnya
        const allPosts = await db.select().from(posts);
        
        res.render('admin/dashboard.ejs', { 
            title: 'Dashboard', 
            path: '/admin', 
            user: req.user, 
            dbType: process.env.DB_TYPE,
            totalPosts: allPosts.length // Kirim total post ke tampilan
        });
    } catch (err) {
        res.status(500).send(`Error: ${err.message}`);
    }
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

app.get('/admin/posts/edit/:id', requireAuth, async (req, res) => {
    try {
        const db = getDB();
        const postId = parseInt(req.params.id);
        const result = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
        
        if (result.length === 0) return res.redirect('/admin/posts');

        res.render('admin/posts/edit.ejs', { 
            title: 'Edit Post', path: '/admin/posts', user: req.user, post: result[0] 
        });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// 5. Proses simpan Edit Post
app.post('/admin/posts/edit/:id', requireAuth, async (req, res) => {
    try {
        const { title, content, status } = req.body;
        const postId = parseInt(req.params.id);
        
        const db = getDB();
        await db.update(posts)
            .set({ title, content, status })
            .where(eq(posts.id, postId));
            
        res.redirect('/admin/posts');
    } catch (error) {
        res.status(500).send("Error updating post. " + error.message);
    }
});

// 6. Proses Delete Post
app.post('/admin/posts/delete/:id', requireAuth, async (req, res) => {
    try {
        const db = getDB();
        const postId = parseInt(req.params.id);
        
        await db.delete(posts).where(eq(posts.id, postId));
        
        res.redirect('/admin/posts');
    } catch (error) {
        res.status(500).send("Error deleting post. " + error.message);
    }
});

// --- ROUTES SETTINGS (PROFIL ADMIN) ---

// 1. Tampilkan halaman Settings
app.get('/admin/settings', requireAuth, async (req, res) => {
    try {
        const db = getDB();
        // Ambil data user yang sedang login dari database
        const result = await db.select().from(users).where(eq(users.id, req.user.id)).limit(1);
        
        if (result.length === 0) return res.redirect('/admin/logout');

        res.render('admin/settings.ejs', { 
            title: 'Settings', 
            path: '/admin/settings', 
            user: req.user, 
            adminData: result[0],
            message: req.query.msg // Untuk menampilkan pesan sukses/error
        });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// 2. Proses update Settings
app.post('/admin/settings', requireAuth, async (req, res) => {
    try {
        const { username, email, password, confirmPassword } = req.body;
        const db = getDB();
        
        let updateData = { username, email };

        // Jika user mengisi kolom password, berarti dia ingin ganti password
        if (password) {
            if (password !== confirmPassword) {
                return res.redirect('/admin/settings?msg=password_mismatch');
            }
            // Hash password baru
            updateData.password = await bcrypt.hash(password, 10);
        }

        // Update database
        await db.update(users).set(updateData).where(eq(users.id, req.user.id));

        // Karena username mungkin berubah, kita perbarui session token-nya
        const token = jwt.sign({ id: req.user.id, username: username, role: req.user.role }, process.env.SESSION_SECRET, { expiresIn: '24h' });
        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 });

        res.redirect('/admin/settings?msg=success');
    } catch (error) {
        // Error biasanya terjadi jika username/email sudah dipakai orang lain (Unique Constraint)
        res.redirect('/admin/settings?msg=error');
    }
});


// --- API ROUTES (HEADLESS CMS) ---

// Middleware khusus API untuk CORS (Mengizinkan akses dari aplikasi/domain lain)
app.use('/api', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); // Mengizinkan semua domain
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

// 1. Get Semua Artikel (List)
app.get('/api/v1/posts', async (req, res) => {
    try {
        const db = getDB();
        // Hanya ambil post yang statusnya 'published'
        const publishedPosts = await db.select({
            id: posts.id,
            title: posts.title,
            slug: posts.slug,
            content: posts.content,
            createdAt: posts.createdAt
        }).from(posts)
          .where(eq(posts.status, 'published'))
          .orderBy(desc(posts.id));

        res.json({
            success: true,
            total: publishedPosts.length,
            data: publishedPosts
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. Get Detail Satu Artikel berdasarkan Slug
app.get('/api/v1/posts/:slug', async (req, res) => {
    try {
        const db = getDB();
        const slug = req.params.slug;
        
        const result = await db.select({
            id: posts.id,
            title: posts.title,
            slug: posts.slug,
            content: posts.content,
            createdAt: posts.createdAt
        }).from(posts)
          .where(and(eq(posts.slug, slug), eq(posts.status, 'published')))
          .limit(1);

        if (result.length === 0) {
            return res.status(404).json({ success: false, message: 'Post not found' });
        }

        res.json({ success: true, data: result[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


// --- FRONTEND ROUTES ---

// 1. Halaman Beranda (Daftar Postingan)
app.get('/', checkAuth, async (req, res) => {
    try {
        const db = getDB();
        // Ambil data yang statusnya 'published', urutkan dari ID terbesar (terbaru)
        const publishedPosts = await db.select()
            .from(posts)
            .where(eq(posts.status, 'published'))
            .orderBy(desc(posts.id));

        res.render('front/index.ejs', {
            title: 'Welcome',
            user: req.user,
            path: '/',
            posts: publishedPosts
        });
    } catch (err) {
        res.status(500).send("Database Error: " + err.message);
    }
});

// 2. Halaman Baca Artikel (Single Post)
app.get('/post/:slug', checkAuth, async (req, res) => {
    try {
        const db = getDB();
        const slug = req.params.slug;
        
        // Cari post berdasarkan slug DAN pastikan statusnya 'published'
        const result = await db.select()
            .from(posts)
            .where(and(eq(posts.slug, slug), eq(posts.status, 'published')))
            .limit(1);

        if (result.length === 0) {
            return res.status(404).send('<h1>404 - Post Not Found</h1><a href="/">Back to Home</a>');
        }

        res.render('front/single.ejs', {
            title: result[0].title,
            user: req.user,
            path: '/post',
            post: result[0]
        });
    } catch (err) {
        res.status(500).send("Database Error: " + err.message);
    }
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