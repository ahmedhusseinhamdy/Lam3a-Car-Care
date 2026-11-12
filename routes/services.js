const express = require('express');
const db = require('../db');
const { body, bad, cleanText, parseMoney, parseId } = require('../utils/validate');

const router = express.Router(); // محمي بـ requireAuth من server.js

function parseService(req) {
  const b = body(req);
  return {
    name: cleanText(b.name, 'اسم الخدمة', { required: true, max: 80 }),
    price: parseMoney(b.price, 'السعر', { max: 100000 }),
    active: b.active === false || b.active === 0 || b.active === '0' ? 0 : 1,
  };
}

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT id, name, price, active FROM services ORDER BY sort_order, id').all());
});

router.post('/', (req, res) => {
  const s = parseService(req);
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM services').get().m;
  const r = db
    .prepare('INSERT INTO services (name, price, active, sort_order) VALUES (?, ?, ?, ?)')
    .run(s.name, s.price, s.active, max + 1);
  res.status(201).json({ id: r.lastInsertRowid, ...s });
});

router.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const s = parseService(req);
  const r = db.prepare('UPDATE services SET name = ?, price = ?, active = ? WHERE id = ?').run(s.name, s.price, s.active, id);
  if (!r.changes) throw bad('الخدمة غير موجودة');
  res.json({ id, ...s });
});

// حذف خدمة: الزيارات القديمة محتفظة باسم وسعر الخدمة وقت الزيارة
router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const r = db.prepare('DELETE FROM services WHERE id = ?').run(id);
  if (!r.changes) throw bad('الخدمة غير موجودة');
  res.json({ ok: true });
});

module.exports = router;
