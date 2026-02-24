/* ── Contacte Utile Module ─────────────────────────────── */
/* contacts.js — loaded after main index.html script        */
/* Depends on globals: currentUser, showToast               */

const ContactsModule = (() => {

  // ── State ────────────────────────────────────────────────
  let categories = [];

  // ── API ──────────────────────────────────────────────────
  async function fetchCategories() {
    const res = await fetch('/api/contacts');
    if (!res.ok) throw new Error('Failed to load contacts');
    return res.json();
  }

  async function apiAddCategory(icon, name) {
    const res = await fetch('/api/contacts/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icon, name })
    });
    if (!res.ok) throw new Error('Failed to add category');
    return res.json();
  }

  async function apiUpdateCategory(id, data) {
    const res = await fetch('/api/contacts/categories/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to update category');
    return res.json();
  }

  async function apiDeleteCategory(id) {
    const res = await fetch('/api/contacts/categories/' + id, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to delete category');
  }

  async function apiAddContact(data) {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to add contact');
    return res.json();
  }

  async function apiUpdateContact(id, data) {
    const res = await fetch('/api/contacts/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to update contact');
    return res.json();
  }

  async function apiDeleteContact(id) {
    const res = await fetch('/api/contacts/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete contact');
  }

  // ── Render ───────────────────────────────────────────────
  function renderContactCard(contact, isAdmin) {
    const adminActions = isAdmin ? `
      <div class="contact-admin-actions">
        <button class="btn btn-secondary btn-sm"
                onclick="ContactsModule.startEditContact(${contact.id})">
          ✏ Editează
        </button>
        <button class="btn btn-danger btn-sm"
                onclick="ContactsModule.deleteContact(${contact.id})">
          🗑
        </button>
      </div>` : '';

    return `
      <div class="contact-card ${!contact.active ? 'contact-inactive' : ''}"
           id="contact-card-${contact.id}">
        <div class="contact-info">
          <span class="contact-name">${escHtml(contact.name)}</span>
          ${contact.notes
            ? `<span class="contact-notes">${escHtml(contact.notes)}</span>`
            : ''}
        </div>
        <a href="tel:${escHtml(contact.phone)}" class="contact-call-btn">
          📞 ${escHtml(contact.phone)}
        </a>
        ${adminActions}
      </div>`;
  }

  function renderEditContactForm(contact) {
    return `
      <div class="contact-card" id="contact-card-${contact.id}">
        <div class="contact-info" style="flex:1">
          <input type="text" id="edit-name-${contact.id}"
                 value="${escHtml(contact.name)}"
                 placeholder="Nume" style="width:100%;margin-bottom:6px">
          <input type="tel" id="edit-phone-${contact.id}"
                 value="${escHtml(contact.phone)}"
                 placeholder="Telefon" style="width:100%;margin-bottom:6px">
          <input type="text" id="edit-notes-${contact.id}"
                 value="${escHtml(contact.notes || '')}"
                 placeholder="Note (opțional)" style="width:100%">
        </div>
        <div class="contact-admin-actions" style="margin-top:8px">
          <button class="btn btn-primary btn-sm"
                  onclick="ContactsModule.saveEditContact(${contact.id})">
            ✓ Salvează
          </button>
          <button class="btn btn-secondary btn-sm"
                  onclick="ContactsModule.load()">
            Anulează
          </button>
        </div>
      </div>`;
  }

  function renderCategoryGroup(cat, isAdmin) {
    const cards = cat.contacts && cat.contacts.length
      ? cat.contacts.map(c => renderContactCard(c, isAdmin)).join('')
      : '<p class="contacts-empty-cat">Niciun contact în această categorie.</p>';

    return `
      <div class="contacts-category-group" id="cat-group-${cat.id}">
        <div class="contacts-category-header"
             onclick="ContactsModule.toggleCategory(${cat.id})">
          <span class="contacts-category-icon">${escHtml(cat.icon)}</span>
          <span class="contacts-category-name">${escHtml(cat.name)}</span>
          <span class="contacts-category-count">
            ${cat.contacts ? cat.contacts.length : 0}
          </span>
          <span class="contacts-category-chevron"
                id="chevron-${cat.id}"
                style="transform:rotate(90deg)">›</span>
        </div>
        <div class="contacts-category-body" id="cat-body-${cat.id}">
          ${cards}
        </div>
      </div>`;
  }

  function renderAdminPanel(cats) {
    const catRows = cats.map(c => `
      <div class="category-admin-row" id="cat-admin-row-${c.id}">
        <span>${escHtml(c.icon)} ${escHtml(c.name)}</span>
        <button class="btn btn-secondary btn-sm"
                onclick="ContactsModule.startEditCategory(${c.id})">
          ✏
        </button>
        <button class="btn btn-danger btn-sm"
                onclick="ContactsModule.deleteCategory(${c.id})">
          🗑
        </button>
      </div>`).join('');

    const catOptions = cats.map(c =>
      `<option value="${c.id}">${escHtml(c.icon)} ${escHtml(c.name)}</option>`
    ).join('');

    document.getElementById('contactsCategoryRows').innerHTML = catRows;
    document.getElementById('contactCategorySelect').innerHTML = catOptions;
  }

  // ── Public Actions ───────────────────────────────────────
  async function load() {
    try {
      categories = await fetchCategories();
      const isAdmin = currentUser?.role === 'admin';
      const list = document.getElementById('contactsList');

      if (!categories.length) {
        list.innerHTML = `
          <div class="empty-state">
            <p class="empty-state-title">Niciun contact adăugat încă.</p>
            <p class="empty-state-body">
              Administratorul va adăuga în curând numerele utile.
            </p>
          </div>`;
      } else {
        list.innerHTML = categories.map(c =>
          renderCategoryGroup(c, isAdmin)).join('');
      }

      const adminZone = document.getElementById('contactsAdminZone');
      if (isAdmin) {
        adminZone.style.display = 'block';
        renderAdminPanel(categories);
      } else {
        adminZone.style.display = 'none';
      }

    } catch(e) {
      showToast('Eroare la încărcarea contactelor.', 'error');
    }
  }

  function toggleCategory(id) {
    const body = document.getElementById('cat-body-' + id);
    const chevron = document.getElementById('chevron-' + id);
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
  }

  async function addCategory() {
    const icon = document.getElementById('newCatIcon').value.trim() || '📋';
    const name = document.getElementById('newCatName').value.trim();
    if (!name) { showToast('Introdu un nume pentru categorie.', 'warning'); return; }
    try {
      await apiAddCategory(icon, name);
      document.getElementById('newCatName').value = '';
      showToast('Categorie adăugată.', 'success');
      load();
    } catch(e) { showToast('Eroare la adăugarea categoriei.', 'error'); }
  }

  function startEditCategory(id) {
    const cat = categories.find(c => c.id === id);
    if (!cat) return;
    const row = document.getElementById('cat-admin-row-' + id);
    row.innerHTML = `
      <input type="text" id="edit-cat-icon-${id}"
             value="${escHtml(cat.icon)}" style="width:48px">
      <input type="text" id="edit-cat-name-${id}"
             value="${escHtml(cat.name)}" style="flex:1">
      <button class="btn btn-primary btn-sm"
              onclick="ContactsModule.saveEditCategory(${id})">✓</button>
      <button class="btn btn-secondary btn-sm"
              onclick="ContactsModule.load()">✕</button>`;
  }

  async function saveEditCategory(id) {
    const icon = document.getElementById('edit-cat-icon-' + id).value.trim();
    const name = document.getElementById('edit-cat-name-' + id).value.trim();
    if (!name) { showToast('Numele nu poate fi gol.', 'warning'); return; }
    try {
      await apiUpdateCategory(id, { icon, name });
      showToast('Categorie actualizată.', 'success');
      load();
    } catch(e) { showToast('Eroare.', 'error'); }
  }

  async function deleteCategory(id) {
    if (!confirm('Ștergi categoria și toate contactele din ea?')) return;
    try {
      await apiDeleteCategory(id);
      showToast('Categorie ștearsă.', 'success');
      load();
    } catch(e) { showToast('Eroare.', 'error'); }
  }

  async function addContact() {
    const category_id = document.getElementById('contactCategorySelect').value;
    const name  = document.getElementById('contactName').value.trim();
    const phone = document.getElementById('contactPhone').value.trim();
    const notes = document.getElementById('contactNotes').value.trim();
    if (!category_id || !name || !phone) {
      showToast('Completează categoria, numele și telefonul.', 'warning');
      return;
    }
    try {
      await apiAddContact({ category_id: parseInt(category_id), name, phone, notes });
      document.getElementById('contactName').value = '';
      document.getElementById('contactPhone').value = '';
      document.getElementById('contactNotes').value = '';
      showToast('Contact adăugat.', 'success');
      load();
    } catch(e) { showToast('Eroare la adăugarea contactului.', 'error'); }
  }

  function startEditContact(id) {
    const contact = categories.flatMap(c => c.contacts || []).find(c => c.id === id);
    if (!contact) return;
    const card = document.getElementById('contact-card-' + id);
    card.outerHTML = renderEditContactForm(contact);
  }

  async function saveEditContact(id) {
    const name  = document.getElementById('edit-name-' + id).value.trim();
    const phone = document.getElementById('edit-phone-' + id).value.trim();
    const notes = document.getElementById('edit-notes-' + id).value.trim();
    if (!name || !phone) {
      showToast('Numele și telefonul sunt obligatorii.', 'warning');
      return;
    }
    try {
      await apiUpdateContact(id, { name, phone, notes });
      showToast('Contact actualizat.', 'success');
      load();
    } catch(e) { showToast('Eroare.', 'error'); }
  }

  async function deleteContact(id) {
    if (!confirm('Ștergi acest contact?')) return;
    try {
      await apiDeleteContact(id);
      showToast('Contact șters.', 'success');
      load();
    } catch(e) { showToast('Eroare.', 'error'); }
  }

  // ── Utils ────────────────────────────────────────────────
  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Public API ───────────────────────────────────────────
  return {
    load,
    toggleCategory,
    addCategory,
    startEditCategory,
    saveEditCategory,
    deleteCategory,
    addContact,
    startEditContact,
    saveEditContact,
    deleteContact
  };

})();

// Expose for inline onclick handlers in the injected HTML fragment.
window.ContactsModule = ContactsModule;

// Backward-compatible breadcrumb helper used by contacts.html.
if (typeof window.showHome !== 'function') {
  window.showHome = function () {
    if (typeof showModuleSelector === 'function') {
      showModuleSelector();
    }
  };
}
