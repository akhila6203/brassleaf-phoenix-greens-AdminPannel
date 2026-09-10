const mysql = require('mysql2/promise');
const env = require('./env');

const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true,
});

module.exports = pool;



// for image upload in the deployee time
// UPDATE wpwd_posts
// SET guid = REPLACE(guid, 'http://localhost:4000', 'https://cornerstone-api.easybizcart.com')
// WHERE post_type = 'attachment' AND guid LIKE 'http://localhost:4000%';