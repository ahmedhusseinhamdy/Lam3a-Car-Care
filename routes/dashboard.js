const express = require('express');
const db = require('../db');
const { bad, todayStr, isValidDateStr } = require('../utils/validate');
const stats = require('../utils/stats');

const router = express.Router(); // محمي بـ requireAuth من server.js

const MAX_RANGE_DAYS = 3660;

function parseRange(q) {
  const from = String(q.from || '');
  const to = String(q.to || '');
  if (!isValidDateStr(from) || !isValidDateStr(to)) throw bad('اختار تاريخ صالح');
  if (from > to) throw bad('تاريخ البداية لازم يكون قبل تاريخ النهاية');
  if (stats.daysBetween(from, to) > MAX_RANGE_DAYS) throw bad('الفترة طويلة جداً');
  return { from, to };
}

function parseMonth(q) {
  const year = Number(q.year);
  const month = Number(q.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw bad('السنة غير صالحة');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw bad('الشهر غير صالح');
  return { year, month };
}

// من شهر إلى شهر داخل نفس السنة (month وحده = شهر واحد)
function parseMonthSpan(q) {
  const year = Number(q.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw bad('السنة غير صالحة');
  const from = Number(q.from_month ?? q.month);
  const to = Number(q.to_month ?? q.month);
  for (const m of [from, to]) if (!Number.isInteger(m) || m < 1 || m > 12) throw bad('الشهر غير صالح');
  if (from > to) throw bad('الشهر الأول لازم يكون قبل الشهر الأخير');
  return { year, from, to };
}

// الصفحة الرئيسية: كل الأقسام بالقيم الافتراضية (الفترة = من أول الشهر لحد النهارده، والشهر = الشهر الحالي)
router.get('/', (req, res) => {
  const today = todayStr();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const mmdd = today.slice(5);
  const thisYear = year;
  const range = { from: stats.monthRange(year, month).from, to: today };
  const m = stats.monthRange(year, month);

  const birthdays = db
    .prepare(
      `SELECT id, name, phone, birthday FROM customers
       WHERE birthday IS NOT NULL AND substr(birthday, 6, 2) = ?
       ORDER BY substr(birthday, 9, 2), name`
    )
    .all(today.slice(5, 7))
    .map((c) => ({
      ...c,
      day: Number(c.birthday.slice(8, 10)),
      age: thisYear - Number(c.birthday.slice(0, 4)),
      is_today: c.birthday.slice(5) === mmdd,
    }));

  res.json({
    today,
    year,
    month,
    years: stats.yearsList(db, year),
    today_stats: stats.todayStats(db, today),
    range: stats.periodStats(db, range.from, range.to),
    month_stats: { year, from_month: month, to_month: month, months: 1, ...stats.periodStats(db, m.from, m.to) },
    usage: { ...range, year, month, ...stats.serviceUsage(db, { ...range, year, month }) },
    inactive: stats.inactiveCustomers(db, today),
    birthdays_today: birthdays.filter((b) => b.is_today),
    birthdays_month: birthdays,
  });
});

// عملاء اليوم: filter=all (كل اللي استخدموا خدمات أو عروض) أو filter=discount (اللي استخدموا خصم)
router.get('/today-visits', (req, res) => {
  const onlyDiscount = req.query.filter === 'discount';
  res.json({ today: todayStr(), items: stats.todayVisits(db, todayStr(), onlyDiscount) });
});

// إيراد فترة (من/إلى)
router.get('/range', (req, res) => {
  const { from, to } = parseRange(req.query);
  res.json(stats.periodStats(db, from, to));
});

// إيراد شهر معيّن
router.get('/month', (req, res) => {
  const { year, from, to } = parseMonthSpan(req.query);
  const a = stats.monthRange(year, from);
  const b = stats.monthRange(year, to);
  res.json({ year, from_month: from, to_month: to, months: to - from + 1, ...stats.periodStats(db, a.from, b.to) });
});

// استخدام الخدمات: فترة (من/إلى) + شهر معيّن
router.get('/service-usage', (req, res) => {
  const { from, to } = parseRange(req.query);
  const { year, month } = parseMonth(req.query);
  res.json({ from, to, year, month, ...stats.serviceUsage(db, { from, to, year, month }) });
});

module.exports = router;
