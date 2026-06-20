// core/middlewares/auth.js
const jwt = require('jsonwebtoken');

const requireAuth = (req, res, next) => {
    // 1. Ambil token dari cookie
    const token = req.cookies.token;

    // 2. Jika tidak ada token, tendang ke halaman login
    if (!token) {
        // Jika request berupa API (mengandung /api/), kembalikan JSON error
        if (req.path.startsWith('/api')) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        // Jika request dari browser biasa, arahkan ke login
        return res.redirect('/admin/login');
    }

    // 3. Verifikasi token
    try {
        const decoded = jwt.verify(token, process.env.SESSION_SECRET);
        req.user = decoded; // Simpan data user (id, role) ke request untuk dipakai nanti
        next(); // Lanjutkan ke rute yang diminta
    } catch (error) {
        // Jika token tidak valid / kadaluarsa
        res.clearCookie('token');
        if (req.path.startsWith('/api')) {
            return res.status(401).json({ success: false, message: 'Invalid token' });
        }
        return res.redirect('/admin/login?error=expired');
    }
};

module.exports = { requireAuth };