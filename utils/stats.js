// إحصائيات لوحة التحكم (إيراد، خصم، استخدام الخدمات، عملاء منقطعين).
// كل الدوال بتاخد db كمعامل عشان تتختبر بسهولة. الإيراد = مجموع سعر الزيارات (= المدفوع) حسب تاريخ الزيارة.
const { visitDiscountSql } = require('./sql');
const { round2 } = require('./validate');

const DISC = visitDiscountSql('v');

const pad = (n) => String(n).padStart(2, '0');

// أول وآخر يوم في شهر (month من 1 لـ 12)
function monthRange(year, month) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

// عدد الأيام بين تاريخين شامل الطرفين
function daysBetween(from, to) {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  return Math.round((b - a) / 86400000) + 1;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// صف واحد: عدد الخدمات، العملاء، العروض، إجمالي الخصم، المبلغ — لفترة من/إلى
function periodStats(db, from, to) {
  const base = db
    .prepare(
      `SELECT COUNT(DISTINCT v.customer_id) AS customers,
              COALESCE(SUM(v.total_price), 0) AS amount,
              COALESCE(SUM(${DISC}), 0) AS discount
       FROM visits v WHERE v.visit_date BETWEEN ? AND ?`
    )
    .get(from, to);
  const services = db
    .prepare('SELECT COUNT(*) AS n FROM visit_services vs JOIN visits v ON v.id = vs.visit_id WHERE v.visit_date BETWEEN ? AND ?')
    .get(from, to).n;
  const offers = db
    .prepare('SELECT COUNT(*) AS n FROM visit_offers vo JOIN visits v ON v.id = vo.visit_id WHERE v.visit_date BETWEEN ? AND ?')
    .get(from, to).n;
  return {
    from,
    to,
    days: daysBetween(from, to),
    services,
    customers: base.customers,
    offers,
    discount: round2(base.discount),
    amount: round2(base.amount),
  };
}

// بطاقات النهارده الخمسة
function todayStats(db, today) {
  const p = periodStats(db, today, today);
  const discountCustomers = db
    .prepare(`SELECT COUNT(DISTINCT v.customer_id) AS n FROM visits v WHERE v.visit_date = ? AND ${DISC} > 0`)
    .get(today).n;
  return {
    revenue: p.amount,
    discount: p.discount,
    services: p.services,
    offers: p.offers,
    items: p.services + p.offers, // عدد الخدمات والعروض المستخدمة
    customers: p.customers,
    discount_customers: discountCustomers,
  };
}

// عملاء اليوم (للنافذة اللي بتتفتح من الكروت). onlyDiscount = عملاء استخدموا خصم فقط
function todayVisits(db, today, onlyDiscount) {
  return db
    .prepare(
      `SELECT v.id, c.id AS customer_id, c.name, c.phone, v.total_price AS amount, ${DISC} AS discount,
         (SELECT group_concat(vs.service_name, '، ') FROM visit_services vs WHERE vs.visit_id = v.id) AS services,
         (SELECT group_concat(vo.offer_title, '، ') FROM visit_offers vo WHERE vo.visit_id = v.id) AS offers
       FROM visits v JOIN customers c ON c.id = v.customer_id
       WHERE v.visit_date = ? ${onlyDiscount ? `AND ${DISC} > 0` : ''}
       ORDER BY v.id DESC`
    )
    .all(today)
    .map((r) => ({ ...r, amount: round2(r.amount), discount: round2(r.discount) }));
}

// استخدام كل خدمة في فترة وفي شهر معيّن. بيشمل الخدمات اللي اتحذفت (ليها زيارات قديمة) والخدمات اللي استخدامها صفر
function serviceUsage(db, { from, to, year, month }) {
  const names = db.prepare('SELECT name FROM services ORDER BY sort_order, id').all().map((r) => r.name);
  for (const r of db.prepare('SELECT DISTINCT service_name AS name FROM visit_services ORDER BY service_name').all()) {
    if (!names.includes(r.name)) names.push(r.name);
  }
  const count = (a, b) => {
    const map = new Map();
    for (const r of db
      .prepare(
        `SELECT vs.service_name AS name, COUNT(*) AS n FROM visit_services vs JOIN visits v ON v.id = vs.visit_id
         WHERE v.visit_date BETWEEN ? AND ? GROUP BY vs.service_name`
      )
      .all(a, b)) map.set(r.name, r.n);
    return map;
  };
  const m = monthRange(year, month);
  const periodMap = count(from, to);
  const monthMap = count(m.from, m.to);
  const rows = names.map((name) => ({ name, period: periodMap.get(name) || 0, month: monthMap.get(name) || 0 }));
  return {
    rows,
    totals: { period: rows.reduce((a, r) => a + r.period, 0), month: rows.reduce((a, r) => a + r.month, 0) },
  };
}

// عملاء آخر زيارة ليهم من أسبوعين أو أكتر (الأحدث أولاً). العملاء من غير زيارات مش بيظهروا
function inactiveCustomers(db, today, days = 14, limit = 100) {
  const cutoff = addDays(today, -days);
  return db
    .prepare(
      `SELECT c.id, c.name, c.phone, MAX(v.visit_date) AS last_visit
       FROM customers c JOIN visits v ON v.customer_id = c.id
       GROUP BY c.id HAVING MAX(v.visit_date) <= ?
       ORDER BY last_visit DESC, c.name LIMIT ?`
    )
    .all(cutoff, limit);
}

// أول سنة فيها زيارات → السنة الحالية (لقوائم السنوات)
function yearsList(db, currentYear) {
  const first = db.prepare('SELECT MIN(substr(visit_date, 1, 4)) AS y FROM visits').get().y;
  const start = Math.min(Number(first) || currentYear, currentYear);
  const out = [];
  for (let y = currentYear; y >= start; y--) out.push(y);
  return out;
}

module.exports = {
  monthRange, daysBetween, addDays, periodStats, todayStats, todayVisits, serviceUsage, inactiveCustomers, yearsList,
};
