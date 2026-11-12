const express = require('express');
const db = require('../db');
const { body, bad, cleanText, normalizePhone } = require('../utils/validate');

const router = express.Router(); // محمي

const KEYS = ['slogan', 'phone', 'whatsapp', 'address', 'working_hours', 'hero_image'];

function readAll() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

router.get('/', (req, res) => res.json(readAll()));

router.put('/', (req, res) => {
  const b = body(req);
  const upd = {};

  if ('slogan' in b) upd.slogan = cleanText(b.slogan, 'السلوجن', { max: 120 });
  if ('address' in b) upd.address = cleanText(b.address, 'العنوان', { max: 250 });
  if ('working_hours' in b) upd.working_hours = cleanText(b.working_hours, 'مواعيد العمل', { max: 250 });

  for (const key of ['phone', 'whatsapp']) {
    if (key in b) {
      const raw = cleanText(b[key], key === 'phone' ? 'رقم الموبايل' : 'رقم الواتساب', { max: 30 });
      if (!raw) {
        upd[key] = '';
      } else {
        const p = normalizePhone(raw);
        if (!p) throw bad('اكتب رقم موبايل مصري صحيح (مثال: 01012345678)');
        upd[key] = p;
      }
    }
  }

  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    for (const k of KEYS) if (k in upd) stmt.run(k, upd[k]);
  })();
  res.json(readAll());
});

module.exports = router;
