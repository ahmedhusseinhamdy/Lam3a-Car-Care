// Lam3a Car Care — السيرفر الرئيسي
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const { config, assertJwtSecret } = require('./config');

assertJwtSecret();

const db = require('./db'); // بينشئ الجداول لو مش موجودة
const { ensureDefaultAdmin } = require('./utils/admin');
const { requireAuth, requirePage, sameOriginForWrites, authenticate } = require('./middleware/auth');
const { HttpError } = require('./utils/validate');

const app = express();
app.disable('x-powered-by');
if (config.isProd) app.set('trust proxy', 1); // Render / Railway بيحطوا بروكسي قدام السيرفر

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json({ limit: '100kb' }));

// ---- API ----
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', sameOriginForWrites);

app.use('/api/public', require('./routes/public')); // عام — بدون بيانات عملاء
app.use('/api/auth', require('./routes/auth')); // تسجيل الدخول (فيه rate limit) — باقي مساراته بتتحقق جوّاها

// كل اللي تحت ده محمي بـ JWT
app.use('/api/customers', requireAuth, require('./routes/customers'));
app.use('/api/services', requireAuth, require('./routes/services'));
app.use('/api/offers', requireAuth, require('./routes/offers'));
app.use('/api/inventory', requireAuth, require('./routes/inventory'));
app.use('/api/gallery', requireAuth, require('./routes/gallery'));
app.use('/api/settings', requireAuth, require('./routes/settings'));
app.use('/api/dashboard', requireAuth, require('./routes/dashboard'));
app.use('/api', requireAuth, require('./routes/visits'));

app.use('/api', (req, res) => res.status(404).json({ error: 'المسار غير موجود' }));

// ---- الصور المرفوعة والملفات العامة ----
app.use('/uploads', express.static(config.uploadsDir, { dotfiles: 'deny', index: false, maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: config.isProd ? '1h' : 0 }));

// ---- صفحات الأدمن ----
const view = (name) => path.join(__dirname, 'views', name);

app.get('/admin/login', (req, res) => {
  if (authenticate(req)) return res.redirect('/admin');
  res.sendFile(view('login.html'));
});
app.get(['/admin', '/admin/'], requirePage, (req, res) => res.sendFile(view('admin.html')));

// ---- 404 + معالج الأخطاء ----
app.use((req, res) => {
  if (req.accepts('html')) return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  res.status(404).json({ error: 'غير موجود' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'البيانات المرسلة غير صالحة' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'حجم الطلب كبير' });
  if (err && err.code && String(err.code).startsWith('SQLITE_CONSTRAINT')) {
    if (/UNIQUE/.test(err.message) && /phone/.test(err.message)) {
      return res.status(409).json({ error: 'رقم الموبايل ده مسجل لعميل تاني' });
    }
    return res.status(400).json({ error: 'البيانات مخالفة لقواعد قاعدة البيانات' });
  }
  console.error('[خطأ غير متوقع]', err); // التفاصيل في سجل السيرفر بس، مش للمستخدم
  res.status(500).json({ error: 'حصل خطأ في السيرفر. حاول مرة تانية.' });
});

ensureDefaultAdmin();

if (require.main === module) {
  const server = app.listen(config.port, () => {
    console.log(`\n  Lam3a Car Care شغّال على:  http://localhost:${config.port}`);
    console.log(`  لوحة التحكم:            http://localhost:${config.port}/admin\n`);
  });
  const shutdown = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = app;
