// الزيارات — محمي بـ requireAuth من server.js (متركّب على /api)
// نموذج الحساب: مفيش "متبقي". الخصم = (مجموع الخدمات والعروض) - المدفوع، والسعر المسجّل للزيارة = المدفوع
const express = require('express');
const db = require('../db');
const {
  HttpError, bad, body, cleanText, parseId, parseMoney, round2, todayStr, isValidDateStr,
} = require('../utils/validate');

const router = express.Router();

function parseDate(value, label) {
  if (value === undefined || value === null || value === '') return todayStr();
  if (!isValidDateStr(value)) throw bad(`${label} غير صالح`);
  if (value < '2000-01-01') throw bad(`${label} قديم جداً`);
  if (value > todayStr()) throw bad(`${label} لا يمكن أن يكون في المستقبل`);
  return value;
}

const isBlank = (x) => x === undefined || x === null || x === '';

// بيجهّز بيانات الزيارة من الـ body
// الشرط: لازم خدمة أو عرض واحد على الأقل (Services OR Offers)
function parseVisit(req) {
  const b = body(req);
  const rawServices = isBlank(b.service_ids) ? [] : b.service_ids;
  const rawOffers = isBlank(b.offer_ids) ? [] : b.offer_ids;
  if (!Array.isArray(rawServices) || !Array.isArray(rawOffers)) throw bad('بيانات الخدمات أو العروض غير صالحة');
  if (rawServices.length + rawOffers.length === 0) throw bad('اختار خدمة أو عرض واحد على الأقل');
  if (rawServices.length > 20 || rawOffers.length > 10) throw bad('عدد الخدمات أو العروض كبير');
  return {
    visit_date: parseDate(b.visit_date, 'تاريخ الزيارة'),
    vehicle: cleanText(b.vehicle, 'رقم/نوع العربية', { max: 80 }),
    notes: cleanText(b.notes, 'الملاحظات', { max: 500 }),
    service_ids: [...new Set(rawServices.map(parseId))],
    offer_ids: [...new Set(rawOffers.map(parseId))],
    price: isBlank(b.total_price) ? null : parseMoney(b.total_price, 'السعر', { max: 1000000 }),
    paid: isBlank(b.paid) ? null : parseMoney(b.paid, 'المبلغ المدفوع'),
  };
}

// بيحوّل الـ ids لخدمات وعروض بأسعارها. العناصر اللي كانت في الزيارة (عند التعديل) بتحتفظ بسعرها القديم
function resolveItems(v, current = { services: [], offers: [] }) {
  const getSvc = db.prepare('SELECT id, name, price FROM services WHERE id = ? AND active = 1');
  const getOffer = db.prepare('SELECT id, title, price, expires_at FROM offers WHERE id = ? AND active = 1');
  const today = todayStr();

  const services = v.service_ids.map((sid) => {
    const old = current.services.find((s) => s.service_id === sid);
    if (old) return { id: sid, name: old.service_name, price: old.price };
    const s = getSvc.get(sid);
    if (!s) throw bad('إحدى الخدمات المختارة غير موجودة أو متوقفة');
    return s;
  });

  const offers = v.offer_ids.map((oid) => {
    const old = current.offers.find((o) => o.offer_id === oid);
    if (old) return { id: oid, title: old.offer_title, price: old.price };
    const o = getOffer.get(oid);
    if (!o) throw bad('أحد العروض المختارة غير موجود أو متوقف');
    if (o.price === null) throw bad(`العرض "${o.title}" ملوش سعر محدد، حدد سعره من صفحة العروض الأول`);
    if (o.expires_at && o.expires_at < today) throw bad(`العرض "${o.title}" منتهي`);
    return o;
  });

  const subtotal = round2([...services, ...offers].reduce((a, x) => a + x.price, 0));
  return { services, offers, subtotal };
}

function fullVisit(id) {
  const v = db.prepare('SELECT id, customer_id, visit_date, vehicle, notes, total_price FROM visits WHERE id = ?').get(id);
  if (!v) return null;
  v.services = db.prepare('SELECT id, service_id, service_name, price FROM visit_services WHERE visit_id = ? ORDER BY id').all(id);
  v.offers = db.prepare('SELECT id, offer_id, offer_title, price FROM visit_offers WHERE visit_id = ? ORDER BY id').all(id);
  v.payments = db.prepare('SELECT id, amount, paid_at, note FROM payments WHERE visit_id = ? ORDER BY paid_at, id').all(id);
  v.subtotal = round2([...v.services, ...v.offers].reduce((a, x) => a + x.price, 0));
  v.discount = Math.max(0, round2(v.subtotal - v.total_price)); // الخصم = إجمالي الخدمات والعروض - المدفوع
  v.paid = round2(v.payments.reduce((a, p) => a + p.amount, 0));
  return v;
}

function insertItems(visitId, items) {
  const insSvc = db.prepare('INSERT INTO visit_services (visit_id, service_id, service_name, price) VALUES (?, ?, ?, ?)');
  const insOffer = db.prepare('INSERT INTO visit_offers (visit_id, offer_id, offer_title, price) VALUES (?, ?, ?, ?)');
  for (const s of items.services) insSvc.run(visitId, s.id, s.name, s.price);
  for (const o of items.offers) insOffer.run(visitId, o.id, o.title, o.price);
}

// الدفعة الوحيدة للزيارة = المبلغ المدفوع
function setPayment(visitId, amount, date) {
  db.prepare('DELETE FROM payments WHERE visit_id = ?').run(visitId);
  if (amount > 0) db.prepare('INSERT INTO payments (visit_id, amount, paid_at, note) VALUES (?, ?, ?, ?)').run(visitId, amount, date, 'دفع');
}

// ---- إضافة زيارة لعميل ----
router.post('/customers/:customerId/visits', (req, res) => {
  const customerId = parseId(req.params.customerId);
  if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(customerId)) throw new HttpError(404, 'العميل غير موجود');

  const v = parseVisit(req);
  const items = resolveItems(v);
  const price = v.price !== null ? v.price : items.subtotal;
  const paid = v.paid !== null ? v.paid : price; // لو المدفوع مش مبعوت يبقى دفع السعر كامل
  if (paid > price) throw bad('المبلغ المدفوع لا يمكن أن يزيد عن السعر');

  const visitId = db.transaction(() => {
    const r = db
      .prepare('INSERT INTO visits (customer_id, visit_date, vehicle, notes, total_price) VALUES (?, ?, ?, ?, ?)')
      .run(customerId, v.visit_date, v.vehicle, v.notes, paid); // السعر المسجّل = المدفوع، والفرق خصم
    insertItems(r.lastInsertRowid, items);
    setPayment(r.lastInsertRowid, paid, v.visit_date);
    return r.lastInsertRowid;
  })();

  res.status(201).json(fullVisit(visitId));
});

// ---- تعديل زيارة (ممكن يتعدل المدفوع كمان) ----
router.put('/visits/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!db.prepare('SELECT id FROM visits WHERE id = ?').get(id)) throw new HttpError(404, 'الزيارة غير موجودة');

  const v = parseVisit(req);
  const current = {
    services: db.prepare('SELECT service_id, service_name, price FROM visit_services WHERE visit_id = ?').all(id),
    offers: db.prepare('SELECT offer_id, offer_title, price FROM visit_offers WHERE visit_id = ?').all(id),
  };
  const items = resolveItems(v, current);
  const price = v.price !== null ? v.price : items.subtotal;
  const currentPaid = round2(db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE visit_id = ?').get(id).s);
  const paid = v.paid !== null ? v.paid : currentPaid;
  if (paid > price) throw bad('المبلغ المدفوع لا يمكن أن يزيد عن السعر');

  db.transaction(() => {
    db.prepare('UPDATE visits SET visit_date = ?, vehicle = ?, notes = ?, total_price = ? WHERE id = ?').run(v.visit_date, v.vehicle, v.notes, paid, id);
    db.prepare('DELETE FROM visit_services WHERE visit_id = ?').run(id);
    db.prepare('DELETE FROM visit_offers WHERE visit_id = ?').run(id);
    insertItems(id, items);
    setPayment(id, paid, v.visit_date);
  })();

  res.json(fullVisit(id));
});

router.delete('/visits/:id', (req, res) => {
  const id = parseId(req.params.id);
  const r = db.prepare('DELETE FROM visits WHERE id = ?').run(id); // الخدمات والعروض والمدفوعات بتتحذف تلقائياً
  if (!r.changes) throw new HttpError(404, 'الزيارة غير موجودة');
  res.json({ ok: true });
});

module.exports = router;
