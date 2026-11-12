// الإعدادات العامة — كلها بتتقرا من متغيرات البيئة (ملف .env)
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const isProd = process.env.NODE_ENV === 'production';

const config = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  timezone: process.env.APP_TIMEZONE || 'Africa/Cairo',
  // مكان قاعدة البيانات والصور المرفوعة. على الاستضافة لازم يشاوروا على Persistent Disk
  dbPath: path.resolve(__dirname, process.env.DB_PATH || './data/turbowash.db'),
  uploadsDir: path.resolve(__dirname, process.env.UPLOADS_DIR || './uploads'),
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpires: process.env.JWT_EXPIRES || '12h',
  adminUser: (process.env.ADMIN_USER || '').trim(),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  // الكوكي Secure لازم يكون true على HTTPS. ممكن تغيّره بـ COOKIE_SECURE=false لو بتجرب محلياً بـ NODE_ENV=production
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  cookieName: 'tw_token',
};

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.uploadsDir, { recursive: true });

// السيرفر مش بيشتغل من غير JWT_SECRET قوي
function assertJwtSecret() {
  const s = config.jwtSecret;
  if (!s || s.length < 32 || /^change/i.test(s)) {
    console.error(
      '\n[خطأ] JWT_SECRET غير مضبوط أو ضعيف (لازم 32 حرف على الأقل).\n' +
        'شغّل الأمر:  npm run setup   عشان يتعمل ملف .env بقيم آمنة تلقائياً.\n'
    );
    process.exit(1);
  }
}

module.exports = { config, assertJwtSecret };
