// database/migrate.js
const { getDB } = require('./index');
const { sql } = require('drizzle-orm');

const executeRaw = async (db, dialect, query) => {
    // Drizzle memiliki metode berbeda untuk SQLite vs MySQL/PG
    if (dialect === 'sqlite') {
        db.run(sql.raw(query));
    } else {
        await db.execute(sql.raw(query));
    }
};

const runCoreMigrations = async (dialect, prefix) => {
    const db = getDB();
    const tableUsers = `${prefix}users`;
    const tablePosts = `${prefix}posts`;

    console.log(`⏳ Running migrations for ${dialect}...`);

    try {
        // Query disesuaikan dengan standar masing-masing SQL Dialect
        if (dialect === 'sqlite') {
            await executeRaw(db, dialect, `
                CREATE TABLE IF NOT EXISTS ${tableUsers} (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    email TEXT NOT NULL UNIQUE,
                    password TEXT NOT NULL,
                    role TEXT DEFAULT 'admin',
                    created_at INTEGER DEFAULT (cast(strftime('%s','now') as int))
                );
            `);

            await executeRaw(db, dialect, `
                CREATE TABLE IF NOT EXISTS ${tablePosts} (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    slug TEXT NOT NULL UNIQUE,
                    content TEXT,
                    status TEXT DEFAULT 'draft',
                    created_at INTEGER DEFAULT (cast(strftime('%s','now') as int))
                );
            `);
        } else if (dialect === 'mysql') {
            await executeRaw(db, dialect, `
                CREATE TABLE IF NOT EXISTS ${tableUsers} (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(50) NOT NULL UNIQUE,
                    email VARCHAR(255) NOT NULL UNIQUE,
                    password VARCHAR(255) NOT NULL,
                    role VARCHAR(20) DEFAULT 'admin',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            await executeRaw(db, dialect, `
                CREATE TABLE IF NOT EXISTS ${tablePosts} (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    slug VARCHAR(255) NOT NULL UNIQUE,
                    content TEXT,
                    status VARCHAR(20) DEFAULT 'draft',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
        } else if (dialect === 'postgres') {
            await executeRaw(db, dialect, `
                CREATE TABLE IF NOT EXISTS ${tableUsers} (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(50) NOT NULL UNIQUE,
                    email VARCHAR(255) NOT NULL UNIQUE,
                    password VARCHAR(255) NOT NULL,
                    role VARCHAR(20) DEFAULT 'admin',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            await executeRaw(db, dialect, `
                CREATE TABLE IF NOT EXISTS ${tablePosts} (
                    id SERIAL PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    slug VARCHAR(255) NOT NULL UNIQUE,
                    content TEXT,
                    status VARCHAR(20) DEFAULT 'draft',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
        }
        
        console.log(`✅ Table '${tableUsers}' and '${tablePosts}' is ready.`);
    } catch (error) {
        console.error("❌ Migration failed:", error.message);
        throw error;
    }
};

module.exports = { runCoreMigrations };