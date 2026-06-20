const express = require("express");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const { env } = require("process");
const { initDB } = require("./database/index");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));
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
    const isInstalled = fs.existsSync(path.join(__dirname, ".env"));
    if (isInstalled && !req.path.startsWith("/install") && !req.path.startsWith("/public")) {
        return res.redirect("/install");
    }
    next();
});

app.get("/admin", (req, res) => {
    res.send("<h1>FrizkCMS Admin Panel</h1><p>UI akan dibangun di sini dengan HTML/CSS murni + EJS.</p>")
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

app.post('/install', (req, res) => {
    // Proteksi: Jangan biarkan ditimpa jika .env sudah ada
    if (fs.existsSync(path.join(__dirname, '.env'))) {
        return res.status(403).send('CMS is already installed.');
    }

    // TANGKAP tablePrefix dari req.body
    const { dbType, tablePrefix, dbHost, dbPort, dbName, dbUser, dbPass } = req.body;
    
    // Pastikan prefix memiliki nilai default jika kosong
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
        fs.writeFileSync(path.join(__dirname, '.env'), envContent);
        dotenv.config({ override: true });
        triggerRestart();
        res.redirect('/admin');
    } catch (error) {
        console.error(error);
        res.status(500).send('Failed to write configuration file.');
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