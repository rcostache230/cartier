export const runtime = "nodejs";

const VERCEL_ANALYTICS_SNIPPET = `
    <script>
      window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    </script>
    <script defer src="/_vercel/insights/script.js"></script>`;

function profileHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Profile Management</title>
    <style>
      :root {
        --bg: #f8fafc;
        --card: #ffffff;
        --line: #e2e8f0;
        --ink: #1a2332;
        --muted: #64748b;
        --border: var(--line);
        --text-primary: var(--ink);
        --text-secondary: var(--muted);
        --accent-primary: #16a34a;
        --shadow-sm: 0 6px 14px rgba(15, 23, 42, 0.08);
        --shadow-md: 0 10px 20px rgba(15, 23, 42, 0.12);
        --teal: #10b981;
        --danger: #ef4444;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 14px;
        color: var(--ink);
        background: var(--bg);
      }

      .container {
        max-width: 1240px;
        margin: 0 auto;
        padding: 24px;
      }

      .hero,
      .card {
        border-radius: 12px;
        border: 1px solid var(--line);
        background: var(--card);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
      }

      .hero {
        padding: 24px;
      }

      .hero-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }

      .hero h1 {
        margin: 0;
      }

      .hero p {
        margin: 8px 0 0;
        color: var(--muted);
      }

      .back-link {
        text-decoration: none;
        color: #fff;
        background: #1a2332;
        border: 1px solid #1a2332;
        border-radius: 8px;
        min-height: 44px;
        width: auto;
        padding: 10px 12px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
      }

      .hidden {
        display: none !important;
      }

      .card {
        padding: 22px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 16px;
      }

      .stack {
        display: grid;
        gap: 12px;
      }

      input,
      select,
      button,
      textarea {
        width: 100%;
        min-height: 44px;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 10px 12px;
        font: inherit;
      }

      textarea {
        min-height: 96px;
        resize: vertical;
      }

      label {
        color: var(--muted);
        font-size: 0.84rem;
        font-weight: 700;
      }

      button {
        border: 1px solid transparent;
        cursor: pointer;
        font-weight: 700;
        color: #fff;
        background: var(--teal);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .subnav-btn,
      .activity-tab-btn,
      .danger-item button,
      .mini-card button,
      [data-user-editor] button,
      .table-wrap button,
      .modal-actions button,
      .admin-toolbar button {
        width: auto;
      }

      button:disabled {
        opacity: 0.65;
        cursor: wait;
      }

      button.ghost {
        color: #334155;
        background: #f8fafc;
        border-color: #cbd5e1;
      }

      button.danger {
        background: var(--danger);
        border-color: var(--danger);
      }

      .btn-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255, 255, 255, 0.45);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .profile-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }

      .profile-user {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .avatar {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: linear-gradient(135deg, #10b981, #0ea5e9);
        color: #fff;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        letter-spacing: 0.04em;
      }

      .profile-meta {
        display: grid;
        gap: 4px;
      }

      .profile-meta b {
        font-size: 1rem;
      }

      .profile-meta span {
        color: var(--muted);
        font-size: 0.82rem;
      }

      .inline-form {
        display: flex;
        gap: 8px;
        align-items: flex-end;
        flex-wrap: wrap;
      }

      .inline-form > div {
        flex: 1;
        min-width: 200px;
      }

      .subnav {
        margin-top: 14px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .subnav-btn {
        width: auto;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #fff;
        color: #334155;
        padding: 8px 12px;
      }

      .subnav-btn.active {
        background: #10b981;
        border-color: #10b981;
        color: #fff;
      }

      .section-title {
        margin: 0 0 8px;
      }

      .activity-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .activity-tab-btn {
        width: auto;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #fff;
        color: #334155;
        padding: 7px 11px;
      }

      .activity-tab-btn.active {
        background: #10b981;
        color: #fff;
        border-color: #10b981;
      }

      .table-wrap {
        margin-top: 10px;
        overflow: auto;
        max-height: 320px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.84rem;
      }

      th,
      td {
        text-align: left;
        border-bottom: 1px solid var(--line);
        padding: 7px 5px;
        vertical-align: top;
      }

      .mobile-card-list {
        display: none;
      }

      .mini-card {
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 12px;
        background: #fff;
        display: grid;
        gap: 8px;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
      }

      .mini-card-title {
        font-weight: 800;
      }

      .mini-card-meta {
        color: #334155;
        font-size: 0.82rem;
        display: grid;
        gap: 4px;
      }

      .danger-zone {
        border: 1px solid #fecaca;
        border-radius: 12px;
        background: #fff7f7;
        padding: 14px;
      }

      .danger-zone h3 {
        margin: 0 0 8px;
        color: #991b1b;
      }

      .danger-list {
        display: grid;
        gap: 8px;
      }

      .danger-item {
        border: 1px solid #fecaca;
        border-radius: 10px;
        background: #fff;
        padding: 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .poll-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 4px 9px;
        border: 1px solid #d7d2c8;
        background: #f6f1e7;
        color: #2b3b46;
        font-size: 0.76rem;
        font-weight: 700;
      }

      .poll-chip.building {
        background: #eef0fa;
        border-color: #c9d0ee;
        color: #334070;
      }

      .poll-chip.neighbourhood {
        background: #e8f6f5;
        border-color: #b9ddd8;
        color: #155a52;
      }

      .poll-chip.voted {
        background: #ddf0e8;
        border-color: #93d7b1;
        color: #17663c;
      }

      .feedback {
        border-radius: 10px;
        border: 1px solid #d8e3e2;
        background: #edf8f6;
        color: #155a52;
        font-size: 0.86rem;
        padding: 8px 10px;
      }

      .feedback.error {
        border-color: #fecaca;
        background: #fef2f2;
        color: #b91c1c;
      }

      .admin-toolbar {
        display: flex;
        gap: 8px;
        align-items: flex-end;
        flex-wrap: wrap;
      }

      .admin-toolbar > div {
        min-width: 180px;
      }

      .admin-grid {
        display: grid;
        gap: 16px;
      }

      .sortable {
        cursor: pointer;
      }

      .sortable:hover {
        text-decoration: underline;
      }

      .modal {
        position: fixed;
        inset: 0;
        z-index: 1400;
        background: rgba(15, 23, 42, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }

      .modal-card {
        width: min(520px, 100%);
        border-radius: 12px;
        border: 1px solid var(--line);
        background: #fff;
        padding: 18px;
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.2);
      }

      .modal-actions {
        margin-top: 12px;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .toast-wrap {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2000;
        display: grid;
        gap: 8px;
      }

      .toast {
        min-width: 250px;
        max-width: 420px;
        border-radius: 10px;
        padding: 10px 12px;
        color: #fff;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
        font-size: 0.88rem;
      }

      .toast.success {
        background: #10b981;
      }

      .toast.error {
        background: #ef4444;
      }

      .lucide {
        width: 16px;
        height: 16px;
        stroke-width: 2.2;
      }

      @media (max-width: 640px) {
        .container {
          padding: 14px;
        }

        .table-wrap {
          display: none;
        }

        .mobile-card-list {
          display: grid;
          gap: 10px;
          margin-top: 10px;
        }

        .inline-form > div,
        .admin-toolbar > div {
          min-width: 100%;
        }

        .modal {
          align-items: flex-end;
          padding: 0;
        }

        .modal-card {
          width: 100%;
          border-radius: 14px 14px 0 0;
          border-bottom: 0;
          padding-bottom: 18px;
        }

        .toast-wrap {
          left: 12px;
          right: 12px;
          bottom: 12px;
        }

        .toast {
          min-width: 0;
          max-width: none;
        }
      }

      /* Atomic UI Components */
      .mt-14 {
        margin-top: 14px;
      }

      .card,
      .mini-card {
        background: var(--card);
        border-radius: 16px;
        padding: 16px 20px;
        box-shadow: var(--shadow-sm);
        border: 1px solid var(--border);
        transition: box-shadow 150ms ease, transform 150ms ease;
      }

      .card-error {
        border-color: #fecaca;
        background: #fef2f2;
        color: #b91c1c;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 3px 10px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.03em;
        white-space: nowrap;
      }

      .badge-green { background: #dcfce7; color: #15803d; }
      .badge-amber { background: #fef3c7; color: #b45309; }
      .badge-red { background: #fee2e2; color: #b91c1c; }
      .badge-blue { background: #dbeafe; color: #1d4ed8; }
      .badge-purple { background: #ede9fe; color: #6d28d9; }
      .badge-teal { background: #ccfbf1; color: #0f766e; }
      .badge-gray { background: #f4f4f5; color: #52525b; }

      .btn,
      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 38px;
        padding: 0 16px;
        border-radius: 9px;
        font-weight: 500;
        font-size: 14px;
        cursor: pointer;
        border: none;
        transition: all 80ms ease;
      }

      button,
      .btn-primary {
        background: var(--accent-primary);
        color: #fff;
      }

      button.ghost,
      .btn-secondary {
        background: transparent;
        border: 1.5px solid var(--border);
        color: var(--text-primary);
      }

      .btn-ghost {
        background: transparent;
        color: var(--text-secondary);
      }

      button.danger,
      .btn-danger {
        background: #fee2e2;
        color: #b91c1c;
        border: none;
      }

      .danger-item button,
      .mini-card button,
      [data-user-editor] button,
      .table-wrap button,
      .modal-actions button,
      .admin-toolbar button {
        height: 32px;
        padding: 0 12px;
        font-size: 13px;
      }

      input:not([type]),
      input[type="text"],
      input[type="password"],
      input[type="number"],
      input[type="tel"],
      select,
      textarea {
        height: 42px;
        padding: 0 12px;
        border-radius: 9px;
        border: 1.5px solid var(--border);
        font-size: 14px;
        color: var(--text-primary);
        background: var(--card);
        width: 100%;
        box-sizing: border-box;
        transition: border-color 180ms ease, box-shadow 180ms ease;
        appearance: none;
      }

      textarea {
        height: auto;
        padding: 12px;
        min-height: 100px;
      }

      select {
        background-repeat: no-repeat;
        background-position: right 10px center;
        background-size: 14px 14px;
        padding-right: 34px;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none'%3E%3Cpath d='M5 7.5l5 5 5-5' stroke='%2364748b' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      }

      input::placeholder,
      textarea::placeholder {
        color: var(--muted);
      }

      .section-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 8px;
        display: block;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <section class="hero">
        <div class="hero-head">
          <h1>Profile Management</h1>
          <a class="back-link" href="/">Back To Dashboard</a>
        </div>
        <p>Manage your account, activity, and admin tools.</p>
      </section>

      <section id="errorCard" class="card card-error hidden mt-14"></section>

      <main id="profileApp" class="hidden" style="margin-top:14px" >
        <section class="card">
          <div class="profile-head">
            <div class="profile-user">
              <div id="profileAvatar" class="avatar">--</div>
              <div class="profile-meta">
                <b id="profileUsername">-</b>
                <span id="profileResidence">-</span>
              </div>
            </div>
            <div style="display:grid; gap:6px; color:var(--muted)">
              <span id="profilePhoneLabel">Phone: -</span>
              <span id="profileRoleLabel">Role: resident</span>
            </div>
          </div>

          <form id="phoneForm" class="inline-form" style="margin-top:12px">
            <div>
              <label for="profilePhoneInput">Phone Number</label>
              <input id="profilePhoneInput" maxlength="64" placeholder="07xx xxx xxx" />
            </div>
            <button id="savePhoneBtn" type="submit" data-default-text="Save Phone">Save Phone</button>
          </form>
        </section>

        <div class="subnav">
          <button type="button" id="summaryTabBtn" class="subnav-btn active">My Profile</button>
          <button type="button" id="adminTabBtn" class="subnav-btn hidden">Admin Panel</button>
        </div>

        <section id="summaryPanel" class="stack" style="margin-top:14px">
          <details class="card" id="passwordCard">
            <summary style="cursor:pointer; font-weight:800">Change Password</summary>
            <form id="passwordForm" class="stack" style="margin-top:10px">
              <div>
                <label for="currentPassword">Current Password</label>
                <input id="currentPassword" type="password" required />
              </div>
              <div>
                <label for="newPassword">New Password</label>
                <input id="newPassword" type="password" minlength="6" required />
              </div>
              <div>
                <label for="confirmPassword">Confirm New Password</label>
                <input id="confirmPassword" type="password" minlength="6" required />
              </div>
              <button id="changePasswordBtn" type="submit" data-default-text="Update Password">Update Password</button>
            </form>
          </details>

          <details class="card" open>
            <summary style="cursor:pointer; font-weight:800">My Activity</summary>
            <h3 class="section-title" style="margin-top:10px">My Activity Summary</h3>
            <div class="activity-tabs">
              <button type="button" class="activity-tab-btn active" data-activity-target="listingsPanel">Listings</button>
              <button type="button" class="activity-tab-btn" data-activity-target="parkingPanel">Parking</button>
              <button type="button" class="activity-tab-btn" data-activity-target="votesPanel">Votes</button>
            </div>

            <section id="listingsPanel" style="margin-top:10px">
              <span class="section-label">Anunțuri</span>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Updated</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody id="marketplaceBody"></tbody>
                </table>
              </div>
              <div id="marketplaceCards" class="mobile-card-list"></div>
            </section>

            <section id="parkingPanel" class="hidden" style="margin-top:10px">
              <span class="section-label">Parcare</span>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Spot</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>From</th>
                      <th>Until</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody id="parkingBody"></tbody>
                </table>
              </div>
              <div id="parkingCards" class="mobile-card-list"></div>
            </section>

            <section id="votesPanel" class="hidden" style="margin-top:10px">
              <span class="section-label">Sondaje</span>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Poll</th>
                      <th>Scope</th>
                      <th>Ends</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody id="pollsBody"></tbody>
                </table>
              </div>
              <div id="pollCards" class="mobile-card-list"></div>
            </section>
          </details>

          <details class="danger-zone card">
            <summary style="cursor:pointer; font-weight:800">Danger Zone</summary>
            <h3 style="margin-top:10px">Quick Delete Actions</h3>
            <span class="section-label">Acțiuni Rapide</span>
            <div id="dangerList" class="danger-list"></div>
          </details>
        </section>

        <section id="adminPanel" class="stack hidden" style="margin-top:14px">
          <section class="card admin-grid">
            <h3 class="section-title">User Management</h3>
            <span class="section-label">Utilizatori</span>
            <div class="admin-toolbar">
              <div>
                <label for="adminSearchInput">Search user</label>
                <input id="adminSearchInput" placeholder="username / phone" />
              </div>
              <button id="adminRefreshBtn" class="ghost" type="button" data-default-text="Refresh Users">Refresh Users</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th class="sortable" data-sort-key="username">Username</th>
                    <th class="sortable" data-sort-key="role">Role</th>
                    <th class="sortable" data-sort-key="avizier_permission">Avizier</th>
                    <th class="sortable" data-sort-key="building_number">Building</th>
                    <th class="sortable" data-sort-key="apartment_number">Apt</th>
                    <th>Phone</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="adminUsersBody"></tbody>
              </table>
            </div>
            <div id="adminUsersCards" class="mobile-card-list"></div>
          </section>

          <section class="card">
            <h3 class="section-title">Create User</h3>
            <form id="createUserForm" class="stack">
              <div class="grid">
                <div>
                  <label for="newUsername">Username</label>
                  <input id="newUsername" required />
                </div>
                <div>
                  <label for="createUserPassword">Password</label>
                  <input id="createUserPassword" type="password" required />
                </div>
              </div>
              <div class="grid">
                <div>
                  <label for="newRole">Role</label>
                  <select id="newRole">
                    <option value="resident">Resident</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label for="newAvizierPermission">Avizier Permission</label>
                  <select id="newAvizierPermission">
                    <option value="none">None</option>
                    <option value="reprezentant_bloc">Reprezentant Bloc (building only)</option>
                    <option value="comitet">Comitet (general + building)</option>
                  </select>
                </div>
                <div>
                  <label for="newPhone">Phone</label>
                  <input id="newPhone" maxlength="64" />
                </div>
              </div>
              <div class="grid">
                <div>
                  <label for="newBuilding">Building</label>
                  <select id="newBuilding"></select>
                </div>
                <div>
                  <label for="newApartment">Apartment</label>
                  <input id="newApartment" type="number" min="1" max="16" value="1" />
                </div>
              </div>
              <div id="createUserFeedback" class="feedback hidden"></div>
              <button id="createUserBtn" type="submit" data-default-text="Create User">Create User</button>
            </form>
          </section>
        </section>
      </main>
    </div>

    <div id="confirmModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
      <div class="modal-card">
        <h3 id="confirmTitle" style="margin:0">Please Confirm</h3>
        <p id="confirmText" style="color:var(--muted); margin-top:8px"></p>
        <div class="modal-actions">
          <button id="confirmCancelBtn" type="button" class="ghost">Cancel</button>
          <button id="confirmOkBtn" type="button" class="danger">Confirm</button>
        </div>
      </div>
    </div>

    <div id="toastContainer" class="toast-wrap"></div>

    <script src="https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js"></script>
    <script>
      const BUCHAREST_DISPLAY_FORMATTER = new Intl.DateTimeFormat("ro-RO", {
        timeZone: "Europe/Bucharest",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      const els = {
        errorCard: document.getElementById("errorCard"),
        profileApp: document.getElementById("profileApp"),
        profileAvatar: document.getElementById("profileAvatar"),
        profileUsername: document.getElementById("profileUsername"),
        profileResidence: document.getElementById("profileResidence"),
        profilePhoneLabel: document.getElementById("profilePhoneLabel"),
        profileRoleLabel: document.getElementById("profileRoleLabel"),
        phoneForm: document.getElementById("phoneForm"),
        profilePhoneInput: document.getElementById("profilePhoneInput"),
        savePhoneBtn: document.getElementById("savePhoneBtn"),
        summaryTabBtn: document.getElementById("summaryTabBtn"),
        adminTabBtn: document.getElementById("adminTabBtn"),
        summaryPanel: document.getElementById("summaryPanel"),
        adminPanel: document.getElementById("adminPanel"),
        passwordForm: document.getElementById("passwordForm"),
        changePasswordBtn: document.getElementById("changePasswordBtn"),
        marketplaceBody: document.getElementById("marketplaceBody"),
        marketplaceCards: document.getElementById("marketplaceCards"),
        parkingBody: document.getElementById("parkingBody"),
        parkingCards: document.getElementById("parkingCards"),
        pollsBody: document.getElementById("pollsBody"),
        pollCards: document.getElementById("pollCards"),
        dangerList: document.getElementById("dangerList"),
        adminSearchInput: document.getElementById("adminSearchInput"),
        adminRefreshBtn: document.getElementById("adminRefreshBtn"),
        adminUsersBody: document.getElementById("adminUsersBody"),
        adminUsersCards: document.getElementById("adminUsersCards"),
        createUserForm: document.getElementById("createUserForm"),
        createUserBtn: document.getElementById("createUserBtn"),
        createUserFeedback: document.getElementById("createUserFeedback"),
        newUsername: document.getElementById("newUsername"),
        createUserPassword: document.getElementById("createUserPassword"),
        newRole: document.getElementById("newRole"),
        newAvizierPermission: document.getElementById("newAvizierPermission"),
        newPhone: document.getElementById("newPhone"),
        newBuilding: document.getElementById("newBuilding"),
        newApartment: document.getElementById("newApartment"),
        confirmModal: document.getElementById("confirmModal"),
        confirmText: document.getElementById("confirmText"),
        confirmCancelBtn: document.getElementById("confirmCancelBtn"),
        confirmOkBtn: document.getElementById("confirmOkBtn"),
        toastContainer: document.getElementById("toastContainer"),
      };

      let currentUser = null;
      let viewedProfileUsername = "";
      let overviewData = { marketplace_listings: [], shared_parking_spots: [], active_interest_polls: [] };
      let adminUsers = [];
      let adminSortKey = "username";
      let adminSortDirection = 1;
      let confirmResolver = null;

      function iconMarkup(name) {
        return '<i data-lucide="' + name + '" aria-hidden="true"></i>';
      }

      function hydrateIcons() {
        if (!window.lucide || typeof window.lucide.createIcons !== "function") return;
        window.lucide.createIcons();
      }

      function showToast(message, kind) {
        const toast = document.createElement("div");
        toast.className = "toast " + (kind || "success");
        toast.textContent = message;
        els.toastContainer.appendChild(toast);
        setTimeout(function () {
          toast.remove();
        }, 3000);
      }

      function showError(message) {
        els.errorCard.classList.remove("hidden");
        els.errorCard.textContent = message;
      }

      function clearError() {
        els.errorCard.classList.add("hidden");
        els.errorCard.textContent = "";
      }

      function normalizeUsername(value) {
        return String(value || "").trim().toLowerCase();
      }

      function inferBuildingFromUsername(username) {
        const match = normalizeUsername(username).match(/^bloc([1-9]|10)\b/);
        return match ? Number(match[1]) : null;
      }

      function formatDate(value) {
        if (!value) return "-";
        const raw = String(value).trim();
        const hasOffset = /(Z|[+-]\d{2}:\d{2})$/i.test(raw);
        if (hasOffset) {
          const parsed = new Date(raw);
          if (!Number.isNaN(parsed.getTime())) {
            return BUCHAREST_DISPLAY_FORMATTER.format(parsed).replace(",", "");
          }
        }
        return raw.replace("T", " ");
      }

      function td(value) {
        return "<td>" + (value == null || value === "" ? "-" : value) + "</td>";
      }

      function profileInitials(username) {
        const cleaned = String(username || "").trim();
        if (!cleaned) return "--";
        const parts = cleaned.split(/[_\s-]+/).filter(Boolean);
        if (!parts.length) return cleaned.slice(0, 2).toUpperCase();
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
      }

      function pollScopeChip(poll) {
        if (poll.scope === "building") {
          return '<span class="poll-chip building">' + iconMarkup("building-2") + "<span>Building " + poll.building_id + "</span></span>";
        }
        return '<span class="poll-chip neighbourhood">' + iconMarkup("map-pinned") + "<span>Neighbourhood</span></span>";
      }

      async function api(path, opts) {
        const response = await fetch(path, {
          method: (opts && opts.method) || "GET",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: opts && opts.body,
        });

        const data = await response.json().catch(function () {
          return {};
        });

        if (!response.ok) {
          const error = new Error(data.error || "Request failed (" + response.status + ")");
          error.status = response.status;
          throw error;
        }
        return data;
      }

      async function withButtonProgress(button, label, run) {
        const previous = button.textContent;
        button.disabled = true;
        button.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>' + label + "</span>";
        try {
          await run();
        } finally {
          button.disabled = false;
          if (button.dataset.defaultHtml) {
            button.innerHTML = button.dataset.defaultHtml;
          } else {
            button.textContent = button.dataset.defaultText || previous;
          }
          hydrateIcons();
        }
      }

      function requestConfirmation(message) {
        els.confirmText.textContent = message;
        els.confirmModal.classList.remove("hidden");
        return new Promise(function (resolve) {
          confirmResolver = resolve;
        });
      }

      function closeConfirmation(result) {
        els.confirmModal.classList.add("hidden");
        if (confirmResolver) {
          confirmResolver(result);
          confirmResolver = null;
        }
      }

      function setSummaryTab(panelId) {
        document.querySelectorAll(".activity-tab-btn[data-activity-target]").forEach(function (btn) {
          btn.classList.toggle("active", btn.dataset.activityTarget === panelId);
        });
        ["listingsPanel", "parkingPanel", "votesPanel"].forEach(function (id) {
          const panel = document.getElementById(id);
          panel.classList.toggle("hidden", id !== panelId);
        });
      }

      function setMainTab(tabName) {
        const summaryActive = tabName !== "admin";
        els.summaryTabBtn.classList.toggle("active", summaryActive);
        els.adminTabBtn.classList.toggle("active", !summaryActive);
        els.summaryPanel.classList.toggle("hidden", !summaryActive);
        els.adminPanel.classList.toggle("hidden", summaryActive || !currentUser || currentUser.role !== "admin");
      }

      function renderProfile(user) {
        const building = Number(user.building_number || 0);
        const apartment = Number(user.apartment_number || 0);
        els.profileAvatar.textContent = profileInitials(user.username);
        els.profileUsername.textContent = user.username;
        els.profileResidence.textContent =
          building > 0 && apartment > 0
            ? "Building " + building + ", Apt " + apartment
            : building > 0
              ? "Building " + building
              : "No building assigned";
        els.profilePhoneLabel.textContent = "Phone: " + (user.phone_number || "-");
        els.profileRoleLabel.textContent = "Role: " + user.role;
        els.profilePhoneInput.value = user.phone_number || "";
      }

      function renderListings(listings) {
        els.marketplaceBody.innerHTML = listings.length
          ? listings
              .map(function (listing) {
                return "<tr>" +
                  td("<strong>" + listing.title + "</strong>") +
                  td(listing.listing_type) +
                  td(listing.status) +
                  td(formatDate(listing.updated_at || listing.created_at)) +
                  '<td><button type="button" class="danger table-action delete-listing-btn" data-listing-id="' + listing.id + '">Delete</button></td>' +
                  "</tr>";
              })
              .join("")
          : '<tr><td colspan="5">No marketplace listings yet.</td></tr>';

        els.marketplaceCards.innerHTML = listings.length
          ? listings
              .map(function (listing) {
                return '<article class="card mini-card">' +
                  '<div class="mini-card-title">' + listing.title + "</div>" +
                  '<div class="mini-card-meta">' +
                  '<div>Type: ' + listing.listing_type + "</div>" +
                  '<div>Status: ' + listing.status + "</div>" +
                  '<div>Updated: ' + formatDate(listing.updated_at || listing.created_at) + "</div>" +
                  "</div>" +
                  '<button type="button" class="danger delete-listing-btn" data-listing-id="' + listing.id + '">Delete</button>' +
                  "</article>";
              })
              .join("")
          : '<article class="card mini-card"><div>No listings yet.</div></article>';
      }

      function renderParking(slots) {
        els.parkingBody.innerHTML = slots.length
          ? slots
              .map(function (slot) {
                return "<tr>" +
                  td(slot.parking_space_number) +
                  td(slot.parking_type) +
                  td(slot.status) +
                  td(formatDate(slot.available_from)) +
                  td(formatDate(slot.available_until)) +
                  '<td><button type="button" class="danger delete-slot-btn" data-slot-id="' + slot.id + '">Delete</button></td>' +
                  "</tr>";
              })
              .join("")
          : '<tr><td colspan="6">No shared parking spots currently active.</td></tr>';

        els.parkingCards.innerHTML = slots.length
          ? slots
              .map(function (slot) {
                return '<article class="card mini-card">' +
                  '<div class="mini-card-title">Spot ' + slot.parking_space_number + "</div>" +
                  '<div class="mini-card-meta">' +
                  '<div>Type: ' + slot.parking_type + "</div>" +
                  '<div>Status: ' + slot.status + "</div>" +
                  '<div>' + formatDate(slot.available_from) + " - " + formatDate(slot.available_until) + "</div>" +
                  "</div>" +
                  '<button type="button" class="danger delete-slot-btn" data-slot-id="' + slot.id + '">Delete</button>' +
                  "</article>";
              })
              .join("")
          : '<article class="card mini-card"><div>No shared parking spots active.</div></article>';
      }

      function renderVotes(polls) {
        els.pollsBody.innerHTML = polls.length
          ? polls
              .map(function (poll) {
                const statusChip = poll.has_voted
                  ? '<span class="poll-chip voted">' + iconMarkup("check-check") + "<span>Voted</span></span>"
                  : '<span class="poll-chip">' + iconMarkup("circle") + "<span>Not Voted</span></span>";
                return "<tr>" +
                  td("<strong>" + poll.title + "</strong>") +
                  td(pollScopeChip(poll)) +
                  td(formatDate(poll.end_date)) +
                  td(statusChip) +
                  "</tr>";
              })
              .join("")
          : '<tr><td colspan="4">No active polls relevant to you right now.</td></tr>';

        els.pollCards.innerHTML = polls.length
          ? polls
              .map(function (poll) {
                const statusChip = poll.has_voted
                  ? '<span class="poll-chip voted">' + iconMarkup("check-check") + "<span>Voted</span></span>"
                  : '<span class="poll-chip">' + iconMarkup("circle") + "<span>Not Voted</span></span>";
                return '<article class="card mini-card">' +
                  '<div class="mini-card-title">' + poll.title + "</div>" +
                  '<div class="mini-card-meta">' +
                  '<div>' + pollScopeChip(poll) + "</div>" +
                  '<div>Ends: ' + formatDate(poll.end_date) + "</div>" +
                  '<div>' + statusChip + "</div>" +
                  "</div>" +
                  "</article>";
              })
              .join("")
          : '<article class="card mini-card"><div>No active polls relevant right now.</div></article>';
      }

      function renderDangerZone() {
        const listings = Array.isArray(overviewData.marketplace_listings) ? overviewData.marketplace_listings : [];
        const slots = Array.isArray(overviewData.shared_parking_spots) ? overviewData.shared_parking_spots : [];
        const rows = [];
        try {
          const ownUsername = normalizeUsername(currentUser && currentUser.username);
          const targetUsername = normalizeUsername(viewedProfileUsername);
          if (targetUsername && ownUsername && targetUsername !== ownUsername) {
            rows.push(
              '<div class="danger-item">' +
                '<span>Mesagerie directă cu <b>' + targetUsername + "</b></span>" +
                '<a class="back-link" href="/messaging?dm=' + encodeURIComponent(targetUsername) + '">💬 Trimite mesaj</a>' +
              "</div>"
            );
          }
        } catch {}

        listings.slice(0, 5).forEach(function (listing) {
          rows.push(
            '<div class="danger-item">' +
              '<span>Listing: <b>' + listing.title + "</b></span>" +
              '<button type="button" class="danger delete-listing-btn" data-listing-id="' + listing.id + '">Delete</button>' +
            "</div>"
          );
        });

        slots.slice(0, 5).forEach(function (slot) {
          rows.push(
            '<div class="danger-item">' +
              '<span>Parking: <b>' + slot.parking_space_number + "</b> (" + slot.parking_type + ")</span>" +
              '<button type="button" class="danger delete-slot-btn" data-slot-id="' + slot.id + '">Delete</button>' +
            "</div>"
          );
        });

        els.dangerList.innerHTML = rows.length ? rows.join("") : '<div class="danger-item"><span>No deletable activity available.</span></div>';
      }

      function applyAdminSearchAndSort(users) {
        const search = String(els.adminSearchInput.value || "").trim().toLowerCase();
        let filtered = users;
        if (search) {
          filtered = users.filter(function (user) {
            return (
              String(user.username || "").toLowerCase().includes(search) ||
              String(user.phone_number || "").toLowerCase().includes(search)
            );
          });
        }

        const sorted = filtered.slice().sort(function (a, b) {
          const va = a[adminSortKey];
          const vb = b[adminSortKey];
          if (typeof va === "number" || typeof vb === "number") {
            return (Number(va || 0) - Number(vb || 0)) * adminSortDirection;
          }
          return String(va || "").localeCompare(String(vb || "")) * adminSortDirection;
        });
        return sorted;
      }

      function adminEditorHtml(user) {
        return (
          '<div class="stack" data-user-editor="' + user.id + '">' +
            '<div class="grid">' +
              '<div><label>Role</label><select data-field="role"><option value="resident"' +
                (user.role === "resident" ? " selected" : "") +
                '>Resident</option><option value="admin"' +
                (user.role === "admin" ? " selected" : "") +
                '>Admin</option></select></div>' +
              '<div><label>Avizier</label><select data-field="avizier_permission"><option value="none"' +
                (String(user.avizier_permission || "none") === "none" ? " selected" : "") +
                '>None</option><option value="reprezentant_bloc"' +
                (String(user.avizier_permission || "none") === "reprezentant_bloc" ? " selected" : "") +
                '>Reprezentant Bloc</option><option value="comitet"' +
                (String(user.avizier_permission || "none") === "comitet" ? " selected" : "") +
                '>Comitet</option></select></div>' +
              '<div><label>Phone</label><input data-field="phone_number" value="' + (user.phone_number || "") + '" maxlength="64" /></div>' +
            '</div>' +
            '<div class="grid">' +
              '<div><label>Building</label><input data-field="building_number" type="number" min="0" max="10" value="' + Number(user.building_number || 0) + '" /></div>' +
              '<div><label>Apt</label><input data-field="apartment_number" type="number" min="0" max="16" value="' + Number(user.apartment_number || 0) + '" /></div>' +
            '</div>' +
            '<div style="display:flex; gap:8px; flex-wrap:wrap">' +
              '<button type="button" class="admin-save-btn" data-user-id="' + user.id + '">Save</button>' +
              '<button type="button" class="danger admin-delete-btn" data-user-id="' + user.id + '">Delete</button>' +
            '</div>' +
          '</div>'
        );
      }

      function renderAdminUsers() {
        const users = applyAdminSearchAndSort(adminUsers);

        els.adminUsersBody.innerHTML = users.length
          ? users
              .map(function (user) {
                return (
                  "<tr>" +
                    td("<b>" + user.username + "</b>") +
                    td(user.role) +
                    td(String(user.avizier_permission || "none")) +
                    td(user.building_number) +
                    td(user.apartment_number) +
                    td(user.phone_number || "-") +
                    td(adminEditorHtml(user)) +
                  "</tr>"
                );
              })
              .join("")
          : '<tr><td colspan="7">No users found for current filter.</td></tr>';

        els.adminUsersCards.innerHTML = users.length
          ? users
              .map(function (user) {
                return (
                  '<article class="card mini-card">' +
                    '<div class="mini-card-title">' + user.username + "</div>" +
                    '<div class="mini-card-meta">Role: ' + user.role + "</div>" +
                    '<div class="mini-card-meta">Avizier: ' + String(user.avizier_permission || "none") + "</div>" +
                    adminEditorHtml(user) +
                  "</article>"
                );
              })
              .join("")
          : '<article class="card mini-card"><div>No users found for current filter.</div></article>';

        hydrateIcons();
      }

      function showCreateUserFeedback(message, isError) {
        els.createUserFeedback.classList.remove("hidden");
        els.createUserFeedback.classList.toggle("error", Boolean(isError));
        els.createUserFeedback.textContent = message;
      }

      function clearCreateUserFeedback() {
        els.createUserFeedback.classList.add("hidden");
        els.createUserFeedback.textContent = "";
      }

      function fillBuildingSelect() {
        els.newBuilding.innerHTML = "";
        for (let i = 1; i <= 10; i += 1) {
          const option = document.createElement("option");
          option.value = String(i);
          option.textContent = "Building " + i;
          els.newBuilding.appendChild(option);
        }
      }

      function updateCreateUserFormVisibility() {
        const isAdmin = els.newRole.value === "admin";
        els.newBuilding.disabled = isAdmin;
        els.newApartment.disabled = isAdmin;
        els.newAvizierPermission.disabled = isAdmin;
        if (isAdmin) {
          els.newAvizierPermission.value = "none";
        }
      }

      function editorPayloadFromContainer(container) {
        const role = container.querySelector('[data-field="role"]')?.value || "resident";
        const avizierPermission = container.querySelector('[data-field="avizier_permission"]')?.value || "none";
        const phone = container.querySelector('[data-field="phone_number"]')?.value || "";
        const building = Number(container.querySelector('[data-field="building_number"]')?.value || 0);
        const apartment = Number(container.querySelector('[data-field="apartment_number"]')?.value || 0);
        return {
          role: role,
          avizier_permission: avizierPermission,
          phone_number: String(phone).trim(),
          building_number: building,
          apartment_number: apartment,
        };
      }

      async function loadAdminUsers() {
        if (!currentUser || currentUser.role !== "admin") return;
        adminUsers = await api("/api/users");
        renderAdminUsers();
      }

      async function loadOverview() {
        clearError();
        const data = await api("/api/profile/overview");
        currentUser = data.current_user;
        try {
          const requestedUsername = normalizeUsername(new URLSearchParams(window.location.search).get("username"));
          viewedProfileUsername = requestedUsername || normalizeUsername(currentUser && currentUser.username);
        } catch {
          viewedProfileUsername = normalizeUsername(currentUser && currentUser.username);
        }
        overviewData = {
          marketplace_listings: Array.isArray(data.marketplace_listings) ? data.marketplace_listings : [],
          shared_parking_spots: Array.isArray(data.shared_parking_spots) ? data.shared_parking_spots : [],
          active_interest_polls: Array.isArray(data.active_interest_polls) ? data.active_interest_polls : [],
        };

        renderProfile(currentUser);
        renderListings(overviewData.marketplace_listings);
        renderParking(overviewData.shared_parking_spots);
        renderVotes(overviewData.active_interest_polls);
        renderDangerZone();

        const isAdmin = currentUser.role === "admin";
        els.adminTabBtn.classList.toggle("hidden", !isAdmin);
        if (isAdmin) {
          await loadAdminUsers();
        } else {
          adminUsers = [];
        }

        els.profileApp.classList.remove("hidden");
        hydrateIcons();
      }

      function applyStaticIcons() {
        const iconMap = [
          [".back-link", "arrow-left"],
          ["#savePhoneBtn", "phone"],
          ["#changePasswordBtn", "key-round"],
          ["#createUserBtn", "user-plus"],
          ["#adminRefreshBtn", "refresh-cw"],
          ["#confirmCancelBtn", "x"],
          ["#confirmOkBtn", "check"],
        ];
        iconMap.forEach(function (entry) {
          document.querySelectorAll(entry[0]).forEach(function (element) {
            const label = element.dataset.defaultText || element.textContent.trim();
            element.dataset.defaultText = label;
            if (element.tagName.toLowerCase() === "a") {
              element.innerHTML = iconMarkup(entry[1]) + "<span>" + label + "</span>";
            } else {
              element.innerHTML = iconMarkup(entry[1]) + "<span>" + label + "</span>";
            }
            element.dataset.defaultHtml = element.innerHTML;
          });
        });
        hydrateIcons();
      }

      document.querySelectorAll(".activity-tab-btn[data-activity-target]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          setSummaryTab(btn.dataset.activityTarget);
        });
      });

      els.summaryTabBtn.addEventListener("click", function () {
        setMainTab("summary");
      });

      els.adminTabBtn.addEventListener("click", function () {
        if (!currentUser || currentUser.role !== "admin") return;
        setMainTab("admin");
      });

      els.confirmCancelBtn.addEventListener("click", function () {
        closeConfirmation(false);
      });

      els.confirmOkBtn.addEventListener("click", function () {
        closeConfirmation(true);
      });

      els.confirmModal.addEventListener("click", function (event) {
        if (event.target === els.confirmModal) {
          closeConfirmation(false);
        }
      });

      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !els.confirmModal.classList.contains("hidden")) {
          closeConfirmation(false);
        }
      });

      els.phoneForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        await withButtonProgress(els.savePhoneBtn, "Saving...", async function () {
          try {
            const result = await api("/api/profile/phone", {
              method: "POST",
              body: JSON.stringify({ phone_number: els.profilePhoneInput.value }),
            });
            currentUser = result.user;
            renderProfile(currentUser);
            showToast("Phone number updated.", "success");
          } catch (error) {
            showToast(error.message || "Could not update phone number.", "error");
          }
        });
      });

      els.passwordForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const currentPassword = document.getElementById("currentPassword").value;
        const newPassword = document.getElementById("newPassword").value;
        const confirmPassword = document.getElementById("confirmPassword").value;

        await withButtonProgress(els.changePasswordBtn, "Updating...", async function () {
          try {
            await api("/api/profile/password", {
              method: "POST",
              body: JSON.stringify({
                current_password: currentPassword,
                new_password: newPassword,
                confirm_password: confirmPassword,
              }),
            });
            els.passwordForm.reset();
            showToast("Password updated.", "success");
          } catch (error) {
            showToast(error.message || "Could not update password.", "error");
          }
        });
      });

      async function handleListingDelete(button) {
        const listingId = Number(button.dataset.listingId || 0);
        if (!listingId) return;
        const confirmed = await requestConfirmation("Delete this listing permanently?");
        if (!confirmed) return;

        await withButtonProgress(button, "Deleting...", async function () {
          try {
            await api("/api/marketplace/posts/" + listingId + "/delete", { method: "POST" });
            showToast("Listing deleted.", "success");
            await loadOverview();
          } catch (error) {
            showToast(error.message || "Could not delete listing.", "error");
          }
        });
      }

      async function handleSlotDelete(button) {
        const slotId = Number(button.dataset.slotId || 0);
        if (!slotId) return;
        const confirmed = await requestConfirmation("Delete this shared parking slot?");
        if (!confirmed) return;

        await withButtonProgress(button, "Deleting...", async function () {
          try {
            await api("/api/slots/" + slotId + "/delete", { method: "POST" });
            showToast("Shared parking slot deleted.", "success");
            await loadOverview();
          } catch (error) {
            showToast(error.message || "Could not delete shared parking slot.", "error");
          }
        });
      }

      document.addEventListener("click", function (event) {
        const listingBtn = event.target.closest(".delete-listing-btn");
        if (listingBtn) {
          handleListingDelete(listingBtn);
          return;
        }

        const slotBtn = event.target.closest(".delete-slot-btn");
        if (slotBtn) {
          handleSlotDelete(slotBtn);
          return;
        }
      });

      els.adminSearchInput.addEventListener("input", function () {
        renderAdminUsers();
      });

      document.addEventListener("click", function (event) {
        const sortable = event.target.closest(".sortable[data-sort-key]");
        if (sortable) {
          const key = sortable.dataset.sortKey;
          if (adminSortKey === key) {
            adminSortDirection = adminSortDirection * -1;
          } else {
            adminSortKey = key;
            adminSortDirection = 1;
          }
          renderAdminUsers();
          return;
        }

        const saveBtn = event.target.closest(".admin-save-btn");
        if (saveBtn) {
          const userId = Number(saveBtn.dataset.userId || 0);
          if (!userId) return;
          const editor = saveBtn.closest("[data-user-editor]");
          if (!editor) return;
          const payload = editorPayloadFromContainer(editor);

          withButtonProgress(saveBtn, "Saving...", async function () {
            try {
              await api("/api/users/" + userId + "/update", {
                method: "POST",
                body: JSON.stringify(payload),
              });
              showToast("User updated.", "success");
              await loadAdminUsers();
            } catch (error) {
              showToast(error.message || "Could not update user.", "error");
            }
          });
          return;
        }

        const deleteBtn = event.target.closest(".admin-delete-btn");
        if (deleteBtn) {
          const userId = Number(deleteBtn.dataset.userId || 0);
          if (!userId) return;
          requestConfirmation("Delete this user account?").then(function (confirmed) {
            if (!confirmed) return;
            withButtonProgress(deleteBtn, "Deleting...", async function () {
              try {
                await api("/api/users/" + userId + "/delete", { method: "POST" });
                showToast("User deleted.", "success");
                await loadAdminUsers();
              } catch (error) {
                showToast(error.message || "Could not delete user.", "error");
              }
            });
          });
          return;
        }
      });

      els.adminRefreshBtn.addEventListener("click", async function () {
        await withButtonProgress(els.adminRefreshBtn, "Refreshing...", async function () {
          try {
            await loadAdminUsers();
            showToast("Users refreshed.", "success");
          } catch (error) {
            showToast(error.message || "Could not refresh users.", "error");
          }
        });
      });

      els.newUsername.addEventListener("input", function () {
        els.newUsername.value = normalizeUsername(els.newUsername.value);
        const inferred = inferBuildingFromUsername(els.newUsername.value);
        if (inferred) {
          els.newBuilding.value = String(inferred);
        }
      });

      els.newRole.addEventListener("change", function () {
        updateCreateUserFormVisibility();
      });

      els.createUserForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearCreateUserFeedback();

        const payload = {
          username: normalizeUsername(els.newUsername.value),
          password: els.createUserPassword.value,
          role: els.newRole.value,
          avizier_permission: els.newAvizierPermission.value,
          building_number: Number(els.newBuilding.value || 0),
          apartment_number: Number(els.newApartment.value || 0),
          phone_number: String(els.newPhone.value || "").trim(),
        };

        if (!payload.username) {
          showCreateUserFeedback("Username is required.", true);
          return;
        }
        if (!payload.password || payload.password.length < 6) {
          showCreateUserFeedback("Password must be at least 6 characters.", true);
          return;
        }
        if (payload.role === "resident") {
          if (!Number.isInteger(payload.building_number) || payload.building_number < 1 || payload.building_number > 10) {
            showCreateUserFeedback("Building must be between 1 and 10 for residents.", true);
            return;
          }
          if (!Number.isInteger(payload.apartment_number) || payload.apartment_number < 1 || payload.apartment_number > 16) {
            showCreateUserFeedback("Apartment must be between 1 and 16 for residents.", true);
            return;
          }
        }

        await withButtonProgress(els.createUserBtn, "Creating...", async function () {
          try {
            await api("/api/users", {
              method: "POST",
              body: JSON.stringify(payload),
            });
            showCreateUserFeedback("User created successfully.", false);
            els.createUserForm.reset();
            updateCreateUserFormVisibility();
            await loadAdminUsers();
          } catch (error) {
            showCreateUserFeedback(error.message || "Could not create user.", true);
          }
        });
      });

      async function boot() {
        fillBuildingSelect();
        updateCreateUserFormVisibility();
        applyStaticIcons();
        setMainTab("summary");
        setSummaryTab("listingsPanel");

        try {
          await loadOverview();
        } catch (error) {
          if (error.status === 401) {
            showError("Authentication required. Please sign in from dashboard first.");
            return;
          }
          showError(error.message || "Could not load profile overview.");
        }
      }

      boot();
    </script>
${VERCEL_ANALYTICS_SNIPPET}
  </body>
</html>`;
}

export async function GET() {
  return new Response(profileHtml(), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
