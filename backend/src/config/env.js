require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '4000', 10),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  // frontendUrl: process.env.FRONTEND_URL || 'https://phoenix-greens-admin.brassleaf.store',
  customerFrontendUrl:
    process.env.CUSTOMER_FRONTEND_URL ||
    process.env.VITE_CUSTOMER_URL ||
    'http://localhost:5174',
    //  'https://phoenix-greens.brassleaf.store',
  apiPublicUrl:
    process.env.API_PUBLIC_URL ||
    process.env.BACKEND_PUBLIC_URL ||
    `http://localhost:${parseInt(process.env.PORT || '4000', 10)}`,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  wpSiteUrl: (process.env.WP_SITE_URL || 'https://brassleaf.store/cornerstone').replace(/\/$/, ''),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'brassleaf',
  },
  prefix: 'wpwd_',
  adminEmail:
    process.env.ADMIN_EMAIL ||
    process.env.STORE_EMAIL ||
    process.env.SMTP_FROM_EMAIL ||
    process.env.SMTP_USER ||
    '',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from:
      process.env.SMTP_FROM ||
      process.env.SMTP_FROM_EMAIL ||
      process.env.SMTP_USER ||
      '',
    fromName: process.env.SMTP_FROM_NAME || 'Brass Leaf',
    fromEmail:
      process.env.SMTP_FROM_EMAIL ||
      process.env.SMTP_USER ||
      '',
  },
  dailyReportCron: process.env.DAILY_REPORT_CRON || '55 23 * * *',
};
