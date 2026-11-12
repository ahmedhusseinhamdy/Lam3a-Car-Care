// المسار العام الوحيد: بيانات الموقع للزوار — مفيهوش أي بيانات عملاء
const express = require('express');
const db = require('../db');
const { todayStr } = require('../utils/validate');

const router = express.Router();

router.get('/site', (req, res) => {
  const settings = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) settings[r.key] = r.value;

  const services = db
    .prepare('SELECT id, name, price FROM services WHERE active = 1 ORDER BY sort_order, id')
    .all();

  const offers = db
    .prepare(
      `SELECT id, title, description, price, expires_at FROM offers
       WHERE active = 1 AND (expires_at IS NULL OR expires_at >= ?)
       ORDER BY id DESC`
    )
    .all(todayStr());

  const gallery = db.prepare('SELECT id, path, caption FROM gallery ORDER BY id DESC').all();

  res.json({
    business: { name: 'Lam3a Car Care' },
    settings: {
      slogan: settings.slogan || '',
      phone: settings.phone || '',
      whatsapp: settings.whatsapp || '',
      address: settings.address || '',
      working_hours: settings.working_hours || '',
      hero_image: settings.hero_image || '',
    },
    services,
    offers,
    gallery,
  });
});

module.exports = router;
