const jwt = require('jsonwebtoken');
const db = require('../db');
const { config } = require('../config');

function readToken(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7).trim();
  const cookie = req.headers.cookie;
  if (cookie) {
    for (const part of cookie.split(';')) {
      const i = part.indexOf('=');
      if (i > -1 && part.slice(0, i).trim() === config.cookieName) {
        try {
          return decodeURIComponent(part.slice(i + 1).trim());
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function authenticate(req) {
  const token = readToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    // نتأكد إن الأدمن لسه موجود في الداتابيز
    const admin = db.prepare('SELECT id, username FROM admins WHERE id = ?').get(payload.sub);
    return admin || null;
  } catch {
    return null;
  }
}

// حماية مسارات الـ API
function requireAuth(req, res, next) {
  const admin = authenticate(req);
  if (!admin) return res.status(401).json({ error: 'غير مصرح. سجّل الدخول أولاً.' });
  req.admin = admin;
  next();
}

// حماية صفحات الأدمن (بتحوّل لصفحة الدخول)
function requirePage(req, res, next) {
  const admin = authenticate(req);
  if (!admin) return res.redirect('/admin/login');
  req.admin = admin;
  next();
}

// حماية إضافية من CSRF: لو الطلب بيغيّر بيانات ومعاه Origin، لازم يكون نفس الموقع
function sameOriginForWrites(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      /* ignore */
    }
    if (host !== req.headers.host) return res.status(403).json({ error: 'طلب مرفوض.' });
  }
  next();
}

function signToken(admin) {
  return jwt.sign({ sub: admin.id }, config.jwtSecret, { algorithm: 'HS256', expiresIn: config.jwtExpires });
}

module.exports = { requireAuth, requirePage, sameOriginForWrites, signToken, authenticate };
