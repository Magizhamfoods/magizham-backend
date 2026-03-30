const { Pool } = require("pg");

// ✅ Works on BOTH local and Railway:
// - Railway provides DATABASE_URL automatically
// - Local uses individual DB_* variables from .env
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }, // ✅ Required for Railway PostgreSQL
      }
    : {
        user:     process.env.DB_USER,
        host:     process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port:     process.env.DB_PORT,
      }
);

module.exports = pool;