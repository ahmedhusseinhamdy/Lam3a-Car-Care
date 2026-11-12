(function () {
  'use strict';
  const form = document.getElementById('loginForm');
  const err = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  const eye = document.getElementById('eyeBtn');
  eye.addEventListener('click', () => {
    const show = form.password.type === 'password';
    form.password.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(show));
    eye.setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
    eye.textContent = show ? '🙈' : '👁';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) { err.textContent = 'اكتب اسم المستخدم وكلمة المرور'; return; }

    btn.disabled = true;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || (res.status === 429 ? 'محاولات كتير، جرّب بعد شوية' : 'فشل تسجيل الدخول'));
      location.href = '/admin';
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
})();
