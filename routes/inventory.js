// المخزن: خامات ومستلزمات المغسلة — محمي بـ requireAuth من server.js
const express = require('express');
const db = require('../db');
const { HttpError, bad, body, cleanText, parseId, parseMoney, round2 } = require('../utils/validate');
const { CATEGORIES, stockStatus } = require('../utils/inventory');

const router = express.Router();

const SELECT = 'SELECT id, code, name, supplier, category, quantity, unit, min_quantity, unit_price, is_demo FROM inventory_items';

function decorate(r) {
  return {
    ...r,
    total_value: round2(r.quantity * r.unit_price),
    status: stockStatus(r.quantity, r.min_quantity),
  };
}

function escapeLike(s) {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

// كود تلقائي لو الأدمن ما كتبش: CHM-101, CON-101, SUP-101 ...
function nextCode(category) {
  const prefix = CATEGORIES[category].prefix;
  const rows = db.prepare('SELECT code FROM inventory_items WHERE code LIKE ?').all(prefix + '-%');
  let max = 100;
  for (const r of rows) {
    const n = Number(String(r.code).slice(prefix.length + 1));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}-${max + 1}`;
}

function parseItem(req, id = 0) {
  const b = body(req);
  const category = String(b.category || '');
  if (!CATEGORIES[category]) throw bad('اختار فئة صالحة');
  let code = cleanText(b.code, 'كود الخامة', { max: 30 }).toUpperCase().replace(/\s+/g, '');
  if (!code) code = nextCode(category);
  if (db.prepare('SELECT id FROM inventory_items WHERE code = ? AND id != ?').get(code, id)) {
    throw new HttpError(409, 'كود الخامة ده مستخدم قبل كده');
  }
  return {
    code,
    name: cleanText(b.name, 'اسم الخامة', { required: true, max: 120 }),
    supplier: cleanText(b.supplier, 'اسم المورد', { max: 120 }),
    category,
    quantity: parseMoney(b.quantity === '' || b.quantity === undefined ? 0 : b.quantity, 'الكمية', { max: 10000000 }),
    unit: cleanText(b.unit, 'الوحدة', { max: 20 }),
    min_quantity: parseMoney(b.min_quantity === '' || b.min_quantity === undefined ? 0 : b.min_quantity, 'الحد الأدنى', { max: 10000000 }),
    unit_price: parseMoney(b.unit_price === '' || b.unit_price === undefined ? 0 : b.unit_price, 'سعر الوحدة', { max: 1000000 }),
  };
}

// القائمة (مع فلاتر) + ملخص الكروت العلوية (الملخص دايماً على كل المخزن مش على الفلتر)
router.get('/', (req, res) => {
  const category = String(req.query.category || '');
  const status = String(req.query.status || '');
  const q = String(req.query.q || '').trim().slice(0, 80);

  const all = db.prepare(SELECT + ' ORDER BY code').all().map(decorate);
  const summary = {
    chemicals: all.filter((i) => i.category === 'chemicals').length,
    consumables: all.filter((i) => i.category === 'consumables').length,
    supplies: all.filter((i) => i.category === 'supplies').length,
    total_value: round2(all.reduce((a, i) => a + i.total_value, 0)),
    alerts: all.filter((i) => i.status !== 'ok').length,
  };

  const needle = q.toLowerCase();
  const items = all.filter(
    (i) =>
      (!category || i.category === category) &&
      (!status || i.status === status) &&
      (!needle || i.name.toLowerCase().includes(needle) || i.code.toLowerCase().includes(needle))
  );
  res.json({ items, summary });
});

router.post('/', (req, res) => {
  const it = parseItem(req);
  const r = db
    .prepare('INSERT INTO inventory_items (code, name, supplier, category, quantity, unit, min_quantity, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(it.code, it.name, it.supplier, it.category, it.quantity, it.unit, it.min_quantity, it.unit_price);
  res.status(201).json(decorate({ id: r.lastInsertRowid, is_demo: 0, ...it }));
});

router.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!db.prepare('SELECT 1 FROM inventory_items WHERE id = ?').get(id)) throw new HttpError(404, 'الخامة غير موجودة');
  const it = parseItem(req, id);
  db.prepare('UPDATE inventory_items SET code = ?, name = ?, supplier = ?, category = ?, quantity = ?, unit = ?, min_quantity = ?, unit_price = ? WHERE id = ?')
    .run(it.code, it.name, it.supplier, it.category, it.quantity, it.unit, it.min_quantity, it.unit_price, id);
  res.json(decorate(db.prepare(SELECT + ' WHERE id = ?').get(id)));
});

// تعديل الكمية: إضافة / صرف / تحديد كمية جديدة
router.post('/:id/adjust', (req, res) => {
  const id = parseId(req.params.id);
  const b = body(req);
  const mode = String(b.mode || '');
  if (!['add', 'subtract', 'set'].includes(mode)) throw bad('نوع التعديل غير صالح');
  const amount = parseMoney(b.amount, 'الكمية', { allowZero: mode === 'set', max: 10000000 });

  const result = db.transaction(() => {
    const row = db.prepare(SELECT + ' WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'الخامة غير موجودة');
    let next = row.quantity;
    if (mode === 'add') next = round2(row.quantity + amount);
    else if (mode === 'subtract') {
      if (amount > row.quantity) throw bad(`الكمية المصروفة أكبر من المتاح (${row.quantity} ${row.unit})`);
      next = round2(row.quantity - amount);
    } else next = amount;
    db.prepare('UPDATE inventory_items SET quantity = ? WHERE id = ?').run(next, id);
    return decorate({ ...row, quantity: next });
  })();
  res.json(result);
});

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const r = db.prepare('DELETE FROM inventory_items WHERE id = ?').run(id);
  if (!r.changes) throw new HttpError(404, 'الخامة غير موجودة');
  res.json({ ok: true });
});

module.exports = router;
