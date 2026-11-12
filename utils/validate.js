// دوال التحقق من البيانات (بتتستخدم في السيرفر — مش بنعتمد على تحقق الفرونت إند)
const { config } = require('../config');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (msg) => new HttpError(400, msg);

// تحويل الأرقام العربية/الفارسية إلى لاتينية
function toLatinDigits(str) {
  return String(str)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

// رقم موبايل مصري: 01[0,1,2,5] + 8 أرقام. بيرجع الرقم بصيغة 01XXXXXXXXX أو null لو غلط
function normalizePhone(input) {
  if (input === null || input === undefined) return null;
  let d = toLatinDigits(input).replace(/\D/g, '');
  if (d.startsWith('0020')) d = '0' + d.slice(4);
  else if (d.startsWith('20') && d.length === 12) d = '0' + d.slice(2);
  else if (d.length === 10 && d.startsWith('1')) d = '0' + d; // الإكسل بيشيل الصفر أحياناً
  return /^01[0125]\d{8}$/.test(d) ? d : null;
}

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: config.timezone }); // YYYY-MM-DD
}

function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// تاريخ ميلاد: صالح، بعد 1900، ومش في المستقبل
function isValidBirthday(s) {
  return isValidDateStr(s) && s >= '1900-01-01' && s <= todayStr();
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// مبلغ مالي: رقم، مش سالب، بحد أقصى معقول
function parseMoney(value, label, { allowZero = true, max = 1000000 } = {}) {
  if (value === '' || value === null || value === undefined) throw bad(`${label} مطلوب`);
  const n = Number(toLatinDigits(value));
  if (!Number.isFinite(n)) throw bad(`${label} لازم يكون رقم`);
  if (n < 0) throw bad(`${label} لا يمكن أن يكون سالباً`);
  if (!allowZero && n === 0) throw bad(`${label} لازم يكون أكبر من صفر`);
  if (n > max) throw bad(`${label} كبير جداً`);
  return round2(n);
}

// نص: بيتقص، وبنتأكد من الطول
function cleanText(value, label, { required = false, max = 200 } = {}) {
  const s = value === null || value === undefined ? '' : String(value).trim();
  if (!s) {
    if (required) throw bad(`${label} مطلوب`);
    return '';
  }
  if (s.length > max) throw bad(`${label} طويل جداً (الحد الأقصى ${max} حرف)`);
  return s;
}

function parseId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw bad('معرّف غير صالح');
  return n;
}

// يتأكد إن الـ body object
function body(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw bad('البيانات المرسلة غير صالحة');
  return req.body;
}

module.exports = {
  HttpError,
  bad,
  toLatinDigits,
  normalizePhone,
  todayStr,
  isValidDateStr,
  isValidBirthday,
  round2,
  parseMoney,
  cleanText,
  parseId,
  body,
};
