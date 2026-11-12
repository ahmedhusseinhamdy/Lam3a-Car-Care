// اختبار سريع شامل للـ API (بيشتغل على قاعدة بيانات مؤقتة — مش بيلمس بياناتك):  npm test
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lam3a-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.ADMIN_USER = 'tester';
process.env.ADMIN_PASSWORD = 'Test-Pass-12345';
process.env.NODE_ENV = 'test';

const ExcelJS = require('exceljs');
const app = require('../server');

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✔', name); }
  else { failed++; console.log('  ✘', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
}

(async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body, { raw = false, headers = {} } = {}) => {
    const opts = { method, headers: { ...headers } };
    if (cookie) opts.headers.Cookie = cookie;
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(base + url, { ...opts, redirect: 'manual' });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ليس JSON */ }
    return { status: res.status, json, text, res };
  };

  console.log('\n— الحماية');
  for (const u of ['/api/customers', '/api/services', '/api/offers', '/api/gallery', '/api/settings', '/api/dashboard']) {
    check(`${u} من غير تسجيل دخول = 401`, (await call('GET', u)).status === 401);
  }
  check('/admin من غير دخول بيحوّل لصفحة الدخول', (await call('GET', '/admin')).status === 302);
  check('دخول بباسورد غلط = 401', (await call('POST', '/api/auth/login', { username: 'tester', password: 'wrong' })).status === 401);
  const login = await call('POST', '/api/auth/login', { username: 'tester', password: 'Test-Pass-12345' });
  check('الدخول الصحيح ناجح', login.status === 200, login.json);
  cookie = (login.res.headers.get('set-cookie') || '').split(';')[0];
  check('الكوكي HttpOnly', /httponly/i.test(login.res.headers.get('set-cookie') || ''));
  check('/admin بعد الدخول = 200', (await call('GET', '/admin')).status === 200);

  console.log('\n— العملاء');
  check('رقم موبايل غلط = 400', (await call('POST', '/api/customers', { name: 'اختبار', phone: '12345' })).status === 400);
  const c1 = await call('POST', '/api/customers', { name: 'عميل اختبار', phone: '01012345678', birthday: '1990-05-10' });
  check('إضافة عميل', c1.status === 201, c1.json);
  check('منع تكرار الرقم = 409', (await call('POST', '/api/customers', { name: 'تاني', phone: '01012345678' })).status === 409);
  check('رقم بالأرقام العربية بيتقبل', (await call('POST', '/api/customers', { name: 'عربي', phone: '٠١١١٢٣٤٥٦٧٨' })).status === 201);
  check('تاريخ ميلاد في المستقبل = 400', (await call('POST', '/api/customers', { name: 'مستقبل', phone: '01212345678', birthday: '2999-01-01' })).status === 400);
  const q = await call('GET', '/api/customers?q=' + encodeURIComponent('01012'));
  check('البحث بالرقم', q.json && q.json.total === 1);
  check("محاولة SQL injection في البحث ما بتكسرش", (await call('GET', '/api/customers?q=' + encodeURIComponent("' OR 1=1 --"))).status === 200);
  const cid = c1.json.id;

  console.log('\n— الخدمات والزيارات والخصم');
  const svcs = (await call('GET', '/api/services')).json;
  check('فيه خدمات افتراضية', svcs.length >= 3);
  check('سعر سالب للخدمة = 400', (await call('POST', '/api/services', { name: 'x', price: -5 })).status === 400);
  const [s1, s2] = svcs;
  const V = `/api/customers/${cid}/visits`;
  check('زيارة من غير خدمات = 400', (await call('POST', V, { service_ids: [] })).status === 400);
  check('مدفوع أكبر من السعر = 400', (await call('POST', V, { service_ids: [s1.id], paid: s1.price + 1 })).status === 400);
  check('سعر سالب = 400', (await call('POST', V, { service_ids: [s1.id], total_price: -1 })).status === 400);
  const total = s1.price + s2.price;
  const v = await call('POST', V, { service_ids: [s1.id, s2.id], notes: 'اختبار', vehicle: 'سيارة' });
  check('زيارة بخدمتين: السعر = المجموع والمدفوع = السعر والخصم صفر', v.status === 201 && v.json.total_price === total && v.json.paid === total && v.json.discount === 0 && v.json.balance === undefined, v.json);
  const pay = await call('POST', V, { service_ids: [s1.id], total_price: s1.price, paid: s1.price - 10 });
  check('دفع أقل: الفرق بيتسجّل خصم', pay.status === 201 && pay.json.paid === s1.price - 10 && pay.json.discount === 10, pay.json);
  check('مسار الدفعات القديم اتشال (404)', (await call('POST', `/api/visits/${v.json.id}/payments`, { amount: 5 })).status === 404);
  const detail = await call('GET', `/api/customers/${cid}`);
  check('تفاصيل العميل: الزيارات والمدفوع والخصم', detail.json && detail.json.visits.length === 2 && detail.json.totals.discount === 10 && detail.json.totals.paid === total + s1.price - 10 && detail.json.totals.balance === undefined, detail.json && detail.json.totals);

  console.log('\n— العروض داخل الزيارة والخصم');
  const offA = await call('POST', '/api/offers', { title: 'عرض الزيارة', price: 200, expires_at: '2999-01-01' });
  const offNoPrice = await call('POST', '/api/offers', { title: 'عرض بدون سعر' });
  const offOld = await call('POST', '/api/offers', { title: 'عرض منتهي للزيارة', price: 50, expires_at: '2020-01-01' });
  const offOff = await call('POST', '/api/offers', { title: 'عرض متوقف', price: 50, active: false });
  check('زيارة من غير خدمات ولا عروض = 400', (await call('POST', V, {})).status === 400);
  check('زيارة بعرض منتهي = 400', (await call('POST', V, { offer_ids: [offOld.json.id] })).status === 400);
  check('زيارة بعرض متوقف = 400', (await call('POST', V, { offer_ids: [offOff.json.id] })).status === 400);
  check('زيارة بعرض من غير سعر = 400', (await call('POST', V, { offer_ids: [offNoPrice.json.id] })).status === 400);
  const vo = await call('POST', V, { offer_ids: [offA.json.id], total_price: 200, paid: 100 });
  check('عرض فقط + دفع جزء: الباقي خصم', vo.status === 201 && vo.json.total_price === 100 && vo.json.discount === 100 && vo.json.subtotal === 200 && vo.json.services.length === 0 && vo.json.offers.length === 1, vo.json);
  const vm = await call('POST', V, { service_ids: [s1.id], offer_ids: [offA.json.id] });
  check('خدمات + عروض: الإجمالي = مجموعهم', vm.status === 201 && vm.json.total_price === s1.price + 200 && vm.json.discount === 0, vm.json);
  const vd = await call('POST', V, { service_ids: [s1.id], offer_ids: [offA.json.id], paid: s1.price + 200 - 30 });
  check('الخصم = الإجمالي - المدفوع', vd.status === 201 && vd.json.discount === 30 && vd.json.subtotal === s1.price + 200, vd.json);
  const ve = await call('PUT', `/api/visits/${vd.json.id}`, { visit_date: vd.json.visit_date, service_ids: [], offer_ids: [offA.json.id], total_price: 200, paid: 150 });
  check('تعديل لعرض فقط والخصم بيتحسب', ve.status === 200 && ve.json.services.length === 0 && ve.json.discount === 50 && ve.json.paid === 150, ve.json);
  check('تعديل بدون خدمات ولا عروض = 400', (await call('PUT', `/api/visits/${vd.json.id}`, { visit_date: vd.json.visit_date, service_ids: [], offer_ids: [] })).status === 400);
  const dt = await call('GET', `/api/customers/${cid}`);
  check('استرجاع الزيارات بالعروض والخصم', dt.json.visits.some((x) => x.offers.length === 1 && x.discount === 50), dt.json.visits.map((x) => x.discount));
  await call('DELETE', `/api/visits/${vo.json.id}`); await call('DELETE', `/api/visits/${vm.json.id}`); await call('DELETE', `/api/visits/${vd.json.id}`);
  const vp = await call('POST', V, { service_ids: [s1.id], paid: 30 });
  const vpe = await call('PUT', `/api/visits/${vp.json.id}`, { visit_date: vp.json.visit_date, service_ids: [s1.id] });
  check('تعديل من غير paid بيحافظ على المدفوع والخصم', vpe.status === 200 && vpe.json.paid === 30 && vpe.json.discount === s1.price - 30, vpe.json);
  await call('DELETE', `/api/visits/${vp.json.id}`);

  console.log('\n— الداشبورد');
  const dash = await call('GET', '/api/dashboard');
  const t = dash.json && dash.json.today_stats;
  check('إيراد النهارده = مدفوع الزيارتين', t && t.revenue === total + s1.price - 10, t);
  check('خصم النهارده وعدد العملاء والمستفيدين', t && t.discount === 10 && t.customers === 1 && t.discount_customers === 1, t);
  check('مفيش مدينين/متبقي في الرد', dash.json && dash.json.debtors === undefined && dash.json.total_outstanding === undefined);
  check('الأقسام: فترة وشهر واستخدام ومنقطعين وأعياد ميلاد', dash.json && dash.json.range && dash.json.month_stats && dash.json.usage.rows.length >= 3 && Array.isArray(dash.json.inactive) && Array.isArray(dash.json.birthdays_month));
  check('استخدام الخدمات: الإجمالي صح', dash.json.usage.totals.period === 3);
  const todayV = await call('GET', '/api/dashboard/today-visits?filter=discount');
  check('نافذة عملاء الخصم', todayV.json && todayV.json.items.length === 1 && todayV.json.items[0].discount === 10, todayV.json);
  check('إيراد فترة مخصصة', (await call('GET', `/api/dashboard/range?from=${dash.json.today}&to=${dash.json.today}`)).json.amount === t.revenue);
  check('فترة غلط = 400', (await call('GET', '/api/dashboard/range?from=2026-02-01&to=2026-01-01')).status === 400);
  check('تقرير شهري', (await call('GET', `/api/dashboard/month?year=${dash.json.year}&from_month=1&to_month=12`)).json.months === 12);

  console.log('\n— المخزن');
  check('/api/inventory من غير دخول = 401', (await fetch(base + '/api/inventory')).status === 401);
  const it = await call('POST', '/api/inventory', { name: 'منظف اختبار', category: 'chemicals', quantity: 4, unit: 'لتر', min_quantity: 5, unit_price: 10 });
  check('إضافة صنف بكود تلقائي والحالة منخفض', it.status === 201 && /^CHM-/.test(it.json.code) && it.json.status === 'low' && it.json.total_value === 40, it.json);
  check('كود مكرر = 409', (await call('POST', '/api/inventory', { code: it.json.code, name: 'x', category: 'chemicals' })).status === 409);
  check('كمية سالبة = 400', (await call('POST', '/api/inventory', { name: 'x', category: 'supplies', quantity: -1 })).status === 400);
  check('توريد كمية', (await call('POST', `/api/inventory/${it.json.id}/adjust`, { mode: 'add', amount: 10 })).json.status === 'ok');
  check('صرف أكتر من المتاح = 400', (await call('POST', `/api/inventory/${it.json.id}/adjust`, { mode: 'subtract', amount: 999 })).status === 400);
  const invList = (await call('GET', '/api/inventory?category=chemicals')).json;
  check('قائمة المخزن والملخص', invList.items.length === 1 && invList.summary.chemicals === 1 && invList.summary.total_value === 140, invList.summary);
  check('حذف صنف', (await call('DELETE', `/api/inventory/${it.json.id}`)).status === 200);

  console.log('\n— حساب الأدمن');
  check('كلمة مرور حالية غلط = 400', (await call('POST', '/api/auth/password', { current_password: 'x', new_password: 'abcdefgh1' })).status === 400);
  check('من غير أي تغيير = 400', (await call('POST', '/api/auth/password', { current_password: 'Test-Pass-12345' })).status === 400);
  check('اسم مستخدم قصير = 400', (await call('POST', '/api/auth/password', { current_password: 'Test-Pass-12345', new_username: 'ab' })).status === 400);
  check('تغيير اسم المستخدم', (await call('POST', '/api/auth/password', { current_password: 'Test-Pass-12345', new_username: 'lam3a' })).json.username === 'lam3a');
  check('الدخول باسم المستخدم الجديد', (await call('POST', '/api/auth/login', { username: 'lam3a', password: 'Test-Pass-12345' })).status === 200);

  console.log('\n— استيراد Excel');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('x');
  ws.addRow(['الاسم', 'رقم التليفون', 'تاريخ الميلاد']);
  ws.addRow(['عميل إكسل 1', '01055555555', '1992-03-04']);
  ws.addRow(['عميل إكسل 2', '1066666666', new Date(Date.UTC(1985, 6, 21))]); // الصفر ضايع زي الإكسل
  ws.addRow(['مكرر في الداتابيز', '01012345678', '']);
  ws.addRow(['رقم غلط', '123', '']);
  ws.addRow(['مكرر في الملف', '01055555555', '']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const mkForm = (mode, name = 'c.xlsx') => { const fd = new FormData(); fd.append('mode', mode); fd.append('file', new Blob([buf]), name); return fd; };
  const prev = await call('POST', '/api/customers/import', mkForm('preview'));
  check('معاينة الاستيراد', prev.status === 200 && prev.json.summary.new === 2 && prev.json.summary.skipped === 3, prev.json && prev.json.summary);
  const before = (await call('GET', '/api/customers')).json.total;
  const comm = await call('POST', '/api/customers/import', mkForm('commit'));
  check('تنفيذ الاستيراد', comm.status === 200 && comm.json.imported === 2, comm.json);
  check('عدد العملاء زاد 2', (await call('GET', '/api/customers')).json.total === before + 2);
  check('ملف بامتداد غلط مرفوض', (await call('POST', '/api/customers/import', mkForm('preview', 'x.exe'))).status === 400);
  check('تحميل القالب', (await call('GET', '/api/customers/template')).status === 200);

  // تصدير: لازم يطلع كل العملاء (مش صفحة واحدة) ببياناتهم مطابقة
  const expRes = await fetch(base + '/api/customers/export', { headers: { Cookie: cookie } });
  check('التصدير: ملف xlsx', expRes.status === 200 && /spreadsheetml/.test(expRes.headers.get('content-type') || '') && /attachment/.test(expRes.headers.get('content-disposition') || ''));
  const expWb = new ExcelJS.Workbook();
  await expWb.xlsx.load(Buffer.from(await expRes.arrayBuffer()));
  const expWs = expWb.worksheets[0];
  const allCustomers = (await call('GET', '/api/customers?limit=100')).json;
  check('التصدير: كل العملاء موجودين', expWs.rowCount - 1 === allCustomers.total, [expWs.rowCount - 1, allCustomers.total]);
  check('التصدير: عناوين عربية', expWs.getRow(1).getCell(1).value === 'اسم العميل' && expWs.getRow(1).getCell(2).value === 'رقم التليفون' && expWs.getRow(1).getCell(4).value === 'تاريخ التسجيل' && expWs.getRow(1).getCell(7).value === 'إجمالي الخصم (ج.م)');
  const expRow = expWs.getRows(2, expWs.rowCount - 1).find((r) => String(r.getCell(2).value) === '01012345678');
  check('التصدير: الرقم محفوظ بالصفر والزيارات والخصم مطابقة', !!expRow && expRow.getCell(5).value === 2 && expRow.getCell(7).value === 10, expRow && expRow.values);
  const noAuth = await fetch(base + '/api/customers/export');
  check('التصدير من غير دخول = 401', noAuth.status === 401);

  console.log('\n— المحتوى العام والرفع');
  check('إضافة عرض', (await call('POST', '/api/offers', { title: 'عرض اختبار', price: 100, expires_at: '2999-01-01' })).status === 201);
  check('عرض بسعر سالب = 400', (await call('POST', '/api/offers', { title: 'x', price: -1 })).status === 400);
  check('عرض منتهي', (await call('POST', '/api/offers', { title: 'قديم', expires_at: '2020-01-01' })).status === 201);
  const set = await call('PUT', '/api/settings', { phone: '01099999999', address: 'عنوان اختبار', working_hours: '9-5' });
  check('حفظ الإعدادات', set.status === 200 && set.json.phone === '01099999999', set.json);
  check('موبايل غلط في الإعدادات = 400', (await call('PUT', '/api/settings', { phone: 'abc' })).status === 400);

  const fdBad = new FormData(); fdBad.append('images', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
  check('رفع ملف مش صورة مرفوض', (await call('POST', '/api/gallery', fdBad)).status === 400);
  const fdFake = new FormData(); fdFake.append('images', new Blob(['not really a png file....'], { type: 'image/png' }), 'a.png');
  check('ملف مزيّف بامتداد صورة مرفوض (فحص المحتوى)', (await call('POST', '/api/gallery', fdFake)).status === 400);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fdOk = new FormData(); fdOk.append('images', new Blob([png], { type: 'image/png' }), 'ok.png'); fdOk.append('caption', 'اختبار');
  check('رفع صورة صالحة', (await call('POST', '/api/gallery', fdOk)).status === 201);

  cookie = ''; // زائر عادي
  const pub = await call('GET', '/api/public/site');
  check('الموقع العام شغال بدون دخول', pub.status === 200);
  check('الموقع العام مفيهوش بيانات عملاء', !/01012345678|عميل اختبار|customers/.test(pub.text));
  check('العرض المنتهي مش ظاهر للزوار', pub.json && !pub.json.offers.some((o) => o.title === 'قديم') && pub.json.offers.some((o) => o.title === 'عرض اختبار'));
  check('الصفحة الرئيسية', (await call('GET', '/')).status === 200);
  check('Helmet: X-Content-Type-Options', (await call('GET', '/')).res.headers.get('x-content-type-options') === 'nosniff');
  check('مسار API مجهول = 404 JSON', (await call('GET', '/api/nothing')).status === 404);

  console.log(`\nالنتيجة: ${passed} نجح، ${failed} فشل\n`);
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('الاختبار وقع:', e); process.exit(1); });
