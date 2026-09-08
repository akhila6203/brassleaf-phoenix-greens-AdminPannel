/**
 * One-time: rename legacy wp_* usermeta keys to wpwd_* to match table prefix.
 * Safe to re-run — only updates rows that still use the old key names.
 *
 * Usage: node scripts/migrate_wp_meta_keys.js
 */
require('dotenv').config();
const pool = require('../src/config/db');
const P = require('../src/config/prefix');
const metaKeys = require('../src/config/metaKeys');

const RENAMES = [
  ['wp_capabilities', metaKeys.capabilities],
  ['wp_user_level', metaKeys.userLevel],
];

(async () => {
  for (const [from, to] of RENAMES) {
    const [result] = await pool.query(
      `UPDATE ${P}usermeta SET meta_key = ? WHERE meta_key = ?`,
      [to, from]
    );
    console.log(`${from} → ${to}: ${result.affectedRows} row(s)`);
  }
  await pool.end();
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
