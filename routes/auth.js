const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { config } = require('../config');
const { requireAuth, signToken } = require('../middleware/auth');
const { HttpError, bad, body, cleanText } = require('../utils/validate');

const router = express.Router();

// تحديد محاولات تسجيل الدخول: 10 محاولات كل 15 دقيقة لكل IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات دخول كتير. جرّب تاني بعد 15 دقيقة.' },
});

// هاش وهمي عشان وقت الرد يبقى متقارب سواء المستخدم موجود أو لا
const DUMMY_HASH = bcrypt.hashSync('turbo-wash-dummy-password', 10);

function cookieOptions() {
  return { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/' };
}

router.post('/login', loginLimiter, (req, res) => {
  const b = body(req);
  const username = cleanText(b.username, 'اسم المستخدم', { required: true, max: 60 });
  const password = typeof b.password === 'string' ? b.password : '';
  if (!password || password.length > 200) throw bad('كلمة المرور مطلوبة');

  const admin = db.prepare('SELECT id, username, password_hash FROM admins WHERE username = ?').get(username);
  const ok = bcrypt.compareSync(password, admin ? admin.password_hash : DUMMY_HASH);
  if (!admin || !ok) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });

  res.cookie(config.cookieName, signToken(admin), { ...cookieOptions(), maxAge: 12 * 60 * 60 * 1000 });
  res.json({ ok: true, username: admin.username });
});

router.post('/logout', (req, res) => {
  res.clearCookie(config.cookieName, cookieOptions());
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.admin.username });
});

// تغيير كلمة المرور و/أو اسم المستخدم (لازم كلمة المرور الحالية)
router.post('/password', requireAuth, (req, res) => {
  const b = body(req);
  const current = typeof b.current_password === 'string' ? b.current_password : '';
  const next = typeof b.new_password === 'string' ? b.new_password : '';
  const newUsername = cleanText(b.new_username, 'اسم المستخدم الجديد', { max: 60 });
  if (!next && !newUsername) throw bad('اكتب كلمة المرور الجديدة أو اسم المستخدم الجديد');
  if (next && next.length < 8) throw bad('كلمة المرور الجديدة لازم تكون 8 أحرف على الأقل');
  if (next.length > 100) throw bad('كلمة المرور الجديدة طويلة جداً');
  if (newUsername && newUsername.length < 3) throw bad('اسم المستخدم لازم يكون 3 أحرف على الأقل');

  const row = db.prepare('SELECT username, password_hash FROM admins WHERE id = ?').get(req.admin.id);
  if (!row || !current || !bcrypt.compareSync(current, row.password_hash)) throw bad('كلمة المرور الحالية غير صحيحة');

  const username = newUsername || row.username;
  if (username !== row.username && db.prepare('SELECT 1 FROM admins WHERE username = ? AND id != ?').get(username, req.admin.id)) {
    throw new HttpError(409, 'اسم المستخدم ده مستخدم قبل كده');
  }
  const hash = next ? bcrypt.hashSync(next, 12) : row.password_hash;
  db.prepare('UPDATE admins SET username = ?, password_hash = ? WHERE id = ?').run(username, hash, req.admin.id);
  res.json({ ok: true, username });
});

module.exports = router;
