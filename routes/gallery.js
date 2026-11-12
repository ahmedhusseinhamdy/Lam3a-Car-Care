const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { config } = require('../config');
const { bad, body, cleanText, parseId } = require('../utils/validate');

const router = express.Router(); // محمي

const MAX_SIZE = 5 * 1024 * 1024; // 5MB للصورة
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE, files: 10 },
  fileFilter(req, file, cb) {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    cb(new Error('INVALID_TYPE'));
  },
});

// نتأكد من نوع الصورة الحقيقي من أول بايتات الملف (مش من الامتداد)
function detectImageExt(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length > 12 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return '.webp';
  return null;
}

function removeFileIfUploaded(webPath) {
  if (typeof webPath !== 'string' || !webPath.startsWith('/uploads/')) return;
  const file = path.join(config.uploadsDir, path.basename(webPath));
  fs.promises.unlink(file).catch(() => {});
}

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT id, path, caption, is_demo FROM gallery ORDER BY id DESC').all());
});

router.post('/', (req, res, next) => {
  upload.array('images', 10)(req, res, (err) => {
    if (err) {
      if (err.message === 'INVALID_TYPE') return next(bad('الملفات المسموحة: JPG أو PNG أو WEBP فقط'));
      if (err.code === 'LIMIT_FILE_SIZE') return next(bad('حجم الصورة كبير (الحد الأقصى 5 ميجا)'));
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return next(bad('الحد الأقصى 10 صور في المرة'));
      return next(err);
    }
    if (!req.files || !req.files.length) return next(bad('اختار صورة واحدة على الأقل'));

    const caption = cleanText(req.body && req.body.caption, 'وصف الصورة', { max: 120 });
    const saved = [];
    try {
      for (const f of req.files) {
        const ext = detectImageExt(f.buffer);
        if (!ext) throw bad('أحد الملفات مش صورة صالحة');
        const filename = crypto.randomUUID() + ext;
        fs.writeFileSync(path.join(config.uploadsDir, filename), f.buffer, { flag: 'wx' });
        saved.push('/uploads/' + filename);
      }
      const ins = db.prepare('INSERT INTO gallery (path, caption) VALUES (?, ?)');
      db.transaction(() => saved.forEach((p) => ins.run(p, caption)))();
      res.status(201).json({ ok: true, count: saved.length });
    } catch (e) {
      saved.forEach(removeFileIfUploaded); // تنظيف لو حصل خطأ في النص
      next(e);
    }
  });
});

router.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const caption = cleanText(body(req).caption, 'وصف الصورة', { max: 120 });
  const r = db.prepare('UPDATE gallery SET caption = ? WHERE id = ?').run(caption, id);
  if (!r.changes) throw bad('الصورة غير موجودة');
  res.json({ ok: true });
});

// تعيين صورة كخلفية للصفحة الرئيسية (Hero)
router.post('/:id/hero', (req, res) => {
  const id = parseId(req.params.id);
  const row = db.prepare('SELECT path FROM gallery WHERE id = ?').get(id);
  if (!row) throw bad('الصورة غير موجودة');
  db.prepare("INSERT INTO settings (key, value) VALUES ('hero_image', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(row.path);
  res.json({ ok: true });
});

router.delete('/hero', (req, res) => {
  db.prepare("UPDATE settings SET value = '' WHERE key = 'hero_image'").run();
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const row = db.prepare('SELECT path FROM gallery WHERE id = ?').get(id);
  if (!row) throw bad('الصورة غير موجودة');
  db.transaction(() => {
    db.prepare('DELETE FROM gallery WHERE id = ?').run(id);
    db.prepare("UPDATE settings SET value = '' WHERE key = 'hero_image' AND value = ?").run(row.path);
  })();
  removeFileIfUploaded(row.path);
  res.json({ ok: true });
});

module.exports = router;
