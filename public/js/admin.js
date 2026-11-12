// Lam3a Car Care — لوحة التحكم (Vanilla JS). كل داتا من السيرفر بتتعرض بـ textContent، مفيش innerHTML.
(function () {
  'use strict';

  // ======================= أدوات عامة =======================
  const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'open', 'hidden', 'multiple']);

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat(Infinity).forEach((c) => { if (c !== null && c !== undefined && c !== false) el.append(c); });
    return el;
  }
  const view = document.getElementById('view');
  const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const money = (n) => `${nf.format(Number(n) || 0)} ج.م`;
  const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
  const latin = (s) => String(s).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x0660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x06f0);
  const isEgPhone = (s) => /^01[0125]\d{8}$/.test(latin(s).replace(/[\s-]/g, ''));
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const waLink = (phone, text) => `https://wa.me/20${phone.slice(1)}?text=${encodeURIComponent(text)}`;

  async function api(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(url, opts);
    if (res.status === 401) { location.href = '/admin/login'; throw new Error('انتهت الجلسة'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'حصل خطأ، حاول تاني');
    return data;
  }

  function toast(msg, isError) {
    const t = h('div', { class: 'toast' + (isError ? ' error' : ''), role: isError ? 'alert' : 'status', text: msg });
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), isError ? 6000 : 3000);
  }

  // مودال عام. بيرجع { dialog, close }
  function openModal(title, content, { wide = false } = {}) {
    const dialog = h('dialog', { class: 'modal' + (wide ? ' wide' : '') });
    const close = () => { dialog.close(); };
    dialog.append(
      h('div', { class: 'modal-head' }, h('h3', { text: title }), h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'إغلاق', text: '✕', onclick: close })),
      h('div', { class: 'modal-body' }, content)
    );
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    return { dialog, close };
  }

  function confirmBox(message, okText = 'تأكيد الحذف') {
    return new Promise((resolve) => {
      let answer = false;
      const body = h('div', {},
        h('p', { text: message, style: 'margin-bottom:18px' }),
        h('div', { class: 'modal-foot' },
          h('button', { class: 'btn btn-danger', type: 'button', text: okText, onclick: () => { answer = true; m.close(); } }),
          h('button', { class: 'btn btn-ghost', type: 'button', text: 'إلغاء', onclick: () => m.close() })));
      const m = openModal('تأكيد', body);
      m.dialog.addEventListener('close', () => resolve(answer));
    });
  }

  const field = (label, input, hint) => {
    const id = 'f' + Math.random().toString(36).slice(2, 8);
    input.id = id;
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), input, hint ? h('p', { class: 'hint', text: hint }) : null);
  };

  // يشغّل دالة async على زرار مع تعطيله وقت التنفيذ وعرض الأخطاء
  async function run(btn, errBox, fn) {
    if (errBox) errBox.textContent = '';
    if (btn) btn.disabled = true;
    try { await fn(); }
    catch (e) { if (errBox) errBox.textContent = e.message; else toast(e.message, true); }
    finally { if (btn) btn.disabled = false; }
  }

  const table = (heads, rows) =>
    h('div', { class: 'table-wrap' }, h('table', { class: 'responsive' },
      h('thead', {}, h('tr', {}, heads.map((t) => h('th', { text: t })))),
      h('tbody', {}, rows)));
  const td = (label, content, cls) => h('td', { 'data-label': label, class: cls || null }, content);

  // ======================= الداشبورد =======================
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const longDate = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
  const ICON_WA = () => {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '22'); s.setAttribute('height', '22'); s.setAttribute('aria-hidden', 'true');
    const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '12'); c.setAttribute('fill', '#25d366');
    const p = document.createElementNS(ns, 'path'); p.setAttribute('fill', '#fff');
    p.setAttribute('d', 'M12 5.2a6.8 6.8 0 0 0-5.8 10.3L5.2 18.8l3.4-1A6.8 6.8 0 1 0 12 5.2Zm3.9 9.5c-.2.5-1 .9-1.4 1-.4 0-.8.2-2.7-.6-2.3-1-3.7-3.3-3.8-3.4-.1-.2-.9-1.2-.9-2.2s.5-1.5.7-1.7c.2-.2.4-.2.5-.2h.4c.1 0 .3 0 .4.3l.6 1.5c0 .1.1.2 0 .3l-.2.4-.3.3c-.1.1-.2.2-.1.4.1.2.6 1 1.3 1.6.9.8 1.6 1 1.8 1.1.2.1.3.1.4-.1l.6-.7c.1-.2.3-.2.5-.1l1.4.7c.2.1.3.2.4.3 0 .2 0 .6-.2 1Z');
    s.append(c, p);
    return s;
  };

  async function viewDashboard() {
    const d = await api('GET', '/api/dashboard');
    const ts = d.today_stats;

    // ---- بطاقات النهارده ----
    const card = (label, val, cls, onclick) => {
      const kids = [h('small', { text: label }), h('strong', { text: val })];
      return onclick
        ? h('button', { class: 'tcard clickable ' + cls, type: 'button', title: 'اضغط لعرض التفاصيل', onclick }, kids)
        : h('div', { class: 'tcard ' + cls }, kids);
    };
    const todayModal = async (filter) => {
      try {
        const r = await api('GET', '/api/dashboard/today-visits?filter=' + filter);
        const body = r.items.length
          ? table(['العميل', 'الخدمات / العروض', 'المبلغ', 'الخصم'], r.items.map((v) => h('tr', {},
              td('العميل', h('div', {}, h('a', { class: 'row-link', href: `#/customers/${v.customer_id}`, text: v.name, onclick: () => document.querySelector('dialog.modal')?.close() }), h('div', { class: 'muted ltr', text: v.phone }))),
              td('الخدمات / العروض', [v.services, v.offers && '🎁 ' + v.offers].filter(Boolean).join(' — ') || '—'),
              td('المبلغ', h('span', { class: 'paid-ok', text: money(v.amount) })),
              td('الخصم', h('span', { class: v.discount > 0 ? 'debt' : 'muted', text: v.discount > 0 ? money(v.discount) : '—' })))))
          : h('p', { class: 'empty', text: filter === 'discount' ? 'مفيش عملاء استخدموا خصم النهارده' : 'مفيش عملاء النهارده لسه' });
        openModal(filter === 'discount' ? 'عملاء الخصم اليوم' : 'عملاء اليوم', body, { wide: true });
      } catch (e) { toast(e.message, true); }
    };

    const todayPanel = h('section', { class: 'panel' }, h('h2', { text: 'إجمالي اليوم' }),
      h('div', { class: 'tcards' },
        card('إجمالي الإيراد', money(ts.revenue), 'c-lime', () => todayModal('all')),
        card('إجمالي الخصم', money(ts.discount), 'c-amber', () => todayModal('discount')),
        card('إجمالي عدد الخدمات', String(ts.services), 'c-white'),
        card('إجمالي عدد العروض', String(ts.offers), 'c-purple'),
        card('إجمالي عدد العملاء', String(ts.customers), 'c-blue'),
        card('إجمالي عدد المستفيدين من الخصم', String(ts.discount_customers), 'c-amber')));

    // ---- جدول إحصائيات فترة ----
    const statTable = (label, s, amountCls) => table(['المسمى', 'عدد الخدمات', 'عدد العملاء', 'عدد العروض', 'إجمالي الخصم', 'المبلغ'], [h('tr', {},
      td('المسمى', h('strong', { text: label })),
      td('عدد الخدمات', h('strong', { class: 'num', text: String(s.services) })),
      td('عدد العملاء', h('strong', { class: 'num c-blue-t', text: String(s.customers) })),
      td('عدد العروض', h('strong', { class: 'num c-blue-t', text: String(s.offers) })),
      td('إجمالي الخصم', h('strong', { class: 'num c-amber-t', text: money(s.discount) })),
      td('المبلغ', h('strong', { class: 'num ' + amountCls, text: money(s.amount) })))]);

    // ---- الإيراد حسب التاريخ ----
    const from = h('input', { type: 'date', value: d.range.from, 'aria-label': 'من تاريخ', min: '2000-01-01' });
    const to = h('input', { type: 'date', value: d.range.to, 'aria-label': 'إلى تاريخ', min: '2000-01-01' });
    const rangeLen = h('span', { class: 'muted', text: `الفترة: ${d.range.days} يوم` });
    const rangeErr = h('p', { class: 'error-text', role: 'alert' });
    const rangeOut = h('div', {}, statTable('إيراد الفترة المختارة', d.range, 'c-lime-t'));
    let rTok = 0;
    const loadRange = async () => {
      rangeErr.textContent = '';
      if (!from.value || !to.value) { rangeErr.textContent = 'اختار تاريخ البداية والنهاية'; return; }
      if (from.value > to.value) { rangeErr.textContent = 'تاريخ البداية لازم يكون قبل تاريخ النهاية'; return; }
      const t = ++rTok;
      try {
        const s = await api('GET', `/api/dashboard/range?from=${from.value}&to=${to.value}`);
        if (t !== rTok) return;
        rangeLen.textContent = `الفترة: ${s.days} يوم`;
        rangeOut.replaceChildren(statTable('إيراد الفترة المختارة', s, 'c-lime-t'));
      } catch (e) { rangeErr.textContent = e.message; }
    };
    from.addEventListener('change', loadRange); to.addEventListener('change', loadRange);
    const rangePanel = h('section', { class: 'panel' }, h('h2', { text: 'الإيراد حسب التاريخ' }),
      h('div', { class: 'filters' }, h('div', { class: 'frow' }, h('span', { class: 'muted', text: 'اختر التاريخ من' }), from, h('span', { class: 'muted', text: 'إلى' }), to), rangeLen),
      rangeErr, rangeOut);

    // ---- تقرير الإيرادات الشهرية ----
    const monthSel = (val) => { const s = h('select', {}, MONTHS.map((n, i) => h('option', { value: String(i + 1), text: n }))); s.value = String(val); return s; };
    const mFrom = monthSel(d.month); const mTo = monthSel(d.month);
    mFrom.setAttribute('aria-label', 'من شهر'); mTo.setAttribute('aria-label', 'إلى شهر');
    const yearSel = (val) => { const s = h('select', {}, d.years.map((y) => h('option', { value: String(y), text: String(y) }))); s.value = String(val); return s; };
    const mYear = yearSel(d.year); mYear.setAttribute('aria-label', 'السنة');
    const monthLen = h('span', { class: 'muted', text: 'الفترة: 1 شهر' });
    const monthErr = h('p', { class: 'error-text', role: 'alert' });
    const monthLabel = (a, b, y) => (a === b ? `إيراد شهر: ${MONTHS[a - 1]} ${y}` : `إيراد الفترة: ${MONTHS[a - 1]} – ${MONTHS[b - 1]} ${y}`);
    const monthOut = h('div', {}, statTable(monthLabel(d.month, d.month, d.year), d.month_stats, 'c-ok-t'));
    let mTok = 0;
    const loadMonths = async () => {
      monthErr.textContent = '';
      const a = Number(mFrom.value), b = Number(mTo.value), y = Number(mYear.value);
      if (a > b) { monthErr.textContent = 'شهر البداية لازم يكون قبل شهر النهاية'; return; }
      const t = ++mTok;
      try {
        const s = await api('GET', `/api/dashboard/month?year=${y}&from_month=${a}&to_month=${b}`);
        if (t !== mTok) return;
        monthLen.textContent = `الفترة: ${s.months} ${s.months === 1 ? 'شهر' : s.months === 2 ? 'شهر' : 'شهور'}`;
        monthOut.replaceChildren(statTable(monthLabel(a, b, y), s, 'c-ok-t'));
      } catch (e) { monthErr.textContent = e.message; }
    };
    [mFrom, mTo, mYear].forEach((el) => el.addEventListener('change', loadMonths));
    const monthPanel = h('section', { class: 'panel' }, h('h2', { text: 'تقرير الإيرادات الشهرية' }),
      h('div', { class: 'filters' }, h('div', { class: 'frow' }, h('span', { class: 'muted', text: 'اختر الشهر من' }), mFrom, h('span', { class: 'muted', text: 'إلى' }), mTo, h('span', { class: 'muted', text: 'السنة' }), mYear), monthLen),
      monthErr, monthOut);

    // ---- إحصائيات استخدام الخدمات ----
    const uFrom = h('input', { type: 'date', value: d.usage.from, 'aria-label': 'استخدام من تاريخ', min: '2000-01-01' });
    const uTo = h('input', { type: 'date', value: d.usage.to, 'aria-label': 'استخدام إلى تاريخ', min: '2000-01-01' });
    const uMonth = monthSel(d.month); uMonth.setAttribute('aria-label', 'شهر الاستخدام');
    const uYear = yearSel(d.year); uYear.setAttribute('aria-label', 'سنة الاستخدام');
    const usageErr = h('p', { class: 'error-text', role: 'alert' });
    const usageBody = h('tbody', {});
    const fillUsage = (u) => {
      usageBody.replaceChildren(
        ...u.rows.map((r) => h('tr', {}, h('td', {}, h('strong', { text: r.name })), h('td', { class: 'ctr' }, h('span', { class: 'pill-num g', text: String(r.period) })), h('td', { class: 'ctr' }, h('span', { class: 'pill-num b', text: String(r.month) })))),
        h('tr', { class: 'total' }, h('td', { class: 'muted', text: 'الإجمالي' }), h('td', { class: 'ctr' }, h('span', { class: 'pill-num g big', text: String(u.totals.period) })), h('td', { class: 'ctr' }, h('span', { class: 'pill-num b big', text: String(u.totals.month) }))));
    };
    fillUsage(d.usage);
    let uTok = 0;
    const loadUsage = async () => {
      usageErr.textContent = '';
      if (!uFrom.value || !uTo.value) { usageErr.textContent = 'اختار تاريخ البداية والنهاية'; return; }
      if (uFrom.value > uTo.value) { usageErr.textContent = 'تاريخ البداية لازم يكون قبل تاريخ النهاية'; return; }
      const t = ++uTok;
      try {
        const u = await api('GET', `/api/dashboard/service-usage?from=${uFrom.value}&to=${uTo.value}&year=${uYear.value}&month=${uMonth.value}`);
        if (t === uTok) fillUsage(u);
      } catch (e) { usageErr.textContent = e.message; }
    };
    [uFrom, uTo, uMonth, uYear].forEach((el) => el.addEventListener('change', loadUsage));
    const usagePanel = h('section', { class: 'panel' }, h('h2', { text: 'إحصائيات استخدام الخدمات' }), usageErr,
      h('div', { class: 'table-wrap' }, h('table', { class: 'usage' },
        h('thead', {}, h('tr', {},
          h('th', { text: 'الخدمة' }),
          h('th', { class: 'ctr' }, h('div', { class: 'th-label', text: 'عدد الاستخدام' }), h('div', { class: 'frow' }, h('span', { text: 'من' }), uFrom, h('span', { text: 'إلى' }), uTo)),
          h('th', { class: 'ctr' }, h('div', { class: 'th-label', text: 'عدد استخدام الشهر' }), h('div', { class: 'frow' }, uMonth, uYear)))),
        usageBody)));

    // ---- عملاء متوقفون عن الزيارة ----
    const inactive = d.inactive.length
      ? h('ul', { class: 'list inactive' }, d.inactive.map((c) => h('li', {},
          h('div', {}, h('div', {}, h('a', { class: 'row-link', href: `#/customers/${c.id}`, text: c.name }), ' ', h('span', { class: 'muted ltr', text: c.phone })),
            h('div', { class: 'muted small', text: 'آخر زيارة: ' + longDate(c.last_visit) })),
          h('a', { class: 'wa-btn', target: '_blank', rel: 'noopener', href: waLink(c.phone, `أهلاً ${c.name} 👋 وحشتنا في Lam3a Car Care! لمعة تفرق لعربيتك — ننتظر زيارتك قريب 🚗✨`) }, ICON_WA(), h('span', { text: 'متابعة العملاء' })))))
      : h('p', { class: 'empty', text: 'مفيش عملاء متوقفين عن الزيارة 👌' });
    const inactivePanel = h('section', { class: 'panel' }, h('h2', { class: 'h-inline' }, h('span', { text: 'عملاء متوقفون عن الزيارة' }), h('span', { class: 'ico-warn', 'aria-hidden': 'true', text: '🚶' })),
      h('p', { class: 'hint', text: 'العملاء اللي آخر زيارة ليهم من أسبوعين أو أكتر' }), inactive);

    // ---- أعياد الميلاد (في آخر الصفحة) ----
    const bdItem = (c, showDay) =>
      h('li', {},
        h('div', {}, h('a', { class: 'row-link', href: `#/customers/${c.id}`, text: c.name }),
          h('div', { class: 'muted', text: (showDay ? `يوم ${c.day} — ` : '') + `${c.age} سنة` })),
        h('a', { class: 'btn btn-sm btn-ghost', target: '_blank', rel: 'noopener', href: waLink(c.phone, `كل سنة وانت طيب يا ${c.name} 🎉 من فريق Lam3a Car Care`), text: '🎉 تهنئة واتساب' }));
    const monthOthers = d.birthdays_month.filter((c) => !c.is_today);
    const bdPanel = h('section', { class: 'panel' }, h('h2', { text: '🎂 أعياد ميلاد النهارده وهذا الشهر' }),
      h('div', { class: 'split' },
        h('div', {}, h('h3', { text: `النهارده (${d.birthdays_today.length})`, style: 'margin-bottom:6px' }),
          d.birthdays_today.length ? h('ul', { class: 'list' }, d.birthdays_today.map((c) => bdItem(c, false))) : h('p', { class: 'empty', text: 'مفيش أعياد ميلاد النهارده' })),
        h('div', {}, h('h3', { text: `باقي الشهر (${monthOthers.length})`, style: 'margin-bottom:6px' }),
          monthOthers.length ? h('ul', { class: 'list' }, monthOthers.map((c) => bdItem(c, true))) : h('p', { class: 'empty', text: 'مفيش أعياد ميلاد تانية الشهر ده' }))));

    view.replaceChildren(todayPanel, rangePanel, monthPanel, usagePanel, inactivePanel, bdPanel);
  }

  // ======================= العملاء =======================
  const custState = { q: '', page: 1 };

  async function viewCustomers() {
    const search = h('input', { type: 'search', placeholder: 'ابحث بالاسم أو رقم التليفون', 'aria-label': 'بحث', value: custState.q, maxlength: '60' });
    const listBox = h('div', {});
    let timer;

    // تصدير كل العملاء (مش الصفحة الحالية) وتحميل الملف مباشرة
    const exportBtn = h('button', { class: 'btn btn-ghost', type: 'button', text: '📤 تصدير إلى Excel' });
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      try {
        const res = await fetch('/api/customers/export', { credentials: 'same-origin' });
        if (res.status === 401) { location.href = '/admin/login'; return; }
        if (!res.ok) throw new Error('تعذّر تصدير الملف');
        const blob = await res.blob();
        const m = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
        const a = h('a', { href: URL.createObjectURL(blob), download: m ? m[1] : 'lam3a-customers.xlsx' });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast('تم تصدير العملاء');
      } catch (e) { toast(e.message, true); }
      finally { exportBtn.disabled = false; }
    });

    async function load() {
      const p = new URLSearchParams({ q: custState.q, page: custState.page, limit: 20 });
      const d = await api('GET', '/api/customers?' + p);
      listBox.replaceChildren();
      if (!d.items.length) { listBox.append(h('p', { class: 'empty', text: custState.q ? 'مفيش نتائج للبحث ده' : 'لسه مفيش عملاء. ضيف عميل أو استورد من Excel.' })); return; }
      listBox.append(table(['الاسم', 'رقم التليفون', 'تاريخ الميلاد', 'تاريخ التسجيل', 'الزيارات', 'الخصم', ''],
        d.items.map((c) => h('tr', {},
          td('الاسم', h('a', { class: 'row-link', href: `#/customers/${c.id}`, text: c.name })),
          td('رقم التليفون', h('span', { class: 'ltr', text: c.phone })),
          td('تاريخ الميلاد', fmtDate(c.birthday)),
          td('تاريخ التسجيل', fmtDate(c.registered_at)),
          td('الزيارات', String(c.visits_count)),
          td('الخصم', h('span', { class: c.total_discount > 0 ? 'debt' : 'muted', text: c.total_discount > 0 ? money(c.total_discount) : '—' })),
          td('', [
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'تعديل', onclick: () => customerForm(c, () => load()) }),
            h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'حذف', onclick: () => deleteCustomer(c, () => load()) }),
          ], 'actions')))));
      listBox.append(h('div', { class: 'pager' },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'السابق', disabled: d.page <= 1, onclick: () => { custState.page--; load(); } }),
        h('span', { class: 'muted', text: `صفحة ${d.page} من ${d.pages} — ${d.total} عميل` }),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'التالي', disabled: d.page >= d.pages, onclick: () => { custState.page++; load(); } })));
    }

    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { custState.q = search.value.trim(); custState.page = 1; load().catch((e) => toast(e.message, true)); }, 300);
    });

    view.replaceChildren(
      h('div', { class: 'toolbar' },
        h('div', { class: 'grow' }, search),
        h('button', { class: 'btn btn-lime', type: 'button', text: '+ إضافة عميل', onclick: () => customerForm(null, () => load()) }),
        h('button', { class: 'btn btn-ghost', type: 'button', text: '📥 استيراد من Excel', onclick: () => importDialog(() => load()) }),
        exportBtn),
      h('section', { class: 'panel' }, listBox));
    await load();
  }

  async function deleteCustomer(c, after) {
    if (!(await confirmBox(`هتحذف العميل "${c.name}" وكل زياراته ومدفوعاته نهائياً. متأكد؟`))) return;
    try { await api('DELETE', `/api/customers/${c.id}`); toast('تم حذف العميل'); after(); }
    catch (e) { toast(e.message, true); }
  }

  function customerForm(c, after) {
    const name = h('input', { type: 'text', maxlength: '100', required: true, value: c ? c.name : '' });
    const phone = h('input', { type: 'tel', inputmode: 'numeric', maxlength: '20', required: true, placeholder: '01012345678', value: c ? c.phone : '' });
    const birthday = h('input', { type: 'date', max: todayISO(), min: '1900-01-01', value: c && c.birthday ? c.birthday : '' });
    const err = h('p', { class: 'error-text', role: 'alert' });
    const save = h('button', { class: 'btn btn-lime', type: 'submit', text: 'حفظ' });
    const form = h('form', { novalidate: true },
      field('الاسم', name), field('رقم الموبايل', phone, 'رقم مصري: 010 / 011 / 012 / 015 + 8 أرقام'), field('تاريخ الميلاد (اختياري)', birthday), err,
      h('div', { class: 'modal-foot' }, save));
    const m = openModal(c ? 'تعديل عميل' : 'إضافة عميل', form);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!name.value.trim()) { err.textContent = 'الاسم مطلوب'; return; }
      if (!isEgPhone(phone.value)) { err.textContent = 'رقم الموبايل غير صالح'; return; }
      run(save, err, async () => {
        const payload = { name: name.value.trim(), phone: latin(phone.value).replace(/[\s-]/g, ''), birthday: birthday.value || null };
        if (c) await api('PUT', `/api/customers/${c.id}`, payload); else await api('POST', '/api/customers', payload);
        toast('تم الحفظ'); m.close(); after();
      });
    });
    name.focus();
  }

  // ---- استيراد Excel ----
  function importDialog(after) {
    const file = h('input', { type: 'file', accept: '.xlsx,.csv' });
    const err = h('p', { class: 'error-text', role: 'alert' });
    const result = h('div', {});
    const previewBtn = h('button', { class: 'btn', type: 'button', text: 'معاينة' });
    const commitBtn = h('button', { class: 'btn btn-lime', type: 'button', text: 'استيراد الصالح', hidden: true });

    const send = (mode) => {
      if (!file.files[0]) throw new Error('اختار ملف الإكسل الأول');
      const fd = new FormData();
      fd.append('mode', mode);
      fd.append('file', file.files[0]);
      return api('POST', '/api/customers/import', fd);
    };
    const problems = (rows) => rows.length
      ? h('div', {}, h('p', { class: 'muted', text: 'صفوف هيتم تخطيها:' }),
          table(['صف', 'الاسم', 'الموبايل', 'السبب'], rows.slice(0, 50).map((r) => h('tr', {}, td('صف', String(r.row)), td('الاسم', r.name || '—'), td('الموبايل', h('span', { class: 'ltr', text: r.phone || '—' })), td('السبب', r.error || '')))))
      : null;

    previewBtn.addEventListener('click', () => run(previewBtn, err, async () => {
      const d = await send('preview');
      result.replaceChildren(
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('small', { text: 'إجمالي الصفوف' }), h('strong', { text: String(d.summary.total) })),
          h('div', { class: 'stat blue' }, h('small', { text: 'عملاء جدد صالحين' }), h('strong', { text: String(d.summary.new) })),
          h('div', { class: 'stat warn' }, h('small', { text: 'هيتم تخطيهم' }), h('strong', { text: String(d.summary.skipped) }))),
        problems(d.rows.filter((r) => r.status !== 'new')));
      commitBtn.hidden = d.summary.new === 0;
    }));
    commitBtn.addEventListener('click', () => run(commitBtn, err, async () => {
      const d = await send('commit');
      toast(`تم استيراد ${d.imported} عميل (تخطي ${d.skipped})`);
      m.close(); after();
    }));
    file.addEventListener('change', () => { commitBtn.hidden = true; result.replaceChildren(); });

    const body = h('div', {},
      h('p', { class: 'hint', text: 'الملف لازم يحتوي عناوين: الاسم، رقم التليفون، تاريخ الميلاد (اختياري). الأرقام المكررة والغلط بتتخطى.' }),
      h('p', {}, h('a', { href: '/api/customers/template', text: '⬇️ تحميل قالب Excel جاهز' })),
      field('ملف Excel (.xlsx) أو CSV', file), err, h('div', { class: 'modal-foot' }, previewBtn, commitBtn), result);
    const m = openModal('استيراد عملاء من Excel', body, { wide: true });
  }

  // ======================= صفحة عميل =======================
  async function viewCustomer(id) {
    const d = await api('GET', `/api/customers/${id}`);
    const c = d.customer;
    const reload = () => viewCustomer(id).catch((e) => toast(e.message, true));

    const visitRows = d.visits.map((v) =>
      h('tr', {},
        td('التاريخ', fmtDate(v.visit_date)),
        td('الخدمة', h('div', {},
          v.services.map((s) => h('span', { class: 'chip', text: s.service_name })),
          (v.offers || []).map((o) => h('span', { class: 'chip offer', text: '🎁 ' + o.offer_title })),
          v.vehicle ? h('div', { class: 'muted', text: '🚘 ' + v.vehicle }) : null,
          v.notes ? h('div', { class: 'muted', text: '📝 ' + v.notes }) : null,
          v.paid > 0 ? h('div', {}, h('span', { class: 'chip pay', text: `دفع ${money(v.paid)}` })) : null)),
        td('السعر', money(v.subtotal)),
        td('المدفوع', h('span', { class: 'paid-ok', text: money(v.paid) })),
        td('الخصم', h('span', { class: v.discount > 0 ? 'debt' : 'muted', text: v.discount > 0 ? money(v.discount) : '—' })),
        td('', [
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'تعديل', onclick: () => visitForm(c.id, v, reload) }),
          h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'حذف', onclick: async () => {
            if (!(await confirmBox(`تحذف زيارة ${fmtDate(v.visit_date)}؟`))) return;
            try { await api('DELETE', `/api/visits/${v.id}`); toast('تم حذف الزيارة'); reload(); } catch (e) { toast(e.message, true); }
          } }),
        ], 'actions')));

    view.replaceChildren(
      h('p', {}, h('a', { href: '#/customers', text: '→ كل العملاء' })),
      h('section', { class: 'panel' },
        h('div', { class: 'cust-head' },
          h('div', {}, h('h2', { text: c.name }),
            h('div', { class: 'cust-meta' }, h('span', { class: 'ltr', text: '📞 ' + c.phone }), h('span', { text: '🎂 ' + fmtDate(c.birthday) }))),
          h('div', { class: 'toolbar' },
            h('button', { class: 'btn btn-lime', type: 'button', text: '+ إضافة زيارة', onclick: () => visitForm(c.id, null, reload) }),
            h('button', { class: 'btn btn-ghost', type: 'button', text: 'تعديل', onclick: () => customerForm(c, reload) }),
            h('button', { class: 'btn btn-danger', type: 'button', text: 'حذف العميل', onclick: () => deleteCustomer(c, () => { location.hash = '#/customers'; }) })))),
      h('div', { class: 'tcards three' },
        h('div', { class: 'tcard c-blue' }, h('small', { text: 'عدد الزيارات' }), h('strong', { text: String(d.totals.visits) })),
        h('div', { class: 'tcard c-ok' }, h('small', { text: 'إجمالي اللي دفعه' }), h('strong', { text: money(d.totals.paid) })),
        h('div', { class: 'tcard c-amber' }, h('small', { text: 'إجمالي الخصم' }), h('strong', { text: money(d.totals.discount) }))),
      h('section', { class: 'panel' }, h('h2', { text: 'سجل الزيارات' }),
        d.visits.length ? table(['التاريخ', 'الخدمة', 'السعر', 'المدفوع', 'الخصم', ''], visitRows) : h('p', { class: 'empty', text: 'مفيش زيارات لسه.' })));
    document.getElementById('pageTitle').textContent = c.name;
  }

  // ---- نموذج الزيارة (خدمات و/أو عروض + مدفوع + خصم) ----
  // السعر = إجمالي الخدمات والعروض (ممكن تعدّله). المدفوع الافتراضي = السعر. الخصم = إجمالي الخدمات والعروض - المدفوع.
  async function visitForm(customerId, visit, after) {
    let allServices, allOffers;
    try { [allServices, allOffers] = await Promise.all([api('GET', '/api/services'), api('GET', '/api/offers')]); }
    catch (e) { return toast(e.message, true); }
    const today = todayISO();
    const activeServices = allServices.filter((s) => s.active);
    // العروض المتاحة: نشطة، ليها سعر، ومش منتهية
    const activeOffers = allOffers
      .filter((o) => o.active && o.price !== null && (!o.expires_at || o.expires_at >= today))
      .map((o) => ({ id: o.id, name: o.title, price: o.price }));

    // في التعديل: العناصر القديمة بسعرها المسجّل + المتاحة حالياً
    const serviceOpts = visit
      ? [...visit.services.filter((s) => s.service_id).map((s) => ({ id: s.service_id, name: s.service_name, price: s.price })),
         ...activeServices.filter((s) => !visit.services.some((x) => x.service_id === s.id))]
      : activeServices;
    const offerOpts = visit
      ? [...visit.offers.filter((o) => o.offer_id).map((o) => ({ id: o.offer_id, name: o.offer_title, price: o.price })),
         ...activeOffers.filter((o) => !visit.offers.some((x) => x.offer_id === o.id))]
      : activeOffers;
    if (!serviceOpts.length && !offerOpts.length) return toast('ضيف خدمة أو عرض واحد على الأقل الأول', true);

    const selectedServices = new Set(visit ? visit.services.map((s) => s.service_id).filter(Boolean) : []);
    const selectedOffers = new Set(visit ? visit.offers.map((o) => o.offer_id).filter(Boolean) : []);

    const date = h('input', { type: 'date', max: todayISO(), min: '2000-01-01', value: visit ? visit.visit_date : todayISO(), required: true });
    const vehicle = h('input', { type: 'text', maxlength: '80', placeholder: 'مثال: أ ب ج 1234 / كورولا بيضاء', value: visit ? visit.vehicle : '' });
    const notes = h('textarea', { maxlength: '500' }); notes.value = visit ? visit.notes : '';
    const price = h('input', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', required: true });
    const paid = h('input', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', required: true });
    const subEl = h('strong', { text: '0' }), discEl = h('strong', { text: '0' });
    const err = h('p', { class: 'error-text', role: 'alert' });
    const summary = h('span', {});
    let priceTouched = !!visit, paidTouched = !!visit;

    const sumAll = () => round2(
      serviceOpts.filter((o) => selectedServices.has(o.id)).reduce((a, o) => a + o.price, 0) +
      offerOpts.filter((o) => selectedOffers.has(o.id)).reduce((a, o) => a + o.price, 0));

    function recalc() {
      const subtotal = sumAll();
      const pd = Number(paid.value) || 0;
      subEl.textContent = money(subtotal);
      discEl.textContent = money(Math.max(0, round2(subtotal - pd)));
      summary.textContent = selectedServices.size ? `تم اختيار ${selectedServices.size} خدمة` : 'اختار الخدمات...';
    }
    function onSelectionChange() {
      err.textContent = '';
      if (!priceTouched) price.value = sumAll();
      if (!paidTouched) paid.value = price.value;
      recalc();
    }

    // الخدمات: اختيار متعدد
    const serviceChecks = serviceOpts.map((o) => {
      const cb = h('input', { type: 'checkbox', checked: selectedServices.has(o.id) });
      cb.addEventListener('change', () => { if (cb.checked) selectedServices.add(o.id); else selectedServices.delete(o.id); onSelectionChange(); });
      return h('label', {}, cb, h('span', { text: o.name }), h('span', { class: 'p', text: money(o.price) }));
    });

    // العروض: اختيار عرض واحد (ممكن تلغيه بالضغط تاني)
    const offerInputs = [];
    const offerPills = offerOpts.map((o) => {
      const cb = h('input', { type: 'checkbox', class: 'radio-like', checked: selectedOffers.has(o.id) });
      offerInputs.push([o.id, cb]);
      cb.addEventListener('change', () => {
        selectedOffers.clear();
        if (cb.checked) { selectedOffers.add(o.id); offerInputs.forEach(([id, other]) => { if (id !== o.id) other.checked = false; }); }
        onSelectionChange();
      });
      return h('label', { class: 'pill' }, cb, h('span', { text: o.name }), h('span', { class: 'p', text: money(o.price) }));
    });
    const offersBox = h('div', { class: 'offers-box' },
      h('div', { class: 'offers-title' }, h('span', { class: 'ico', 'aria-hidden': 'true', text: '🎁' }),
        h('div', {}, h('strong', { text: 'العروض' }), h('p', { class: 'hint', text: 'اختر عرضاً من العروض المتاحة' }))),
      offerPills.length ? h('div', { class: 'offer-pills' }, offerPills) : h('p', { class: 'hint', text: 'مفيش عروض متاحة حالياً' }));

    price.value = visit ? visit.subtotal : 0;
    paid.value = visit ? visit.paid : 0;
    price.addEventListener('input', () => { priceTouched = true; if (!paidTouched) paid.value = price.value; recalc(); });
    paid.addEventListener('input', () => { paidTouched = true; recalc(); });

    const save = h('button', { class: 'btn btn-lime', type: 'submit', text: 'حفظ الزيارة' });
    const form = h('form', { novalidate: true },
      field('التاريخ', date),
      h('div', { class: 'field' }, h('label', { text: 'الخدمات (ممكن أكتر من واحدة)' }),
        h('details', { class: 'multi' }, h('summary', {}, summary),
          h('div', { class: 'opts' }, serviceChecks.length ? serviceChecks : h('p', { class: 'hint', text: 'مفيش خدمات متاحة' })))),
      offersBox,
      h('div', { class: 'calc' }, h('span', { text: 'إجمالي الخدمات والعروض' }), subEl),
      h('div', { class: 'grid-2' }, field('السعر', price), field('المدفوع', paid, 'لو دفع أقل من السعر، الفرق بيتسجّل خصم')),
      h('div', { class: 'calc' }, h('span', { text: 'الخصم' }), discEl),
      field('رقم العربية أو نوعها (اختياري)', vehicle),
      field('ملاحظات (اختياري)', notes), err, h('div', { class: 'modal-foot' }, save));
    const m = openModal(visit ? 'تعديل زيارة' : 'إضافة زيارة', form);
    recalc();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = Number(price.value), pd = Number(paid.value);
      // الشرط: خدمات OR عروض لازم واحد على الأقل
      if (!selectedServices.size && !selectedOffers.size) { err.textContent = 'يرجى اختيار خدمة واحدة أو عرض واحد على الأقل'; err.scrollIntoView({ block: 'center' }); return; }
      if (price.value === '' || !Number.isFinite(p) || p < 0) { err.textContent = 'السعر لازم يكون رقم موجب'; return; }
      if (paid.value === '' || !Number.isFinite(pd) || pd < 0) { err.textContent = 'المبلغ المدفوع لازم يكون رقم موجب'; return; }
      if (pd > p) { err.textContent = 'المبلغ المدفوع لا يمكن أن يزيد عن السعر'; return; }
      run(save, err, async () => {
        const payload = { visit_date: date.value, vehicle: vehicle.value.trim(), notes: notes.value.trim(),
          service_ids: [...selectedServices], offer_ids: [...selectedOffers], total_price: p, paid: pd };
        if (visit) await api('PUT', `/api/visits/${visit.id}`, payload);
        else await api('POST', `/api/customers/${customerId}/visits`, payload);
        toast('تم حفظ الزيارة'); m.close(); after();
      });
    });
  }

  // ======================= الخدمات =======================
  async function viewServices() {
    const list = await api('GET', '/api/services');
    const reload = () => viewServices().catch((e) => toast(e.message, true));
    view.replaceChildren(
      h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-lime', type: 'button', text: '+ إضافة خدمة', onclick: () => serviceForm(null, reload) })),
      h('section', { class: 'panel' },
        list.length ? table(['الخدمة', 'السعر الافتراضي', 'الحالة', ''], list.map((s) => h('tr', {},
          td('الخدمة', h('strong', { text: s.name })),
          td('السعر الافتراضي', money(s.price)),
          td('الحالة', h('span', { class: 'badge ' + (s.active ? 'ok' : 'off'), text: s.active ? 'ظاهرة' : 'متوقفة' })),
          td('', [
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'تعديل', onclick: () => serviceForm(s, reload) }),
            h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'حذف', onclick: async () => {
              if (!(await confirmBox(`تحذف خدمة "${s.name}"؟ الزيارات القديمة هتفضل محتفظة باسمها وسعرها.`))) return;
              try { await api('DELETE', `/api/services/${s.id}`); toast('تم الحذف'); reload(); } catch (e) { toast(e.message, true); }
            } })], 'actions')))) : h('p', { class: 'empty', text: 'مفيش خدمات.' })));
  }

  function serviceForm(s, after) {
    const name = h('input', { type: 'text', maxlength: '80', required: true, value: s ? s.name : '' });
    const price = h('input', { type: 'number', min: '0', step: '0.5', inputmode: 'decimal', required: true, value: s ? String(s.price) : '' });
    const active = h('input', { type: 'checkbox', checked: s ? !!s.active : true });
    const err = h('p', { class: 'error-text', role: 'alert' });
    const save = h('button', { class: 'btn btn-lime', type: 'submit', text: 'حفظ' });
    const form = h('form', { novalidate: true }, field('اسم الخدمة', name), field('السعر (ج.م)', price),
      h('label', { style: 'display:flex;gap:8px;align-items:center' }, active, ' تظهر في الموقع وتتاح في الزيارات'), err, h('div', { class: 'modal-foot' }, save));
    const m = openModal(s ? 'تعديل خدمة' : 'إضافة خدمة', form);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = Number(price.value);
      if (!name.value.trim()) { err.textContent = 'اسم الخدمة مطلوب'; return; }
      if (price.value === '' || !Number.isFinite(p) || p < 0) { err.textContent = 'السعر لازم يكون رقم موجب'; return; }
      run(save, err, async () => {
        const payload = { name: name.value.trim(), price: p, active: active.checked };
        if (s) await api('PUT', `/api/services/${s.id}`, payload); else await api('POST', '/api/services', payload);
        toast('تم الحفظ'); m.close(); after();
      });
    });
  }

  // ======================= العروض =======================
  async function viewOffers() {
    const list = await api('GET', '/api/offers');
    const reload = () => viewOffers().catch((e) => toast(e.message, true));
    const today = todayISO();
    view.replaceChildren(
      h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-lime', type: 'button', text: '+ إضافة عرض', onclick: () => offerForm(null, reload) })),
      h('section', { class: 'panel' },
        list.length ? table(['العرض', 'السعر', 'ينتهي', 'الحالة', ''], list.map((o) => {
          const expired = o.expires_at && o.expires_at < today;
          return h('tr', {},
            td('العرض', h('div', {}, h('strong', { text: o.title }), o.is_demo ? h('span', { class: 'demo-tag', text: 'تجريبي' }) : null, o.description ? h('div', { class: 'muted', text: o.description }) : null)),
            td('السعر', o.price === null ? '—' : money(o.price)),
            td('ينتهي', fmtDate(o.expires_at)),
            td('الحالة', h('span', { class: 'badge ' + (expired ? 'warn' : o.active ? 'ok' : 'off'), text: expired ? 'منتهي' : o.active ? 'ظاهر' : 'مخفي' })),
            td('', [
              h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'تعديل', onclick: () => offerForm(o, reload) }),
              h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'حذف', onclick: async () => {
                if (!(await confirmBox(`تحذف عرض "${o.title}"؟`))) return;
                try { await api('DELETE', `/api/offers/${o.id}`); toast('تم الحذف'); reload(); } catch (e) { toast(e.message, true); }
              } })], 'actions'));
        })) : h('p', { class: 'empty', text: 'مفيش عروض.' })));
  }

  function offerForm(o, after) {
    const title = h('input', { type: 'text', maxlength: '100', required: true, value: o ? o.title : '' });
    const desc = h('textarea', { maxlength: '500' }); desc.value = o ? o.description : '';
    const price = h('input', { type: 'number', min: '0', step: '0.5', inputmode: 'decimal', value: o && o.price !== null ? String(o.price) : '' });
    const expires = h('input', { type: 'date', min: '2000-01-01', value: o && o.expires_at ? o.expires_at : '' });
    const active = h('input', { type: 'checkbox', checked: o ? !!o.active : true });
    const err = h('p', { class: 'error-text', role: 'alert' });
    const save = h('button', { class: 'btn btn-lime', type: 'submit', text: 'حفظ' });
    const form = h('form', { novalidate: true }, field('عنوان العرض', title), field('الوصف', desc),
      h('div', { class: 'grid-2' }, field('سعر العرض (اختياري)', price), field('تاريخ الانتهاء (اختياري)', expires)),
      h('label', { style: 'display:flex;gap:8px;align-items:center' }, active, ' العرض ظاهر في الموقع'), err, h('div', { class: 'modal-foot' }, save));
    const m = openModal(o ? 'تعديل عرض' : 'إضافة عرض', form);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!title.value.trim()) { err.textContent = 'عنوان العرض مطلوب'; return; }
      if (price.value !== '' && (!Number.isFinite(Number(price.value)) || Number(price.value) < 0)) { err.textContent = 'السعر لازم يكون رقم موجب'; return; }
      run(save, err, async () => {
        const payload = { title: title.value.trim(), description: desc.value.trim(), price: price.value === '' ? null : Number(price.value), expires_at: expires.value || null, active: active.checked };
        if (o) await api('PUT', `/api/offers/${o.id}`, payload); else await api('POST', '/api/offers', payload);
        toast('تم الحفظ'); m.close(); after();
      });
    });
  }

  // ======================= المعرض =======================
  async function viewGallery() {
    const [imgs, settings] = await Promise.all([api('GET', '/api/gallery'), api('GET', '/api/settings')]);
    const reload = () => viewGallery().catch((e) => toast(e.message, true));
    const files = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true });
    const caption = h('input', { type: 'text', maxlength: '120', placeholder: 'وصف الصور (اختياري)' });
    const err = h('p', { class: 'error-text', role: 'alert' });
    const up = h('button', { class: 'btn btn-lime', type: 'submit', text: 'رفع' });
    const form = h('form', {}, h('div', { class: 'grid-2' }, field('اختار صور (JPG / PNG / WEBP — حد أقصى 5 ميجا للصورة)', files), field('وصف', caption)), err, up);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!files.files.length) { err.textContent = 'اختار صورة واحدة على الأقل'; return; }
      if (files.files.length > 10) { err.textContent = 'الحد الأقصى 10 صور في المرة'; return; }
      for (const f of files.files) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { err.textContent = 'الملفات المسموحة: JPG أو PNG أو WEBP'; return; }
        if (f.size > 5 * 1024 * 1024) { err.textContent = `الصورة "${f.name}" أكبر من 5 ميجا`; return; }
      }
      run(up, err, async () => {
        const fd = new FormData();
        fd.append('caption', caption.value.trim());
        for (const f of files.files) fd.append('images', f);
        const r = await api('POST', '/api/gallery', fd);
        toast(`تم رفع ${r.count} صورة`); reload();
      });
    });

    view.replaceChildren(
      h('section', { class: 'panel' }, h('h2', { text: 'رفع صور جديدة' }), form),
      h('section', { class: 'panel' }, h('h2', { text: `الصور (${imgs.length})` }),
        imgs.length ? h('div', { class: 'gal-grid' }, imgs.map((g) => {
          const isHero = settings.hero_image === g.path;
          return h('div', { class: 'gal-item' }, h('img', { src: g.path, alt: g.caption || 'صورة', loading: 'lazy' }),
            h('div', { class: 'info' },
              h('div', {}, g.caption || h('span', { class: 'muted', text: 'بدون وصف' }), g.is_demo ? h('span', { class: 'demo-tag', text: 'تجريبي' }) : null, isHero ? h('span', { class: 'badge ok', text: ' خلفية Hero' }) : null),
              h('div', { class: 'btns' },
                h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: isHero ? 'إلغاء كخلفية' : 'خلفية للـ Hero', onclick: async () => {
                  try { if (isHero) await api('DELETE', '/api/gallery/hero'); else await api('POST', `/api/gallery/${g.id}/hero`); toast('تم'); reload(); } catch (e) { toast(e.message, true); }
                } }),
                h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'حذف', onclick: async () => {
                  if (!(await confirmBox('تحذف الصورة دي؟'))) return;
                  try { await api('DELETE', `/api/gallery/${g.id}`); toast('تم الحذف'); reload(); } catch (e) { toast(e.message, true); }
                } }))));
        })) : h('p', { class: 'empty', text: 'مفيش صور لسه.' })));
  }

  // ======================= المخزن =======================
  const INV_CATS = { chemicals: 'منظفات وكيماويات', consumables: 'مستهلكات', supplies: 'مستلزمات ومعدات' };
  const INV_STATUS = { ok: ['متوفر', 'ok'], low: ['منخفض', 'warn'], out: ['نفدت', 'bad'] };
  const invState = { category: '', status: '', q: '' };

  async function viewInventory() {
    const tabsBox = h('div', { class: 'tabs', role: 'tablist' });
    const search = h('input', { type: 'search', placeholder: 'ابحث بالاسم أو الكود', 'aria-label': 'بحث في المخزن', value: invState.q, maxlength: '60' });
    const statusSel = h('select', { 'aria-label': 'الحالة' }, h('option', { value: '', text: 'كل الحالات' }), h('option', { value: 'ok', text: 'متوفر' }), h('option', { value: 'low', text: 'منخفض' }), h('option', { value: 'out', text: 'نفدت' }));
    statusSel.value = invState.status;
    const cardsBox = h('div', { class: 'tcards five' });
    const listBox = h('div', {});
    let tok = 0, timer;

    const reload = () => load().catch((e) => toast(e.message, true));

    async function load() {
      const t = ++tok;
      const p = new URLSearchParams({ category: invState.category, status: invState.status, q: invState.q });
      const d = await api('GET', '/api/inventory?' + p);
      if (t !== tok) return;
      const s = d.summary;
      cardsBox.replaceChildren(
        h('div', { class: 'tcard c-blue' }, h('small', { text: 'منظفات وكيماويات' }), h('strong', { text: String(s.chemicals) })),
        h('div', { class: 'tcard c-purple' }, h('small', { text: 'مستهلكات' }), h('strong', { text: String(s.consumables) })),
        h('div', { class: 'tcard c-white' }, h('small', { text: 'مستلزمات ومعدات' }), h('strong', { text: String(s.supplies) })),
        h('div', { class: 'tcard c-lime' }, h('small', { text: 'إجمالي قيمة المخزون' }), h('strong', { text: money(s.total_value) })),
        h('div', { class: 'tcard ' + (s.alerts ? 'c-amber' : 'c-ok') }, h('small', { text: 'تنبيهات المخزون' }), h('strong', { text: String(s.alerts) })));
      tabsBox.replaceChildren(...[['', 'الكل'], ...Object.entries(INV_CATS)].map(([k, label]) =>
        h('button', { class: 'tab' + (invState.category === k ? ' active' : ''), type: 'button', role: 'tab', 'aria-selected': String(invState.category === k), text: label,
          onclick: () => { invState.category = k; reload(); } })));
      listBox.replaceChildren();
      if (!d.items.length) { listBox.append(h('p', { class: 'empty', text: 'مفيش أصناف مطابقة. ضيف صنف جديد من زر "+ إضافة صنف".' })); return; }
      listBox.append(table(['الكود', 'الصنف', 'الفئة', 'الكمية', 'الحد الأدنى', 'سعر الوحدة', 'الإجمالي', 'الحالة', ''],
        d.items.map((i) => {
          const [stLabel, stCls] = INV_STATUS[i.status];
          return h('tr', {},
            td('الكود', h('span', { class: 'ltr muted nowrap', text: i.code })),
            td('الصنف', h('div', {}, h('strong', { text: i.name }), i.supplier ? h('div', { class: 'muted small', text: i.supplier }) : null, i.is_demo ? h('span', { class: 'demo-tag', text: 'تجريبي' }) : null)),
            td('الفئة', h('span', { class: 'badge cat-' + i.category, text: INV_CATS[i.category] })),
            td('الكمية', h('span', { class: 'num', text: `${nf.format(i.quantity)} ${i.unit}` })),
            td('الحد الأدنى', h('span', { class: 'num muted', text: `${nf.format(i.min_quantity)} ${i.unit}` })),
            td('سعر الوحدة', money(i.unit_price)),
            td('الإجمالي', h('strong', { class: 'num', text: money(i.total_value) })),
            td('الحالة', h('span', { class: 'badge ' + stCls, text: stLabel })),
            td('', [
              h('button', { class: 'btn btn-sm btn-ghost', type: 'button', title: 'إضافة / صرف كمية', 'aria-label': 'تعديل الكمية', text: '↕', onclick: () => adjustForm(i, reload) }),
              h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'تعديل', onclick: () => itemForm(i, reload) }),
              h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'حذف', onclick: async () => {
                if (!(await confirmBox(`تحذف الصنف "${i.name}" من المخزن؟`))) return;
                try { await api('DELETE', `/api/inventory/${i.id}`); toast('تم حذف الصنف'); reload(); } catch (e) { toast(e.message, true); }
              } })], 'actions'));
        })));
    }

    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { invState.q = search.value.trim(); reload(); }, 300); });
    statusSel.addEventListener('change', () => { invState.status = statusSel.value; reload(); });

    view.replaceChildren(
      h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-lime', type: 'button', text: '+ إضافة صنف', onclick: () => itemForm(null, reload) })),
      cardsBox,
      h('section', { class: 'panel' }, tabsBox, h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, search), statusSel), listBox));
    await load();
  }

  function itemForm(i, after) {
    const code = h('input', { type: 'text', maxlength: '30', placeholder: 'تلقائي لو سبته فاضي (مثال: CHM-105)', value: i ? i.code : '', dir: 'ltr' });
    const name = h('input', { type: 'text', maxlength: '120', required: true, value: i ? i.name : '' });
    const supplier = h('input', { type: 'text', maxlength: '120', value: i ? i.supplier : '' });
    const cat = h('select', {}, Object.entries(INV_CATS).map(([k, v]) => h('option', { value: k, text: v })));
    cat.value = i ? i.category : (invState.category || 'chemicals');
    const qty = h('input', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: i ? String(i.quantity) : '0' });
    const unit = h('input', { type: 'text', maxlength: '20', placeholder: 'كجم / لتر / قطعة', value: i ? i.unit : '' });
    const min = h('input', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: i ? String(i.min_quantity) : '0' });
    const price = h('input', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: i ? String(i.unit_price) : '0' });
    const err = h('p', { class: 'error-text', role: 'alert' });
    const save = h('button', { class: 'btn btn-lime', type: 'submit', text: 'حفظ' });
    const form = h('form', { novalidate: true },
      h('div', { class: 'grid-2' }, field('اسم الصنف', name), field('الكود', code)),
      h('div', { class: 'grid-2' }, field('المورّد (اختياري)', supplier), field('الفئة', cat)),
      h('div', { class: 'grid-2' }, field('الكمية', qty), field('الوحدة', unit)),
      h('div', { class: 'grid-2' }, field('الحد الأدنى (للتنبيه)', min), field('سعر الوحدة (ج.م)', price)),
      err, h('div', { class: 'modal-foot' }, save));
    const m = openModal(i ? 'تعديل صنف' : 'إضافة صنف', form);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!name.value.trim()) { err.textContent = 'اسم الصنف مطلوب'; return; }
      for (const [el, label] of [[qty, 'الكمية'], [min, 'الحد الأدنى'], [price, 'سعر الوحدة']]) {
        const n = Number(el.value);
        if (el.value === '' || !Number.isFinite(n) || n < 0) { err.textContent = `${label} لازم تكون رقم صفر أو أكبر`; return; }
      }
      run(save, err, async () => {
        const payload = { code: code.value.trim(), name: name.value.trim(), supplier: supplier.value.trim(), category: cat.value, quantity: Number(qty.value), unit: unit.value.trim(), min_quantity: Number(min.value), unit_price: Number(price.value) };
        if (i) await api('PUT', `/api/inventory/${i.id}`, payload); else await api('POST', '/api/inventory', payload);
        toast('تم الحفظ'); m.close(); after();
      });
    });
    name.focus();
  }

  // ↕ إضافة / صرف / تحديد الكمية
  function adjustForm(i, after) {
    const mode = h('select', {}, h('option', { value: 'add', text: 'إضافة كمية (توريد)' }), h('option', { value: 'subtract', text: 'صرف كمية (استهلاك)' }), h('option', { value: 'set', text: 'تحديد الكمية (جرد)' }));
    const amount = h('input', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', required: true, value: '1' });
    const err = h('p', { class: 'error-text', role: 'alert' });
    const save = h('button', { class: 'btn btn-lime', type: 'submit', text: 'تطبيق' });
    const form = h('form', { novalidate: true },
      h('div', { class: 'calc' }, h('span', { text: 'الكمية الحالية' }), h('strong', { text: `${nf.format(i.quantity)} ${i.unit}` })),
      field('نوع العملية', mode), field('الكمية', amount), err, h('div', { class: 'modal-foot' }, save));
    const m = openModal(`تعديل كمية: ${i.name}`, form);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const a = Number(amount.value);
      if (amount.value === '' || !Number.isFinite(a) || a < 0) { err.textContent = 'اكتب كمية صحيحة'; return; }
      if (mode.value === 'subtract' && a > i.quantity) { err.textContent = 'الكمية المصروفة أكبر من المتاح في المخزن'; return; }
      run(save, err, async () => { await api('POST', `/api/inventory/${i.id}/adjust`, { mode: mode.value, amount: a }); toast('تم تحديث الكمية'); m.close(); after(); });
    });
    amount.select();
  }

  // ======================= الإعدادات =======================
  // حقل باسورد مع زر إظهار/إخفاء (العين)
  function passField(label, props) {
    const input = h('input', { type: 'password', maxlength: '200', ...props });
    const eye = h('button', { class: 'eye', type: 'button', 'aria-label': 'إظهار كلمة المرور', 'aria-pressed': 'false', text: '👁' });
    eye.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.setAttribute('aria-pressed', String(show)); eye.setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'); eye.textContent = show ? '🙈' : '👁';
    });
    const id = 'f' + Math.random().toString(36).slice(2, 8);
    input.id = id;
    const el = h('div', { class: 'field' }, h('label', { for: id, text: label }), h('div', { class: 'pw-wrap' }, input, eye));
    return { el, input };
  }

  async function viewSettings() {
    const [s, me] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/auth/me')]);

    // ---- الحساب ----
    const curName = h('input', { type: 'text', value: me.username, readonly: true, 'aria-readonly': 'true' });
    const newName = h('input', { type: 'text', maxlength: '60', autocomplete: 'off', placeholder: 'اتركه فاضي لو مش عايز تغيّره' });
    const cur = passField('كلمة المرور الحالية', { autocomplete: 'current-password' });
    const nw = passField('كلمة المرور الجديدة (8 أحرف على الأقل)', { autocomplete: 'new-password', maxlength: '100' });
    const err2 = h('p', { class: 'error-text', role: 'alert' });
    const save2 = h('button', { class: 'btn', type: 'submit', text: 'تغيير كلمة المرور' });
    const pform = h('form', { novalidate: true },
      h('div', { class: 'grid-2' }, field('اسم المستخدم الحالي', curName), field('اسم مستخدم جديد (اختياري)', newName)),
      h('div', { class: 'grid-2' }, cur.el, nw.el), err2, save2);
    pform.addEventListener('submit', (e) => {
      e.preventDefault();
      const nn = newName.value.trim();
      if (!cur.input.value) { err2.textContent = 'اكتب كلمة المرور الحالية'; return; }
      if (!nn && !nw.input.value) { err2.textContent = 'اكتب اسم مستخدم جديد أو كلمة مرور جديدة'; return; }
      if (nn && nn.length < 3) { err2.textContent = 'اسم المستخدم لازم يكون 3 أحرف على الأقل'; return; }
      if (nw.input.value && nw.input.value.length < 8) { err2.textContent = 'كلمة المرور الجديدة لازم تكون 8 أحرف على الأقل'; return; }
      run(save2, err2, async () => {
        const body = { current_password: cur.input.value };
        if (nn) body.new_username = nn;
        if (nw.input.value) body.new_password = nw.input.value;
        const r = await api('POST', '/api/auth/password', body);
        cur.input.value = ''; nw.input.value = ''; newName.value = ''; curName.value = r.username;
        document.getElementById('who').textContent = r.username;
        toast('تم تحديث بيانات الحساب');
      });
    });

    // ---- بيانات التواصل ----
    const inp = (v, props) => h('input', { type: 'text', value: v || '', ...props });
    const slogan = inp(s.slogan, { maxlength: '120' });
    const phone = h('input', { type: 'tel', inputmode: 'numeric', value: /^01/.test(s.phone) ? s.phone : '', placeholder: '01012345678' });
    const wa = h('input', { type: 'tel', inputmode: 'numeric', value: s.whatsapp || '', placeholder: 'لو فاضي هيستخدم رقم الموبايل' });
    const address = h('textarea', { maxlength: '250' }); address.value = /^\s*\[/.test(s.address) ? '' : s.address || '';
    const hours = h('textarea', { maxlength: '250', placeholder: 'مثال: يومياً من 9 صباحاً حتى 10 مساءً' }); hours.value = /^\s*\[/.test(s.working_hours) ? '' : s.working_hours || '';
    const err = h('p', { class: 'error-text', role: 'alert' });
    const save = h('button', { class: 'btn btn-lime', type: 'submit', text: 'حفظ بيانات التواصل' });
    const form = h('form', { novalidate: true }, field('السلوجن', slogan), h('div', { class: 'grid-2' }, field('رقم الموبايل', phone), field('رقم الواتساب', wa)),
      field('العنوان', address), field('مواعيد العمل', hours), err, save);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      for (const el of [phone, wa]) if (el.value.trim() && !isEgPhone(el.value)) { err.textContent = 'اكتب رقم موبايل مصري صحيح'; return; }
      run(save, err, async () => {
        await api('PUT', '/api/settings', { slogan: slogan.value.trim(), phone: latin(phone.value).replace(/[\s-]/g, ''), whatsapp: latin(wa.value).replace(/[\s-]/g, ''), address: address.value.trim(), working_hours: hours.value.trim() });
        toast('تم حفظ الإعدادات');
      });
    });

    view.replaceChildren(
      h('section', { class: 'panel' }, h('h2', { text: 'الحساب' }), pform),
      h('section', { class: 'panel' }, h('h2', { text: 'بيانات التواصل والموقع' }), form));
  }

  // ======================= الراوتر =======================
  const routes = {
    dashboard: ['الرئيسية', viewDashboard],
    customers: ['العملاء', viewCustomers],
    services: ['الخدمات والأسعار', viewServices],
    inventory: ['المخزن', viewInventory],
    offers: ['العروض', viewOffers],
    gallery: ['معرض الصور', viewGallery],
    settings: ['الإعدادات', viewSettings],
  };

  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');
  const menuBtn = document.getElementById('menuBtn');
  function setMenu(open) { sidebar.classList.toggle('open', open); scrim.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); }
  menuBtn.addEventListener('click', () => setMenu(!sidebar.classList.contains('open')));
  scrim.addEventListener('click', () => setMenu(false));

  let navToken = 0;
  async function route() {
    setMenu(false);
    const parts = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
    const key = parts[0];
    const token = ++navToken;
    const isCustomer = key === 'customers' && /^\d+$/.test(parts[1] || '');
    const def = routes[key];
    if (!def) { location.hash = '#/dashboard'; return; }

    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
    document.getElementById('pageTitle').textContent = def[0];
    view.replaceChildren(h('p', { class: 'empty', text: 'جاري التحميل...' }));
    try {
      if (isCustomer) await viewCustomer(Number(parts[1])); else await def[1]();
    } catch (e) {
      if (token !== navToken) return;
      view.replaceChildren(h('div', { class: 'panel' }, h('p', { class: 'error-text', text: e.message }), h('button', { class: 'btn', type: 'button', text: 'إعادة المحاولة', onclick: route })));
    }
    if (token === navToken) view.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', route);

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await api('POST', '/api/auth/logout'); } finally { location.href = '/admin/login'; }
  });

  api('GET', '/api/auth/me').then((m) => { document.getElementById('who').textContent = m.username; }).catch(() => {});
  route();
})();
