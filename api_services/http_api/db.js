'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  throw new Error('Missing SUPABASE_DB_URL in environment');
}

const hasLocalHost = /(?:localhost|127\.0\.0\.1)/i.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: hasLocalHost ? undefined : { rejectUnauthorized: false },
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
