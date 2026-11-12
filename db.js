// قاعدة البيانات SQLite (better-sqlite3) — بتتنشئ لوحدها أول مرة
const Database = require('better-sqlite3');
const { config } = require('./config');

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL UNIQUE,
  birthday   TEXT,                       -- YYYY-MM-DD
  is_demo    INTEGER NOT NULL DEFAULT 0, -- 1 = بيانات تجريبية
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

CREATE TABLE IF NOT EXISTS services (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  price      REAL NOT NULL CHECK (price >= 0),
  active     INTEGER NOT NULL DEFAULT 1,   -- يظهر في الموقع ويتاح في الزيارات
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS visits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  visit_date  TEXT NOT NULL,               -- YYYY-MM-DD
  vehicle     TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  total_price REAL NOT NULL CHECK (total_price >= 0),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_visits_customer ON visits(customer_id);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(visit_date);

-- نسخة من اسم وسعر الخدمة وقت الزيارة (عشان تغيير الأسعار بعدين ما يغيرش الحسابات القديمة)
CREATE TABLE IF NOT EXISTS visit_services (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id     INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  service_id   INTEGER REFERENCES services(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL,
  price        REAL NOT NULL CHECK (price >= 0)
);
CREATE INDEX IF NOT EXISTS idx_vs_visit ON visit_services(visit_id);

CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id   INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  amount     REAL NOT NULL CHECK (amount > 0),
  paid_at    TEXT NOT NULL,                -- YYYY-MM-DD
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_visit ON payments(visit_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(paid_at);

CREATE TABLE IF NOT EXISTS offers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       REAL CHECK (price IS NULL OR price >= 0),
  expires_at  TEXT,                        -- YYYY-MM-DD أو NULL
  active      INTEGER NOT NULL DEFAULT 1,
  is_demo     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- العروض المختارة في الزيارة (نسخة من اسم وسعر العرض وقت الزيارة). جدول جديد بيتنشئ تلقائياً على أي قاعدة بيانات قديمة
CREATE TABLE IF NOT EXISTS visit_offers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id    INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  offer_id    INTEGER REFERENCES offers(id) ON DELETE SET NULL,
  offer_title TEXT NOT NULL,
  price       REAL NOT NULL CHECK (price >= 0)
);
CREATE INDEX IF NOT EXISTS idx_vo_visit ON visit_offers(visit_id);

CREATE TABLE IF NOT EXISTS gallery (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  path       TEXT NOT NULL,                -- مثل /uploads/xxx.jpg
  caption    TEXT NOT NULL DEFAULT '',
  is_demo    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- المخزن: خامات ومستلزمات المغسلة (category: chemicals | consumables | supplies)
CREATE TABLE IF NOT EXISTS inventory_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  supplier     TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL CHECK (category IN ('chemicals', 'consumables', 'supplies')),
  quantity     REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit         TEXT NOT NULL DEFAULT '',
  min_quantity REAL NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  unit_price   REAL NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  is_demo      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory_items(category);

-- علامات الترحيلات اللي اتنفذت (عشان ما تتكررش)
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`);

// ---- قيم افتراضية (أماكن مؤقتة واضحة — عدّلها من لوحة التحكم) ----
const defaultSettings = {
  slogan: 'لمعة تفرق.. لعربيتك وموتوسيكلك',
  phone: '[رقم الموبايل — عدّله من الإعدادات]',
  whatsapp: '',
  address: '[العنوان — عدّله من الإعدادات]',
  working_hours: '[مواعيد العمل — عدّلها من الإعدادات]',
  hero_image: '',
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaultSettings)) insertSetting.run(k, v);

// خدمات افتراضية (الأسعار تقريبية للتجربة — عدّلها من لوحة التحكم)
if (db.prepare('SELECT COUNT(*) AS n FROM services').get().n === 0) {
  const ins = db.prepare('INSERT INTO services (name, price, sort_order) VALUES (?, ?, ?)');
  [
    ['غسيل خارجي', 80],
    ['غسيل داخلي', 100],
    ['غسيل كامل (داخلي + خارجي)', 160],
    ['تلميع', 350],
    ['تنظيف محرك', 120],
    ['غسيل موتوسيكل', 50],
  ].forEach(([n, p], i) => ins.run(n, p, i));
}

// ---- ترحيلات لمرة واحدة على قواعد البيانات القديمة ----
function runOnce(key, fn) {
  if (db.prepare('SELECT 1 FROM meta WHERE key = ?').get(key)) return;
  db.transaction(() => {
    fn();
    db.prepare("INSERT INTO meta (key, value) VALUES (?, '1')").run(key);
  })();
}

// 1) نموذج الخصم: مفيش "متبقي". أي فرق بين الحساب والمدفوع بقى خصم، فالسعر المسجّل = المدفوع
runOnce('discount_model_v1', () => {
  db.prepare(
    'UPDATE visits SET total_price = COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.visit_id = visits.id), 0)'
  ).run();
});

// 2) الهوية الجديدة Lam3a Car Care: نحدّث السلوجن القديم لو ما اتغيّرش
runOnce('brand_lam3a_v1', () => {
  db.prepare("UPDATE settings SET value = ? WHERE key = 'slogan' AND value LIKE '%التيربو%'").run(defaultSettings.slogan);
});

module.exports = db;
