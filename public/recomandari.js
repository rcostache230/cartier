/* recomandari.js — rebuilt */
/* globals: currentUser, showToast, timeAgoRo */

const RecomandariModule = (() => {
  let allRecs = [];
  let categories = [];
  let activeCategory = null;
  let selectedRating = 0;
  let editRating = 0;
  let modalEventsBound = false;

  const PREDEFINED_CATEGORIES = [
    { icon: '🍽️', name: 'Food', display_order: 1 },
    { icon: '☕', name: 'Coffee', display_order: 2 },
    { icon: '🏥', name: 'Medicina', display_order: 3 },
    { icon: '🛠️', name: 'Mesteri', display_order: 4 },
    { icon: '🎓', name: 'Educatie', display_order: 5 }
  ];

  const ICON_CHOICES = ['🍽️', '☕', '🏥', '🛠️', '🎓', '📌', '🚗', '💻', '🏠', '🧰', '⚖️', '✂️', '🛒', '🔧', '📦'];

  const CAT_COLORS = {
    Food: '#F97316',
    Coffee: '#B45309',
    Medicina: '#DC2626',
    Mesteri: '#2563EB',
    Educatie: '#7C3AED'
  };

  function getUser() {
    if (typeof currentUser !== 'undefined' && currentUser) return currentUser;
    if (typeof window !== 'undefined' && window.currentUser) return window.currentUser;
    return null;
  }

  function isAdminUser() {
    const user = getUser();
    if (!user) return false;
    const role = String(user.role || '').trim().toLowerCase();
    if (role === 'admin' || role.includes('admin')) return true;
    if (user.is_admin === true) return true;
    return String(user.username || '').trim().toLowerCase() === 'admin';
  }

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toInt(v) {
    const n = parseInt(String(v || ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeWebsite(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    return 'https://' + value;
  }

  function starsHtml(n, size) {
    const s = size || 14;
    const score = Number(n) || 0;
    return [1, 2, 3, 4, 5].map((i) => '<span style="font-size:' + s + 'px;opacity:' + (i <= score ? '1' : '0.2') + '">⭐</span>').join('');
  }

  function timeStr(value) {
    if (typeof timeAgoRo === 'function') return timeAgoRo(value);
    return value ? String(value).slice(0, 10) : '';
  }

  function getCatColor(name) {
    return CAT_COLORS[String(name || '').trim()] || 'var(--accent-primary)';
  }

  function categoryNameKey(name) {
    return String(name || '').trim().toLowerCase();
  }

  function sortCategories(list) {
    return (Array.isArray(list) ? list : []).slice().sort((a, b) => {
      const ao = Number(a.display_order || 0);
      const bo = Number(b.display_order || 0);
      if (ao !== bo) return ao - bo;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ro', { sensitivity: 'base' });
    });
  }

  async function requestJson(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error('request failed');
    const text = await r.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  function canEditRec(rec) {
    const user = getUser();
    if (!user) return false;
    return isAdminUser() || String(user.username || '') === String(rec.added_by || '');
  }

  function getCreateModal() {
    return document.getElementById('recCreateModal');
  }

  function openCreateModal() {
    const modal = getCreateModal();
    if (!modal) return;
    modal.classList.remove('hidden');
    const firstInput = document.getElementById('recFormName');
    if (firstInput) setTimeout(() => firstInput.focus(), 0);
  }

  function closeCreateModal() {
    const modal = getCreateModal();
    if (!modal) return;
    modal.classList.add('hidden');
  }

  function bindCreateModalEvents() {
    if (modalEventsBound) return;
    const modal = getCreateModal();
    if (!modal) return;
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeCreateModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const activeModal = getCreateModal();
      if (!activeModal || activeModal.classList.contains('hidden')) return;
      closeCreateModal();
    });
    modalEventsBound = true;
  }

  function notifyRecomandariChanged() {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent('recomandari:changed'));
    } catch (_) {
      // ignore
    }
  }

  async function fetchRecs() {
    const data = await requestJson('/api/recommendations');
    return Array.isArray(data) ? data : [];
  }

  async function fetchCats() {
    const data = await requestJson('/api/rec-categories');
    return Array.isArray(data) ? data : [];
  }

  async function apiCreateRec(payload) {
    return requestJson('/api/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  async function apiUpdateRec(id, payload) {
    return requestJson('/api/recommendations/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  async function apiDeleteRec(id) {
    return requestJson('/api/recommendations/' + id, { method: 'DELETE' });
  }

  async function apiCreateCat(icon, name) {
    return requestJson('/api/rec-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icon: icon, name: name })
    });
  }

  async function apiUpdateCat(id, icon, name) {
    return requestJson('/api/rec-categories/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icon: icon, name: name })
    });
  }

  async function apiDeleteCat(id) {
    return requestJson('/api/rec-categories/' + id, { method: 'DELETE' });
  }

  async function bootstrapPredefinedCategories(serverCats) {
    const list = Array.isArray(serverCats) ? serverCats : [];
    if (!isAdminUser()) return list;

    const existing = new Set(list.map((c) => categoryNameKey(c.name)));
    const missing = PREDEFINED_CATEGORIES.filter((c) => !existing.has(categoryNameKey(c.name)));
    if (!missing.length) return list;

    let created = 0;
    for (const cat of missing) {
      try {
        await apiCreateCat(cat.icon, cat.name);
        created += 1;
      } catch (_) {
        // ignore per-category failures
      }
    }

    if (created > 0) {
      try {
        showToast('Categorii predefinite adăugate.', 'success');
      } catch (_) {}
    }

    try {
      return await fetchCats();
    } catch (_) {
      return list;
    }
  }

  function fallbackCategories() {
    return PREDEFINED_CATEGORIES.map((c, i) => ({
      id: 9000 + i,
      icon: c.icon,
      name: c.name,
      display_order: c.display_order,
      _fallback: true
    }));
  }

  function renderCategoryFilter() {
    const el = document.getElementById('recCategoryFilter');
    if (!el) return;
    const options = ['<option value="">📋 Toate categoriile</option>'];
    sortCategories(categories).forEach((c) => {
      options.push('<option value="' + esc(c.id) + '"' + (activeCategory === c.id ? ' selected' : '') + '>' + esc(c.icon) + ' ' + esc(c.name) + '</option>');
    });
    el.innerHTML = options.join('');
    el.value = activeCategory ? String(activeCategory) : '';
  }

  function renderFormCategorySelect() {
    const el = document.getElementById('recFormCategory');
    if (!el) return;
    const options = sortCategories(categories).map((c) => '<option value="' + esc(c.id) + '">' + esc(c.icon) + ' ' + esc(c.name) + '</option>');
    el.innerHTML = options.join('');
  }

  function renderCategorySection(cat, items) {
    return '' +
      '<section class="rec-category-group" style="--rec-color:' + getCatColor(cat.name) + '">' +
      '  <div class="rec-category-group-header">' +
      '    <div class="rec-category-group-title">' + esc(cat.icon) + ' ' + esc(cat.name) + '</div>' +
      '    <span class="rec-category-group-count">' + items.length + '</span>' +
      '  </div>' +
      '  <div class="rec-category-group-body">' + items.map(renderCard).join('') + '</div>' +
      '</section>';
  }

  function renderList() {
    const el = document.getElementById('recList');
    if (!el) return;

    if (!allRecs.length) {
      el.innerHTML = '' +
        '<div class="rec-empty">' +
        '  <div class="rec-empty-icon">💡</div>' +
        '  <div class="rec-empty-title">Nicio recomandare adăugată încă.</div>' +
        '  <div class="rec-empty-sub">Fii primul care recomandă ceva vecinilor.</div>' +
        '</div>';
      return;
    }

    if (activeCategory) {
      const list = allRecs.filter((r) => r.category_id === activeCategory);
      if (!list.length) {
        el.innerHTML = '' +
          '<div class="rec-empty">' +
          '  <div class="rec-empty-icon">🗂️</div>' +
          '  <div class="rec-empty-title">Nu există recomandări în categoria selectată.</div>' +
          '</div>';
        return;
      }
      el.innerHTML = list.map(renderCard).join('');
      return;
    }

    const out = [];
    const sortedCats = sortCategories(categories);
    for (const cat of sortedCats) {
      const items = allRecs.filter((r) => r.category_id === cat.id);
      if (items.length) out.push(renderCategorySection(cat, items));
    }

    const knownIds = new Set(sortedCats.map((c) => c.id));
    const uncategorized = allRecs.filter((r) => !r.category_id || !knownIds.has(r.category_id));
    if (uncategorized.length) {
      out.push(renderCategorySection({ icon: '📌', name: 'Fără categorie' }, uncategorized));
    }

    el.innerHTML = out.join('');
  }

  function renderCard(rec) {
    const cat = categories.find((c) => c.id === rec.category_id) || { icon: '📌', name: 'Fără categorie' };
    const color = getCatColor(cat.name);
    const phoneLink = rec.phone
      ? '<a class="rec-phone-btn" href="tel:' + esc(rec.phone) + '">📞 ' + esc(rec.phone) + '</a>'
      : '';
    const website = normalizeWebsite(rec.website || '');
    const webLink = website
      ? '<a class="rec-web-btn" href="' + esc(website) + '" target="_blank" rel="noopener noreferrer">🌐 Website</a>'
      : '';

    const actions = canEditRec(rec)
      ? '<div class="rec-admin-actions">' +
          '<button class="btn btn-secondary btn-sm" type="button" onclick="RecomandariModule.startEdit(' + rec.id + ')">✏ Editează</button>' +
          '<button class="btn btn-danger btn-sm" type="button" onclick="RecomandariModule.del(' + rec.id + ')">🗑 Șterge</button>' +
        '</div>'
      : '';

    return '' +
      '<article class="rec-card" id="rec-card-' + rec.id + '" style="--rec-color:' + color + '">' +
      '  <div class="rec-card-header">' +
      '    <div class="rec-card-title-group">' +
      '      <div class="rec-name">' + esc(rec.name) + '</div>' +
      (rec.area ? '      <div class="rec-area">📍 ' + esc(rec.area) + '</div>' : '') +
      '    </div>' +
      '    <div class="rec-stars">' + starsHtml(rec.rating, 14) + '</div>' +
      '  </div>' +
      '  <div class="rec-badges"><span class="rec-badge">' + esc(cat.icon) + ' ' + esc(cat.name) + '</span></div>' +
      '  <div class="rec-why">' + esc(rec.why) + '</div>' +
      '  <div class="rec-card-footer">' +
      '    <div class="rec-meta">' +
      '      <span>👤 ' + esc(rec.added_by || '-') + '</span>' +
      (rec.building ? '<span>· Bloc ' + esc(rec.building) + '</span>' : '') +
      '      <span>· ' + esc(timeStr(rec.created_at)) + '</span>' +
      '    </div>' +
      '    <div class="rec-actions">' + phoneLink + webLink + '</div>' +
      '  </div>' +
      actions +
      '</article>';
  }

  function renderEditForm(rec) {
    const catOptions = sortCategories(categories).map((c) => '<option value="' + esc(c.id) + '"' + (c.id === rec.category_id ? ' selected' : '') + '>' + esc(c.icon) + ' ' + esc(c.name) + '</option>').join('');
    editRating = Number(rec.rating || 0);

    const stars = [1, 2, 3, 4, 5].map((i) =>
      '<span id="eStar' + i + '" onclick="RecomandariModule.setEditRating(' + i + ')" style="font-size:28px;min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;opacity:' + (i <= editRating ? '1' : '0.25') + '">⭐</span>'
    ).join('');

    return '' +
      '<article class="rec-card" id="rec-card-' + rec.id + '">' +
      '  <div class="rec-edit-form">' +
      '    <div><label>Nume *</label><input type="text" id="eRecName" value="' + esc(rec.name) + '"></div>' +
      '    <div><label>Categorie *</label><select id="eRecCat">' + catOptions + '</select></div>' +
      '    <div><label>Zonă / Adresă</label><input type="text" id="eRecArea" value="' + esc(rec.area || '') + '"></div>' +
      '    <div><label>Telefon</label><input type="tel" id="eRecPhone" value="' + esc(rec.phone || '') + '"></div>' +
      '    <div><label>Website</label><input type="url" id="eRecWebsite" value="' + esc(rec.website || '') + '"></div>' +
      '    <div><label>Rating *</label><div style="display:flex;gap:4px">' + stars + '</div></div>' +
      '    <div><label>De ce recomanzi? *</label><textarea id="eRecWhy">' + esc(rec.why || '') + '</textarea></div>' +
      '    <div class="rec-edit-actions">' +
      '      <button class="btn btn-primary" type="button" onclick="RecomandariModule.saveEdit(' + rec.id + ')">✓ Salvează</button>' +
      '      <button class="btn btn-secondary" type="button" onclick="RecomandariModule.load()">Anulează</button>' +
      '    </div>' +
      '  </div>' +
      '</article>';
  }

  function renderAdminPanel() {
    const zone = document.getElementById('recAdminZone');
    if (!zone) return;
    const adminAllowed = isAdminUser();
    if (!adminAllowed) {
      zone.style.display = 'none';
      return;
    }
    zone.style.display = 'block';

    const listEl = document.getElementById('recCatManageList');
    if (!listEl) return;

    const rows = sortCategories(categories).map((c) => '' +
      '<div class="rec-cat-manage-row" id="cat-admin-row-' + c.id + '">' +
      '  <span class="cat-label">' + esc(c.icon) + ' ' + esc(c.name) + '</span>' +
      '  <button class="btn btn-secondary btn-sm" type="button" onclick="RecomandariModule.startEditCat(' + c.id + ')">✏</button>' +
      '  <button class="btn btn-danger btn-sm" type="button" onclick="RecomandariModule.delCat(' + c.id + ')">🗑</button>' +
      '</div>'
    );
    listEl.innerHTML = rows.length ? rows.join('') : '<p style="font-size:13px;color:var(--text-muted);padding:8px">Nicio categorie.</p>';

    const iconInput = document.getElementById('recNewCatIcon');
    const nameInput = document.getElementById('recNewCatName');
    const addBtn = zone.querySelector('.rec-new-cat-form .btn');
    if (iconInput) iconInput.disabled = false;
    if (nameInput) nameInput.disabled = false;
    if (addBtn) addBtn.disabled = false;
    renderNewCategoryIconPicker();
  }

  function renderNewCategoryIconPicker() {
    const picker = document.getElementById('recNewCatIconPicker');
    if (!picker) return;
    const iconInput = document.getElementById('recNewCatIcon');
    const current = iconInput && iconInput.value ? iconInput.value.trim() : '📌';

    picker.setAttribute('data-icon-picker-for', 'recNewCatIcon');
    picker.innerHTML = ICON_CHOICES.map((icon) =>
      '<button type="button" class="rec-icon-chip' + (icon === current ? ' active' : '') + '" onclick="RecomandariModule.pickCatIcon(\'' + icon + '\', \'recNewCatIcon\')">' + esc(icon) + '</button>'
    ).join('');
  }

  function ensureActiveCategoryValid() {
    if (!activeCategory) return;
    if (!categories.some((c) => c.id === activeCategory)) activeCategory = null;
  }

  async function load() {
    bindCreateModalEvents();
    const [recsResult, catsResult] = await Promise.allSettled([fetchRecs(), fetchCats()]);

    allRecs = recsResult.status === 'fulfilled' ? recsResult.value : [];
    if (recsResult.status !== 'fulfilled') showToast('Eroare la încărcarea recomandărilor.', 'error');

    let serverCats = catsResult.status === 'fulfilled' ? catsResult.value : [];
    if (catsResult.status !== 'fulfilled') showToast('Eroare la încărcarea categoriilor.', 'warning');

    serverCats = await bootstrapPredefinedCategories(serverCats);
    categories = sortCategories(serverCats.length ? serverCats : fallbackCategories());

    ensureActiveCategoryValid();
    renderAdminPanel();
    renderCategoryFilter();
    renderFormCategorySelect();
    renderList();

    const ts = document.getElementById('recRefreshedAt');
    if (ts) ts.textContent = 'acum';
  }

  function filter(catId) {
    const parsed = toInt(catId);
    activeCategory = parsed;
    renderCategoryFilter();
    renderList();
  }

  function filterFromSelect() {
    const select = document.getElementById('recCategoryFilter');
    filter(select && select.value ? select.value : null);
  }

  function setRating(n) {
    selectedRating = n;
    [1, 2, 3, 4, 5].forEach((i) => {
      const el = document.getElementById('rStar' + i);
      if (el) el.style.opacity = i <= n ? '1' : '0.25';
    });
  }

  function hoverRating(n) {
    [1, 2, 3, 4, 5].forEach((i) => {
      const el = document.getElementById('rStar' + i);
      if (el) el.style.opacity = i <= n ? '1' : '0.25';
    });
  }

  function resetHover() {
    setRating(selectedRating || 0);
  }

  function setEditRating(n) {
    editRating = n;
    [1, 2, 3, 4, 5].forEach((i) => {
      const el = document.getElementById('eStar' + i);
      if (el) el.style.opacity = i <= n ? '1' : '0.25';
    });
  }

  async function submit() {
    const user = getUser();
    if (!user || !user.username) {
      showToast('Trebuie să fii autentificat.', 'warning');
      return;
    }

    const name = String((document.getElementById('recFormName') || {}).value || '').trim();
    const catId = toInt((document.getElementById('recFormCategory') || {}).value);
    const area = String((document.getElementById('recFormArea') || {}).value || '').trim();
    const phone = String((document.getElementById('recFormPhone') || {}).value || '').trim();
    const website = normalizeWebsite((document.getElementById('recFormWebsite') || {}).value || '');
    const why = String((document.getElementById('recFormWhy') || {}).value || '').trim();

    if (!name) return showToast('Introdu numele locului/persoanei.', 'warning');
    if (!catId || catId >= 9000) return showToast('Selectează o categorie validă.', 'warning');
    if (!selectedRating) return showToast('Selectează ratingul (1-5).', 'warning');
    if (why.length < 10) return showToast('Scrie minim 10 caractere la "De ce recomanzi".', 'warning');

    const btn = document.getElementById('recSubmitBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Se adaugă...';
    }

    try {
      const payload = {
        name: name,
        category_id: catId,
        area: area,
        phone: phone,
        rating: selectedRating,
        why: why,
        added_by: user.username,
        building: user.building || user.building_number || ''
      };
      if (website) payload.website = website;

      await apiCreateRec(payload);

      ['recFormName', 'recFormArea', 'recFormPhone', 'recFormWebsite', 'recFormWhy'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      selectedRating = 0;
      [1, 2, 3, 4, 5].forEach((i) => {
        const el = document.getElementById('rStar' + i);
        if (el) el.style.opacity = '0.25';
      });

      showToast('Recomandare adăugată.', 'success');
      closeCreateModal();
      notifyRecomandariChanged();
      await load();
    } catch (_) {
      showToast('Eroare la adăugare.', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '+ Adaugă recomandare';
      }
    }
  }

  function startEdit(id) {
    const rec = allRecs.find((r) => r.id === id);
    if (!rec || !canEditRec(rec)) return;
    const card = document.getElementById('rec-card-' + id);
    if (card) card.outerHTML = renderEditForm(rec);
  }

  async function saveEdit(id) {
    const rec = allRecs.find((r) => r.id === id);
    if (!rec || !canEditRec(rec)) return;

    const name = String((document.getElementById('eRecName') || {}).value || '').trim();
    const catId = toInt((document.getElementById('eRecCat') || {}).value);
    const area = String((document.getElementById('eRecArea') || {}).value || '').trim();
    const phone = String((document.getElementById('eRecPhone') || {}).value || '').trim();
    const website = normalizeWebsite((document.getElementById('eRecWebsite') || {}).value || '');
    const why = String((document.getElementById('eRecWhy') || {}).value || '').trim();

    if (!name) return showToast('Numele nu poate fi gol.', 'warning');
    if (!catId || catId >= 9000) return showToast('Selectează o categorie validă.', 'warning');
    if (!editRating) return showToast('Selectează ratingul.', 'warning');
    if (why.length < 10) return showToast('Textul explicației este prea scurt.', 'warning');

    try {
      const payload = {
        name: name,
        category_id: catId,
        area: area,
        phone: phone,
        rating: editRating,
        why: why
      };
      if (website) payload.website = website;

      await apiUpdateRec(id, payload);
      showToast('Recomandare actualizată.', 'success');
      notifyRecomandariChanged();
      await load();
    } catch (_) {
      showToast('Eroare la actualizare.', 'error');
    }
  }

  async function del(id) {
    const rec = allRecs.find((r) => r.id === id);
    if (!rec || !canEditRec(rec)) return;
    if (!confirm('Ștergi această recomandare?')) return;

    try {
      await apiDeleteRec(id);
      showToast('Recomandare ștearsă.', 'success');
      notifyRecomandariChanged();
      await load();
    } catch (_) {
      showToast('Eroare la ștergere.', 'error');
    }
  }

  async function addCat() {
    if (!isAdminUser()) return showToast('Doar admin poate adăuga categorii.', 'warning');

    const iconEl = document.getElementById('recNewCatIcon');
    const nameEl = document.getElementById('recNewCatName');
    const icon = String((iconEl || {}).value || '').trim() || '📌';
    const name = String((nameEl || {}).value || '').trim();

    if (!name) return showToast('Introdu numele categoriei.', 'warning');

    try {
      await apiCreateCat(icon, name);
      if (nameEl) nameEl.value = '';
      if (iconEl) iconEl.value = '📌';
      showToast('Categorie adăugată.', 'success');
      await load();
    } catch (_) {
      showToast('Eroare la adăugarea categoriei.', 'error');
    }
  }

  function startEditCat(id) {
    if (!isAdminUser()) return showToast('Doar admin poate edita categorii.', 'warning');

    const cat = categories.find((c) => c.id === id);
    const row = document.getElementById('cat-admin-row-' + id);
    if (!cat || !row) return;

    row.innerHTML = '' +
      '<input type="text" id="eCatIcon-' + id + '" value="' + esc(cat.icon || '📌') + '" style="width:58px;text-align:center;font-size:20px;padding:0 6px">' +
      '<input type="text" id="eCatName-' + id + '" value="' + esc(cat.name) + '" style="flex:1;min-width:120px">' +
      '<button class="btn btn-primary btn-sm" type="button" onclick="RecomandariModule.saveEditCat(' + id + ')">✓</button>' +
      '<button class="btn btn-secondary btn-sm" type="button" onclick="RecomandariModule.load()">✕</button>';
  }

  async function saveEditCat(id) {
    if (!isAdminUser()) return showToast('Doar admin poate edita categorii.', 'warning');

    const icon = String((document.getElementById('eCatIcon-' + id) || {}).value || '').trim() || '📌';
    const name = String((document.getElementById('eCatName-' + id) || {}).value || '').trim();
    if (!name) return showToast('Numele categoriei nu poate fi gol.', 'warning');

    try {
      await apiUpdateCat(id, icon, name);
      showToast('Categorie actualizată.', 'success');
      await load();
    } catch (_) {
      showToast('Eroare la actualizare categorie.', 'error');
    }
  }

  async function delCat(id) {
    if (!isAdminUser()) return showToast('Doar admin poate șterge categorii.', 'warning');

    const cat = categories.find((c) => c.id === id);
    const label = cat ? String(cat.name) : 'această categorie';
    if (!confirm('Ștergi categoria "' + label + '"?')) return;

    try {
      await apiDeleteCat(id);
      if (activeCategory === id) activeCategory = null;
      showToast('Categorie ștearsă.', 'success');
      await load();
    } catch (_) {
      showToast('Eroare la ștergere categorie.', 'error');
    }
  }

  function pickCatIcon(icon, targetId) {
    const input = document.getElementById(targetId);
    if (!input) return;
    input.value = icon;
    renderNewCategoryIconPicker();
  }

  return {
    load: load,
    filter: filter,
    filterFromSelect: filterFromSelect,
    setRating: setRating,
    hoverRating: hoverRating,
    resetHover: resetHover,
    setEditRating: setEditRating,
    submit: submit,
    openCreateModal: openCreateModal,
    closeCreateModal: closeCreateModal,
    startEdit: startEdit,
    saveEdit: saveEdit,
    del: del,
    addCat: addCat,
    startEditCat: startEditCat,
    saveEditCat: saveEditCat,
    delCat: delCat,
    pickCatIcon: pickCatIcon
  };
})();

if (typeof window !== 'undefined') {
  window.RecomandariModule = RecomandariModule;
}
