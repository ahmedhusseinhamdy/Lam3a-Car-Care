// إنشاء / تحديث حساب الأدمن (بيتستخدم في السيرفر وفي سكريبت reset-admin)
const bcrypt = require('bcrypt');
const db = require('../db');
const { config } = require('../config');

const BCRYPT_ROUNDS = 12;

function weakPassword(p) {
  return !p || p.length < 8 || /^change/i.test(p);
}

// أول تشغيل: لو مفيش أي أدمن، ننشئ واحد من ADMIN_USER و ADMIN_PASSWORD في .env
function ensureDefaultAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (count > 0) return { created: false };

  if (!config.adminUser || weakPassword(config.adminPassword)) {
    console.error(
      '\n[تنبيه] مفيش أدمن في قاعدة البيانات، ومتغيرات ADMIN_USER / ADMIN_PASSWORD في .env مش مضبوطة أو ضعيفة (8 أحرف على الأقل).\n' +
        'شغّل  npm run setup  أو عدّل ملف .env ثم أعد تشغيل السيرفر.\n'
    );
    return { created: false, missing: true };
  }
  const hash = bcrypt.hashSync(config.adminPassword, BCRYPT_ROUNDS);
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(config.adminUser, hash);
  console.log(`[Lam3a Car Care] تم إنشاء حساب الأدمن "${config.adminUser}" من ملف .env`);
  return { created: true };
}

// تغيير/إنشاء أدمن بالاسم (للسكريبت)
function upsertAdmin(username, password) {
  if (!username || username.length > 60) throw new Error('اسم المستخدم غير صالح');
  if (weakPassword(password)) throw new Error('كلمة المرور لازم تكون 8 أحرف على الأقل');
  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const row = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (row) db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, row.id);
  else db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, hash);
  return { updated: !!row };
}

module.exports = { ensureDefaultAdmin, upsertAdmin, weakPassword };
