/* recomandari.js — loaded after main index.html script */
/* Depends on globals: currentUser, showToast */

const RecomandariModule = (() => {
  // ── State ─────────────────────────────────────────────
  let allRecs = [];
  let categories = [];
  let activeCategory = null;
  let selectedRating = 0;
  let editRating = 0;
  let editingRecId = null;

  const ICON_CHOICES = ['🍽️','🔧','🏥','🎓','🛒','✂️','📦','🏋️','🐶','🚗','🧰','⚖️','🏠','☕','🧒','📚','💻','📌'];

  const CAT_COLORS = {
    'Mâncare': '#F97316',
    'Servicii': '#3B82F6',
    'Sănătate': '#EF4444',
    'Educație': '#8B5CF6',
    'Shopping': '#0D9488',
    'Frumusețe': '#EC4899',
    'Altele': '#78716C'
  };

  function getCatColor(name) {
    return CAT_COLORS[name] || 'var(--accent-primary)';
  }

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function starsHtml(n, size) {
    const starSize = size || 14;
    return [1, 2, 3, 4, 5].map((i) =>
      '<span style="font-size:' + starSize + 'px;opacity:' + (i <= (n || 0) ? '1' : '0.2') + '">⭐</span>'
    ).join('');
  }

  function timeStr(ts) {
    if (typeof window.timeAgoRo === 'function') return window.timeAgoRo(ts);
    return ts ? String(ts).slice(0, 10) : '';
  }

  function getCurrentUserBuilding() {
    if (!window.currentUser) return '';
    return currentUser.building || currentUser.building_number || '';
  }

  function isAdminUser() {
    return String((window.currentUser && currentUser.role) || '').trim().toLowerCase() === 'admin';
  }

  function normalizeWebsite(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    return 'https://' + value;
  }

  function iconPickerHtml(targetId, activeIcon) {
    return ICON_CHOICES.map((icon) => {
      const activeClass = (activeIcon || '') === icon ? 'active' : '';
      return '<button type="button" class="rec-icon-chip ' + activeClass + '" ' +
        'onclick="RecomandariModule.pickCatIcon(\'' + icon + '\', \'' + targetId + '\')" ' +
        'aria-label="Alege iconița ' + esc(icon) + '">' + esc(icon) + '</button>';
    }).join('');
  }

  function updatePickerSelection(targetId) {
    const input = document.getElementById(targetId);
    const value = input ? input.value.trim() : '';
    const root = document.querySelector('[data-icon-picker-for="' + targetId + '"]');
    if (!root) return;
    root.querySelectorAll('.rec-icon-chip').forEach((chip) => {
      chip.classList.toggle('active', chip.textContent === value);
    });
  }

  function renderAddCategoryPicker() {
    const picker = document.getElementById('recNewCatIconPicker');
    if (!picker) return;
    const iconInput = document.getElementById('recNewCatIcon');
    const activeIcon = iconInput && iconInput.value ? iconInput.value.trim() : '📌';
    picker.setAttribute('data-icon-picker-for', 'recNewCatIcon');
    picker.innerHTML = iconPickerHtml('recNewCatIcon', activeIcon);
    updatePickerSelection('recNewCatIcon');
  }

  function ensureValidActiveCategory() {
    if (!activeCategory) return;
    const exists = categories.some((c) => c.id === activeCategory);
    if (!exists) activeCategory = null;
  }

  // ── API ───────────────────────────────────────────────
  async function fetchRecs() {
    const r = await fetch('/api/recommendations');
    if (!r.ok) throw new Error('Eroare la încărcarea recomandărilor');
    return r.json();
  }

  async function fetchCats() {
    const r = await fetch('/api/rec-categories');
    if (!r.ok) throw new Error('Eroare la încărcarea categoriilor');
    return r.json();
  }

  async function apiCreateRec(data) {
    const r = await fetch('/api/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error('Eroare la crearea recomandării');
    return r.json();
  }

  async function apiUpdateRec(id, data) {
    const r = await fetch('/api/recommendations/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error('Eroare la actualizarea recomandării');
    return r.json();
  }

  async function apiDeleteRec(id) {
    const r = await fetch('/api/recommendations/' + id, { method: 'DELETE' });
    if (!r.ok) throw new Error('Eroare la ștergerea recomandării');
  }

  async function apiCreateCat(icon, name) {
    const r = await fetch('/api/rec-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icon: icon, name: name })
    });
    if (!r.ok) throw new Error('Eroare la crearea categoriei');
    return r.json();
  }

  async function apiUpdateCat(id, icon, name) {
    const r = await fetch('/api/rec-categories/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icon: icon, name: name })
    });
    if (!r.ok) throw new Error('Eroare la actualizarea categoriei');
    return r.json();
  }

  async function apiDeleteCat(id) {
    const r = await fetch('/api/rec-categories/' + id, { method: 'DELETE' });
    if (!r.ok) throw new Error('Eroare la ștergerea categoriei');
  }

  // ── Render ────────────────────────────────────────────
  function sortCategories(list) {
    return (list || []).slice().sort((a, b) => {
      const ao = Number(a.display_order || 0);
      const bo = Number(b.display_order || 0);
      if (ao !== bo) return ao - bo;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ro', { sensitivity: 'base' });
    });
  }

  function renderCategoryFilter() {
    const el = document.getElementById('recCategoryFilter');
    if (!el) return;
    const options = ['<option value="">📋 Toate categoriile</option>'];
    sortCategories(categories).forEach((c) => {
      options.push('<option value="' + c.id + '" ' + (activeCategory === c.id ? 'selected' : '') + '>' + esc(c.icon) + ' ' + esc(c.name) + '</option>');
    });
    el.innerHTML = options.join('');
    el.value = activeCategory ? String(activeCategory) : '';
  }

  function renderCategorySection(cat, items) {
    const safeName = cat && cat.name ? cat.name : 'Fără categorie';
    const safeIcon = cat && cat.icon ? cat.icon : '📌';
    const color = getCatColor(safeName);
    return '\n      <section class="rec-category-group" style="--rec-color:' + color + '">' +
      '\n        <div class="rec-category-group-header">' +
      '\n          <div class="rec-category-group-title">' + esc(safeIcon) + ' ' + esc(safeName) + '</div>' +
      '\n          <span class="rec-category-group-count">' + items.length + '</span>' +
      '\n        </div>' +
      '\n        <div class="rec-category-group-body">' + items.map(renderCard).join('') + '</div>' +
      '\n      </section>';
  }

  function renderList() {
    const el = document.getElementById('recList');
    if (!el) return;

    if (activeCategory) {
      const list = allRecs.filter((r) => r.category_id === activeCategory);
      if (!list.length) {
        const catName = (categories.find((c) => c.id === activeCategory) || {}).name || '';
        el.innerHTML = '\n        <div class="rec-empty">\n          <div class="rec-empty-icon">💡</div>\n          <div class="rec-empty-title">' +
          (catName ? ('Nicio recomandare pentru &quot;' + esc(catName) + '&quot; încă.') : 'Nicio recomandare adăugată încă.') +
          '</div>\n          <div class="rec-empty-sub">Fii primul care recomandă ceva vecinilor!</div>\n        </div>';
        return;
      }
      el.innerHTML = list.map(renderCard).join('');
      return;
    }

    if (!allRecs.length) {
      el.innerHTML = '\n        <div class="rec-empty">\n          <div class="rec-empty-icon">💡</div>\n          <div class="rec-empty-title">Nicio recomandare adăugată încă.</div>\n          <div class="rec-empty-sub">Fii primul care recomandă ceva vecinilor!</div>\n        </div>';
      return;
    }

    const categoryIds = new Set(categories.map((c) => c.id));
    const sections = [];
    sortCategories(categories).forEach((cat) => {
      const catItems = allRecs.filter((r) => r.category_id === cat.id);
      if (catItems.length) sections.push(renderCategorySection(cat, catItems));
    });

    const uncategorized = allRecs.filter((r) => !r.category_id || !categoryIds.has(r.category_id));
    if (uncategorized.length) {
      sections.push(renderCategorySection({ id: null, name: 'Fără categorie', icon: '📌' }, uncategorized));
    }

    el.innerHTML = sections.join('');
  }

  function renderCard(rec) {
    const cat = categories.find((c) => c.id === rec.category_id);
    const catName = cat ? cat.name : 'Fără categorie';
    const catIcon = cat ? cat.icon : '📌';
    const color = getCatColor(catName);
    const isOwn = currentUser && currentUser.username === rec.added_by;
    const isAdmin = isAdminUser();
    const canEdit = Boolean(isOwn || isAdmin);

    const phonePart = rec.phone
      ? '<a href="tel:' + esc(rec.phone) + '" class="rec-phone-btn">📞 ' + esc(rec.phone) + '</a>'
      : '';
    const webUrl = normalizeWebsite(rec.website || '');
    const websitePart = webUrl
      ? '<a href="' + esc(webUrl) + '" class="rec-web-btn" target="_blank" rel="noopener noreferrer">🌐 Website</a>'
      : '';

    const adminPart = canEdit ?
      '<div class="rec-admin-actions">' +
        '<button class="btn btn-secondary btn-sm" type="button" onclick="RecomandariModule.startEdit(' + rec.id + ')">✏ Editează</button>' +
        '<button class="btn btn-danger btn-sm" type="button" onclick="RecomandariModule.del(' + rec.id + ')">🗑 Șterge</button>' +
      '</div>' : '';

    return '\n      <div class="rec-card" id="rec-card-' + rec.id + '" style="--rec-color:' + color + '">\n        <div class="rec-card-header">\n          <div class="rec-card-title-group">\n            <div class="rec-name">' + esc(rec.name) + '</div>' +
              (rec.area ? ('<div class="rec-area">📍 ' + esc(rec.area) + '</div>') : '') +
          '</div>\n          <div class="rec-stars">' + starsHtml(rec.rating) + '</div>\n        </div>\n        <div class="rec-badges">\n          <span class="rec-badge">' + esc(catIcon) + ' ' + esc(catName) + '</span>\n        </div>\n        <div class="rec-why">' + esc(rec.why) + '</div>\n        <div class="rec-card-footer">\n          <div class="rec-meta">\n            <span>👤 ' + esc(rec.added_by) + '</span>' +
            (rec.building ? ('<span>· Bloc ' + esc(rec.building) + '</span>') : '') +
            '<span>· ' + timeStr(rec.created_at) + '</span>\n          </div>\n          <div class="rec-actions">' + phonePart + websitePart + '</div>\n        </div>' +
        adminPart +
      '\n      </div>';
  }

  function renderEditForm(rec) {
    const cat = categories.find((c) => c.id === rec.category_id);
    const color = getCatColor((cat && cat.name) || 'Altele');
    editRating = rec.rating || 0;

    const catOptions = categories.map((c) =>
      '<option value="' + c.id + '" ' + (c.id === rec.category_id ? 'selected' : '') + '>' + esc(c.icon) + ' ' + esc(c.name) + '</option>'
    ).join('');

    const editStars = [1, 2, 3, 4, 5].map((i) => (
      '<span id="eStar' + i + '" onclick="RecomandariModule.setEditRating(' + i + ')" ' +
      'style="font-size:28px;cursor:pointer;min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;opacity:' + (i <= editRating ? '1' : '0.25') + '">⭐</span>'
    )).join('');

    return '\n      <div class="rec-card" id="rec-card-' + rec.id + '" style="--rec-color:' + color + ';border-color:var(--accent-primary)">\n        <div class="rec-edit-form">\n          <div>\n            <label>Nume *</label>\n            <input type="text" id="eRecName" value="' + esc(rec.name) + '" placeholder="Numele locului sau persoanei">\n          </div>\n          <div>\n            <label>Categorie *</label>\n            <select id="eRecCat">' + catOptions + '</select>\n          </div>\n          <div>\n            <label>Zonă / Adresă</label>\n            <input type="text" id="eRecArea" value="' + esc(rec.area || '') + '" placeholder="ex: Bd. Unirii, Sector 3">\n          </div>\n          <div>\n            <label>Telefon</label>\n            <input type="tel" id="eRecPhone" value="' + esc(rec.phone || '') + '" placeholder="07xx xxx xxx">\n          </div>\n          <div>\n            <label>Website</label>\n            <input type="url" id="eRecWebsite" value="' + esc(rec.website || '') + '" placeholder="https://exemplu.ro">\n          </div>\n          <div>\n            <label>Rating *</label>\n            <div style="display:flex;gap:4px">' + editStars + '</div>\n          </div>\n          <div>\n            <label>De ce recomanzi? *</label>\n            <textarea id="eRecWhy">' + esc(rec.why) + '</textarea>\n          </div>\n          <div class="rec-edit-actions">\n            <button class="btn btn-primary" type="button" onclick="RecomandariModule.saveEdit(' + rec.id + ')">✓ Salvează</button>\n            <button class="btn btn-secondary" type="button" onclick="RecomandariModule.load()">Anulează</button>\n          </div>\n        </div>\n      </div>';
  }

  function populateSelect() {
    const sel = document.getElementById('recFormCategory');
    if (!sel) return;
    sel.innerHTML = categories.map((c) =>
      '<option value="' + c.id + '">' + esc(c.icon) + ' ' + esc(c.name) + '</option>'
    ).join('');
  }

  function renderAdminPanel() {
    const el = document.getElementById('recAdminZone');
    if (!el) return;
    if (!isAdminUser()) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';

    const rows = categories.map((c) =>
      '<div class="rec-cat-manage-row" id="cat-admin-row-' + c.id + '">' +
        '<span class="cat-label">' + esc(c.icon) + ' ' + esc(c.name) + '</span>' +
        '<button class="btn btn-secondary btn-sm" type="button" onclick="RecomandariModule.startEditCat(' + c.id + ')">✏</button>' +
        '<button class="btn btn-danger btn-sm" type="button" onclick="RecomandariModule.delCat(' + c.id + ')">🗑</button>' +
      '</div>'
    ).join('');

    const listEl = document.getElementById('recCatManageList');
    if (listEl) {
      listEl.innerHTML = rows || '<p style="font-size:13px;color:var(--text-muted);padding:8px">Nicio categorie.</p>';
    }
    renderAddCategoryPicker();
  }

  // ── Public: load ──────────────────────────────────────
  async function load() {
    try {
      const data = await Promise.all([fetchRecs(), fetchCats()]);
      allRecs = Array.isArray(data[0]) ? data[0] : [];
      categories = Array.isArray(data[1]) ? data[1] : [];
      ensureValidActiveCategory();
      renderCategoryFilter();
      renderList();
      populateSelect();
      renderAdminPanel();
      const ts = document.getElementById('recRefreshedAt');
      if (ts) ts.textContent = 'acum';
    } catch (e) {
      showToast('Eroare la încărcarea recomandărilor.', 'error');
    }
  }

  // ── Public: filter ────────────────────────────────────
  function filter(catId) {
    const parsed = Number(catId);
    activeCategory = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    renderCategoryFilter();
    renderList();
  }

  function filterFromSelect() {
    const sel = document.getElementById('recCategoryFilter');
    const val = sel ? sel.value : '';
    filter(val ? parseInt(val, 10) : null);
  }

  // ── Public: star rating (add form) ───────────────────
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
    [1, 2, 3, 4, 5].forEach((i) => {
      const el = document.getElementById('rStar' + i);
      if (el) el.style.opacity = i <= selectedRating ? '1' : '0.25';
    });
  }

  // ── Public: star rating (edit form) ──────────────────
  function setEditRating(n) {
    editRating = n;
    [1, 2, 3, 4, 5].forEach((i) => {
      const el = document.getElementById('eStar' + i);
      if (el) el.style.opacity = i <= n ? '1' : '0.25';
    });
  }

  // ── Public: submit new rec ────────────────────────────
  async function submit() {
    if (!currentUser || !currentUser.username) {
      showToast('Trebuie să fii autentificat.', 'warning');
      return;
    }

    const name = (document.getElementById('recFormName') || {}).value ? document.getElementById('recFormName').value.trim() : '';
    const catId = parseInt(((document.getElementById('recFormCategory') || {}).value || ''), 10);
    const area = (document.getElementById('recFormArea') || {}).value ? document.getElementById('recFormArea').value.trim() : '';
    const phone = (document.getElementById('recFormPhone') || {}).value ? document.getElementById('recFormPhone').value.trim() : '';
    const website = normalizeWebsite((document.getElementById('recFormWebsite') || {}).value || '');
    const why = (document.getElementById('recFormWhy') || {}).value ? document.getElementById('recFormWhy').value.trim() : '';

    if (!name) { showToast('Introdu numele locului sau persoanei.', 'warning'); return; }
    if (!Number.isFinite(catId)) { showToast('Selectează o categorie.', 'warning'); return; }
    if (!why || why.length < 10) { showToast('Explică de ce recomanzi (minim 10 caractere).', 'warning'); return; }
    if (!selectedRating) { showToast('Selectează un rating (1-5 stele).', 'warning'); return; }

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
        why: why,
        rating: selectedRating,
        added_by: currentUser.username,
        building: getCurrentUserBuilding()
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
      showToast('Recomandare adăugată! Mulțumim 🙏', 'success');
      await load();
    } catch (e) {
      showToast('Eroare la adăugare.', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '+ Adaugă recomandare';
      }
    }
  }

  // ── Public: inline edit rec ───────────────────────────
  function startEdit(id) {
    const rec = allRecs.find((r) => r.id === id);
    if (!rec) return;
    editingRecId = id;
    const card = document.getElementById('rec-card-' + id);
    if (card) card.outerHTML = renderEditForm(rec);
  }

  async function saveEdit(id) {
    const name = (document.getElementById('eRecName') || {}).value ? document.getElementById('eRecName').value.trim() : '';
    const catId = parseInt(((document.getElementById('eRecCat') || {}).value || ''), 10);
    const area = (document.getElementById('eRecArea') || {}).value ? document.getElementById('eRecArea').value.trim() : '';
    const phone = (document.getElementById('eRecPhone') || {}).value ? document.getElementById('eRecPhone').value.trim() : '';
    const website = normalizeWebsite((document.getElementById('eRecWebsite') || {}).value || '');
    const why = (document.getElementById('eRecWhy') || {}).value ? document.getElementById('eRecWhy').value.trim() : '';

    if (!name) { showToast('Numele nu poate fi gol.', 'warning'); return; }
    if (!Number.isFinite(catId)) { showToast('Selectează o categorie.', 'warning'); return; }
    if (!why || why.length < 10) { showToast('Explică de ce recomanzi.', 'warning'); return; }
    if (!editRating) { showToast('Selectează un rating.', 'warning'); return; }

    try {
      const payload = {
        name: name,
        category_id: catId,
        area: area,
        phone: phone,
        why: why,
        rating: editRating
      };
      if (website) payload.website = website;
      await apiUpdateRec(id, payload);
      showToast('Recomandare actualizată.', 'success');
      editingRecId = null;
      await load();
    } catch (e) {
      showToast('Eroare la actualizare.', 'error');
    }
  }

  // ── Public: delete rec ────────────────────────────────
  async function del(id) {
    if (!confirm('Ștergi această recomandare?')) return;
    try {
      await apiDeleteRec(id);
      if (editingRecId === id) editingRecId = null;
      showToast('Recomandare ștearsă.', 'success');
      await load();
    } catch (e) {
      showToast('Eroare la ștergere.', 'error');
    }
  }

  // ── Public: category management ───────────────────────
  async function addCat() {
    const iconEl = document.getElementById('recNewCatIcon');
    const nameEl = document.getElementById('recNewCatName');
    const icon = (iconEl && iconEl.value.trim()) || '📌';
    const name = nameEl ? nameEl.value.trim() : '';
    if (!name) { showToast('Introdu un nume pentru categorie.', 'warning'); return; }
    try {
      await apiCreateCat(icon, name);
      if (nameEl) nameEl.value = '';
      if (iconEl) iconEl.value = '📌';
      renderAddCategoryPicker();
      showToast('Categorie adăugată.', 'success');
      await load();
    } catch (e) {
      showToast('Eroare la adăugare.', 'error');
    }
  }

  function startEditCat(id) {
    const cat = categories.find((c) => c.id === id);
    if (!cat) return;
    const row = document.getElementById('cat-admin-row-' + id);
    if (!row) return;
    row.innerHTML = '\n      <div class="rec-cat-manage-edit">\n        <div class="rec-cat-manage-edit-row">\n          <input type="text" id="eCatIcon-' + id + '" class="rec-cat-edit-icon" value="' + esc(cat.icon) + '" maxlength="2" aria-label="Icon categorie">\n          <input type="text" id="eCatName-' + id + '" class="rec-cat-edit-name" value="' + esc(cat.name) + '" aria-label="Nume categorie">\n          <button class="btn btn-primary btn-sm" type="button" onclick="RecomandariModule.saveEditCat(' + id + ')">✓</button>\n          <button class="btn btn-secondary btn-sm" type="button" onclick="RecomandariModule.load()">✕</button>\n        </div>\n        <div class="rec-icon-picker" data-icon-picker-for="eCatIcon-' + id + '">' + iconPickerHtml('eCatIcon-' + id, cat.icon) + '</div>\n      </div>';
    updatePickerSelection('eCatIcon-' + id);
  }

  async function saveEditCat(id) {
    const icon = ((document.getElementById('eCatIcon-' + id) || {}).value || '').trim();
    const name = ((document.getElementById('eCatName-' + id) || {}).value || '').trim();
    if (!name) { showToast('Numele nu poate fi gol.', 'warning'); return; }
    try {
      await apiUpdateCat(id, icon || '📌', name);
      showToast('Categorie actualizată.', 'success');
      await load();
    } catch (e) {
      showToast('Eroare.', 'error');
    }
  }

  async function delCat(id) {
    const cat = categories.find((c) => c.id === id);
    const msg = 'Ștergi categoria "' + ((cat && cat.name) || '') + '"? Toate recomandările din ea rămân, dar fără categorie.';
    if (!confirm(msg)) return;
    try {
      await apiDeleteCat(id);
      if (activeCategory === id) activeCategory = null;
      showToast('Categorie ștearsă.', 'success');
      await load();
    } catch (e) {
      showToast('Eroare.', 'error');
    }
  }

  function pickCatIcon(icon, targetId) {
    const input = document.getElementById(targetId);
    if (!input) return;
    input.value = icon;
    updatePickerSelection(targetId);
    try { input.focus(); } catch (_) {}
  }

  // ── Public API ────────────────────────────────────────
  return {
    load: load,
    filter: filter,
    filterFromSelect: filterFromSelect,
    setRating: setRating,
    hoverRating: hoverRating,
    resetHover: resetHover,
    setEditRating: setEditRating,
    submit: submit,
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
