const jwt = require('jsonwebtoken');

// Middleware untuk memblokir akses jika tidak login (Dipakai di /admin)
const requireAuth = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        if (req.path.startsWith('/api')) return res.status(401).json({ success: false, message: 'Unauthorized' });
        return res.redirect('/admin/login');
    }
    try {
        const decoded = jwt.verify(token, process.env.SESSION_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.clearCookie('token');
        if (req.path.startsWith('/api')) return res.status(401).json({ success: false, message: 'Invalid token' });
        return res.redirect('/admin/login?error=expired');
    }
};

// Middleware pasif untuk mengecek login tanpa memblokir (Dipakai di frontend)
const checkAuth = (req, res, next) => {
    const token = req.cookies.token;
    if (token) {
        try {
            req.user = jwt.verify(token, process.env.SESSION_SECRET);
        } catch (e) {
            req.user = null;
        }
    } else {
        req.user = null;
    }
    next();
};

module.exports = { requireAuth, checkAuth };