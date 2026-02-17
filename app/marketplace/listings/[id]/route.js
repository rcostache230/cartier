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
        --bg: #f3f4f3;
        --card: #ffffff;
        --line: #e3e5e4;
        --ink: #093e41;
        --muted: #6f7677;
        --accent: #ff7b69;
        --accent-2: #0a4c85;
        --soft-btn: #eef0ea;
        --buy-btn: #b4de71;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        background: var(--bg);
        color: var(--ink);
      }

      .container {
        max-width: 1380px;
        margin: 0 auto;
        padding: 30px 34px 46px;
      }

      .crumb-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .crumb {
        margin: 0;
        font-size: 52px;
        line-height: 1.08;
        font-weight: 800;
        color: #0a3d40;
      }

      .crumb small {
        font-size: 0.5em;
        color: #6a7475;
        font-weight: 700;
      }

      .back-link {
        text-decoration: none;
        border-radius: 999px;
        background: #5f6f7f;
        color: #fff;
        font-weight: 700;
        padding: 10px 16px;
        font-size: 0.95rem;
      }

      .layout {
        margin-top: 24px;
        display: grid;
        grid-template-columns: minmax(380px, 1fr) minmax(360px, 0.95fr);
        gap: 34px;
      }

      .gallery-col,
      .detail-col {
        min-width: 0;
      }

      .error-card {
        margin-top: 16px;
        border: 1px solid #f4b1ab;
        border-radius: 14px;
        background: #fff1ef;
        color: #b42318;
        padding: 16px;
        font-weight: 700;
      }

      .gallery-shell {
        position: relative;
        border-radius: 26px;
        border: 1px solid var(--line);
        background: #ecefed;
        overflow: hidden;
      }

      .delivery-badge {
        position: absolute;
        top: 0;
        left: 0;
        border-radius: 0 0 22px 0;
        background: var(--accent-2);
        color: #fff;
        padding: 14px 26px;
        font-weight: 700;
        font-size: 2rem;
        line-height: 1;
      }

      .gallery-main {
        width: 100%;
        aspect-ratio: 1 / 1;
        object-fit: contain;
        display: block;
        background: #ecefed;
        padding: 58px 20px 24px;
      }

      .thumb-row {
        margin-top: 18px;
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 14px;
      }

      .thumb-btn {
        border: 2px solid #e4e7e5;
        border-radius: 12px;
        padding: 0;
        background: #ecefed;
        cursor: pointer;
        overflow: hidden;
      }

      .thumb-btn.active {
        border-color: #0b6f6e;
        box-shadow: 0 0 0 2px rgba(11, 111, 110, 0.14);
      }

      .thumb-btn img {
        width: 100%;
        height: 112px;
        object-fit: contain;
        background: #ecefed;
        display: block;
      }

      .countdown {
        color: var(--accent);
        font-weight: 800;
        font-size: 2.2rem;
        letter-spacing: 0.01em;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .vendor {
        margin-top: 18px;
        color: #7b8184;
        font-size: 2rem;
      }

      .title {
        margin: 10px 0 0;
        color: #0a3d40;
        font-size: 5rem;
        line-height: 1.08;
        letter-spacing: -0.02em;
      }

      .rating-row {
        margin-top: 14px;
        display: flex;
        align-items: center;
        gap: 10px;
        color: #204f52;
        font-size: 2rem;
      }

      .rating-row .star {
        color: #f0c84b;
      }

      .rating-row .reviews {
        color: #80888a;
        text-decoration: underline;
      }

      .price-row {
        margin-top: 18px;
        display: flex;
        align-items: flex-start;
        gap: 10px;
      }

      .price-main {
        font-size: 7rem;
        line-height: 0.95;
        font-weight: 800;
        color: #083f40;
      }

      .price-currency {
        font-size: 3.6rem;
        font-weight: 800;
        margin-top: 2px;
        color: #083f40;
      }

      .separator {
        margin: 24px 0;
        border: 0;
        border-top: 1px solid #e2e4e3;
      }

      .policy-box {
        border: 1px solid #e3e5e4;
        border-radius: 16px;
        background: #f8f9f7;
        padding: 14px 16px;
        display: flex;
        align-items: center;
        gap: 14px;
      }

      .policy-tag {
        background: #ffd8df;
        color: #74273a;
        border-radius: 10px;
        padding: 6px 12px;
        font-weight: 800;
        font-size: 1.8rem;
      }

      .policy-text {
        color: #7a8183;
        font-size: 1.85rem;
        line-height: 1.2;
      }

      .policy-text strong {
        color: #174346;
      }

      .actions {
        margin-top: 18px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }

      button,
      .action-link {
        border: 0;
        border-radius: 999px;
        padding: 15px 16px;
        font: inherit;
        font-weight: 700;
        font-size: 1.9rem;
        text-align: center;
      }

      button {
        cursor: pointer;
      }

      button:disabled {
        opacity: 0.7;
        cursor: wait;
      }

      .action-contact {
        background: var(--soft-btn);
        color: #1a4f52;
      }

      .action-claim {
        background: var(--buy-btn);
        color: #0d483f;
      }

      .action-link {
        display: inline-block;
        text-decoration: underline;
        background: transparent;
        color: #1b4f53;
        padding-left: 0;
        padding-right: 0;
      }

      .quick-links {
        margin-top: 14px;
        display: flex;
        flex-wrap: wrap;
        gap: 18px;
        align-items: center;
      }

      .quick-links .sep {
        width: 1px;
        height: 22px;
        background: #d8dcdb;
      }

      .chips-row {
        margin-top: 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .chips {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .chip {
        width: 22px;
        height: 22px;
        border-radius: 50%;
      }

      .chip.c1 {
        background: #8b1b7b;
      }

      .chip.c2 {
        background: #b86d1d;
      }

      .chip.c3 {
        background: #105f92;
      }

      .sold-note {
        color: #a54040;
        font-weight: 700;
        font-size: 1.9rem;
      }

      .meta {
        margin-top: 14px;
        color: #596265;
        font-size: 1.75rem;
        line-height: 1.5;
      }

      .meta b,
      .meta strong {
        color: #214c4f;
      }

      .desc {
        margin-top: 14px;
        color: #666f73;
        font-size: 1.85rem;
        line-height: 1.45;
      }

      .benefits {
        margin-top: 18px;
        border: 1px solid #e3e5e4;
        border-radius: 14px;
        background: #fff;
        display: grid;
        grid-template-columns: 1fr 1fr;
      }

      .benefit {
        padding: 16px;
      }

      .benefit + .benefit {
        border-left: 1px solid #eceeed;
      }

      .benefit b {
        display: block;
        color: #194749;
        font-size: 2rem;
      }

      .benefit span {
        color: #7a8285;
        font-size: 1.8rem;
      }

      .hidden {
        display: none !important;
      }

      @media (max-width: 1120px) {
        html {
          font-size: 12px;
        }
      }

      @media (max-width: 860px) {
        html {
          font-size: 11px;
        }

        .container {
          padding: 20px 14px 30px;
        }

        .layout {
          grid-template-columns: 1fr;
          gap: 20px;
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
        <h1 class="crumb"><small id="crumbPrefix">All category</small> / <span id="crumbTitle">Listing</span></h1>
        <a class="back-link" href="/">Back To Dashboard</a>
      </section>

      <section id="errorCard" class="error-card hidden"></section>

      <section id="listingCard" class="layout hidden">
        <div class="gallery-col">
          <div class="gallery-shell">
            <div id="deliveryBadge" class="delivery-badge">In Person</div>
            <img id="galleryMain" class="gallery-main" alt="Listing photo" />
          </div>
          <div id="thumbRow" class="thumb-row"></div>
        </div>

        <div class="detail-col">
          <div class="countdown"><span>⏰</span><span id="countdownValue">00 : 00 : 00 : 00</span></div>
          <div id="vendorLine" class="vendor">Neighbourhood marketplace</div>
          <h2 id="listingTitle" class="title">Listing</h2>
          <div class="rating-row"><span class="star">★</span><span id="ratingValue">4.8 Rating</span><span id="reviewsValue" class="reviews">(20 reviews)</span></div>

          <div class="price-row">
            <div id="priceMain" class="price-main">0</div>
            <div id="priceCurrency" class="price-currency">RON</div>
          </div>

          <hr class="separator" />

          <div class="policy-box">
            <div class="policy-tag">Policy</div>
            <div class="policy-text">
              <span>In-person transaction only.</span>
              <strong>No online payment.</strong>
            </div>
          </div>

          <div class="actions">
            <button id="contactBtn" class="action-contact" type="button">Contact owner</button>
            <button id="claimBtn" class="action-claim" type="button">Claim donation</button>
          </div>

          <div class="quick-links">
            <a id="openMainPhotoLink" class="action-link" href="#" target="_blank" rel="noopener noreferrer">View full photo</a>
            <span class="sep"></span>
            <a class="action-link" href="/">Back to listings</a>
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
              <span>Meet at pickup location and confirm item condition before completing exchange.</span>
            </div>
            <div class="benefit">
              <b>Resident Marketplace</b>
              <span>Created for neighbours: direct contact, quick coordination, no platform checkout.</span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <script>
      const listingId = ${listingId};
      const PLACEHOLDER_THUMB =
        "data:image/svg+xml;utf8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200"><rect width="1200" height="1200" fill="#ecefed"/><rect x="230" y="200" width="740" height="740" rx="28" fill="#ffffff" stroke="#d7dbda" stroke-width="16"/><circle cx="470" cy="420" r="64" fill="#d4d7d6"/><path d="M300 860l200-220 120 120 100-102 180 202H300z" fill="#c6dad7"/><text x="600" y="1030" text-anchor="middle" font-size="58" fill="#8a8f95" font-family="Arial, sans-serif">No Photo</text></svg>'
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
        countdownValue: document.getElementById("countdownValue"),
        vendorLine: document.getElementById("vendorLine"),
        listingTitle: document.getElementById("listingTitle"),
        ratingValue: document.getElementById("ratingValue"),
        reviewsValue: document.getElementById("reviewsValue"),
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

      let currentPost = null;
      let countdownTimer = null;
      let galleryBound = false;

      function showError(message) {
        els.listingCard.classList.add("hidden");
        els.errorCard.classList.remove("hidden");
        els.errorCard.textContent = message;
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

      function listingTypeLabel(type) {
        return type === "donation" ? "Donation" : "Sale";
      }

      function listingStatusLabel(status) {
        if (status === "sold") return "Sold";
        if (status === "donated") return "Donated";
        return "Active";
      }

      function seededRatingValue(id) {
        const base = Number(id || 0);
        const rating = 4.2 + ((base % 7) * 0.1);
        const reviews = 8 + (base % 25);
        return {
          rating: rating.toFixed(1),
          reviews,
        };
      }

      function parsePriceParts(post) {
        if (!post || post.listing_type !== "sale") {
          return { value: "0", currency: "FREE" };
        }
        const raw = String(post.price_text || "").trim();
        if (!raw) return { value: "0", currency: "RON" };

        const numberMatch = raw.match(/\d+(?:[.,]\d+)?/);
        const value = numberMatch ? numberMatch[0].replace(",", ".") : raw;

        if (/\beur\b/i.test(raw)) return { value, currency: "EUR" };
        if (/\busd\b/i.test(raw)) return { value, currency: "USD" };
        if (/\bron\b/i.test(raw)) return { value, currency: "RON" };

        return { value, currency: "RON" };
      }

      function countdownParts(targetDate) {
        const now = Date.now();
        const delta = Math.max(0, targetDate - now);
        const totalSec = Math.floor(delta / 1000);
        const days = Math.floor(totalSec / 86400);
        const hours = Math.floor((totalSec % 86400) / 3600);
        const minutes = Math.floor((totalSec % 3600) / 60);
        const seconds = totalSec % 60;
        return [days, hours, minutes, seconds].map((v) => String(v).padStart(2, "0")).join(" : ");
      }

      function setupCountdown(post) {
        if (countdownTimer) {
          clearInterval(countdownTimer);
          countdownTimer = null;
        }

        const anchorRaw = post.updated_at || post.created_at;
        const anchorDate = new Date(anchorRaw);
        if (Number.isNaN(anchorDate.getTime())) {
          els.countdownValue.textContent = "00 : 00 : 00 : 00";
          return;
        }

        const target = anchorDate.getTime() + 7 * 24 * 60 * 60 * 1000;
        const render = () => {
          els.countdownValue.textContent = countdownParts(target);
        };

        render();
        countdownTimer = setInterval(render, 1000);
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
          els.claimBtn.textContent = post.listing_type === "donation" ? "Already claimed" : "Not a donation";
          return;
        }

        els.claimBtn.disabled = false;
        els.claimBtn.textContent = "Claim donation";
      }

      function renderListing(post) {
        currentPost = post;
        els.errorCard.classList.add("hidden");
        els.listingCard.classList.remove("hidden");

        els.crumbTitle.textContent = post.title || "Listing";
        els.deliveryBadge.textContent = post.listing_type === "donation" ? "Donation" : "In Person";
        els.vendorLine.textContent = "Neighbourhood marketplace";
        els.listingTitle.textContent = post.title || "Listing";

        const seeded = seededRatingValue(post.id);
        els.ratingValue.textContent = seeded.rating + " Rating";
        els.reviewsValue.textContent = "(" + seeded.reviews + " reviews)";

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
        els.contactBtn.textContent = contactPhone ? "Contact owner" : "No phone shared";
        els.contactBtn.onclick = () => {
          if (!contactPhone) return;
          window.location.href = "tel:" + contactPhone.replace(/\s+/g, "");
        };

        setClaimButton(post);
        els.claimBtn.onclick = async () => {
          if (els.claimBtn.disabled) return;
          const previous = els.claimBtn.textContent;
          els.claimBtn.disabled = true;
          els.claimBtn.textContent = "Claiming...";
          try {
            const updated = await claimDonation(post.id);
            renderListing(updated);
          } catch (error) {
            els.claimBtn.disabled = false;
            els.claimBtn.textContent = previous;
            alert(error.message || "Could not claim donation");
          }
        };

        setupCountdown(post);
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
