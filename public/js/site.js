// Lam3a Car Care — الصفحة العامة. كل النصوص بتتحط بـ textContent (مفيش innerHTML بداتا من الداتابيز)
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v);
    }
    kids.flat().forEach((c) => c && el.append(c));
    return el;
  }

  const money = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
  const isPlaceholder = (s) => !s || /^\s*\[/.test(s);
  const validPhone = (s) => /^01[0125]\d{8}$/.test(s || '');
  const intl = (p) => '+2' + p; // 01012345678 -> +201012345678

  // قائمة الموبايل
  const toggle = $('navToggle'), links = $('navLinks');
  toggle.addEventListener('click', () => {
    const open = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  links.addEventListener('click', (e) => { if (e.target.tagName === 'A') { links.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); } });
  $('year').textContent = new Date().getFullYear();

  function formatDate(iso) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function renderServices(list) {
    const box = $('servicesList');
    box.replaceChildren();
    if (!list.length) return box.append(h('div', { class: 'empty', text: 'الخدمات هتتضاف قريباً.' }));
    list.forEach((s) =>
      box.append(h('div', { class: 'card service-card' }, h('h3', { text: s.name }), h('div', { class: 'price' }, money(s.price), ' ', h('small', { text: 'ج.م' }))))
    );
  }

  function renderOffers(list) {
    const box = $('offersList');
    box.replaceChildren();
    if (!list.length) return box.append(h('div', { class: 'empty', text: 'مفيش عروض حالياً — تابعنا قريباً.' }));
    list.forEach((o) => {
      box.append(
        h('article', { class: 'card offer-card' },
          h('span', { class: 'badge', text: 'عرض' }),
          h('h3', { text: o.title }),
          o.description ? h('p', { text: o.description }) : null,
          h('div', { class: 'meta' },
            o.price !== null && o.price !== undefined ? h('div', { class: 'price' }, money(o.price), ' ', h('small', { text: 'ج.م' })) : null,
            o.expires_at ? h('span', { class: 'expires', text: 'ينتهي: ' + formatDate(o.expires_at) }) : null))
      );
    });
  }

  const lb = $('lightbox');
  function renderGallery(list) {
    const box = $('galleryList');
    box.replaceChildren();
    if (!list.length) return box.append(h('div', { class: 'empty', text: 'الصور هتتضاف قريباً.' }));
    list.forEach((g) => {
      const btn = h('button', { type: 'button', 'aria-label': g.caption || 'عرض الصورة' },
        h('img', { src: g.path, alt: g.caption || 'صورة من Lam3a Car Care', loading: 'lazy' }),
        g.caption ? h('span', { class: 'cap', text: g.caption }) : null);
      btn.addEventListener('click', () => {
        $('lbImg').src = g.path; $('lbImg').alt = g.caption || '';
        $('lbCap').textContent = g.caption || '';
        lb.showModal();
      });
      box.append(btn);
    });
  }
  $('lbClose').addEventListener('click', () => lb.close());
  lb.addEventListener('click', (e) => { if (e.target === lb) lb.close(); });

  function contactItem(icon, title, valueNode) {
    return h('div', { class: 'contact-item' }, h('div', { class: 'ico', 'aria-hidden': 'true', text: icon }), h('div', {}, h('h3', { text: title }), valueNode));
  }

  function renderContact(s) {
    const grid = $('contactGrid');
    grid.replaceChildren();
    const textOrPlaceholder = (v) => h('p', { class: isPlaceholder(v) ? 'placeholder-note' : '', text: v || 'هيتضاف قريباً' });
    grid.append(
      contactItem('📞', 'الموبايل', validPhone(s.phone) ? h('p', {}, h('a', { class: 'ltr', href: 'tel:' + intl(s.phone), text: s.phone })) : textOrPlaceholder(s.phone)),
      contactItem('💬', 'واتساب', validPhone(s.whatsapp || s.phone) ? h('p', {}, h('a', { class: 'ltr', href: 'https://wa.me/' + intl(s.whatsapp || s.phone).slice(1), target: '_blank', rel: 'noopener', text: s.whatsapp || s.phone })) : textOrPlaceholder('')),
      contactItem('📍', 'العنوان', textOrPlaceholder(s.address)),
      contactItem('🕒', 'مواعيد العمل', textOrPlaceholder(s.working_hours))
    );
  }

  function applySettings(s) {
    if (s.slogan) $('slogan').textContent = s.slogan;
    if (s.hero_image) document.querySelector('.hero').style.backgroundImage = `url("${encodeURI(s.hero_image)}")`;

    const call = $('ctaCall'), wa = $('ctaWa'), float = $('waFloat');
    if (validPhone(s.phone)) { call.href = 'tel:' + intl(s.phone); }
    const waNum = validPhone(s.whatsapp) ? s.whatsapp : validPhone(s.phone) ? s.phone : '';
    if (waNum) {
      const url = 'https://wa.me/' + intl(waNum).slice(1) + '?text=' + encodeURIComponent('مرحباً Lam3a Car Care، عاوز أستفسر عن خدمة.');
      wa.href = url; wa.target = '_blank';
      float.href = url; float.target = '_blank'; float.hidden = false;
    }
  }

  fetch('/api/public/site', { headers: { Accept: 'application/json' } })
    .then((r) => { if (!r.ok) throw new Error('bad status'); return r.json(); })
    .then((d) => {
      applySettings(d.settings);
      renderServices(d.services);
      renderOffers(d.offers);
      renderGallery(d.gallery);
      renderContact(d.settings);
    })
    .catch(() => {
      ['offersList', 'servicesList'].forEach((id) => { $(id).replaceChildren(h('div', { class: 'empty', text: 'تعذّر تحميل البيانات. حدّث الصفحة.' })); });
    });
})();
