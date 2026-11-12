// قراءة ملف Excel/CSV للعملاء (الاسم، رقم التليفون، تاريخ الميلاد)
const ExcelJS = require('exceljs');
const { Readable } = require('stream');
const { bad, toLatinDigits, normalizePhone, isValidBirthday } = require('./validate');

const MAX_ROWS = 5000;

const HEADER_ALIASES = {
  name: ['الاسم', 'اسم', 'اسمالعميل', 'العميل', 'name', 'fullname', 'customername', 'customer'],
  phone: [
    'رقمالتليفون', 'التليفون', 'تليفون', 'رقمالموبايل', 'الموبايل', 'موبايل', 'رقمالهاتف', 'الهاتف', 'هاتف',
    'رقمالجوال', 'الجوال', 'رقم', 'phone', 'mobile', 'phonenumber', 'tel', 'telephone',
  ],
  birthday: ['تاريخالميلاد', 'الميلاد', 'ميلاد', 'عيدالميلاد', 'تاريخميلاد', 'birthday', 'birthdate', 'dateofbirth', 'dob', 'birth'],
};

function normHeader(h) {
  return toLatinDigits(String(h || ''))
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, '') // التشكيل
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[^a-z0-9؀-ۿ]/g, ''); // نشيل المسافات والرموز
}
const normAliases = Object.fromEntries(
  Object.entries(HEADER_ALIASES).map(([k, arr]) => [k, arr.map(normHeader)])
);

// قيمة الخلية كنص/رقم/تاريخ بسيط
function cellValue(cell) {
  let v = cell.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return v.result instanceof Date ? v.result : v.result ?? '';
    if ('text' in v) return v.text;
    return '';
  }
  return v;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// يحوّل قيمة تاريخ الميلاد لصيغة YYYY-MM-DD أو null
function parseBirthday(v) {
  if (v === '' || v === null || v === undefined) return { value: null };
  let iso = null;

  if (v instanceof Date) {
    if (!isNaN(v)) iso = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  } else if (typeof v === 'number') {
    // رقم تسلسلي من الإكسل
    if (v > 1 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      iso = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
  } else {
    const s = toLatinDigits(v).trim();
    let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) iso = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) iso = `${m[3]}-${pad(m[2])}-${pad(m[1])}`; // يوم/شهر/سنة
  }
  if (iso && isValidBirthday(iso)) return { value: iso };
  return { error: 'تاريخ ميلاد غير صالح' };
}

async function readWorkbook(buffer, ext) {
  const wb = new ExcelJS.Workbook();
  if (ext === '.csv') {
    await wb.csv.read(Readable.from([buffer]));
  } else {
    await wb.xlsx.load(buffer);
  }
  return wb;
}

// بيرجع { rows: [{row, name, phone, birthday, error?}], total }
async function parseCustomersFile(buffer, ext) {
  let wb;
  try {
    wb = await readWorkbook(buffer, ext);
  } catch {
    throw bad('تعذّر قراءة الملف. تأكد إنه ملف Excel (.xlsx) أو CSV سليم.');
  }
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) throw bad('الملف فاضي أو مفيهوش بيانات.');

  // نلاقي أعمدة الاسم/الموبايل/الميلاد من الصف الأول
  const cols = {};
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const h = normHeader(cellValue(cell));
    for (const key of Object.keys(normAliases)) {
      if (cols[key] === undefined && normAliases[key].includes(h)) cols[key] = colNumber;
    }
  });
  if (!cols.name || !cols.phone) {
    throw bad('الصف الأول لازم يحتوي على عناوين الأعمدة: «الاسم» و«رقم التليفون» و«تاريخ الميلاد» (اختياري).');
  }
  if (ws.rowCount - 1 > MAX_ROWS) throw bad(`الملف كبير. الحد الأقصى ${MAX_ROWS} صف.`);

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rawName = cellValue(row.getCell(cols.name));
    const rawPhone = cellValue(row.getCell(cols.phone));
    const rawBirth = cols.birthday ? cellValue(row.getCell(cols.birthday)) : '';
    if ([rawName, rawPhone, rawBirth].every((x) => x === '' || x === null)) continue; // صف فاضي

    const item = { row: r, name: String(rawName).trim(), phone: null, birthday: null };
    if (!item.name) item.error = 'الاسم فاضي';
    else if (item.name.length > 100) item.error = 'الاسم طويل جداً';
    if (!item.error) {
      item.phone = normalizePhone(typeof rawPhone === 'number' ? String(rawPhone) : rawPhone);
      if (!item.phone) item.error = 'رقم الموبايل غير صالح';
    }
    if (!item.error) {
      const b = parseBirthday(rawBirth);
      if (b.error) item.error = b.error;
      else item.birthday = b.value;
    }
    rows.push(item);
  }
  return { rows };
}

// ملف قالب فاضي للتحميل
async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('العملاء', { views: [{ rightToLeft: true }] });
  ws.columns = [
    { header: 'الاسم', key: 'name', width: 30 },
    { header: 'رقم التليفون', key: 'phone', width: 20 },
    { header: 'تاريخ الميلاد', key: 'birthday', width: 18 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getColumn('phone').numFmt = '@'; // نص عشان الصفر في الأول ما يضيعش
  ws.getColumn('birthday').numFmt = 'yyyy-mm-dd';
  return wb.xlsx.writeBuffer();
}

module.exports = { parseCustomersFile, buildTemplate, parseBirthday };
