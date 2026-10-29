// Encàrrecs de dinar i panell del restaurant
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayKey = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const today = () => dayKey(new Date());
  const longDate = k => new Date(k + 'T12:00').toLocaleDateString('ca-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const euros = n => (Math.round(n * 100) / 100).toLocaleString('ca-ES', { minimumFractionDigits: n % 1 ? 2 : 0 }) + ' €';
  const store = {
    get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };
  const DEFAULT_CONFIG = { preu: 14, tancament: '12:30', torns: ['13:00', '14:00'], postres: ['Postres del dia', 'Cafè'], plus: [], novetats: [] };
  function minutesNow() {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    return parseInt(p.find(x => x.type === 'hour').value, 10) % 24 * 60 + parseInt(p.find(x => x.type === 'minute').value, 10);
  }
  function isOpen(date, cfg) {
    const t = today();
    if (date !== t) return date > t;
    const [h, m] = cfg.tancament.split(':').map(Number);
    return minutesNow() < h * 60 + m;
  }

  // ---------- Magatzem: servidor propi (api/) o base de dades de l'artifact ----------
  function serverBackend() {
    const pin = () => sessionStorage.getItem('pla-pin') || '';
    const call = async (method, url, body, headers = {}) => {
      const r = await fetch('api/' + url, { method, headers: { 'Content-Type': 'application/json', 'X-Admin-Pin': pin(), ...headers }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || 'error'), { code: j.error, status: r.status });
      return j;
    };
    return {
      kind: 'server',
      async day(date) { const j = await call('GET', 'dia?date=' + date); return { menu: j.menu, config: j.config }; },
      async login(p) { sessionStorage.setItem('pla-pin', p); try { await call('POST', 'login', { pin: p }); return true; } catch (e) { sessionStorage.removeItem('pla-pin'); return false; } },
      async isAdmin() { return !!pin() && this.login(pin()); },
      logout() { sessionStorage.removeItem('pla-pin'); },
      saveMenu: (date, menu) => call('PUT', 'menu', { date, ...menu }),
      saveConfig: cfg => call('PUT', 'config', cfg),
      async create(o) { return call('POST', 'comandes', o); },
      update: (id, token, o) => call('PUT', 'comandes/' + id, o, { 'X-Order-Token': token }),
      remove: (id, token) => call('DELETE', 'comandes/' + id, null, { 'X-Order-Token': token }),
      async mine(id, token) { try { return await call('GET', 'comandes/' + id, null, { 'X-Order-Token': token }); } catch (e) { return null; } },
      setServed: (id, v) => call('PATCH', 'comandes/' + id, { servit: v }),
      watch(date, cb) {
        let stop = false;
        const tick = async () => { if (stop) return; try { cb((await call('GET', 'comandes?date=' + date)).comandes); } catch (e) { } setTimeout(tick, 8000); };
        tick();
        return () => { stop = true; };
      }
    };
  }

  function dbBackend(db, user) {
    return {
      kind: 'db',
      async day(date) {
        const [m, c] = await Promise.all([db.doc('menus/' + date).get(), db.doc('config/general').get()]);
        return { menu: m.exists ? m.data() : null, config: { ...DEFAULT_CONFIG, ...(c.exists ? c.data() : {}) } };
      },
      async login() { return user ? user.canEdit() : false; },
      async isAdmin() { return user ? user.canEdit() : false; },
      logout() { },
      async saveMenu(date, menu) { const ref = db.doc('menus/' + date); if (!menu.primers.length && !menu.segons.length) return ref.delete(); return ref.set(menu); },
      saveConfig: cfg => db.doc('config/general').set(cfg),
      async create(o) { const ref = await db.collection('orders').add({ ...o, servit: false, creada: Date.now() }); return { id: ref.id, token: '' }; },
      update: (id, token, o) => db.doc('orders/' + id).update(o),
      remove: id => db.doc('orders/' + id).delete(),
      async mine(id) { const s = await db.doc('orders/' + id).get(); return s.exists ? { id, ...s.data() } : null; },
      setServed: (id, v) => db.doc('orders/' + id).update({ servit: v }),
      watch(date, cb) {
        return db.collection('orders').where('date', '==', date).onSnapshot(s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => { });
      }
    };
  }

  // Demostració sense servidor (GitHub Pages): tot es guarda en aquest dispositiu
  const EXEMPLES = [
    { primers: ['Amanida catalana', 'Vichyssoise de porro', 'Tallarins a la carbonara', 'Pèsols saltejats amb calamars'],
      segons: ['Garró al forn a baixa temperatura amb salsa de ceps', 'Botifarra de ceps i rovellons', 'Fingers de pollastre amb salsa de mel i mostassa', 'Llúcera fregida'] },
    { primers: ['Amanida de formatge de cabra', 'Crema de carbassó', 'Croquetes de pollastre', 'Paella de peix i marisc'],
      segons: ['Lagarto a la brasa', "Gall d'indi a la brasa amb salsa gorgonzola", 'Mandonguilles estofades', 'Salmó a la planxa'] },
    { primers: ['Amanida de pollastre arrebossat', 'Crema de pèsols', 'Macarrons a la bolonyesa', 'Trinxat de col i patata'],
      segons: ['Galta al forn a baixa temperatura', 'Ploma a la brasa', 'Xurrasco de vedella a la brasa', 'Tonyina a la planxa amb salsa teriyaki'] }
  ];
  function localBackend() {
    const K = 'pla-demo';
    const load = () => store.get(K) || {
      config: { ...DEFAULT_CONFIG,
        plus: [{ id: 'p1', nom: 'Mitjana de bou a la brasa', preu: 6 }, { id: 'p2', nom: 'Entrecot de vedella', preu: 5 }, { id: 'p3', nom: 'Broquetes de llagostins', preu: 4 }],
        novetats: [{ id: 'n1', nom: 'Bolets de temporada a la brasa', desc: 'Rovellons i ceps amb all i julivert', preu: 3 }] },
      menus: {}, orders: {}
    };
    const save = d => store.set(K, d);
    const menuFor = (d, date) => {
      if (date in d.menus) return d.menus[date];
      const wd = (new Date(date + 'T12:00').getDay() + 6) % 7;
      return wd < 5 ? EXEMPLES[wd % 3] : null;
    };
    const subs = new Set();
    const notify = () => subs.forEach(f => f());
    addEventListener('storage', e => { if (e.key === K) notify(); });
    return {
      kind: 'local',
      async day(date) { const d = load(); return { menu: menuFor(d, date), config: d.config }; },
      async login() { return true; },
      async isAdmin() { return true; },
      logout() { },
      async saveMenu(date, menu) { const d = load(); d.menus[date] = menu.primers.length || menu.segons.length ? menu : null; save(d); },
      async saveConfig(cfg) { const d = load(); d.config = cfg; save(d); },
      async create(o) { const d = load(), id = Math.random().toString(36).slice(2, 12); d.orders[id] = { ...o, servit: false, creada: Date.now() }; save(d); notify(); return { id, token: '' }; },
      async update(id, t, o) { const d = load(); d.orders[id] = { ...d.orders[id], ...o }; save(d); notify(); },
      async remove(id) { const d = load(); delete d.orders[id]; save(d); notify(); },
      async mine(id) { const o = load().orders[id]; return o ? { id, ...o } : null; },
      async setServed(id, v) { const d = load(); if (d.orders[id]) d.orders[id].servit = v; save(d); notify(); },
      watch(date, cb) {
        const f = () => cb(Object.entries(load().orders).filter(([, o]) => o.date === date).map(([id, o]) => ({ id, ...o })));
        subs.add(f); f();
        return () => subs.delete(f);
      }
    };
  }

  let backendPromise;
  function backend() {
    if (backendPromise) return backendPromise;
    backendPromise = (async () => {
      for (let i = 0; i < 2; i++) {
        try {
          const ctl = new AbortController(); setTimeout(() => ctl.abort(), 6000);
          const r = await fetch('api/ping', { cache: 'no-store', signal: ctl.signal });
          if (r.ok && (await r.json()).ok) return serverBackend();
          break;
        } catch (e) { }
      }
      if (window.claude && claude.use) {
        const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
        if (db) return dbBackend(db, user);
      }
      // Sense servidor ni base de dades (p. ex. GitHub Pages): demostració en aquest dispositiu
      return localBackend();
    })();
    // Si no s'ha trobat cap magatzem, es torna a provar la propera vegada
    backendPromise.then(b => { if (!b) backendPromise = null; });
    return backendPromise;
  }

  // ---------- Encàrrecs (treballadors) ----------
  const W = { date: today(), menu: null, config: DEFAULT_CONFIG, mine: null, editing: false };
  const meKey = () => 'pla-comanda-' + W.date;

  function demoNote(box, be) {
    if (be.kind !== 'local' || box.previousElementSibling?.classList.contains('enc-demo')) return;
    box.insertAdjacentHTML('beforebegin', '<p class="enc-demo">Versió de demostració: els encàrrecs es guarden només en aquest dispositiu. Per provar-ho, fes un encàrrec i obre l\'«Accés restaurant» al peu de la pàgina.</p>');
  }

  async function loadWorker() {
    const box = $('#enc-app');
    const be = await backend();
    if (be) demoNote(box, be);
    if (!be) { box.innerHTML = '<p class="enc-empty">El servei d\'encàrrecs no està disponible en aquesta vista.</p>'; return; }
    try {
      // Quan els d'avui ja estan tancats, s'obre l'encàrrec del pròxim dia amb menú
      W.date = today(); Object.assign(W, await be.day(W.date));
      const saved = store.get(meKey());
      if (!saved && (!W.menu || !isOpen(W.date, W.config))) {
        for (let i = 1; i <= 7; i++) {
          const k = dayKey(new Date(Date.now() + i * 864e5)), d = await be.day(k);
          if (d.menu) { W.date = k; Object.assign(W, d); break; }
        }
      }
    } catch (e) { box.innerHTML = '<p class="enc-empty">No s\'ha pogut carregar el menú. Torna-ho a provar d\'aquí a una estona.</p>'; return; }
    const saved = store.get(meKey());
    W.mine = saved ? await be.mine(saved.id, saved.token) : null;
    if (saved && !W.mine) localStorage.removeItem(meKey());
    W.editing = !W.mine;
    renderWorker();
  }

  function renderWorker() {
    const box = $('#enc-app'), cfg = W.config, open = isOpen(W.date, cfg);
    $('#enc-date').textContent = (W.date === today() ? 'Avui, ' : '') + longDate(W.date);
    $('#enc-close').textContent = !open ? 'Encàrrecs tancats per avui' : W.date === today() ? 'Encàrrecs oberts fins a les ' + cfg.tancament : 'Encàrrecs oberts fins a les ' + cfg.tancament + ' del mateix dia';
    $('#enc-close').classList.toggle('closed', !open);
    if (!W.menu) { box.innerHTML = '<p class="enc-empty">Avui encara no hi ha menú publicat. Torna a mirar-ho més tard.</p>'; return; }
    if (W.mine && !W.editing) return renderSummary(open);
    if (!open) { box.innerHTML = '<p class="enc-empty">Ja no s\'accepten encàrrecs per avui. Si et cal alguna cosa, truca al <a href="tel:+34938769128">93 876 91 28</a>.</p>'; return; }

    const me = store.get('pla-jo') || {}, cur = W.mine || {};
    const opt = (name, value, label, extra = '', checked = false, inner = '') => `<label class="opt"><input type="radio" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''} ${extra}><span><b>${esc(label)}</b>${inner}</span></label>`;
    const segons = W.menu.segons.map(s => opt('segon', s, s, 'data-sup="0"', cur.segon === s));
    const carta = cfg.plus.map(p => opt('segon', p.nom, p.nom, `data-sup="${p.preu}"`, cur.segon === p.nom, `<em>+${euros(p.preu)}</em>`));
    const nous = cfg.novetats.map(n => opt('segon', n.nom, n.nom, `data-sup="${n.preu}"`, cur.segon === n.nom, `<i>${esc(n.desc || '')}</i><em>Novetat${n.preu ? ' · +' + euros(n.preu) : ''}</em>`));

    box.innerHTML = `
      <form id="enc-form" class="enc-form" novalidate>
        <fieldset class="enc-step"><legend><span>1</span>Qui ets</legend>
          <div class="enc-row">
            <label class="fld"><span>Nom i cognom</span><input name="nom" required maxlength="60" autocomplete="name" value="${esc(cur.nom || me.nom || '')}"></label>
            <label class="fld"><span>Empresa</span><input name="empresa" maxlength="60" autocomplete="organization" value="${esc(cur.empresa || me.empresa || 'Himesa')}"></label>
          </div>
        </fieldset>
        <fieldset class="enc-step"><legend><span>2</span>Torn i servei</legend>
          <div class="seg2">${cfg.torns.map(t => `<label><input type="radio" name="torn" value="${t}" required ${(cur.torn || me.torn) === t ? 'checked' : ''}><span>Torn de les ${t}</span></label>`).join('')}</div>
          <div class="seg2">
            <label><input type="radio" name="mode" value="taula" ${cur.mode !== 'emportar' ? 'checked' : ''}><span>A taula</span></label>
            <label><input type="radio" name="mode" value="emportar" ${cur.mode === 'emportar' ? 'checked' : ''}><span>Per emportar</span></label>
          </div>
        </fieldset>
        <fieldset class="enc-step"><legend><span>3</span>Primer plat</legend>
          <div class="opts">${W.menu.primers.map(s => opt('primer', s, s, '', cur.primer === s)).join('')}</div>
        </fieldset>
        <fieldset class="enc-step"><legend><span>4</span>Segon plat</legend>
          <div class="opts">${segons.join('')}</div>
          ${carta.length ? `<p class="opts-h">De la carta, amb suplement</p><div class="opts">${carta.join('')}</div>` : ''}
          ${nous.length ? `<p class="opts-h">Novetats</p><div class="opts">${nous.join('')}</div>` : ''}
        </fieldset>
        <fieldset class="enc-step"><legend><span>5</span>Postres o cafè</legend>
          <div class="seg2">${cfg.postres.map(p => `<label><input type="radio" name="postres" value="${esc(p)}" ${(cur.postres || cfg.postres[0]) === p ? 'checked' : ''}><span>${esc(p)}</span></label>`).join('')}</div>
          <label class="fld" style="margin-top: 20px"><span>Observacions (al·lèrgies, sense sal...)</span><input name="nota" maxlength="200" value="${esc(cur.nota || '')}"></label>
        </fieldset>
        <div class="enc-total"><div><span>Total</span><b id="enc-sum">${euros(cfg.preu)}</b></div><button class="btn solid" type="submit">${W.mine ? 'Desar els canvis' : 'Enviar l\'encàrrec'}</button></div>
        <p class="enc-msg" id="enc-msg" role="status"></p>
      </form>`;
    const f = $('#enc-form');
    const sum = () => { const s = f.querySelector('input[name=segon]:checked'); $('#enc-sum').textContent = euros(cfg.preu + (s ? Number(s.dataset.sup) : 0)); };
    f.addEventListener('change', sum); sum();
    f.addEventListener('submit', submitOrder);
  }

  async function submitOrder(e) {
    e.preventDefault();
    const f = e.target, d = new FormData(f), msg = $('#enc-msg'), btn = f.querySelector('button[type=submit]');
    const seg = f.querySelector('input[name=segon]:checked');
    const o = { date: W.date, nom: (d.get('nom') || '').trim(), empresa: (d.get('empresa') || '').trim() || 'Himesa', torn: d.get('torn'), mode: d.get('mode') || 'taula', primer: d.get('primer'), segon: d.get('segon'), suplement: seg ? Number(seg.dataset.sup) : 0, postres: d.get('postres') || '', nota: (d.get('nota') || '').trim() };
    const missing = !o.nom ? 'el teu nom' : !o.torn ? 'el torn' : !o.primer ? 'el primer plat' : !o.segon ? 'el segon plat' : '';
    if (missing) { msg.textContent = 'Falta triar ' + missing + '.'; msg.className = 'enc-msg err'; return; }
    btn.disabled = true; msg.textContent = 'Enviant...'; msg.className = 'enc-msg';
    const be = await backend();
    try {
      const saved = store.get(meKey());
      if (W.mine && saved) await be.update(saved.id, saved.token, o);
      else { const r = await be.create(o); store.set(meKey(), { id: r.id, token: r.token }); }
      store.set('pla-jo', { nom: o.nom, empresa: o.empresa, torn: o.torn });
      const s = store.get(meKey());
      W.mine = (await be.mine(s.id, s.token)) || { ...o, id: s.id };
      W.editing = false; renderWorker();
    } catch (err) {
      btn.disabled = false;
      msg.textContent = err.code === 'tancat' ? 'Els encàrrecs d\'avui ja estan tancats.' : 'No s\'ha pogut enviar. Revisa la connexió i torna-ho a provar.';
      msg.className = 'enc-msg err';
    }
  }

  function renderSummary(open) {
    const o = W.mine;
    $('#enc-app').innerHTML = `
      <div class="enc-done">
        <p class="cap teal">Encàrrec rebut</p>
        <h2>Fins ara, ${esc(o.nom.split(' ')[0])}</h2>
        <p class="body">Torn de les ${esc(o.torn)} · ${o.mode === 'emportar' ? 'per emportar' : 'a taula'}</p>
        <ul class="enc-list">
          <li><span>Primer</span>${esc(o.primer)}</li>
          <li><span>Segon</span>${esc(o.segon)}${o.suplement ? ` <em>+${euros(o.suplement)}</em>` : ''}</li>
          <li><span>Postres</span>${esc(o.postres || '—')}</li>
          ${o.nota ? `<li><span>Nota</span>${esc(o.nota)}</li>` : ''}
          <li class="tot"><span>Total</span>${euros(W.config.preu + (o.suplement || 0))}</li>
        </ul>
        ${open ? `<div class="enc-actions"><button class="btn" type="button" id="enc-edit">Modificar</button><button class="btn ghost" type="button" id="enc-del">Anul·lar</button></div><p class="fine">Pots canviar-lo fins a les ${esc(W.config.tancament)}.</p>` : '<p class="fine">Els encàrrecs ja estan tancats.</p>'}
      </div>`;
    if (!open) return;
    $('#enc-edit').onclick = () => { W.editing = true; renderWorker(); };
    $('#enc-del').onclick = async () => {
      if (!confirm('Vols anul·lar l\'encàrrec d\'avui?')) return;
      const s = store.get(meKey()), be = await backend();
      try { await be.remove(s.id, s.token); localStorage.removeItem(meKey()); W.mine = null; W.editing = true; renderWorker(); } catch (e) { alert('No s\'ha pogut anul·lar.'); }
    };
  }

  // ---------- Panell del restaurant ----------
  const A = { date: today(), tab: 'prod', orders: [], menu: null, config: DEFAULT_CONFIG, unwatch: null };

  async function loadAdmin() {
    const box = $('#adm-app'), be = await backend();
    if (!be) { box.innerHTML = '<p class="enc-empty">El panell no està disponible en aquesta vista.</p>'; return; }
    demoNote(box, be);
    if (!(await be.isAdmin())) return renderLogin(be);
    renderAdminShell();
  }

  function renderLogin(be) {
    if (be.kind === 'db') { $('#adm-app').innerHTML = '<p class="enc-empty">Només el restaurant pot obrir aquest panell.</p>'; return; }
    $('#adm-app').innerHTML = `<form class="adm-login" id="adm-login"><h2>Accés restaurant</h2><label class="fld"><span>PIN</span><input name="pin" type="password" inputmode="numeric" autocomplete="current-password" required></label><button class="btn solid" type="submit">Entrar</button><p class="enc-msg err" id="adm-err"></p></form>`;
    $('#adm-login').onsubmit = async e => {
      e.preventDefault();
      if (await be.login(new FormData(e.target).get('pin'))) renderAdminShell();
      else $('#adm-err').textContent = 'PIN incorrecte.';
    };
  }

  async function renderAdminShell() {
    const be = await backend();
    $('#adm-app').innerHTML = `
      <div class="adm-bar">
        <label class="fld inline"><span>Dia</span><input type="date" id="adm-date" value="${A.date}"></label>
        <nav class="adm-tabs" role="tablist">
          <button type="button" data-tab="prod">Producció</button>
          <button type="button" data-tab="list">Comandes</button>
          <button type="button" data-tab="menu">Menú del dia</button>
          <button type="button" data-tab="carta">Carta i ajustos</button>
        </nav>
        <div class="adm-tools"><button type="button" class="link" id="adm-print">Imprimir</button>${be.kind === 'server' ? '<button type="button" class="link" id="adm-out">Sortir</button>' : ''}</div>
      </div>
      <div id="adm-body"></div>`;
    $('#adm-date').onchange = e => { A.date = e.target.value || today(); watchDay(); };
    document.querySelectorAll('.adm-tabs button').forEach(b => b.onclick = () => { A.tab = b.dataset.tab; renderAdminBody(); });
    $('#adm-print').onclick = () => print();
    if ($('#adm-out')) $('#adm-out').onclick = () => { be.logout(); if (A.unwatch) A.unwatch(); loadAdmin(); };
    watchDay();
  }

  async function watchDay() {
    const be = await backend();
    if (A.unwatch) A.unwatch();
    try { Object.assign(A, await be.day(A.date)); } catch (e) { }
    A.orders = [];
    renderAdminBody();
    A.unwatch = be.watch(A.date, list => { A.orders = list.sort((a, b) => (a.creada || 0) - (b.creada || 0)); if (A.tab === 'prod' || A.tab === 'list') renderAdminBody(); });
  }

  function counts(list, key) {
    const m = new Map();
    list.forEach(o => { if (o[key]) m.set(o[key], (m.get(o[key]) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }

  function renderAdminBody() {
    document.querySelectorAll('.adm-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === A.tab));
    const body = $('#adm-body');
    if (A.tab === 'prod') return renderProduction(body);
    if (A.tab === 'list') return renderList(body);
    if (A.tab === 'menu') return renderMenuEditor(body);
    renderCartaEditor(body);
  }

  function renderProduction(body) {
    const torns = A.config.torns, all = A.orders;
    const block = (title, list) => `
      <section class="prod">
        <header><h3>${title}</h3><p><b>${list.length}</b> menús · <b>${list.filter(o => o.mode === 'emportar').length}</b> per emportar</p></header>
        ${list.length ? ['primer', 'segon', 'postres'].map(k => `
          <div class="prod-group"><p class="cap">${{ primer: 'Primers', segon: 'Segons', postres: 'Postres i cafès' }[k]}</p>
          <ul>${counts(list, k).map(([n, c]) => `<li><b>${c}</b><span>${esc(n)}</span></li>`).join('')}</ul></div>`).join('') : '<p class="fine">Cap encàrrec encara.</p>'}
        ${list.some(o => o.nota) ? `<div class="prod-group"><p class="cap">Observacions</p><ul>${list.filter(o => o.nota).map(o => `<li><span><strong>${esc(o.nom)}</strong> · ${esc(o.nota)}</span></li>`).join('')}</ul></div>` : ''}
      </section>`;
    body.innerHTML = `
      <p class="adm-head">${esc(longDate(A.date))} · <b>${all.length}</b> encàrrecs · ${A.menu ? 'menú publicat' : '<strong class="warn">sense menú publicat</strong>'}</p>
      <div class="prod-grid">${torns.map(t => block('Torn de les ' + t, all.filter(o => o.torn === t))).join('')}</div>`;
  }

  function renderList(body) {
    const torns = A.config.torns;
    body.innerHTML = torns.map(t => {
      const list = A.orders.filter(o => o.torn === t);
      return `<section class="tbl-wrap"><h3>Torn de les ${t} <span>${list.length}</span></h3>
        ${list.length ? `<table class="tbl"><thead><tr><th>Nom</th><th>Primer</th><th>Segon</th><th>Postres</th><th>Servei</th><th>Fet</th></tr></thead><tbody>
        ${list.map(o => `<tr class="${o.servit ? 'done' : ''}"><td data-l="Nom"><b>${esc(o.nom)}</b><small>${esc(o.empresa)}${o.nota ? ' · ' + esc(o.nota) : ''}</small></td><td data-l="Primer">${esc(o.primer)}</td><td data-l="Segon">${esc(o.segon)}${o.suplement ? ` <em>+${euros(o.suplement)}</em>` : ''}</td><td data-l="Postres">${esc(o.postres)}</td><td data-l="Servei">${o.mode === 'emportar' ? '<span class="pill">Emportar</span>' : 'Taula'}</td><td data-l="Fet"><input type="checkbox" data-id="${esc(o.id)}" ${o.servit ? 'checked' : ''} aria-label="Marcar com a preparat"></td></tr>`).join('')}
        </tbody></table>` : '<p class="fine">Cap encàrrec.</p>'}</section>`;
    }).join('');
    body.querySelectorAll('input[type=checkbox]').forEach(c => c.onchange = async () => { const be = await backend(); try { await be.setServed(c.dataset.id, c.checked); } catch (e) { c.checked = !c.checked; } });
  }

  function renderMenuEditor(body) {
    const m = A.menu || { primers: [], segons: [] };
    body.innerHTML = `
      <form class="adm-form" id="menu-form">
        <p class="adm-head">Menú de ${esc(longDate(A.date))}. Escriu un plat per línia, tal com l'envieu per WhatsApp.</p>
        <div class="enc-row">
          <label class="fld"><span>Primers</span><textarea name="primers" rows="7">${esc(m.primers.join('\n'))}</textarea></label>
          <label class="fld"><span>Segons</span><textarea name="segons" rows="7">${esc(m.segons.join('\n'))}</textarea></label>
        </div>
        <div class="adm-actions"><button class="btn solid" type="submit">Publicar el menú</button><button class="btn" type="button" id="menu-copy">Copiar del dia anterior</button><span class="enc-msg" id="menu-msg"></span></div>
      </form>`;
    const lines = v => v.split('\n').map(s => s.trim()).filter(Boolean);
    $('#menu-form').onsubmit = async e => {
      e.preventDefault();
      const d = new FormData(e.target), be = await backend(), menu = { primers: lines(d.get('primers')), segons: lines(d.get('segons')) };
      try { await be.saveMenu(A.date, menu); A.menu = menu.primers.length || menu.segons.length ? menu : null; $('#menu-msg').textContent = 'Publicat. Els treballadors ja el veuen.'; }
      catch (err) { $('#menu-msg').textContent = 'No s\'ha pogut desar.'; }
    };
    $('#menu-copy').onclick = async () => {
      const be = await backend();
      for (let i = 1; i <= 7; i++) {
        const k = dayKey(new Date(new Date(A.date + 'T12:00').getTime() - i * 864e5)), { menu } = await be.day(k);
        if (menu) { const f = $('#menu-form'); f.primers.value = menu.primers.join('\n'); f.segons.value = menu.segons.join('\n'); $('#menu-msg').textContent = 'Copiat del ' + longDate(k) + '. Revisa\'l i publica.'; return; }
      }
      $('#menu-msg').textContent = 'No hi ha cap menú els darrers set dies.';
    };
  }

  function renderCartaEditor(body) {
    const c = A.config;
    const rows = (list, desc) => list.map(x => `${x.nom} | ${x.preu}${desc ? ' | ' + (x.desc || '') : ''}`).join('\n');
    body.innerHTML = `
      <form class="adm-form" id="cfg-form">
        <div class="enc-row three">
          <label class="fld"><span>Preu del menú (€)</span><input name="preu" type="number" min="0" step="0.5" value="${c.preu}"></label>
          <label class="fld"><span>Tancament d'encàrrecs</span><input name="tancament" type="time" value="${esc(c.tancament)}"></label>
          <label class="fld"><span>Postres (separades per comes)</span><input name="postres" value="${esc(c.postres.join(', '))}"></label>
        </div>
        <label class="fld"><span>Plats de la carta amb suplement · un per línia: nom | suplement</span><textarea name="plus" rows="5">${esc(rows(c.plus))}</textarea></label>
        <label class="fld"><span>Novetats · un per línia: nom | suplement | descripció</span><textarea name="novetats" rows="4">${esc(rows(c.novetats, true))}</textarea></label>
        <div class="adm-actions"><button class="btn solid" type="submit">Desar</button><span class="enc-msg" id="cfg-msg"></span></div>
      </form>`;
    const parse = (v, desc) => v.split('\n').map(l => l.split('|').map(s => s.trim())).filter(p => p[0]).map((p, i) => ({ id: (desc ? 'n' : 'p') + (i + 1), nom: p[0], preu: Number((p[1] || '0').replace(',', '.')) || 0, ...(desc ? { desc: p[2] || '' } : {}) }));
    $('#cfg-form').onsubmit = async e => {
      e.preventDefault();
      const d = new FormData(e.target), be = await backend();
      const cfg = { ...c, preu: Number(d.get('preu')) || 0, tancament: d.get('tancament') || c.tancament, postres: d.get('postres').split(',').map(s => s.trim()).filter(Boolean), plus: parse(d.get('plus')), novetats: parse(d.get('novetats'), true) };
      try { await be.saveConfig(cfg); A.config = cfg; $('#cfg-msg').textContent = 'Desat.'; } catch (err) { $('#cfg-msg').textContent = 'No s\'ha pogut desar.'; }
    };
  }

  // ---------- App a la pantalla d'inici ----------
  let installEvt = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; const b = $('#enc-install'); if (b) b.hidden = false; });
  function setupInstall() {
    const box = $('#enc-home');
    if (!box) return;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) { box.hidden = true; return; }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    $('#enc-home-text').textContent = ios ? 'A l\'iPhone: toca Compartir i després «Afegeix a la pantalla d\'inici».' : 'Al mòbil: obre el menú del navegador i tria «Afegeix a la pantalla d\'inici» o «Instal·la l\'aplicació».';
    const b = $('#enc-install');
    b.hidden = !installEvt;
    b.onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; b.hidden = true; };
  }
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !/claudeusercontent|claude\.ai/.test(location.hostname)) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }

  // Entrada: la pàgina principal avisa quan s'obre cada apartat
  addEventListener('pla:page', e => {
    if (e.detail === 'encarrecs') { W.date = today(); loadWorker(); setupInstall(); }
    if (e.detail === 'admin') loadAdmin();
    else if (A.unwatch) { A.unwatch(); A.unwatch = null; }
  });
})();
