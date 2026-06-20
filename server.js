const express = require("express");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

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
    res.send('<h1>FrizkCMS Installer</h1><p>Wizard instalasi Database akan di sini.</p>');
});

app.get("*", (req, res) => {
    res.send('<h1>Frontend FrizkCMS</h1><p>Halaman ini nantinya akan dirender oleh Theme Engine atau dibiarkan sebagai API murni.</p>');
});

app.listen(PORT, () => {
    console.log(`🚀 FrizkCMS is running on http://localhost:${PORT}`);
});