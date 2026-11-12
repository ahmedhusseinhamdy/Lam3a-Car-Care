const express = require('express');
const db = require('../db');
const { body, bad, cleanText, parseMoney, parseId, isValidDateStr } = require('../utils/validate');

const router = express.Router(); // محمي

function parseOffer(req) {
  const b = body(req);
  let price = null;
  if (b.price !== '' && b.price !== null && b.price !== undefined) price = parseMoney(b.price, 'سعر العرض', { max: 100000 });
  let expires = null;
  if (b.expires_at) {
    if (!isValidDateStr(b.expires_at)) throw bad('تاريخ انتهاء العرض غير صالح');
    expires = b.expires_at;
  }
  return {
    title: cleanText(b.title, 'عنوان العرض', { required: true, max: 100 }),
    description: cleanText(b.description, 'وصف العرض', { max: 500 }),
    price,
    expires_at: expires,
    active: b.active === false || b.active === 0 || b.active === '0' ? 0 : 1,
  };
}

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT id, title, description, price, expires_at, active, is_demo FROM offers ORDER BY id DESC').all());
});

router.post('/', (req, res) => {
  const o = parseOffer(req);
  const r = db
    .prepare('INSERT INTO offers (title, description, price, expires_at, active) VALUES (?, ?, ?, ?, ?)')
    .run(o.title, o.description, o.price, o.expires_at, o.active);
  res.status(201).json({ id: r.lastInsertRowid, ...o });
});

router.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const o = parseOffer(req);
  const r = db
    .prepare('UPDATE offers SET title = ?, description = ?, price = ?, expires_at = ?, active = ? WHERE id = ?')
    .run(o.title, o.description, o.price, o.expires_at, o.active, id);
  if (!r.changes) throw bad('العرض غير موجود');
  res.json({ id, ...o });
});

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const r = db.prepare('DELETE FROM offers WHERE id = ?').run(id);
  if (!r.changes) throw bad('العرض غير موجود');
  res.json({ ok: true });
});

module.exports = router;
