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
        --bg: #f6f4ee;
        --card: #ffffff;
        --line: #d7d2c8;
        --ink: #1d2730;
        --muted: #55626e;
        --teal: #0e7568;
        --ghost: #687684;
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
        max-width: 1080px;
        margin: 0 auto;
        padding: 20px;
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .button-link {
        display: inline-block;
        text-decoration: none;
        border-radius: 8px;
        padding: 8px 12px;
        color: #fff;
        background: var(--teal);
        font-weight: 600;
      }

      .button-link.ghost {
        background: var(--ghost);
      }

      .card {
        margin-top: 12px;
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 14px;
      }

      .title {
        margin: 0;
      }

      .meta {
        margin-top: 8px;
        display: grid;
        gap: 8px;
        color: var(--muted);
      }

      .meta strong {
        color: var(--ink);
      }

      .gallery-main-wrap {
        border: 1px solid #ddd8ce;
        border-radius: 12px;
        background: #fbfaf6;
        overflow: hidden;
      }

      .gallery-main {
        width: 100%;
        aspect-ratio: 16 / 10;
        object-fit: contain;
        display: block;
        background: #f3efe7;
      }

      .thumb-row {
        margin-top: 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .thumb-btn {
        border: 2px solid #d8d2c8;
        border-radius: 8px;
        padding: 0;
        background: #fff;
        cursor: pointer;
      }

      .thumb-btn.active {
        border-color: #0e7568;
      }

      .thumb-btn img {
        width: 76px;
        height: 76px;
        object-fit: cover;
        display: block;
        border-radius: 6px;
      }

      .status {
        margin-top: 8px;
        font-weight: 700;
      }

      .muted {
        color: var(--muted);
      }

      .error {
        color: #b42318;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <section class="topbar">
        <h1 class="title">Marketplace Listing</h1>
        <a class="button-link ghost" href="/">Back To Dashboard</a>
      </section>

      <section class="card" id="errorCard" style="display: none">
        <p id="errorText" class="error"></p>
      </section>

      <section class="card" id="listingCard" style="display: none">
        <div class="topbar">
          <h2 id="listingTitle" class="title"></h2>
          <a id="openMainPhotoLink" class="button-link" href="#" target="_blank" rel="noopener noreferrer">Open Photo</a>
        </div>
        <p id="listingStatus" class="status"></p>
        <p id="listingDescription" class="muted"></p>

        <div class="gallery-main-wrap">
          <img id="galleryMain" class="gallery-main" alt="Listing photo" />
        </div>
        <div id="thumbRow" class="thumb-row"></div>

        <div class="meta">
          <div><strong>Type:</strong> <span id="metaType"></span></div>
          <div><strong>Price:</strong> <span id="metaPrice"></span></div>
          <div><strong>Owner:</strong> <span id="metaOwner"></span></div>
          <div><strong>Contact:</strong> <span id="metaContact"></span></div>
          <div><strong>Pickup:</strong> <span id="metaPickup"></span></div>
          <div><strong>Claimed By:</strong> <span id="metaClaimedBy"></span></div>
          <div><strong>Created:</strong> <span id="metaCreated"></span></div>
          <div><strong>Updated:</strong> <span id="metaUpdated"></span></div>
        </div>
      </section>
    </div>

    <script>
      const listingId = ${listingId};
      const PLACEHOLDER_THUMB =
        "data:image/svg+xml;utf8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750"><rect width="1200" height="750" fill="#f3efe7"/><rect x="240" y="125" width="720" height="500" rx="28" fill="#ffffff" stroke="#d7d2c8" stroke-width="16"/><circle cx="480" cy="290" r="58" fill="#d8d2c8"/><path d="M320 560l180-190 110 110 90-94 180 174H320z" fill="#c6d9d4"/><text x="600" y="688" text-anchor="middle" font-size="56" fill="#8a8f95" font-family="Arial, sans-serif">No Photo</text></svg>'
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
        errorText: document.getElementById("errorText"),
        listingCard: document.getElementById("listingCard"),
        listingTitle: document.getElementById("listingTitle"),
        listingStatus: document.getElementById("listingStatus"),
        listingDescription: document.getElementById("listingDescription"),
        galleryMain: document.getElementById("galleryMain"),
        openMainPhotoLink: document.getElementById("openMainPhotoLink"),
        thumbRow: document.getElementById("thumbRow"),
        metaType: document.getElementById("metaType"),
        metaPrice: document.getElementById("metaPrice"),
        metaOwner: document.getElementById("metaOwner"),
        metaContact: document.getElementById("metaContact"),
        metaPickup: document.getElementById("metaPickup"),
        metaClaimedBy: document.getElementById("metaClaimedBy"),
        metaCreated: document.getElementById("metaCreated"),
        metaUpdated: document.getElementById("metaUpdated"),
      };

      function showError(message) {
        els.listingCard.style.display = "none";
        els.errorCard.style.display = "";
        els.errorText.textContent = message;
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

      function setupGallery(urls) {
        const galleryUrls = Array.isArray(urls) && urls.length ? urls : [PLACEHOLDER_THUMB];
        let activeUrl = galleryUrls[0];

        function updateMain(url) {
          activeUrl = url || PLACEHOLDER_THUMB;
          els.galleryMain.src = activeUrl;
          els.openMainPhotoLink.href = activeUrl;
          els.openMainPhotoLink.style.display = activeUrl === PLACEHOLDER_THUMB ? "none" : "";
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

        els.thumbRow.addEventListener("click", (event) => {
          const button = event.target.closest(".thumb-btn");
          if (!button) return;
          updateMain(button.dataset.photoUrl || PLACEHOLDER_THUMB);
        });

        updateMain(activeUrl);
      }

      function renderListing(post) {
        els.errorCard.style.display = "none";
        els.listingCard.style.display = "";

        els.listingTitle.textContent = post.title || "Listing";
        els.listingStatus.textContent = listingStatusLabel(post.status || "active");
        els.listingDescription.textContent = post.description || "No additional description provided.";

        const photos = Array.isArray(post.photos)
          ? post.photos.map((photo) => photo.file_url).filter(Boolean)
          : [];
        setupGallery(photos);

        els.metaType.textContent = listingTypeLabel(post.listing_type);
        els.metaPrice.textContent = post.listing_type === "sale" ? post.price_text || "-" : "Free";
        els.metaOwner.textContent = post.owner_username || "-";
        els.metaContact.textContent = post.contact_phone || post.owner_phone_number || "-";
        els.metaPickup.textContent = post.pickup_details || "-";
        els.metaClaimedBy.textContent = post.claimed_by_username || "-";
        els.metaCreated.textContent = formatDate(post.created_at);
        els.metaUpdated.textContent = formatDate(post.updated_at || post.created_at);
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
