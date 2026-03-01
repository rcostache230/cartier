/* marketplace.js — extracted Marketplace module logic */

const MarketplaceModule = (() => {
  "use strict";

  const MARKETPLACE_PLACEHOLDER_THUMB =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><rect width="240" height="240" fill="#f3efe7"/><rect x="38" y="46" width="164" height="148" rx="14" fill="#ffffff" stroke="#d7d2c8" stroke-width="6"/><circle cx="92" cy="98" r="16" fill="#d8d2c8"/><path d="M58 174l44-46 28 28 24-23 28 41H58z" fill="#c6d9d4"/><text x="120" y="220" text-anchor="middle" font-size="18" fill="#8a8f95" font-family="Arial, sans-serif">No Photo</text></svg>'
    );
  const MARKETPLACE_CATEGORY_ORDER = ["furniture", "toys", "clothes", "brico", "other"];
  const MARKETPLACE_CATEGORY_LABELS = {
    all: "Toate",
    furniture: "Mobilă",
    toys: "Jucării",
    clothes: "Haine",
    brico: "Brico",
    other: "Altele",
  };
  const MARKETPLACE_CATEGORY_ICONS = {
    all: "📋",
    furniture: "🪑",
    toys: "🧸",
    clothes: "👕",
    brico: "🔧",
    other: "📦",
  };
  const MARKETPLACE_MAX_FILE_BYTES = 5 * 1024 * 1024;
  const MARKETPLACE_ALLOWED_FILE_TYPES = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
  ]);

  let marketplaceDashboardData = { active_listings: [], my_listings: [] };
  let marketplaceSelectedCategory = "all";
  let marketplaceSelectedType = "all";
  let marketplaceSelectedSort = "newest";
  let marketplaceSelectedBuilding = "all";
  let marketplaceUploadedPhotos = [];
  let marketplaceUploadPromise = null;
  let marketplaceUploadToken = 0;
  let marketplaceSelectedFiles = [];
  let marketplacePreviewUrls = [];
  let marketplaceSearchQuery = "";

  let eventsAttached = false;

  const e = (id) => document.getElementById(id);

  function marketplaceTypeLabel(type) {
    if (type === "donation") return "Donație";
    if (type === "lending") return "Împrumut";
    return "Vânzare";
  }

  function normalizeMarketplaceCategory(category) {
    const normalized = String(category || "other")
      .trim()
      .toLowerCase();
    if (normalized === "all") return "all";
    return MARKETPLACE_CATEGORY_ORDER.includes(normalized) ? normalized : "other";
  }

  function marketplaceCategoryLabel(category) {
    const normalized = normalizeMarketplaceCategory(category);
    return MARKETPLACE_CATEGORY_LABELS[normalized] || "Altele";
  }

  function marketplaceCategoryIcon(category) {
    const normalized = normalizeMarketplaceCategory(category);
    return MARKETPLACE_CATEGORY_ICONS[normalized] || "📦";
  }

  function marketplaceOwnerBuilding(post) {
    const fromPayload = Number(post?.building_number || 0);
    if (fromPayload > 0) return fromPayload;
    return inferBuildingFromUsername(post?.owner_username) || 0;
  }

  function marketplaceBuildingMatches(post) {
    if (marketplaceSelectedBuilding === "all") return true;
    return String(marketplaceOwnerBuilding(post)) === marketplaceSelectedBuilding;
  }

  function parseMarketplacePriceValue(post) {
    if (!post || post.listing_type === "donation" || post.listing_type === "lending") return 0;
    const raw = String(post.price_text || "").replace(",", ".").match(/(\d+(\.\d+)?)/);
    if (!raw) return Number.POSITIVE_INFINITY;
    return Number(raw[1] || Number.POSITIVE_INFINITY);
  }

  function sortMarketplaceListings(listings) {
    const sorted = listings.slice();
    sorted.sort((a, b) => {
      if (marketplaceSelectedSort === "price_asc") {
        return parseMarketplacePriceValue(a) - parseMarketplacePriceValue(b);
      }
      if (marketplaceSelectedSort === "price_desc") {
        return parseMarketplacePriceValue(b) - parseMarketplacePriceValue(a);
      }
      const da = new Date(String(a.updated_at || a.created_at || 0)).getTime() || 0;
      const db = new Date(String(b.updated_at || b.created_at || 0)).getTime() || 0;
      return db - da;
    });
    return sorted;
  }

  function marketplaceCategoryMatches(post) {
    if (marketplaceSelectedCategory === "all") return true;
    return normalizeMarketplaceCategory(post?.category) === marketplaceSelectedCategory;
  }

  function marketplaceTypeMatches(post) {
    if (marketplaceSelectedType === "all") return true;
    return String(post?.listing_type || "").toLowerCase() === marketplaceSelectedType;
  }

  function syncMarketplaceTypeSectionVisibility() {
    const sectionMap = {
      sale: e("sectionSale"),
      donation: e("sectionDonation"),
      lending: e("sectionLending"),
    };
    Object.entries(sectionMap).forEach(([type, sectionEl]) => {
      if (!sectionEl) return;
      sectionEl.classList.toggle("hidden", marketplaceSelectedType !== "all" && marketplaceSelectedType !== type);
    });
  }

  function setMarketplaceTypeFilter(type, { rerender = true, scroll = true } = {}) {
    const normalized = ["sale", "donation", "lending"].includes(String(type || "").toLowerCase())
      ? String(type).toLowerCase()
      : "all";
    marketplaceSelectedType = normalized;
    const typeTabs = e("marketplaceTypeTabs");
    if (typeTabs) {
      typeTabs.querySelectorAll("[data-market-type]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.marketType === normalized);
      });
    }
    if (rerender) {
      renderMarketplace(marketplaceDashboardData);
    } else {
      syncMarketplaceTypeSectionVisibility();
    }
    const sectionLending = e("sectionLending");
    if (scroll && normalized === "lending" && sectionLending) {
      sectionLending.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function setMarketplaceCategory(category, { syncForm = true, rerender = true } = {}) {
    const nextCategory = normalizeMarketplaceCategory(category);
    marketplaceSelectedCategory = nextCategory;
    const categoryTabs = e("marketplaceCategoryTabs");
    if (categoryTabs) {
      categoryTabs.querySelectorAll("[data-market-category]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.marketCategory === nextCategory);
      });
    }
    const categorySelect = e("marketplaceCategory");
    if (syncForm && categorySelect && nextCategory !== "all") {
      categorySelect.value = nextCategory;
    }
    if (rerender) {
      renderMarketplace(marketplaceDashboardData);
    }
  }

  function setMarketplaceSort(sortKey, { rerender = true } = {}) {
    const normalized = sortKey === "price_asc" || sortKey === "price_desc" ? sortKey : "newest";
    marketplaceSelectedSort = normalized;
    const sortTabs = e("marketplaceSortTabs");
    if (sortTabs) {
      sortTabs.querySelectorAll("[data-market-sort]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.marketSort === normalized);
      });
    }
    if (rerender) renderMarketplace(marketplaceDashboardData);
  }

  function setMarketplaceBuildingFilter(buildingValue, { rerender = true } = {}) {
    marketplaceSelectedBuilding = buildingValue || "all";
    const buildingFilter = e("marketplaceBuildingFilter");
    if (buildingFilter) {
      buildingFilter.value = marketplaceSelectedBuilding;
    }
    if (rerender) renderMarketplace(marketplaceDashboardData);
  }

  function marketplaceStatusLabel(status) {
    if (status === "sold") return "Vândut";
    if (status === "donated") return "Donat";
    return "Activ";
  }

  function marketplaceStatusTag(post) {
    const status = String(post?.status || "active")
      .trim()
      .toLowerCase();
    if (post?.listing_type === "lending") {
      if (status !== "active") {
        return { label: "Închis", className: "completed" };
      }
      return post?.is_available === false
        ? { label: "Împrumutat momentan", className: "claimed" }
        : { label: "Disponibil", className: "available" };
    }
    if (status === "active") {
      if (post?.listing_type === "donation" && post?.claimed_by_username) {
        return { label: "Rezervat", className: "claimed" };
      }
      return { label: "Disponibil", className: "available" };
    }
    return { label: "Finalizat", className: "completed" };
  }

  function marketplacePrimaryPhotoUrl(post) {
    const photos = Array.isArray(post?.photos) ? post.photos : [];
    if (!photos.length) return "";
    const first = photos[0];
    return first && first.file_url ? first.file_url : "";
  }

  function marketplaceThumbHtml(post, title = "Listing photo") {
    const thumbUrl = marketplacePrimaryPhotoUrl(post);
    if (thumbUrl) {
      return `<img class="market-thumb" src="${thumbUrl}" alt="${title}" loading="lazy" />`;
    }
    return `<div class="market-thumb-placeholder" aria-hidden="true">${marketplaceCategoryIcon(post?.category)}</div>`;
  }

  function marketplacePriceBadge(post) {
    if (post.listing_type === "donation") {
      return `<span class="market-price-badge free">Gratuit</span>`;
    }
    if (post.listing_type === "lending") {
      return `<span class="market-price-badge free">Împrumut</span>`;
    }
    const priceLabel = post.price_text ? post.price_text : "Preț";
    return `<span class="market-price-badge paid">${priceLabel}</span>`;
  }

  function marketplaceContactLabel(post) {
    return post.contact_phone || post.owner_phone_number || "Telefon indisponibil";
  }

  function marketplaceTypeBadgeClass(type) {
    if (type === "donation") return "badge-teal";
    if (type === "lending") return "badge-blue";
    return "badge-amber";
  }

  function sanitizePhoneHref(phoneValue) {
    return String(phoneValue || "").replace(/[^\d+]/g, "");
  }

  function marketplaceSectionEmptyStateHtml(type) {
    if (type === "sale") {
      return `
        <div class="empty-state">
          <p class="empty-state-title">Niciun obiect de vânzare momentan.</p>
          <p class="empty-state-body">Fii primul care listează ceva!</p>
        </div>
      `;
    }
    if (type === "donation") {
      return `
        <div class="empty-state">
          <p class="empty-state-title">Nicio donație disponibilă momentan.</p>
          <p class="empty-state-body">Ai ceva de dăruit unui vecin?</p>
        </div>
      `;
    }
    return `
      <div class="empty-state">
        <p class="empty-state-title">Nimeni nu a pus ceva la împrumut încă.</p>
        <p class="empty-state-body">Ai o bormaşină, o scară sau un cort? Oferă-le vecinilor!</p>
      </div>
    `;
  }

  function normalizeMarketplaceFileType(fileType, fileName) {
    const lowered = String(fileType || "").toLowerCase();
    if (lowered) return lowered;
    const fileLower = String(fileName || "").toLowerCase();
    if (fileLower.endsWith(".jpg") || fileLower.endsWith(".jpeg")) return "image/jpeg";
    if (fileLower.endsWith(".png")) return "image/png";
    if (fileLower.endsWith(".webp")) return "image/webp";
    return "";
  }

  function setMarketplaceUploadStatus(message, kind = "") {
    const uploadStatus = e("marketplaceUploadStatus");
    if (!uploadStatus) return;
    uploadStatus.textContent = message;
    uploadStatus.classList.remove("error", "success");
    if (kind) {
      uploadStatus.classList.add(kind);
    }
  }

  function clearMarketplaceUploadState() {
    const photoPreviews = e("marketplacePhotoPreviews");
    const photosInput = e("marketplacePhotos");
    const fileWarning = e("marketplaceFileWarning");
    const uploadProgress = e("marketplaceUploadProgress");
    const uploadProgressFill = e("marketplaceUploadProgressFill");

    marketplaceUploadedPhotos = [];
    marketplaceUploadPromise = null;
    marketplaceUploadToken += 1;
    marketplaceSelectedFiles = [];
    marketplacePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    marketplacePreviewUrls = [];
    if (photoPreviews) photoPreviews.innerHTML = "";
    if (photosInput) photosInput.value = "";
    if (fileWarning) {
      fileWarning.classList.add("hidden");
      fileWarning.textContent = "";
    }
    if (uploadProgress) uploadProgress.classList.add("hidden");
    if (uploadProgressFill) uploadProgressFill.style.width = "0%";
    setMarketplaceUploadStatus("No photos selected.");
  }

  function renderMarketplacePhotoPreviews() {
    const photoPreviews = e("marketplacePhotoPreviews");
    const fileWarning = e("marketplaceFileWarning");
    if (!photoPreviews) return;
    marketplacePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    marketplacePreviewUrls = [];
    photoPreviews.innerHTML = marketplaceSelectedFiles
      .map((file, index) => {
        const url = URL.createObjectURL(file);
        marketplacePreviewUrls.push(url);
        return `
          <div class="market-preview-item">
            <img src="${url}" alt="Selected photo ${index + 1}" />
            <button type="button" class="market-preview-remove" data-remove-market-file="${index}" aria-label="Remove photo">
              ×
            </button>
          </div>
        `;
      })
      .join("");
    if (fileWarning) {
      fileWarning.classList.add("hidden");
      fileWarning.textContent = "";
    }
  }

  function setMarketplaceSelectedFiles(fileList, { append = false } = {}) {
    const photosInput = e("marketplacePhotos");
    const uploadProgress = e("marketplaceUploadProgress");
    const uploadProgressFill = e("marketplaceUploadProgressFill");

    const incoming = Array.from(fileList || []).filter(Boolean);
    const invalid = incoming.filter(
      (file) => !MARKETPLACE_ALLOWED_FILE_TYPES.has(normalizeMarketplaceFileType(file.type, file.name))
    );
    if (invalid.length) {
      showToast(
        `Invalid file type: ${invalid.map((file) => file.name).join(", ")}. Only JPG, PNG and WEBP allowed.`,
        "error"
      );
      if (!append) {
        marketplaceUploadToken += 1;
        marketplaceUploadPromise = null;
        marketplaceUploadedPhotos = [];
        marketplaceSelectedFiles = [];
        if (photosInput) photosInput.value = "";
        setMarketplaceUploadStatus("No photos selected.");
        renderMarketplacePhotoPreviews();
      }
      return;
    }

    const oversized = incoming.filter((file) => Number(file.size || 0) > MARKETPLACE_MAX_FILE_BYTES);
    if (oversized.length) {
      showToast(
        `File too large: ${oversized.map((file) => file.name).join(", ")}. Max 5MB each.`,
        "warning"
      );
      if (!append) {
        marketplaceUploadToken += 1;
        marketplaceUploadPromise = null;
        marketplaceUploadedPhotos = [];
        marketplaceSelectedFiles = [];
        if (photosInput) photosInput.value = "";
        setMarketplaceUploadStatus("No photos selected.");
        renderMarketplacePhotoPreviews();
      }
      return;
    }

    marketplaceUploadToken += 1;
    marketplaceUploadPromise = null;
    marketplaceSelectedFiles = append ? [...marketplaceSelectedFiles, ...incoming] : incoming;
    marketplaceUploadedPhotos = [];
    if (uploadProgress) uploadProgress.classList.add("hidden");
    if (uploadProgressFill) uploadProgressFill.style.width = "0%";
    setMarketplaceUploadStatus(
      marketplaceSelectedFiles.length ? `${marketplaceSelectedFiles.length} photo(s) selected.` : "No photos selected."
    );
    renderMarketplacePhotoPreviews();
  }

  function updateMarketplaceFormVisibility() {
    const listingTypeEl = e("marketplaceListingType");
    const priceRow = e("marketplacePriceRow");
    const priceText = e("marketplacePriceText");
    const lendingFields = e("lendingFields");
    const maxDays = e("maxDays");
    if (!listingTypeEl || !priceText) return;
    const listingType = String(listingTypeEl.value || "sale");
    const showPrice = listingType === "sale";
    const showLending = listingType === "lending";
    if (priceRow) {
      priceRow.style.display = showPrice ? "" : "none";
    }
    priceText.disabled = !showPrice;
    if (!showPrice) {
      priceText.value = "";
      priceText.placeholder = "Nu se folosește pentru donații / împrumut";
    } else {
      priceText.placeholder = "e.g. 150 RON, negotiable";
    }
    if (lendingFields) {
      lendingFields.style.display = showLending ? "" : "none";
    }
    if (!showLending && maxDays) {
      maxDays.value = "";
    }
  }

  async function uploadMarketplacePhotos(files, onProgress = null) {
    const uploads = files.map(async (file, i) => {
      if (typeof onProgress === "function") {
        onProgress({ index: i, total: files.length, fileName: file.name, stage: "upload" });
      }

      const form = new FormData();
      form.append("file", file);
      form.append("module_name", "marketplace");

      const uploadRes = await fetch("/api/uploads/direct", {
        method: "POST",
        body: form,
      });
      const uploadData = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) {
        throw new Error(uploadData.error || `Upload failed for ${file.name}.`);
      }

      if (typeof onProgress === "function") {
        onProgress({ index: i + 1, total: files.length, fileName: file.name, stage: "done" });
      }

      return {
        file_url: uploadData.file_url,
        file_name: uploadData.file_name || file.name,
        file_type: uploadData.file_type || file.type || "application/octet-stream",
      };
    });

    return Promise.all(uploads);
  }

  async function startMarketplacePhotoUpload() {
    const uploadProgress = e("marketplaceUploadProgress");
    const uploadProgressFill = e("marketplaceUploadProgressFill");

    const files = marketplaceSelectedFiles.slice();
    const token = ++marketplaceUploadToken;

    if (!files.length) {
      marketplaceUploadedPhotos = [];
      if (uploadProgress) uploadProgress.classList.add("hidden");
      if (uploadProgressFill) uploadProgressFill.style.width = "0%";
      setMarketplaceUploadStatus("No photos selected.");
      return;
    }

    if (uploadProgress) uploadProgress.classList.remove("hidden");
    if (uploadProgressFill) uploadProgressFill.style.width = "0%";
    setMarketplaceUploadStatus(`Uploading ${files.length} photo(s)...`);

    marketplaceUploadPromise = uploadMarketplacePhotos(files, (progress) => {
      if (token !== marketplaceUploadToken) {
        throw new Error("__upload_cancelled__");
      }
      if (progress.stage === "upload") {
        const percent = Math.min(99, Math.round((progress.index / progress.total) * 100));
        if (uploadProgressFill) uploadProgressFill.style.width = `${percent}%`;
        setMarketplaceUploadStatus(`Uploading ${progress.index + 1}/${progress.total}: ${progress.fileName}...`);
        return;
      }
      if (progress.stage === "done") {
        const percent = Math.min(100, Math.round((progress.index / progress.total) * 100));
        if (uploadProgressFill) uploadProgressFill.style.width = `${percent}%`;
        setMarketplaceUploadStatus(`Uploaded ${progress.index}/${progress.total} photo(s)...`);
      }
    })
      .then((photos) => {
        if (token !== marketplaceUploadToken) return;
        marketplaceUploadedPhotos = photos;
        if (uploadProgressFill) uploadProgressFill.style.width = "100%";
        setMarketplaceUploadStatus(`Upload complete: ${photos.length} photo(s) ready.`, "success");
      })
      .catch((error) => {
        if (token !== marketplaceUploadToken || error.message === "__upload_cancelled__") {
          return;
        }
        marketplaceUploadedPhotos = [];
        if (uploadProgress) uploadProgress.classList.add("hidden");
        if (uploadProgressFill) uploadProgressFill.style.width = "0%";
        setMarketplaceUploadStatus(`Upload failed: ${error.message || "unknown error"}`, "error");
        throw error;
      })
      .finally(() => {
        if (token === marketplaceUploadToken) {
          marketplaceUploadPromise = null;
        }
      });

    return marketplaceUploadPromise;
  }

  function marketplacePhotoLinks(post) {
    const photos = Array.isArray(post.photos) ? post.photos : [];
    if (!photos.length) return "-";
    return photos
      .map((photo, idx) => `<a href="${photo.file_url}" target="_blank" rel="noopener noreferrer">Photo ${idx + 1}</a>`)
      .join(" | ");
  }

  function marketplaceListingUrl(postId) {
    return `/marketplace/listings/${postId}`;
  }

  function shouldSkipMarketplaceRowNavigation(target) {
    return Boolean(target.closest("button, a, input, select, textarea, label"));
  }

  function maybeNavigateMarketplaceRow(event) {
    const row = event.target.closest("tr[data-listing-url]");
    if (!row) return false;
    if (shouldSkipMarketplaceRowNavigation(event.target)) return false;
    const url = String(row.dataset.listingUrl || "").trim();
    if (!url) return false;
    window.location.href = url;
    return true;
  }

  function maybeNavigateMarketplaceRowFromKeyboard(event) {
    if (event.key !== "Enter" && event.key !== " ") return false;
    const row = event.target.closest("tr[data-listing-url]");
    if (!row) return false;
    if (shouldSkipMarketplaceRowNavigation(event.target)) return false;
    event.preventDefault();
    const url = String(row.dataset.listingUrl || "").trim();
    if (!url) return false;
    window.location.href = url;
    return true;
  }

  function clearMarketplaceTables() {
    const cardsSale = e("cardsSale");
    const cardsDonation = e("cardsDonation");
    const cardsLending = e("cardsLending");
    const marketplaceActiveBody = e("marketplaceActiveBody");
    const marketplaceMineBody = e("marketplaceMineBody");
    const myListingsCards = e("myListingsCards");
    const marketplaceMineCards = e("marketplaceMineCards");
    const marketplaceActiveCount = e("marketplaceActiveCount");
    const marketplaceMineCount = e("marketplaceMineCount");
    const countSale = e("countSale");
    const countDonation = e("countDonation");
    const countLending = e("countLending");

    if (cardsSale) cardsSale.innerHTML = marketplaceSectionEmptyStateHtml("sale");
    if (cardsDonation) cardsDonation.innerHTML = marketplaceSectionEmptyStateHtml("donation");
    if (cardsLending) cardsLending.innerHTML = marketplaceSectionEmptyStateHtml("lending");
    if (marketplaceActiveBody) marketplaceActiveBody.innerHTML = "";
    if (marketplaceMineBody) marketplaceMineBody.innerHTML = "";
    const mineEmptyHtml = `<div class="market-empty-state">${iconMarkup("package-search")}<span>Nu ai creat anunțuri încă.</span></div>`;
    if (myListingsCards) myListingsCards.innerHTML = mineEmptyHtml;
    if (marketplaceMineCards) marketplaceMineCards.innerHTML = mineEmptyHtml;
    if (marketplaceActiveCount) marketplaceActiveCount.textContent = "0";
    if (marketplaceMineCount) marketplaceMineCount.textContent = "0";
    if (countSale) countSale.textContent = "0";
    if (countDonation) countDonation.textContent = "0";
    if (countLending) countLending.textContent = "0";
    marketplaceDashboardData = { active_listings: [], my_listings: [] };
    syncMarketplaceTypeSectionVisibility();

    const moduleEl = e("marketplaceModule");
    if (moduleEl) {
      decorateDynamicActionIcons(moduleEl);
    }
    hydrateLucideIcons();
  }

  function renderMarketplace(data) {
    const buildingFilter = e("marketplaceBuildingFilter");
    const cardsSale = e("cardsSale");
    const cardsDonation = e("cardsDonation");
    const cardsLending = e("cardsLending");
    const marketplaceActiveBody = e("marketplaceActiveBody");
    const marketplaceMineBody = e("marketplaceMineBody");
    const myListingsCards = e("myListingsCards");
    const marketplaceMineCards = e("marketplaceMineCards");
    const marketplaceActiveCount = e("marketplaceActiveCount");
    const marketplaceMineCount = e("marketplaceMineCount");
    const countSale = e("countSale");
    const countDonation = e("countDonation");
    const countLending = e("countLending");

    const activeListingsAll = Array.isArray(data.active_listings) ? data.active_listings : [];
    const myListingsAll = Array.isArray(data.my_listings) ? data.my_listings : [];
    marketplaceDashboardData = {
      active_listings: activeListingsAll,
      my_listings: myListingsAll,
    };

    if (buildingFilter) {
      const buildingOptions = ["<option value=\"all\">Toate</option>"]
        .concat(Array.from({ length: 10 }, (_, idx) => idx + 1).map((building) => `<option value="${building}">Bloc ${building}</option>`))
        .join("");
      buildingFilter.innerHTML = buildingOptions;
      if (!Array.from(buildingFilter.options).some((opt) => opt.value === marketplaceSelectedBuilding)) {
        marketplaceSelectedBuilding = "all";
      }
      buildingFilter.value = marketplaceSelectedBuilding;
    }

    function marketplaceSearchMatches(post) {
      if (!marketplaceSearchQuery) return true;
      const q = marketplaceSearchQuery.toLowerCase();
      return (
        String(post.title || "").toLowerCase().includes(q) ||
        String(post.description || "").toLowerCase().includes(q) ||
        String(post.owner_username || "").toLowerCase().includes(q)
      );
    }

    const activeListings = sortMarketplaceListings(
      activeListingsAll.filter(
        (post) =>
          marketplaceCategoryMatches(post) &&
          marketplaceBuildingMatches(post) &&
          marketplaceSearchMatches(post)
      )
    );
    const myListings = sortMarketplaceListings(
      myListingsAll.filter((post) => marketplaceCategoryMatches(post) && marketplaceBuildingMatches(post))
    );

    const activeByType = {
      sale: activeListings.filter((post) => post.listing_type === "sale"),
      donation: activeListings.filter((post) => post.listing_type === "donation"),
      lending: activeListings.filter((post) => post.listing_type === "lending"),
    };

    function renderActiveStandardCard(post) {
      const isOwner = currentUser && post.owner_username === currentUser.username;
      const statusTag = marketplaceStatusTag(post);
      const openLink = `<a class="table-action-link ghost" href="${marketplaceListingUrl(post.id)}">Detalii</a>`;
      const canClaim =
        post.status === "active" &&
        post.listing_type === "donation" &&
        !post.claimed_by_username &&
        !isOwner;
      const contactId = `market-contact-${post.id}`;
      const ownerBuilding = marketplaceOwnerBuilding(post);
      const isDonation = post.listing_type === "donation";
      return `
        <article class="market-listing-card card">
          <div class="market-listing-head">
            <div class="market-listing-thumb">
              ${isDonation ? `<span class="market-free-flag">FREE</span>` : ""}
              <div class="market-status-corner">
                <span class="market-status-badge ${statusTag.className}">${statusTag.label}</span>
              </div>
              ${marketplaceThumbHtml(post, post.title || "Imagine anunț")}
            </div>
            <div class="market-listing-body">
              <div class="market-title-line">
                <strong>${escapeHtml(post.title)}</strong>
                <span class="market-price-main">${isDonation ? "Gratuit" : escapeHtml(post.price_text || "-")}</span>
              </div>
              <div class="market-owner-line">${escapeHtml(post.owner_username)} ${ownerBuilding ? `· Bloc ${ownerBuilding}` : ""}</div>
              <div class="market-age">Publicat ${formatRelativeTime(post.created_at)}</div>
              <div class="market-card-badges">
                <span class="market-category-badge ${marketplaceTypeBadgeClass(post.listing_type)}">${marketplaceTypeLabel(post.listing_type)}</span>
                <span class="market-category-badge">${marketplaceCategoryIcon(post.category)} ${marketplaceCategoryLabel(post.category)}</span>
              </div>
            </div>
          </div>
          <div class="market-card-actions">
            <button type="button" class="table-action-btn market-contact-btn" data-contact-id="${contactId}">Contact</button>
            <button type="button" class="table-action-btn ghost share-entity-btn" data-share-kind="listing" data-share-id="${post.id}">Distribuie</button>
            ${canClaim ? `<button type="button" class="table-action-btn alt market-claim-btn" data-post-id="${post.id}">Revendică donația</button>` : ""}
            ${openLink}
          </div>
          <div id="${contactId}" class="market-contact-meta hidden">${iconMarkup("phone")}<span>${escapeHtml(marketplaceContactLabel(post))}</span></div>
        </article>
      `;
    }

    function renderLendingCard(post) {
      const isOwner = currentUser && post.owner_username === currentUser.username;
      const ownerBuilding = marketplaceOwnerBuilding(post);
      const statusBadge = marketplaceStatusTag(post);
      const contactId = `market-contact-${post.id}`;
      const maxDaysBadge =
        Number(post.max_days || 0) > 0
          ? `<span class="badge badge-gray">⏱ Max ${Number(post.max_days)} zile</span>`
          : "";
      const toggleLabel = post.is_available === false ? "Marchează ca disponibil" : "Marchează ca împrumutat";
      return `
        <article class="market-listing-card card lending-card">
          <div class="market-listing-head">
            <div class="market-listing-thumb">
              ${marketplaceThumbHtml(post, post.title || "Imagine anunț împrumut")}
            </div>
            <div class="market-listing-body">
              <div class="market-card-badges market-lending-badges">
                <span class="badge badge-blue">🤝 Împrumut</span>
                <span class="market-category-badge">${marketplaceCategoryIcon(post.category)} ${marketplaceCategoryLabel(post.category)}</span>
                ${maxDaysBadge}
                <span class="badge ${statusBadge.className === "available" ? "badge-green" : "badge-amber"}">${statusBadge.label}</span>
              </div>
              <div class="market-title-line">
                <strong>${escapeHtml(post.title)}</strong>
                <span class="market-price-main">Împrumut</span>
              </div>
              <div class="market-owner-line">${escapeHtml(post.owner_username)}${ownerBuilding ? ` · Bloc ${ownerBuilding}` : ""}</div>
              <div class="market-age">Publicat ${formatRelativeTime(post.created_at)}</div>
              ${post.description ? `<p class="market-listing-description">${escapeHtml(post.description)}</p>` : ""}
              <div class="market-card-actions">
                <button type="button" class="table-action-btn market-contact-btn" data-contact-id="${contactId}">Contact</button>
                <button type="button" class="table-action-btn ghost share-entity-btn" data-share-kind="listing" data-share-id="${post.id}">Distribuie</button>
                ${isOwner ? `<button type="button" class="table-action-btn alt market-lending-toggle-btn" data-lending-toggle-id="${post.id}">${toggleLabel}</button>` : ""}
                <a class="table-action-link ghost" href="${marketplaceListingUrl(post.id)}">Detalii</a>
              </div>
              <div id="${contactId}" class="market-contact-meta hidden">${iconMarkup("phone")}<span>${escapeHtml(marketplaceContactLabel(post))}</span></div>
            </div>
          </div>
        </article>
      `;
    }

    function renderTypeSection(containerEl, posts, type) {
      if (!containerEl) return;
      if (!posts.length) {
        containerEl.innerHTML = marketplaceSectionEmptyStateHtml(type);
        return;
      }
      containerEl.innerHTML = posts
        .map((post) => (type === "lending" ? renderLendingCard(post) : renderActiveStandardCard(post)))
        .join("");
    }

    renderTypeSection(cardsSale, activeByType.sale, "sale");
    renderTypeSection(cardsDonation, activeByType.donation, "donation");
    renderTypeSection(cardsLending, activeByType.lending, "lending");
    if (marketplaceActiveBody) marketplaceActiveBody.innerHTML = "";

    if (marketplaceMineBody) marketplaceMineBody.innerHTML = "";

    const myListingCardsHtml = myListings.length
      ? myListings
          .map((post) => {
            const isActive = post.status === "active";
            const statusTag = marketplaceStatusTag(post);
            const isDonation = post.listing_type === "donation";
            const isLending = post.listing_type === "lending";
            const priceLabel =
              post.listing_type === "sale"
                ? post.price_text || "-"
                : post.listing_type === "donation"
                  ? "Gratuit"
                  : "Împrumut";
            const listingUrl = marketplaceListingUrl(post.id);
            const lendingToggleLabel = post.is_available === false ? "Disponibil ✓" : "Împrumutat ✗";
            return `
              <article class="market-listing-card card">
                <div class="market-listing-head">
                  <div class="market-listing-thumb">
                    ${isDonation ? `<span class="market-free-flag">FREE</span>` : ""}
                    <div class="market-status-corner">
                      <span class="market-status-badge ${statusTag.className}">${statusTag.label}</span>
                    </div>
                    ${marketplaceThumbHtml(post, post.title || "Imagine anunț")}
                  </div>
                  <div class="market-listing-body">
                    <div class="market-title-line">
                      <strong>${escapeHtml(post.title)}</strong>
                      <span class="market-price-main">${escapeHtml(priceLabel)}</span>
                    </div>
                    <div class="market-card-badges">
                      <span class="market-category-badge listing-type ${marketplaceTypeBadgeClass(post.listing_type)}">${marketplaceTypeLabel(post.listing_type)}</span>
                      <span class="market-category-badge">${marketplaceCategoryIcon(post.category)} ${marketplaceCategoryLabel(post.category)}</span>
                      ${isLending ? `<span class="badge ${post.is_available === false ? "badge-amber" : "badge-green"}">${post.is_available === false ? "Împrumutat momentan" : "Disponibil"}</span>` : ""}
                      ${isLending && Number(post.max_days || 0) > 0 ? `<span class="badge badge-gray">⏱ Max ${Number(post.max_days)} zile</span>` : ""}
                    </div>
                    ${post.claimed_by_username ? `<div class="market-my-meta">Revendicat de: ${escapeHtml(post.claimed_by_username)}</div>` : ""}
                    <div class="market-my-meta">Actualizat ${formatRelativeTime(post.updated_at || post.created_at)}</div>
                    <div class="market-age">Publicat ${formatRelativeTime(post.created_at)}</div>
                  </div>
                </div>
                <div class="market-card-actions">
                  <button type="button" class="table-action-btn ghost share-entity-btn" data-share-kind="listing" data-share-id="${post.id}">Distribuie</button>
                  <button type="button" class="table-action-btn market-edit-btn" data-listing-url="${listingUrl}">Editează</button>
                  <button type="button" class="table-action-btn market-delete-btn" data-post-id="${post.id}">Șterge</button>
                  ${isLending && isActive ? `<button type="button" class="table-action-btn ghost market-lending-toggle-btn" data-lending-toggle-id="${post.id}">${lendingToggleLabel}</button>` : ""}
                  ${isActive && !isLending ? `<button type="button" class="table-action-btn alt market-complete-btn" data-post-id="${post.id}">Marchează finalizat</button>` : ""}
                </div>
              </article>
            `;
          })
          .join("")
      : `<div class="market-empty-state">${iconMarkup("package-search")}<span>Nu ai creat anunțuri ${
          marketplaceSelectedCategory === "all"
            ? "încă."
            : `în categoria ${marketplaceCategoryLabel(marketplaceSelectedCategory)}.`
        }</span></div>`;

    if (!isMobile()) {
      if (myListingsCards) myListingsCards.innerHTML = myListingCardsHtml;
      if (marketplaceMineCards) marketplaceMineCards.innerHTML = "";
    } else {
      if (marketplaceMineCards) marketplaceMineCards.innerHTML = myListingCardsHtml;
      if (myListingsCards) myListingsCards.innerHTML = "";
    }

    if (marketplaceActiveCount) marketplaceActiveCount.textContent = String(activeListings.length);
    if (marketplaceMineCount) marketplaceMineCount.textContent = String(myListings.length);
    if (countSale) countSale.textContent = String(activeByType.sale.length);
    if (countDonation) countDonation.textContent = String(activeByType.donation.length);
    if (countLending) countLending.textContent = String(activeByType.lending.length);

    syncMarketplaceTypeSectionVisibility();

    const moduleEl = e("marketplaceModule");
    if (moduleEl) {
      decorateDynamicActionIcons(moduleEl);
    }
    hydrateLucideIcons();
  }

  async function refreshMarketplace() {
    if (!currentUser) return;
    const fetchFn = typeof cachedFetch === "function" ? cachedFetch : window.cachedFetch;
    const data = fetchFn
      ? await fetchFn("/api/marketplace/dashboard", {}, 60)
      : await api("/api/marketplace/dashboard");
    moduleQuickStats.activeListings = Array.isArray(data.active_listings) ? data.active_listings.length : 0;
    renderQuickStats();
    renderMarketplace(data);
    refreshHomeActivity();
    markModuleRefreshed("marketplace");
  }

  async function toggleLendingAvailability(postId, button, { source = "mine" } = {}) {
    if (!postId) return;
    await withButtonProgress(button, "Se actualizează...", async () => {
      try {
        const updated = await api(`/api/marketplace/posts/${postId}/complete`, { method: "POST" });
        const isAvailable = updated && updated.is_available !== false;
        showToast(
          isAvailable ? "Anunțul este marcat ca disponibil." : "Anunțul este marcat ca împrumutat momentan."
        );
        if (source === "active") {
          flashButtonSuccess(button, isAvailable ? "Disponibil" : "Împrumutat");
        }
        await refreshMarketplace();
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  }

  async function handleMarketplaceMineActions(event, { allowRowNav = false } = {}) {
    const shareBtn = event.target.closest('.share-entity-btn[data-share-kind="listing"]');
    const editBtn = event.target.closest(".market-edit-btn");
    const completeBtn = event.target.closest(".market-complete-btn");
    const deleteBtn = event.target.closest(".market-delete-btn");
    const lendingToggleBtn = event.target.closest(".market-lending-toggle-btn");
    if (shareBtn) {
      openShareForEntity("listing", shareBtn.dataset.shareId);
      return;
    }
    if (editBtn) {
      const url = String(editBtn.dataset.listingUrl || "").trim();
      if (url) {
        window.location.href = url;
      }
      return;
    }
    if (completeBtn) {
      const postId = Number(completeBtn.dataset.postId || 0);
      if (!postId) return;
      await withButtonProgress(completeBtn, "Updating...", async () => {
        try {
          await api(`/api/marketplace/posts/${postId}/complete`, { method: "POST" });
          await refreshMarketplace();
          showToast("Listing marked as completed.");
        } catch (error) {
          setStatus(error.message, true);
        }
      });
      return;
    }
    if (lendingToggleBtn) {
      const postId = Number(lendingToggleBtn.dataset.lendingToggleId || 0);
      if (!postId) return;
      await toggleLendingAvailability(postId, lendingToggleBtn, { source: "mine" });
      return;
    }
    if (deleteBtn) {
      const postId = Number(deleteBtn.dataset.postId || 0);
      if (!postId) return;
      const confirmed = await requestActionConfirmation("Delete this listing permanently?");
      if (!confirmed) return;
      await withButtonProgress(deleteBtn, "Deleting...", async () => {
        try {
          await api(`/api/marketplace/posts/${postId}/delete`, { method: "POST" });
          await refreshMarketplace();
          showToast("Listing deleted.");
        } catch (error) {
          setStatus(error.message, true);
        }
      });
      return;
    }
    if (allowRowNav) {
      maybeNavigateMarketplaceRow(event);
    }
  }

  function buildListingSharePayload(post) {
    if (!post) return null;
    const isDonation = String(post.listing_type || "") === "donation";
    const priceLabel = isDonation ? "FREE" : String(post.price_text || "Price on request");
    const categoryLabel = marketplaceCategoryLabel(post.category);
    const ownerLabel = String(post.owner_username || "").trim();
    return {
      kind: "listing",
      kindLabel: "Marketplace listing",
      title: String(post.title || "Marketplace listing").trim(),
      text: [priceLabel, categoryLabel, ownerLabel ? `Posted by ${ownerLabel}` : ""].filter(Boolean).join(" · "),
      preview: shortenText(post.description || "", 180),
      url: absoluteUrl(marketplaceListingUrl(post.id)),
    };
  }

  function marketplaceShareLookup(postId) {
    const allListings = [
      ...(Array.isArray(marketplaceDashboardData.active_listings) ? marketplaceDashboardData.active_listings : []),
      ...(Array.isArray(marketplaceDashboardData.my_listings) ? marketplaceDashboardData.my_listings : []),
    ];
    return allListings.find((post) => String(post.id) === String(postId)) || null;
  }

  function attachEvents() {
    if (eventsAttached) return;

    const listingType = e("marketplaceListingType");
    const typeTabs = e("marketplaceTypeTabs");
    const categoryTabs = e("marketplaceCategoryTabs");
    const categorySelect = e("marketplaceCategory");
    const sortTabs = e("marketplaceSortTabs");
    const buildingFilter = e("marketplaceBuildingFilter");
    const searchInput = e("marketplaceSearch");
    const dropzone = e("marketplaceDropzone");
    const photosInput = e("marketplacePhotos");
    const photoPreviews = e("marketplacePhotoPreviews");
    const createForm = e("marketplaceCreateForm");
    const createBtn = e("marketplaceCreateBtn");
    const activeCards = e("marketplaceActiveCards");
    const myListingsCards = e("myListingsCards");
    const mineCards = e("marketplaceMineCards");
    const mineBody = e("marketplaceMineBody");

    if (!listingType || !createForm || !activeCards || !myListingsCards || !mineCards) {
      return;
    }

    eventsAttached = true;

    listingType.addEventListener("change", () => {
      updateMarketplaceFormVisibility();
    });

    if (typeTabs) {
      typeTabs.addEventListener("click", (event) => {
        const typeBtn = event.target.closest("[data-market-type]");
        if (!typeBtn) return;
        setMarketplaceTypeFilter(typeBtn.dataset.marketType, { rerender: false, scroll: true });
      });
    }

    if (categoryTabs) {
      categoryTabs.addEventListener("click", (event) => {
        const tabButton = event.target.closest("[data-market-category]");
        if (!tabButton) return;
        setMarketplaceCategory(tabButton.dataset.marketCategory, { syncForm: true, rerender: true });
      });
    }

    if (categorySelect) {
      categorySelect.addEventListener("change", () => {
        setMarketplaceCategory(categorySelect.value, { syncForm: false, rerender: true });
      });
    }

    if (sortTabs) {
      sortTabs.addEventListener("click", (event) => {
        const sortBtn = event.target.closest("[data-market-sort]");
        if (!sortBtn) return;
        setMarketplaceSort(sortBtn.dataset.marketSort, { rerender: true });
      });
    }

    if (buildingFilter) {
      buildingFilter.addEventListener("change", () => {
        setMarketplaceBuildingFilter(buildingFilter.value, { rerender: true });
      });
    }

    if (searchInput) {
      searchInput.addEventListener("input", function onMarketplaceSearchInput() {
        marketplaceSearchQuery = this.value.trim();
        renderMarketplace(marketplaceDashboardData);
      });
    }

    if (dropzone && photosInput) {
      dropzone.addEventListener("click", () => {
        photosInput.click();
      });

      dropzone.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        photosInput.click();
      });

      dropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropzone.classList.add("dragover");
      });

      dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("dragover");
      });

      dropzone.addEventListener("drop", (event) => {
        event.preventDefault();
        dropzone.classList.remove("dragover");
        setMarketplaceSelectedFiles(event.dataTransfer?.files || [], { append: true });
      });
    }

    if (photosInput) {
      photosInput.addEventListener("change", () => {
        setMarketplaceSelectedFiles(photosInput.files || [], { append: false });
      });
    }

    if (photoPreviews) {
      photoPreviews.addEventListener("click", (event) => {
        const removeBtn = event.target.closest("[data-remove-market-file]");
        if (!removeBtn) return;
        const removeIndex = Number(removeBtn.dataset.removeMarketFile || -1);
        if (removeIndex < 0) return;
        marketplaceSelectedFiles = marketplaceSelectedFiles.filter((_, idx) => idx !== removeIndex);
        marketplaceUploadedPhotos = [];
        renderMarketplacePhotoPreviews();
        setMarketplaceUploadStatus(
          marketplaceSelectedFiles.length ? `${marketplaceSelectedFiles.length} photo(s) selected.` : "No photos selected."
        );
      });
    }

    createForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!currentUser || currentUser.role !== "resident") {
        setStatus("Only residents can create marketplace listings.", true);
        return;
      }
      await withButtonProgress(createBtn, "Creating...", async () => {
        try {
          const listingTypeEl = e("marketplaceListingType");
          const categoryEl = e("marketplaceCategory");
          const titleEl = e("marketplaceTitle");
          const descriptionEl = e("marketplaceDescription");
          const priceTextEl = e("marketplacePriceText");
          const maxDaysEl = e("maxDays");
          const contactPhoneEl = e("marketplaceContactPhone");
          const pickupDetailsEl = e("marketplacePickupDetails");

          const payload = {
            listing_type: listingTypeEl.value,
            category: normalizeMarketplaceCategory(categoryEl.value),
            title: titleEl.value.trim(),
            description: (descriptionEl.value || "").trim(),
            price_text: listingTypeEl.value === "sale" ? (priceTextEl.value || "").trim() : null,
            max_days: listingTypeEl.value === "lending" ? (maxDaysEl && maxDaysEl.value ? Number(maxDaysEl.value) : null) : null,
            is_available: listingTypeEl.value === "lending" ? true : null,
            contact_phone: (contactPhoneEl.value || "").trim(),
            pickup_details: (pickupDetailsEl.value || "").trim(),
          };

          const files = marketplaceSelectedFiles.slice();
          if (files.length) {
            if (marketplaceUploadPromise) {
              await marketplaceUploadPromise;
            } else if (!marketplaceUploadedPhotos.length) {
              await startMarketplacePhotoUpload();
            }
            if (!marketplaceUploadedPhotos.length) {
              throw new Error("Photos failed to upload. Please reselect files.");
            }
            payload.photos = [...marketplaceUploadedPhotos];
          }

          await api("/api/marketplace/posts", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          showToast("Marketplace listing created.");
          flashButtonSuccess(createBtn, "Created");
          createForm.reset();
          contactPhoneEl.value = currentUser.phone_number || "";
          setMarketplaceCategory(marketplaceSelectedCategory, { syncForm: true, rerender: false });
          clearMarketplaceUploadState();
          updateMarketplaceFormVisibility();
          await refreshMarketplace();
        } catch (error) {
          setStatus(error.message, true);
        }
      });
    });

    activeCards.addEventListener("click", async (event) => {
      const lendingToggleBtn = event.target.closest(".market-lending-toggle-btn");
      if (lendingToggleBtn) {
        const postId = Number(lendingToggleBtn.dataset.lendingToggleId || 0);
        if (!postId) return;
        await toggleLendingAvailability(postId, lendingToggleBtn, { source: "active" });
        return;
      }
      const shareBtn = event.target.closest('.share-entity-btn[data-share-kind="listing"]');
      if (shareBtn) {
        openShareForEntity("listing", shareBtn.dataset.shareId);
        return;
      }
      const contactBtn = event.target.closest(".market-contact-btn");
      if (contactBtn) {
        const contactId = String(contactBtn.dataset.contactId || "").trim();
        if (!contactId) return;

        document.querySelectorAll(".market-contact-meta").forEach((el) => {
          if (el.id !== contactId) {
            el.classList.add("hidden");
          }
        });

        document.querySelectorAll(".market-contact-btn").forEach((btn) => {
          if (btn !== contactBtn) {
            btn.innerHTML = `${iconMarkup("phone")}<span>Contact</span>`;
            btn.dataset.defaultText = "Contact";
          }
        });

        const detailsEl = document.getElementById(contactId);
        if (!detailsEl) return;
        const isHidden = detailsEl.classList.contains("hidden");
        detailsEl.classList.toggle("hidden", !isHidden);
        contactBtn.dataset.defaultText = isHidden ? "Ascunde" : "Contact";
        contactBtn.innerHTML = `${iconMarkup("phone")}<span>${contactBtn.dataset.defaultText}</span>`;
        hydrateLucideIcons();
        return;
      }

      const button = event.target.closest(".market-claim-btn");
      if (button) {
        const postId = Number(button.dataset.postId || 0);
        if (!postId) return;

        await withButtonProgress(button, "Claiming...", async () => {
          try {
            await api(`/api/marketplace/posts/${postId}/claim`, { method: "POST" });
            await refreshMarketplace();
            showToast("Donation claimed.");
            flashButtonSuccess(button, "Claimed");
          } catch (error) {
            setStatus(error.message, true);
          }
        });
      }
    });

    myListingsCards.addEventListener("click", async (event) => {
      await handleMarketplaceMineActions(event, { allowRowNav: false });
    });

    mineCards.addEventListener("click", async (event) => {
      await handleMarketplaceMineActions(event, { allowRowNav: false });
    });

    if (mineBody) {
      mineBody.addEventListener("click", async (event) => {
        await handleMarketplaceMineActions(event, { allowRowNav: true });
      });
      mineBody.addEventListener("keydown", (event) => {
        maybeNavigateMarketplaceRowFromKeyboard(event);
      });
    }
  }

  function init() {
    attachEvents();
    setMarketplaceTypeFilter("all", { rerender: false, scroll: false });
    setMarketplaceSort("newest", { rerender: false });
    setMarketplaceBuildingFilter("all", { rerender: false });
    setMarketplaceCategory("all", { syncForm: false, rerender: false });
    clearMarketplaceTables();
    clearMarketplaceUploadState();
    updateMarketplaceFormVisibility();
  }

  return {
    init,
    refresh: refreshMarketplace,
    clearTables: clearMarketplaceTables,
    clearUploadState: clearMarketplaceUploadState,
    setTypeFilter: setMarketplaceTypeFilter,
    setCategory: setMarketplaceCategory,
    setSort: setMarketplaceSort,
    setBuildingFilter: setMarketplaceBuildingFilter,
    updateFormVisibility: updateMarketplaceFormVisibility,
    render: renderMarketplace,
    buildSharePayload: buildListingSharePayload,
    shareLookup: marketplaceShareLookup,
    getDashboardData: () => marketplaceDashboardData,
    categoryLabel: marketplaceCategoryLabel,
    listingUrl: marketplaceListingUrl,
  };
})();

window.MarketplaceModule = MarketplaceModule;
