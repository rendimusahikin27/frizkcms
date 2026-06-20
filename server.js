const express = require("express");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { eq, or } = require("drizzle-orm");

const { initDB, getDB } = require("./database/index");
const { runCoreMigrations } = require("./database/migrate");
const { users } = require("./database/schema/users");
const { requireAuth } = require("./core/middlewares/auth");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));
app.use(cookieParser());
app.use("/public", express.static(path.join(__dirname, "public")));

const triggerRestart = () => {
    const restartFile = path.join(__dirname, "tmp", "restart.txt");

    try {
        if (!fs.existsSync(path.join(__dirname, "tmp"))) {
            fs.mkdirSync(path.join(__dirname, "tmp"));
        }
        const time = new Date();
        fs.utimesSync(restartFile, time, time);
        console.log("🔄 Application restart triggered for cPanel Passenger");
    } catch (err) {
        fs.writeFile(restartFile, "Restart Triggered");
        console.log("🔄 tmp/restart.txt created. App will restart.");
    }
};
app.use((req, res, next) => {
    const isInstalled = fs.existsSync(path.join(__dirname, '.env'));
    // Jika belum install dan akses bukan ke /install atau /public, arahkan ke install
    if (!isInstalled && !req.path.startsWith('/install') && !req.path.startsWith('/public')) {
        return res.redirect('/install');
    }
    // Jika SUDAH install tapi malah mau akses /install, arahkan ke admin
    if (isInstalled && req.path.startsWith('/install')) {
        return res.redirect('/admin');
    }
    next();
});

app.get('/admin/login', (req, res) => {
    const token = req.cookies.token;

    // JANGAN sekadar cek token ada/tidak, tapi verifikasi.
    // Jika token ada dan VALID, baru lempar ke /admin.
    if (token) {
        try {
            jwt.verify(token, process.env.SESSION_SECRET);
            return res.redirect('/admin'); // Token valid, tidak perlu login lagi
        } catch (e) {
            // Jika token sampah/expired, biarkan user di halaman login
            res.clearCookie('token');
        }
    }
    
    const errorMsg = req.query.error === 'failed' ? 'Invalid credentials.' : 
                     req.query.error === 'expired' ? 'Session expired. Please log in again.' : null;
                     
    res.render('admin/login.ejs', { error: errorMsg });
});

app.post('/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const db = getDB();

        // Cari user berdasarkan username ATAU email menggunakan Drizzle ORM
        const result = await db.select().from(users).where(
            or(eq(users.username, username), eq(users.email, username))
        ).limit(1);

        const user = result[0];

        // Cek apakah user ada dan password cocok
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.redirect('/admin/login?error=failed');
        }

        // Buat JWT Token (Berlaku 24 jam)
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role }, 
            process.env.SESSION_SECRET, 
            { expiresIn: '24h' }
        );

        // Set Cookie
        res.cookie('token', token, {
            httpOnly: true, // Tidak bisa diakses oleh JavaScript frontend (Aman dari XSS)
            secure: process.env.NODE_ENV === 'production', // Gunakan HTTPS jika production
            maxAge: 24 * 60 * 60 * 1000 // 24 jam
        });

        res.redirect('/admin');
    } catch (error) {
        console.error("Login Error:", error);
        res.redirect('/admin/login?error=failed');
    }
});

app.get('/admin/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/admin/login');
});

app.get('/admin', requireAuth, (req, res) => {
    // Jika sampai di sini, artinya requireAuth sudah meloloskan user
    res.send(`
        <div style="font-family: sans-serif; padding: 2rem;">
            <h1>Welcome to Admin Dashboard, ${req.user.username}!</h1>
            <p>Role Anda: ${req.user.role}</p>
            <hr>
            <a href="/admin/logout" style="color: red;">Logout</a>
        </div>
    `);
});

app.get("/api/v1/posts", (req, res) => {
    res.json({
        success: true,
        message: "FrizkCMS API is running",
        data: []
    })
});

app.get("/install", (req, res) => {
    if (fs.existsSync(path.join(__dirname, ".env"))) {
        return res.redirect("/admin");
    }
    res.render("install/index.ejs");
});

app.post('/install', async (req, res) => {
    if (fs.existsSync(path.join(__dirname, '.env'))) {
        return res.status(403).send('CMS is already installed.');
    }

    const { 
        dbType, tablePrefix, dbHost, dbPort, dbName, dbUser, dbPass,
        adminUser, adminEmail, adminPass 
    } = req.body;
    
    const prefix = tablePrefix ? tablePrefix.trim() : 'frizk_';
    let envContent = `NODE_ENV=production\nPORT=3000\nDB_TYPE=${dbType}\nDB_PREFIX=${prefix}\n`;

    if (dbType === 'sqlite') {
        envContent += `DB_SQLITE_PATH=./database/frizk.sqlite\n`;
    } else {
        const dialect = dbType === 'postgres' ? 'postgresql' : 'mysql';
        const portStr = dbPort ? `:${dbPort}` : '';
        envContent += `DATABASE_URL="${dialect}://${dbUser}:${dbPass}@${dbHost}${portStr}/${dbName}"\n`;
    }

    const sessionSecret = require('crypto').randomBytes(32).toString('hex');
    envContent += `SESSION_SECRET="${sessionSecret}"\n`;

    try {
        // 1. Tulis file .env sementara
        fs.writeFileSync(path.join(__dirname, '.env'), envContent);
        
        // 2. Load env baru ke dalam process Node.js yang sedang berjalan
        dotenv.config({ override: true });

        // 3. Connect ke Database secara dinamis
        const db = await initDB();

        // 4. Jalankan Migrasi (Buat Tabel)
        await runCoreMigrations(dbType, prefix);

        // 5. Buat Akun Admin Pertama
        const hashedPassword = await bcrypt.hash(adminPass, 10);
        
        // Kita menggunakan Drizzle ORM Insert untuk memasukkan data!
        await db.insert(users).values({
            username: adminUser,
            email: adminEmail,
            password: hashedPassword,
            role: 'admin'
        });

        console.log("👤 Admin user created successfully.");

        // 6. Trigger Restart untuk sistem production (cPanel)
        triggerRestart();

        // 7. Selesai! Arahkan ke halaman login admin (Akan kita buat nanti)
        res.send('<h1>Installation Complete!</h1><p>Welcome to FrizkCMS. <a href="/admin">Go to Admin Panel</a></p>');
        
    } catch (error) {
        console.error("Installation Error:", error);
        // Jika gagal, hapus .env agar user bisa mencoba lagi
        if (fs.existsSync(path.join(__dirname, '.env'))) {
            fs.unlinkSync(path.join(__dirname, '.env'));
        }
        res.status(500).send(`Installation Failed: ${error.message}. <a href="/install">Try Again</a>`);
    }
});

app.get("*", (req, res) => {
    res.send('<h1>Frontend FrizkCMS</h1><p>Halaman ini nantinya akan dirender oleh Theme Engine atau dibiarkan sebagai API murni.</p>');
});

const startServer = async () => {
    // Jika CMS sudah diinstall (.env ada), inisialisasi Database
    if (fs.existsSync(path.join(__dirname, '.env'))) {
        try {
            await initDB();
        } catch (err) {
            console.log("⚠️ Could not connect to database. Please check your credentials.");
        }
    }

    app.listen(PORT, () => {
        console.log(`🚀 FrizkCMS is running on http://localhost:${PORT}`);
    });
};

startServer();