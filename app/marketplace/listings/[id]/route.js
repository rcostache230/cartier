export const runtime = "nodejs";

function buildListingHtml(listingId) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Marketplace Listing #${listingId}</title>
    <style>
      :root {
        --bg: #f8fafc;
        --card: #ffffff;
        --line: #e2e8f0;
        --ink: #1a2332;
        --muted: #64748b;
        --teal: #10b981;
        --teal-2: #059669;
        --amber: #f59e0b;
        --danger: #ef4444;
        --soft: #ecfdf5;
        --chip: #f1f5f9;
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

      .crumb-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }

      .crumb {
        margin: 0;
        font-size: 2rem;
        line-height: 1.2;
        font-weight: 800;
        color: var(--ink);
      }

      .crumb small {
        font-size: 0.82rem;
        color: #6a7475;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }

      .back-link {
        text-decoration: none;
        border-radius: 8px;
        background: #1a2332;
        color: #fff;
        font-weight: 700;
        padding: 8px 12px;
        font-size: 0.88rem;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .back-links {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .back-link.market {
        background: var(--teal);
      }

      .error-card {
        margin-top: 12px;
        border: 1px solid #fecaca;
        border-radius: 12px;
        background: #fef2f2;
        color: #b91c1c;
        padding: 12px;
        font-weight: 700;
      }

      .layout {
        margin-top: 12px;
        display: grid;
        grid-template-columns: minmax(340px, 1fr) minmax(340px, 0.95fr);
        gap: 16px;
      }

      .panel {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 22px;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
      }

      .gallery-shell {
        position: relative;
        border-radius: 12px;
        border: 1px solid var(--line);
        background: #f8fafc;
        overflow: hidden;
      }

      .badge {
        position: absolute;
        top: 10px;
        left: 10px;
        border-radius: 999px;
        background: #1a2332;
        color: #fff;
        padding: 6px 10px;
        font-size: 0.82rem;
        font-weight: 700;
      }

      .gallery-main {
        width: 100%;
        aspect-ratio: 1 / 1;
        object-fit: contain;
        display: block;
        background: #f8fafc;
        padding: 36px 14px 12px;
      }

      .thumb-row {
        margin-top: 10px;
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 8px;
      }

      .thumb-btn {
        border: 2px solid #cbd5e1;
        border-radius: 8px;
        padding: 0;
        background: #f8fafc;
        cursor: pointer;
        overflow: hidden;
      }

      .thumb-btn.active {
        border-color: var(--teal);
      }

      .thumb-btn img {
        width: 100%;
        height: 72px;
        object-fit: contain;
        display: block;
        background: #f8fafc;
      }

      .vendor {
        color: var(--muted);
        font-size: 0.86rem;
      }

      .title {
        margin: 6px 0 0;
        color: var(--ink);
        font-size: 2rem;
        line-height: 1.18;
      }

      .price-row {
        margin-top: 12px;
        display: flex;
        align-items: baseline;
        gap: 8px;
      }

      .price-main {
        font-size: 2.35rem;
        line-height: 1;
        font-weight: 800;
        color: var(--ink);
      }

      .price-currency {
        font-size: 1.1rem;
        font-weight: 800;
        color: var(--ink);
      }

      .separator {
        margin: 14px 0;
        border: 0;
        border-top: 1px solid #e2e4e3;
      }

      .policy-box {
        border: 1px solid var(--line);
        border-radius: 12px;
        background: #f8fafc;
        padding: 10px;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .policy-tag {
        background: #fef3c7;
        color: #92400e;
        border-radius: 8px;
        padding: 5px 9px;
        font-weight: 800;
        font-size: 0.8rem;
      }

      .policy-text {
        color: var(--muted);
        font-size: 0.88rem;
      }

      .policy-text strong {
        color: var(--ink);
      }

      .actions {
        margin-top: 12px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      button,
      .action-link {
        border: 1px solid transparent;
        border-radius: 8px;
        padding: 10px 12px;
        font: inherit;
        font-size: 0.92rem;
        font-weight: 700;
        text-align: center;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      button {
        cursor: pointer;
      }

      button:disabled {
        opacity: 0.7;
        cursor: wait;
      }

      .action-contact {
        background: var(--soft);
        color: #065f46;
      }

      .action-claim {
        background: #10b981;
        color: #ffffff;
      }

      .action-link {
        display: inline-flex;
        text-decoration: underline;
        background: transparent;
        color: #1a2332;
        padding-left: 0;
        padding-right: 0;
      }

      .quick-links {
        margin-top: 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
      }

      .quick-links .sep {
        width: 1px;
        height: 18px;
        background: #d8dcdb;
      }

      .chips-row {
        margin-top: 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .chips {
        display: flex;
        gap: 6px;
        align-items: center;
      }

      .chip {
        width: 14px;
        height: 14px;
        border-radius: 50%;
      }

      .chip.c1 {
        background: #10b981;
      }

      .chip.c2 {
        background: #f59e0b;
      }

      .chip.c3 {
        background: #1a2332;
      }

      .sold-note {
        color: #1a2332;
        font-weight: 700;
        font-size: 0.9rem;
      }

      .meta {
        margin-top: 12px;
        color: var(--muted);
        font-size: 0.88rem;
        line-height: 1.55;
      }

      .meta strong,
      .meta b {
        color: var(--ink);
      }

      .desc {
        margin-top: 12px;
        color: var(--muted);
        font-size: 0.92rem;
        line-height: 1.5;
      }

      .benefits {
        margin-top: 14px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: #fff;
        display: grid;
        grid-template-columns: 1fr 1fr;
      }

      .benefit {
        padding: 12px;
      }

      .benefit + .benefit {
        border-left: 1px solid #eceeed;
      }

      .benefit b {
        display: block;
        color: var(--ink);
        font-size: 0.95rem;
      }

      .benefit span {
        color: var(--muted);
        font-size: 0.86rem;
      }

      .lucide {
        width: 16px;
        height: 16px;
        stroke-width: 2.2;
      }

      .hidden {
        display: none !important;
      }

      @media (max-width: 900px) {
        .layout {
          grid-template-columns: 1fr;
        }

        .thumb-row {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .actions {
          grid-template-columns: 1fr;
        }

        .benefits {
          grid-template-columns: 1fr;
        }

        .benefit + .benefit {
          border-left: 0;
          border-top: 1px solid #eceeed;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <section class="crumb-row">
        <h1 class="crumb"><small>Marketplace Listing</small> / <span id="crumbTitle">Item</span></h1>
        <div class="back-links">
          <a class="back-link market" href="/?module=marketplace">Back To Marketplace</a>
          <a class="back-link" href="/">Back To Dashboard</a>
        </div>
      </section>

      <section id="errorCard" class="error-card hidden"></section>

      <section id="listingCard" class="layout hidden">
        <div class="panel">
          <div class="gallery-shell">
            <div id="deliveryBadge" class="badge">In Person Only</div>
            <img id="galleryMain" class="gallery-main" alt="Listing photo" />
          </div>
          <div id="thumbRow" class="thumb-row"></div>
        </div>

        <div class="panel">
          <div class="vendor">Neighbourhood marketplace</div>
          <h2 id="listingTitle" class="title">Listing</h2>

          <div class="price-row">
            <div id="priceMain" class="price-main">0</div>
            <div id="priceCurrency" class="price-currency">RON</div>
          </div>

          <hr class="separator" />

          <div class="policy-box">
            <div class="policy-tag">Policy</div>
            <div class="policy-text">In-person transaction only. <strong>No online payment.</strong></div>
          </div>

          <div class="actions">
            <button id="contactBtn" class="action-contact" type="button">Contact owner</button>
            <button id="claimBtn" class="action-claim" type="button">Claim donation</button>
          </div>

          <div class="quick-links">
            <a id="openMainPhotoLink" class="action-link" href="#" target="_blank" rel="noopener noreferrer">View full photo</a>
            <span class="sep"></span>
            <a class="action-link" href="/?module=marketplace">Back to marketplace</a>
          </div>

          <div class="chips-row">
            <div class="chips"><span class="chip c1"></span><span class="chip c2"></span><span class="chip c3"></span></div>
            <div id="soldNote" class="sold-note">Listing active</div>
          </div>

          <div class="meta">
            <div><b>SKU:</b> MP<span id="metaSku"></span></div>
            <div><strong>Type:</strong> <span id="metaType"></span> | <strong>Status:</strong> <span id="metaStatus"></span></div>
            <div><strong>Owner:</strong> <span id="metaOwner"></span> | <strong>Contact:</strong> <span id="metaContact"></span></div>
            <div><strong>Pickup:</strong> <span id="metaPickup"></span></div>
            <div><strong>Claimed By:</strong> <span id="metaClaimedBy"></span></div>
            <div><strong>Created:</strong> <span id="metaCreated"></span> | <strong>Updated:</strong> <span id="metaUpdated"></span></div>
          </div>

          <p id="listingDescription" class="desc"></p>

          <div class="benefits">
            <div class="benefit">
              <b>In-Person Handoff</b>
              <span>Meet at pickup location and check item condition before finalizing.</span>
            </div>
            <div class="benefit">
              <b>Resident Marketplace</b>
              <span>Direct neighbour-to-neighbour coordination without platform checkout.</span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <script src="https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js"></script>
    <script>
      const listingId = ${listingId};
      const PLACEHOLDER_THUMB =
        "data:image/svg+xml;utf8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200"><rect width="1200" height="1200" fill="#f2f4f2"/><rect x="230" y="200" width="740" height="740" rx="28" fill="#ffffff" stroke="#d7dbda" stroke-width="16"/><circle cx="470" cy="420" r="64" fill="#d4d7d6"/><path d="M300 860l200-220 120 120 100-102 180 202H300z" fill="#c6dad7"/><text x="600" y="1030" text-anchor="middle" font-size="58" fill="#8a8f95" font-family="Arial, sans-serif">No Photo</text></svg>'
        );

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
        listingCard: document.getElementById("listingCard"),
        crumbTitle: document.getElementById("crumbTitle"),
        galleryMain: document.getElementById("galleryMain"),
        deliveryBadge: document.getElementById("deliveryBadge"),
        thumbRow: document.getElementById("thumbRow"),
        listingTitle: document.getElementById("listingTitle"),
        priceMain: document.getElementById("priceMain"),
        priceCurrency: document.getElementById("priceCurrency"),
        contactBtn: document.getElementById("contactBtn"),
        claimBtn: document.getElementById("claimBtn"),
        openMainPhotoLink: document.getElementById("openMainPhotoLink"),
        soldNote: document.getElementById("soldNote"),
        metaSku: document.getElementById("metaSku"),
        metaType: document.getElementById("metaType"),
        metaStatus: document.getElementById("metaStatus"),
        metaOwner: document.getElementById("metaOwner"),
        metaContact: document.getElementById("metaContact"),
        metaPickup: document.getElementById("metaPickup"),
        metaClaimedBy: document.getElementById("metaClaimedBy"),
        metaCreated: document.getElementById("metaCreated"),
        metaUpdated: document.getElementById("metaUpdated"),
        listingDescription: document.getElementById("listingDescription"),
      };

      let galleryBound = false;

      function iconMarkup(name) {
        return '<i data-lucide="' + name + '" aria-hidden="true"></i>';
      }

      function hydrateLucideIcons() {
        if (!window.lucide || typeof window.lucide.createIcons !== "function") return;
        window.lucide.createIcons();
      }

      function setActionButton(button, iconName, label) {
        if (!button) return;
        button.dataset.defaultText = label;
        button.innerHTML = iconMarkup(iconName) + "<span>" + label + "</span>";
        button.dataset.defaultHtml = button.innerHTML;
      }

      function setActionLink(link, iconName) {
        if (!link) return;
        const label = link.textContent.trim();
        link.innerHTML = iconMarkup(iconName) + "<span>" + label + "</span>";
      }

      function applyStaticIcons() {
        document.querySelectorAll(".back-link.market").forEach((link) => setActionLink(link, "store"));
        document.querySelectorAll(".back-link:not(.market)").forEach((link) => setActionLink(link, "arrow-left"));
        document.querySelectorAll('.quick-links a[href="/?module=marketplace"]').forEach((link) => setActionLink(link, "store"));
        setActionLink(els.openMainPhotoLink, "image");
        setActionButton(els.contactBtn, "phone", "Contact owner");
        setActionButton(els.claimBtn, "hand-heart", "Claim donation");
        hydrateLucideIcons();
      }

      function showError(message) {
        els.listingCard.classList.add("hidden");
        els.errorCard.classList.remove("hidden");
        els.errorCard.textContent = message;
      }

      function formatDate(value) {
        if (!value) return "-";
        const raw = String(value).trim();
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
          return BUCHAREST_DISPLAY_FORMATTER.format(parsed).replace(",", "");
        }
        return "-";
      }

      function listingTypeLabel(type) {
        return type === "donation" ? "Donation" : "Sale";
      }

      function listingStatusLabel(status) {
        if (status === "sold") return "Sold";
        if (status === "donated") return "Donated";
        return "Active";
      }

      function parsePriceParts(post) {
        if (!post || post.listing_type !== "sale") {
          return { value: "0", currency: "FREE" };
        }
        const raw = String(post.price_text || "").trim();
        if (!raw) return { value: "0", currency: "RON" };

        const numberMatch = raw.match(/\\d+(?:[.,]\\d+)?/);
        const value = numberMatch ? numberMatch[0].replace(",", ".") : raw;

        if (/\\beur\\b/i.test(raw)) return { value, currency: "EUR" };
        if (/\\busd\\b/i.test(raw)) return { value, currency: "USD" };
        if (/\\bron\\b/i.test(raw)) return { value, currency: "RON" };

        return { value, currency: "RON" };
      }

      function setupGallery(urls) {
        const galleryUrls = Array.isArray(urls) && urls.length ? urls : [PLACEHOLDER_THUMB];
        let activeUrl = galleryUrls[0];

        function updateMain(url) {
          activeUrl = url || PLACEHOLDER_THUMB;
          els.galleryMain.src = activeUrl;
          els.openMainPhotoLink.href = activeUrl;
          els.openMainPhotoLink.classList.toggle("hidden", activeUrl === PLACEHOLDER_THUMB);
          Array.from(els.thumbRow.querySelectorAll(".thumb-btn")).forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.photoUrl === activeUrl);
          });
        }

        els.thumbRow.innerHTML = galleryUrls
          .map((url, idx) => {
            const safeUrl = url || PLACEHOLDER_THUMB;
            return '<button type="button" class="thumb-btn' +
              (idx === 0 ? " active" : "") +
              '" data-photo-url="' +
              safeUrl +
              '" aria-label="Open photo ' +
              (idx + 1) +
              '"><img src="' +
              safeUrl +
              '" alt="Listing thumbnail ' +
              (idx + 1) +
              '" loading="lazy" /></button>';
          })
          .join("");

        if (!galleryBound) {
          els.thumbRow.addEventListener("click", (event) => {
            const button = event.target.closest(".thumb-btn");
            if (!button) return;
            updateMain(button.dataset.photoUrl || PLACEHOLDER_THUMB);
          });
          galleryBound = true;
        }

        updateMain(activeUrl);
      }

      async function claimDonation(postId) {
        const response = await fetch("/api/marketplace/posts/" + postId + "/claim", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Could not claim donation.");
        }
        return data;
      }

      function setClaimButton(post) {
        const canClaim =
          post.listing_type === "donation" &&
          post.status === "active" &&
          !post.claimed_by_username;

        if (!canClaim) {
          els.claimBtn.disabled = true;
          setActionButton(els.claimBtn, "ban", post.listing_type === "donation" ? "Already claimed" : "Not a donation");
          hydrateLucideIcons();
          return;
        }

        els.claimBtn.disabled = false;
        setActionButton(els.claimBtn, "hand-heart", "Claim donation");
        hydrateLucideIcons();
      }

      function renderListing(post) {
        els.errorCard.classList.add("hidden");
        els.listingCard.classList.remove("hidden");

        els.crumbTitle.textContent = post.title || "Item";
        els.deliveryBadge.textContent = post.listing_type === "donation" ? "Donation" : "In Person Only";
        els.listingTitle.textContent = post.title || "Listing";

        const price = parsePriceParts(post);
        els.priceMain.textContent = price.value;
        els.priceCurrency.textContent = price.currency;

        const photos = Array.isArray(post.photos)
          ? post.photos.map((photo) => photo.file_url).filter(Boolean)
          : [];
        setupGallery(photos);

        els.soldNote.textContent =
          post.status === "active"
            ? "Listing active now"
            : post.status === "sold"
              ? "Marked as sold"
              : "Marked as donated";

        els.metaSku.textContent = String(post.id || listingId).padStart(4, "0");
        els.metaType.textContent = listingTypeLabel(post.listing_type);
        els.metaStatus.textContent = listingStatusLabel(post.status || "active");
        els.metaOwner.textContent = post.owner_username || "-";
        els.metaContact.textContent = post.contact_phone || post.owner_phone_number || "-";
        els.metaPickup.textContent = post.pickup_details || "In person handoff";
        els.metaClaimedBy.textContent = post.claimed_by_username || "-";
        els.metaCreated.textContent = formatDate(post.created_at);
        els.metaUpdated.textContent = formatDate(post.updated_at || post.created_at);
        els.listingDescription.textContent =
          post.description ||
          "Owner did not add extra details. Contact directly for condition, dimensions, and pickup timing.";

        const contactPhone = post.contact_phone || post.owner_phone_number || "";
        els.contactBtn.disabled = !contactPhone;
        setActionButton(els.contactBtn, contactPhone ? "phone" : "phone-off", contactPhone ? "Contact owner" : "No phone shared");
        hydrateLucideIcons();
        els.contactBtn.onclick = () => {
          if (!contactPhone) return;
          window.location.href = "tel:" + contactPhone.replace(/\\s+/g, "");
        };

        setClaimButton(post);
        els.claimBtn.onclick = async () => {
          if (els.claimBtn.disabled) return;
          const previousHtml = els.claimBtn.innerHTML;
          els.claimBtn.disabled = true;
          els.claimBtn.textContent = "Claiming...";
          try {
            const updated = await claimDonation(post.id);
            renderListing(updated);
          } catch (error) {
            els.claimBtn.disabled = false;
            els.claimBtn.innerHTML = previousHtml;
            hydrateLucideIcons();
            alert(error.message || "Could not claim donation");
          }
        };
      }

      async function loadListing() {
        try {
          const response = await fetch("/api/marketplace/posts/" + listingId, {
            method: "GET",
            credentials: "include",
            headers: { "cache-control": "no-store" },
          });

          if (response.status === 401) {
            showError("Authentication required. Go back and sign in first.");
            return;
          }
          if (response.status === 404) {
            showError("Listing not found.");
            return;
          }

          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            showError(data.error || "Could not load listing.");
            return;
          }

          renderListing(data);
        } catch (error) {
          showError("Could not load listing. Please try again.");
        }
      }

      applyStaticIcons();
      loadListing();
    </script>
  </body>
</html>`;
}

export async function GET(_request, context) {
  const params = await Promise.resolve(context?.params || {});
  const listingId = Number(params.id || 0);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return new Response("Invalid listing id", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return new Response(buildListingHtml(listingId), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
