export const runtime = "nodejs";

function profileHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Profile Management</title>
    <style>
      :root {
        --bg: #f6f4ee;
        --card: #ffffff;
        --line: #d7d2c8;
        --ink: #1d2730;
        --muted: #55626e;
        --teal: #0e7568;
        --amber: #da7c1b;
        --danger: #b42318;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at 12% -12%, #fce9ce 0%, #fce9ce00 30%),
          radial-gradient(circle at 110% 110%, #d6f0eb 0%, #d6f0eb00 36%),
          var(--bg);
      }

      .container {
        max-width: 1240px;
        margin: 0 auto;
        padding: 22px;
      }

      .hero {
        border-radius: 16px;
        border: 1px solid var(--line);
        background: linear-gradient(115deg, #fff, #f9f4e8);
        padding: 18px;
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
        border: 0;
        color: #fff;
        cursor: pointer;
        font-weight: 600;
        background: #687684;
        width: auto;
        padding: 8px 12px;
        border-radius: 8px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 14px;
        margin-top: 14px;
      }

      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 14px;
      }

      .card h2,
      .card h3 {
        margin-top: 0;
      }

      .stack {
        display: grid;
        gap: 10px;
      }

      .meta-list {
        display: grid;
        gap: 6px;
        color: var(--muted);
        font-size: 0.9rem;
      }

      label {
        font-size: 0.86rem;
        color: var(--muted);
      }

      input,
      button {
        width: 100%;
        border: 1px solid #c9c2b5;
        border-radius: 8px;
        padding: 9px 10px;
        font: inherit;
      }

      button {
        border: 0;
        color: #fff;
        cursor: pointer;
        font-weight: 600;
        background: var(--teal);
      }

      button.alt {
        background: var(--amber);
      }

      button.danger {
        background: var(--danger);
      }

      button:disabled {
        opacity: 0.65;
        cursor: wait;
      }

      .table-wrap {
        max-height: 320px;
        overflow: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.86rem;
      }

      th,
      td {
        text-align: left;
        border-bottom: 1px solid #eee7db;
        padding: 7px 5px;
        vertical-align: top;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .link-btn {
        display: inline-block;
        text-decoration: underline;
        color: #185355;
        font-weight: 700;
      }

      .table-btn {
        width: auto;
        padding: 6px 10px;
        font-size: 0.8rem;
      }

      .poll-chip {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 4px 10px;
        border: 1px solid #d7d2c8;
        background: #f6f1e7;
        color: #2b3b46;
        font-size: 0.78rem;
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

      .status {
        margin-top: 12px;
        border-radius: 10px;
        padding: 10px 12px;
        border: 1px solid #d8e3e2;
        background: #edf8f6;
        color: #155a52;
        font-size: 0.9rem;
      }

      .status.error {
        border-color: #f0c7bf;
        background: #fff4f2;
        color: #b42318;
      }

      .hidden {
        display: none !important;
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
        <p>Update your password and manage your activity across marketplace, parking, and active polls.</p>
      </section>

      <section id="errorCard" class="status error hidden"></section>

      <main id="profileApp" class="hidden">
        <section class="grid">
          <article class="card">
            <h2>Account</h2>
            <div class="meta-list" id="accountMeta"></div>
          </article>

          <article class="card">
            <h2>Change Password</h2>
            <form id="passwordForm" class="stack">
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
          </article>
        </section>

        <section class="grid">
          <article class="card">
            <h3>My Marketplace Listings</h3>
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
          </article>

          <article class="card">
            <h3>My Shared Parking Spots</h3>
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
          </article>
        </section>

        <section class="card" style="margin-top: 14px">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap">
            <h3 style="margin:0">Active Polls Relevant To You</h3>
            <a class="link-btn" href="/">Open Voting Module</a>
          </div>
          <div class="table-wrap" style="margin-top: 8px">
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
        </section>

        <section id="statusCard" class="status hidden"></section>
      </main>
    </div>

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
        accountMeta: document.getElementById("accountMeta"),
        passwordForm: document.getElementById("passwordForm"),
        changePasswordBtn: document.getElementById("changePasswordBtn"),
        marketplaceBody: document.getElementById("marketplaceBody"),
        parkingBody: document.getElementById("parkingBody"),
        pollsBody: document.getElementById("pollsBody"),
        statusCard: document.getElementById("statusCard"),
      };

      function showError(message) {
        els.errorCard.classList.remove("hidden");
        els.errorCard.textContent = message;
      }

      function clearError() {
        els.errorCard.classList.add("hidden");
        els.errorCard.textContent = "";
      }

      function showStatus(message, isError = false) {
        els.statusCard.classList.remove("hidden");
        els.statusCard.classList.toggle("error", isError);
        els.statusCard.textContent = message;
      }

      function formatDate(value) {
        if (!value) return "-";
        const raw = String(value).trim();
        const hasOffset = /(Z|[+-]\\d{2}:\\d{2})$/i.test(raw);
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

      function pollScopeChip(poll) {
        if (poll.scope === "building") {
          return '<span class="poll-chip building">Bloc ' + poll.building_id + "</span>";
        }
        return '<span class="poll-chip neighbourhood">Neighbourhood</span>';
      }

      async function api(path, opts = {}) {
        const response = await fetch(path, {
          method: opts.method || "GET",
          credentials: "include",
          headers: { "content-type": "application/json", ...(opts.headers || {}) },
          body: opts.body,
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = data.error || "Request failed (" + response.status + ")";
          const error = new Error(message);
          error.status = response.status;
          throw error;
        }

        return data;
      }

      async function withButtonProgress(button, text, run) {
        const previous = button.textContent;
        button.disabled = true;
        button.textContent = text;
        try {
          await run();
        } finally {
          button.disabled = false;
          button.textContent = button.dataset.defaultText || previous;
        }
      }

      function renderAccount(user) {
        const buildingText = Number(user.building_number) > 0 ? String(user.building_number) : "-";
        const aptText = Number(user.apartment_number) > 0 ? String(user.apartment_number) : "-";
        els.accountMeta.innerHTML = [
          "<div><b>Username:</b> " + user.username + "</div>",
          "<div><b>Role:</b> " + user.role + "</div>",
          "<div><b>Building:</b> " + buildingText + "</div>",
          "<div><b>Apartment:</b> " + aptText + "</div>",
          "<div><b>Phone:</b> " + (user.phone_number || "-") + "</div>",
        ].join("");
      }

      function renderMarketplace(listings) {
        els.marketplaceBody.innerHTML = listings.length
          ? listings
              .map((listing) => {
                const openLink = '<a class="link-btn" href="/marketplace/listings/' + listing.id + '">Open</a>';
                const deleteBtn =
                  '<button type="button" class="table-btn danger delete-listing-btn" data-listing-id="' +
                  listing.id +
                  '">Delete</button>';
                return "<tr>" +
                  td(listing.title) +
                  td(listing.listing_type) +
                  td(listing.status) +
                  td(formatDate(listing.updated_at || listing.created_at)) +
                  '<td><div class="actions">' + openLink + deleteBtn + "</div></td>" +
                  "</tr>";
              })
              .join("")
          : '<tr><td colspan="5">No marketplace listings yet.</td></tr>';
      }

      function renderParking(slots) {
        els.parkingBody.innerHTML = slots.length
          ? slots
              .map((slot) => {
                const deleteBtn =
                  '<button type="button" class="table-btn danger delete-slot-btn" data-slot-id="' +
                  slot.id +
                  '">Delete</button>';
                return "<tr>" +
                  td(slot.parking_space_number) +
                  td(slot.parking_type) +
                  td(slot.status) +
                  td(formatDate(slot.available_from)) +
                  td(formatDate(slot.available_until)) +
                  '<td><div class="actions">' + deleteBtn + "</div></td>" +
                  "</tr>";
              })
              .join("")
          : '<tr><td colspan="6">No shared parking spots currently active.</td></tr>';
      }

      function renderPolls(polls) {
        els.pollsBody.innerHTML = polls.length
          ? polls
              .map((poll) => {
                const statusChip = poll.has_voted
                  ? '<span class="poll-chip voted">Voted</span>'
                  : '<span class="poll-chip">Not Voted</span>';
                return "<tr>" +
                  td("<strong>" + poll.title + "</strong>") +
                  td(pollScopeChip(poll)) +
                  td(formatDate(poll.end_date)) +
                  td(statusChip) +
                  "</tr>";
              })
              .join("")
          : '<tr><td colspan="4">No active polls relevant to you right now.</td></tr>';
      }

      async function loadOverview() {
        clearError();
        try {
          const data = await api("/api/profile/overview");
          const user = data.current_user;
          renderAccount(user);
          renderMarketplace(Array.isArray(data.marketplace_listings) ? data.marketplace_listings : []);
          renderParking(Array.isArray(data.shared_parking_spots) ? data.shared_parking_spots : []);
          renderPolls(Array.isArray(data.active_interest_polls) ? data.active_interest_polls : []);
          els.profileApp.classList.remove("hidden");
        } catch (error) {
          if (error.status === 401) {
            showError("Authentication required. Please sign in from dashboard first.");
            return;
          }
          showError(error.message || "Could not load profile overview.");
        }
      }

      els.passwordForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const currentPassword = document.getElementById("currentPassword").value;
        const newPassword = document.getElementById("newPassword").value;
        const confirmPassword = document.getElementById("confirmPassword").value;

        await withButtonProgress(els.changePasswordBtn, "Updating...", async () => {
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
            showStatus("Password updated successfully.");
          } catch (error) {
            showStatus(error.message || "Could not update password.", true);
          }
        });
      });

      els.marketplaceBody.addEventListener("click", async (event) => {
        const button = event.target.closest(".delete-listing-btn");
        if (!button) return;
        const listingId = Number(button.dataset.listingId || 0);
        if (!listingId) return;

        const confirmed = window.confirm("Delete this listing permanently?");
        if (!confirmed) return;

        await withButtonProgress(button, "Deleting...", async () => {
          try {
            await api("/api/marketplace/posts/" + listingId + "/delete", { method: "POST" });
            showStatus("Listing deleted.");
            await loadOverview();
          } catch (error) {
            showStatus(error.message || "Could not delete listing.", true);
          }
        });
      });

      els.parkingBody.addEventListener("click", async (event) => {
        const button = event.target.closest(".delete-slot-btn");
        if (!button) return;
        const slotId = Number(button.dataset.slotId || 0);
        if (!slotId) return;

        const confirmed = window.confirm("Delete this shared parking slot?");
        if (!confirmed) return;

        await withButtonProgress(button, "Deleting...", async () => {
          try {
            await api("/api/slots/" + slotId + "/delete", { method: "POST" });
            showStatus("Shared parking slot deleted.");
            await loadOverview();
          } catch (error) {
            showStatus(error.message || "Could not delete shared parking slot.", true);
          }
        });
      });

      loadOverview();
    </script>
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
