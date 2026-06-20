// database/index.js
const fs = require('fs');
const path = require('path');

// Drivers & Drizzle Wrappers
const { drizzle: drizzleSqlite } = require('drizzle-orm/better-sqlite3');
const Database = require('better-sqlite3');

const { drizzle: drizzleMysql } = require('drizzle-orm/mysql2');
const mysql = require('mysql2/promise');

const { drizzle: drizzlePg } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');

let db = null;

const initDB = async () => {
    // Hindari koneksi berulang jika sudah terkoneksi
    if (db) return db;

    const type = process.env.DB_TYPE || 'sqlite';

    try {
        if (type === 'sqlite') {
            const dbPath = process.env.DB_SQLITE_PATH || './database/frizk.sqlite';
            // Pastikan folder database ada agar SQLite tidak error
            const dbDir = path.dirname(dbPath);
            if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

            const sqliteClient = new Database(dbPath);
            db = drizzleSqlite(sqliteClient);
            console.log('📦 Database Connected: SQLite');

        } else if (type === 'mysql') {
            const poolConnection = await mysql.createPool(process.env.DATABASE_URL);
            db = drizzleMysql(poolConnection);
            console.log('📦 Database Connected: MySQL');

        } else if (type === 'postgres') {
            const pool = new Pool({ connectionString: process.env.DATABASE_URL });
            db = drizzlePg(pool);
            console.log('📦 Database Connected: PostgreSQL');
        }

        return db;
    } catch (error) {
        console.error('❌ Database Connection Error:', error.message);
        throw error;
    }
};

const getDB = () => {
    if (!db) throw new Error("Database not initialized yet.");
    return db;
};

module.exports = { initDB, getDB };