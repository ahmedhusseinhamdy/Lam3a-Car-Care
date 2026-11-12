// بيانات تجريبية: عملاء + زيارات + مدفوعات + عروض + صور معرض + مخزن
// الاستخدام:  npm run seed          (يضيف البيانات التجريبية)
//             npm run seed:clear    (يمسح البيانات التجريبية بس — بيانات عملائك الحقيقية ما بتتلمسش)
// كل الأسماء والأرقام هنا وهمية 100% ومعلّمة is_demo=1
const { assertJwtSecret } = require('../config');
assertJwtSecret();
const db = require('../db');
const { todayStr, round2 } = require('../utils/validate');

const clear = process.argv.includes('--clear');

function clearDemo() {
  db.transaction(() => {
    db.prepare('DELETE FROM customers WHERE is_demo = 1').run(); // الزيارات والمدفوعات بتتحذف معاه (cascade)
    db.prepare('DELETE FROM offers WHERE is_demo = 1').run();
    db.prepare('DELETE FROM gallery WHERE is_demo = 1').run();
    db.prepare('DELETE FROM inventory_items WHERE is_demo = 1').run();
    db.prepare("UPDATE settings SET value = '' WHERE key = 'hero_image' AND value LIKE '/img/demo/%'").run();
  })();
}

if (clear) {
  clearDemo();
  console.log('✔ تم مسح البيانات التجريبية فقط.');
  process.exit(0);
}

if (db.prepare('SELECT COUNT(*) AS n FROM customers WHERE is_demo = 1').get().n > 0) {
  console.log('البيانات التجريبية موجودة بالفعل. لو عاوز تعيدها: npm run seed:clear ثم npm run seed');
  process.exit(0);
}

// ---- أدوات تاريخ ----
const today = todayStr();
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const mmddToday = today.slice(5);

// ---- عملاء وهميين (أرقام 010000000XX وهمية) ----
const names = [
  'أحمد محمود', 'محمد السيد', 'مصطفى إبراهيم', 'كريم عادل', 'عمرو حسن', 'يوسف خالد', 'طارق فتحي', 'هيثم رضا',
  'سامح نبيل', 'إسلام جمال', 'باسم سمير', 'وليد مجدي', 'مروان أشرف', 'أيمن عصام', 'محمود ناصر', 'شريف وائل',
  'علي ماهر', 'حازم صلاح', 'تامر زكريا', 'نادر فؤاد',
];
const birthdays = names.map((_, i) => {
  if (i === 0) return `1991-${mmddToday}`; // عيد ميلاده النهارده
  if (i === 1) return `1988-${mmddToday}`;
  if (i >= 2 && i <= 6) return `${1980 + i * 2}-${today.slice(5, 7)}-${String(Math.min(28, 3 + i * 4)).padStart(2, '0')}`; // أعياد ميلاد في الشهر الحالي
  if (i === 7) return null;
  return `${1980 + (i % 20)}-${String(((i * 5) % 12) + 1).padStart(2, '0')}-${String(((i * 7) % 27) + 1).padStart(2, '0')}`;
});

const services = db.prepare('SELECT id, name, price FROM services WHERE active = 1 ORDER BY sort_order, id').all();
if (!services.length) {
  console.error('مفيش خدمات في الداتابيز. شغّل السيرفر مرة واحدة على الأقل أو أضف خدمات.');
  process.exit(1);
}
const vehicles = ['سيارة سيدان بيضاء', 'SUV رمادي', 'هاتشباك أحمر', 'موتوسيكل أسود', 'سيارة صغيرة فضي', ''];

// مولّد أرقام عشوائي ثابت (عشان نفس البيانات كل مرة)
let seedState = 42;
const rnd = () => ((seedState = (seedState * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const insCustomer = db.prepare('INSERT INTO customers (name, phone, birthday, is_demo) VALUES (?, ?, ?, 1)');
const insVisit = db.prepare('INSERT INTO visits (customer_id, visit_date, vehicle, notes, total_price) VALUES (?, ?, ?, ?, ?)');
const insVS = db.prepare('INSERT INTO visit_services (visit_id, service_id, service_name, price) VALUES (?, ?, ?, ?)');
const insVO = db.prepare('INSERT INTO visit_offers (visit_id, offer_id, offer_title, price) VALUES (?, ?, ?, ?)');
const insPay = db.prepare('INSERT INTO payments (visit_id, amount, paid_at, note) VALUES (?, ?, ?, ?)');

db.transaction(() => {
  // عروض تجريبية (بتتعمل الأول عشان بعض الزيارات تستخدمها)
  const insOffer = db.prepare('INSERT INTO offers (title, description, price, expires_at, is_demo) VALUES (?, ?, ?, ?, 1)');
  const offerRows = [
    ['باقة اللمعة الكاملة', 'غسيل خارجي + داخلي + تنظيف محرك بسعر خاص. (عرض تجريبي — عدّله من لوحة التحكم)', 220, addDays(today, 30)],
    ['خصم 20% على التلميع', 'تلميع احترافي لعربيتك بخصم لفترة محدودة. (عرض تجريبي)', 280, addDays(today, 14)],
    ['غسيل الموتوسيكل بنص السعر', 'كل يوم جمعة للموتوسيكلات. (عرض تجريبي)', 25, null],
  ].map(([title, desc, price, exp]) => ({ id: insOffer.run(title, desc, price, exp).lastInsertRowid, title, price }));

  names.forEach((name, i) => {
    const phone = `0100000${String(i + 1).padStart(4, '0')}`; // 01000000001 ... (وهمي)
    const cid = insCustomer.run(name, phone, birthdays[i]).lastInsertRowid;
    let firstDate = today;

    const visitsCount = 1 + Math.floor(rnd() * 4);
    for (let k = 0; k < visitsCount; k++) {
      const daysAgo = k === 0 && i < 6 ? 0 : Math.floor(rnd() * 40);
      const date = addDays(today, -daysAgo);
      if (date < firstDate) firstDate = date;
      const chosen = [...new Set([pick(services), rnd() > 0.7 ? pick(services) : null].filter(Boolean))];
      const offer = rnd() > 0.8 ? pick(offerRows) : null;
      const subtotal = round2(chosen.reduce((a, s) => a + s.price, 0) + (offer ? offer.price : 0));

      // المدفوع: السعر كامل، أو أقل (والفرق خصم). السعر المسجّل للزيارة = المدفوع
      let paid = subtotal;
      if (rnd() > 0.7) {
        const reduced = Math.floor((subtotal * 0.8) / 5) * 5;
        if (reduced > 0) paid = reduced;
      }
      const vid = insVisit.run(cid, date, pick(vehicles), '', paid).lastInsertRowid;
      chosen.forEach((s) => insVS.run(vid, s.id, s.name, s.price));
      if (offer) insVO.run(vid, offer.id, offer.title, offer.price);
      insPay.run(vid, paid, date, 'دفع');
    }
    // تاريخ تسجيل العميل = قبل أول زيارة
    db.prepare('UPDATE customers SET created_at = ? WHERE id = ?').run(`${firstDate} 09:00:00`, cid);
  });

  // مخزن تجريبي (خامات ومستلزمات) — القيمة الإجمالية 10,640 ج.م و4 تنبيهات
  const insInv = db.prepare(
    'INSERT INTO inventory_items (code, name, supplier, category, quantity, unit, min_quantity, unit_price, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
  );
  [
    ['CHM-101', 'مسحوق غسيل أوتوماتيك خارق (برميل)', 'شركة النيل للمنظفات', 'chemicals', 45, 'كجم', 15, 85],
    ['CHM-102', 'منعم ومعطر ملابس نسيم اللافندر', 'شركة النيل للمنظفات', 'chemicals', 8, 'لتر', 10, 40],
    ['CHM-103', 'مبيض كلور مركز للغسيل الأبيض', 'شركة المصرية للكيماويات', 'chemicals', 3, 'جالون', 5, 65],
    ['CHM-104', 'مزيل بقع الحبر والزيوت (Spot Remover)', 'شركة تيكنو كلين للكيماويات', 'chemicals', 0, 'لتر', 4, 120],
    ['CON-201', 'فوط ميكروفايبر للتجفيف', 'مكتب الأمل للتجهيزات', 'consumables', 120, 'قطعة', 50, 25],
    ['CON-202', 'إسفنج غسيل سيارات', 'مكتب الأمل للتجهيزات', 'consumables', 40, 'قطعة', 20, 15],
    ['CON-203', 'أكياس حماية للمقاعد', 'مصنع التغليف الحديث', 'consumables', 6, 'رول', 10, 50],
    ['SUP-301', 'خرطوم مياه ضغط عالي', 'شركة الفاروق للمعدات', 'supplies', 5, 'قطعة', 2, 300],
    ['SUP-302', 'مكنسة كهربائية صناعية', 'شركة الفاروق للمعدات', 'supplies', 2, 'قطعة', 1, 450],
  ].forEach((row) => insInv.run(...row));

  // صور معرض تجريبية (رسومات SVG موجودة في public/img/demo)
  const insG = db.prepare('INSERT INTO gallery (path, caption, is_demo) VALUES (?, ?, 1)');
  [
    ['wash-1.svg', 'غسيل خارجي بالفوم'],
    ['wash-2.svg', 'تلميع وإزالة الخدوش'],
    ['wash-3.svg', 'تنظيف داخلي عميق'],
    ['bike-1.svg', 'غسيل الموتوسيكلات'],
    ['wash-4.svg', 'حماية الطلاء'],
    ['bike-2.svg', 'تلميع الموتوسيكل'],
  ].forEach(([f, c]) => insG.run('/img/demo/' + f, c));

  db.prepare("UPDATE settings SET value = '/img/demo/hero.svg' WHERE key = 'hero_image' AND value = ''").run();
})();

const c = db.prepare('SELECT COUNT(*) AS n FROM customers WHERE is_demo = 1').get().n;
const v = db.prepare('SELECT COUNT(*) AS n FROM visits').get().n;
console.log(`✔ تمت إضافة بيانات تجريبية: ${c} عميل، ${v} زيارة، 3 عروض، 6 صور، 9 أصناف مخزن.`);
console.log('  (كلها وهمية ومعلّمة is_demo — امسحها بـ: npm run seed:clear)');
