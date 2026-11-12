// تغيير باسورد أدمن (أو إنشاء أدمن جديد):  npm run reset-admin -- اسم_المستخدم كلمة_المرور_الجديدة
const { assertJwtSecret } = require('../config');
assertJwtSecret();
const { upsertAdmin } = require('../utils/admin');

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('الاستخدام:  npm run reset-admin -- <username> <new-password>');
  process.exit(1);
}
try {
  const { updated } = upsertAdmin(username.trim(), password);
  console.log(updated ? `✔ تم تغيير كلمة مرور "${username}"` : `✔ تم إنشاء الأدمن "${username}"`);
} catch (e) {
  console.error('خطأ:', e.message);
  process.exit(1);
}
