// بيعمل ملف .env بقيم آمنة عشوائية (JWT_SECRET وباسورد الأدمن) لو مش موجود
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

if (fs.existsSync(envPath)) {
  console.log('ملف .env موجود بالفعل — مش هعدّل فيه. امسحه الأول لو عاوز تبدأ من جديد.');
  process.exit(0);
}

// باسورد قوي وسهل النسخ (من غير رموز ملخبطة)
const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const password = Array.from(crypto.randomBytes(14), (b) => alphabet[b % alphabet.length]).join('');
const secret = crypto.randomBytes(48).toString('hex');

let text = fs.readFileSync(examplePath, 'utf8');
text = text.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${secret}`).replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${password}`);
fs.writeFileSync(envPath, text, { mode: 0o600 });

console.log('\n✔ تم إنشاء ملف .env');
console.log('  اسم المستخدم : admin');
console.log(`  كلمة المرور   : ${password}`);
console.log('  احتفظ بكلمة المرور دي، وغيّرها من لوحة التحكم (الإعدادات) بعد أول دخول.\n');
