const express = require('express');
const multer = require('multer');
const path = require('path');
const ExcelJS = require('exceljs');
const db = require('../db');
const { config } = require('../config');
const { visitDiscountSql } = require('../utils/sql');
const { parseCustomersFile, buildTemplate } = require('../utils/excel');
const {
  HttpError, bad, body, cleanText, parseId, normalizePhone, isValidBirthday, toLatinDigits, round2,
} = require('../utils/validate');

const router = express.Router(); // محمي بـ requireAuth من server.js

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (['.xlsx', '.csv'].includes(ext)) return cb(null, true);
    cb(new Error('INVALID_TYPE'));
  },
});

// ---- تحقق من بيانات العميل ----
function parseCustomer(req) {
  const b = body(req);
  const name = cleanText(b.name, 'اسم العميل', { required: true, max: 100 });
  const phone = normalizePhone(b.phone);
  if (!phone) throw bad('رقم الموبايل غير صالح. اكتب رقم مصري صحيح (مثال: 01012345678)');
  let birthday = null;
  if (b.birthday) {
    if (!isValidBirthday(b.birthday)) throw bad('تاريخ الميلاد غير صالح');
    birthday = b.birthday;
  }
  return { name, phone, birthday };
}

function phoneTaken(phone, exceptId = 0) {
  return db.prepare('SELECT id FROM customers WHERE phone = ? AND id != ?').get(phone, exceptId);
}

// created_at متخزن بتوقيت UTC (YYYY-MM-DD HH:MM:SS) → تاريخ بتوقيت التطبيق (YYYY-MM-DD)
function registrationDate(createdAt) {
  if (!createdAt) return '';
  const d = new Date(String(createdAt).replace(' ', 'T') + 'Z');
  return isNaN(d) ? '' : d.toLocaleDateString('en-CA', { timeZone: config.timezone });
}

function escapeLike(s) {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

// ---- قالب Excel (لازم يكون قبل /:id) ----
router.get('/template', async (req, res, next) => {
  try {
    const buf = await buildTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="lam3a-customers-template.xlsx"');
    res.send(Buffer.from(buf));
  } catch (e) {
    next(e);
  }
});

// ---- تصدير كل العملاء إلى Excel (لازم يكون قبل /:id) ----
// بيصدّر كل العملاء في الداتابيز (مش الصفحة الحالية ولا نتيجة البحث)
router.get('/export', async (req, res, next) => {
  try {
    const rows = db
      .prepare(
        `SELECT c.name, c.phone, c.birthday, c.created_at,
          (SELECT COUNT(*) FROM visits v WHERE v.customer_id = c.id) AS visits_count,
          COALESCE((SELECT SUM(v.total_price) FROM visits v WHERE v.customer_id = c.id), 0) AS total_paid,
          COALESCE((SELECT SUM(${visitDiscountSql('v')}) FROM visits v WHERE v.customer_id = c.id), 0) AS total_discount
         FROM customers c ORDER BY c.id`
      )
      .all();

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Lam3a Car Care';
    const ws = wb.addWorksheet('العملاء', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'اسم العميل', key: 'name', width: 30 },
      { header: 'رقم التليفون', key: 'phone', width: 18 },
      { header: 'تاريخ الميلاد', key: 'birthday', width: 16 },
      { header: 'تاريخ التسجيل', key: 'registered', width: 16 },
      { header: 'عدد الزيارات', key: 'visits', width: 14 },
      { header: 'إجمالي المدفوع (ج.م)', key: 'paid', width: 20 },
      { header: 'إجمالي الخصم (ج.م)', key: 'discount', width: 20 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getColumn('phone').numFmt = '@'; // نص عشان الصفر في الأول ما يضيعش

    for (const r of rows) {
      ws.addRow({
        name: r.name,
        phone: r.phone, // نص
        birthday: r.birthday || '', // نص بصيغة YYYY-MM-DD زي ما هو متخزن
        registered: registrationDate(r.created_at),
        visits: r.visits_count,
        paid: round2(r.total_paid),
        discount: round2(r.total_discount),
      });
    }
    ['paid', 'discount'].forEach((k) => { ws.getColumn(k).numFmt = '#,##0.00'; });

    const buf = await wb.xlsx.writeBuffer();
    const stamp = new Date().toLocaleDateString('en-CA', { timeZone: config.timezone });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="lam3a-customers-${stamp}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    next(e);
  }
});

// ---- قائمة العملاء + بحث + ترقيم صفحات ----
router.get('/', (req, res) => {
  const q = toLatinDigits(String(req.query.q || '')).trim().slice(0, 60);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  const like = `%${escapeLike(q)}%`;
  const where = q ? "WHERE (c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')" : '';
  const args = q ? [like, like] : [];

  const total = db.prepare(`SELECT COUNT(*) AS n FROM customers c ${where}`).get(...args).n;
  const items = db
    .prepare(
      `SELECT c.id, c.name, c.phone, c.birthday, c.created_at,
        (SELECT COUNT(*) FROM visits v WHERE v.customer_id = c.id) AS visits_count,
        COALESCE((SELECT SUM(${visitDiscountSql('v')}) FROM visits v WHERE v.customer_id = c.id), 0) AS total_discount
       FROM customers c ${where}
       ORDER BY c.id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, limit, (page - 1) * limit)
    .map((c) => ({ ...c, registered_at: registrationDate(c.created_at), total_discount: round2(c.total_discount) }));

  res.json({ items, total, page, pages: Math.max(Math.ceil(total / limit), 1) });
});

// ---- استيراد من Excel ----
// mode=preview بيرجع المعاينة بس، mode=commit بيحفظ الصفوف الصالحة الجديدة
router.post('/import', (req, res, next) => {
  importUpload.single('file')(req, res, async (err) => {
    try {
      if (err) {
        if (err.message === 'INVALID_TYPE') throw bad('الملف لازم يكون Excel (.xlsx) أو CSV');
        if (err.code === 'LIMIT_FILE_SIZE') throw bad('حجم الملف كبير (الحد الأقصى 5 ميجا)');
        throw err;
      }
      if (!req.file) throw bad('اختار ملف الإكسل الأول');
      const ext = path.extname(req.file.originalname).toLowerCase();
      const { rows } = await parseCustomersFile(req.file.buffer, ext);

      const existing = db.prepare('SELECT id FROM customers WHERE phone = ?');
      const seen = new Set();
      for (const r of rows) {
        if (r.error) { r.status = 'error'; continue; }
        if (seen.has(r.phone)) { r.status = 'duplicate_in_file'; r.error = 'الرقم متكرر في نفس الملف'; continue; }
        seen.add(r.phone);
        if (existing.get(r.phone)) { r.status = 'exists'; r.error = 'العميل موجود بالفعل'; continue; }
        r.status = 'new';
      }
      const summary = {
        total: rows.length,
        new: rows.filter((r) => r.status === 'new').length,
        skipped: rows.filter((r) => r.status !== 'new').length,
      };

      if (req.body && req.body.mode === 'commit') {
        const ins = db.prepare('INSERT INTO customers (name, phone, birthday) VALUES (?, ?, ?)');
        db.transaction(() => {
          for (const r of rows) if (r.status === 'new') ins.run(r.name, r.phone, r.birthday);
        })();
        return res.json({ ok: true, imported: summary.new, skipped: summary.skipped, rows: rows.filter((r) => r.status !== 'new').slice(0, 200) });
      }
      res.json({ summary, rows: rows.slice(0, 200) });
    } catch (e) {
      next(e);
    }
  });
});

// ---- عميل واحد + زياراته ----
router.get('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const customer = db.prepare('SELECT id, name, phone, birthday FROM customers WHERE id = ?').get(id);
  if (!customer) throw new HttpError(404, 'العميل غير موجود');

  const visits = db
    .prepare('SELECT id, visit_date, vehicle, notes, total_price FROM visits WHERE customer_id = ? ORDER BY visit_date DESC, id DESC')
    .all(id);
  const svc = db.prepare('SELECT id, service_id, service_name, price FROM visit_services WHERE visit_id = ? ORDER BY id');
  const offs = db.prepare('SELECT id, offer_id, offer_title, price FROM visit_offers WHERE visit_id = ? ORDER BY id');
  const pay = db.prepare('SELECT id, amount, paid_at, note FROM payments WHERE visit_id = ? ORDER BY paid_at, id');

  let totalPaid = 0;
  let totalDiscount = 0;
  for (const v of visits) {
    v.services = svc.all(v.id);
    v.offers = offs.all(v.id);
    v.subtotal = round2([...v.services, ...v.offers].reduce((a, x) => a + x.price, 0));
    v.discount = Math.max(0, round2(v.subtotal - v.total_price));
    v.payments = pay.all(v.id);
    v.paid = round2(v.payments.reduce((a, p) => a + p.amount, 0));
    totalDiscount += v.discount;
    totalPaid += v.paid;
  }
  res.json({
    customer,
    visits,
    totals: { visits: visits.length, paid: round2(totalPaid), discount: round2(totalDiscount) },
  });
});

router.post('/', (req, res) => {
  const c = parseCustomer(req);
  if (phoneTaken(c.phone)) throw new HttpError(409, 'رقم الموبايل ده مسجل لعميل تاني');
  const r = db.prepare('INSERT INTO customers (name, phone, birthday) VALUES (?, ?, ?)').run(c.name, c.phone, c.birthday);
  res.status(201).json({ id: r.lastInsertRowid, ...c });
});

router.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const c = parseCustomer(req);
  if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id)) throw new HttpError(404, 'العميل غير موجود');
  if (phoneTaken(c.phone, id)) throw new HttpError(409, 'رقم الموبايل ده مسجل لعميل تاني');
  db.prepare('UPDATE customers SET name = ?, phone = ?, birthday = ? WHERE id = ?').run(c.name, c.phone, c.birthday, id);
  res.json({ id, ...c });
});

// حذف العميل بيحذف زياراته ومدفوعاته (cascade) — الفرونت إند بيطلب تأكيد
router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const r = db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  if (!r.changes) throw new HttpError(404, 'العميل غير موجود');
  res.json({ ok: true });
});

module.exports = router;
