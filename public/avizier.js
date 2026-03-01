const AvizierModule = (() => {
  "use strict";

  const AVIZIER_MAX_FILE_BYTES = 10 * 1024 * 1024;
  const AVIZIER_ALLOWED_FILE_TYPES = new Set(["image/jpeg", "image/jpg", "application/pdf"]);
  const AVIZIER_READ_KEY = "10blocuri_avizier_read_v1";
  const AVIZIER_PAGE_SIZE = 10;

  let avizierAnnouncements = [];
  let avizierEditingAnnouncementId = null;
  let avizierPage = 0;
  let avizierScopeFilter = "all";
  let eventsBound = false;

  const e = (id) => document.getElementById(id);

  function loadAvizierReadState() {
    try {
      return JSON.parse(localStorage.getItem(AVIZIER_READ_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function storeAvizierReadState(nextState) {
    try {
      localStorage.setItem(AVIZIER_READ_KEY, JSON.stringify(nextState || {}));
    } catch {
      // ignore local storage errors
    }
  }

  function isAvizierRead(announcementId) {
    if (!currentUser || !announcementId) return false;
    const state = loadAvizierReadState();
    const userState = state[currentUser.username] || {};
    return Boolean(userState[String(announcementId)]);
  }

  function markAvizierRead(announcementId) {
    if (!currentUser || !announcementId) return;
    const state = loadAvizierReadState();
    const userKey = currentUser.username;
    const userState = state[userKey] || {};
    userState[String(announcementId)] = true;
    state[userKey] = userState;
    storeAvizierReadState(state);
  }

  function canPostAvizier(user, scope, buildingId = null) {
    if (!user) return false;
    if (user.role === "admin") return true;
    if (user.avizier_permission === "comitet") return true;
    if (user.avizier_permission === "reprezentant_bloc") {
      return scope === "building" && Number(buildingId || 0) === Number(user.building_number || 0);
    }
    return false;
  }

  function canDeleteAvizierAnnouncement(item, user = currentUser) {
    if (!user || !item) return false;
    if (String(item.created_by_username || "") === String(user.username || "")) return true;
    return canPostAvizier(user, item.scope, item.scope === "building" ? item.building_id : null);
  }

  function canEditAvizierAnnouncement(item, user = currentUser) {
    if (!user || !item) return false;
    if (user.role === "admin") return true;
    return String(item.created_by_username || "") === String(user.username || "");
  }

  function avizierPermissionLabel(permission) {
    if (permission === "comitet") return "Comitet";
    if (permission === "reprezentant_bloc") return "Reprezentant Bloc";
    return "Niciuna";
  }

  function decodeAvizierTitle(rawTitle) {
    const source = String(rawTitle || "").trim();
    let cleanTitle = source;
    let priority = "normal";
    let pinned = false;
    if (/^\[(urgent)\]\s*/i.test(cleanTitle)) {
      priority = "urgent";
      cleanTitle = cleanTitle.replace(/^\[(urgent)\]\s*/i, "");
    } else if (/^\[(important)\]\s*/i.test(cleanTitle)) {
      priority = "important";
      cleanTitle = cleanTitle.replace(/^\[(important)\]\s*/i, "");
    }
    if (/^\[pin\]\s*/i.test(cleanTitle)) {
      pinned = true;
      cleanTitle = cleanTitle.replace(/^\[pin\]\s*/i, "");
    }
    return { cleanTitle: cleanTitle || source, priority, pinned };
  }

  function encodeAvizierTitle(title, priority, pinned) {
    let encoded = String(title || "").trim();
    if (priority === "urgent") encoded = `[URGENT] ${encoded}`;
    if (priority === "important") encoded = `[IMPORTANT] ${encoded}`;
    if (pinned) encoded = `[PIN] ${encoded}`;
    return encoded;
  }

  function formatAvizierInlineRichText(value) {
    let html = escapeHtml(value);
    html = html.replace(/(https?:\/\/[^\s<]+)/gi, (match) => {
      const clean = match.replace(/[),.;!?]+$/g, "");
      const trailing = match.slice(clean.length);
      return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${trailing}`;
    });
    html = html.replace(/\*\*([^*\n][\s\S]*?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*])\*([^*\n][\s\S]*?)\*/g, "$1<em>$2</em>");
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    return html;
  }

  function renderAvizierMessageHtml(message, { truncate = 0 } = {}) {
    const normalized = String(message || "").replace(/\r\n?/g, "\n").trim();
    if (!normalized) return `<p class="poll-note">Fără mesaj.</p>`;

    if (truncate > 0 && normalized.length > truncate) {
      const short = `${normalized.slice(0, truncate).trim()}...`;
      return `<p>${formatAvizierInlineRichText(short).replace(/\n/g, "<br>")}</p>`;
    }

    const blocks = normalized.split(/\n{2,}/).filter(Boolean);
    return blocks
      .map((block) => {
        const lines = block
          .split("\n")
          .map((line) => line.trimEnd())
          .filter((line) => line.length > 0);
        if (!lines.length) return "";
        const bulletItems = lines.every((line) => /^[-*]\s+/.test(line));
        if (bulletItems) {
          return `<ul>${lines
            .map((line) => `<li>${formatAvizierInlineRichText(line.replace(/^[-*]\s+/, ""))}</li>`)
            .join("")}</ul>`;
        }
        const numberedItems = lines.every((line) => /^\d+\.\s+/.test(line));
        if (numberedItems) {
          return `<ol>${lines
            .map((line) => `<li>${formatAvizierInlineRichText(line.replace(/^\d+\.\s+/, ""))}</li>`)
            .join("")}</ol>`;
        }
        return `<p>${lines.map((line) => formatAvizierInlineRichText(line)).join("<br>")}</p>`;
      })
      .join("");
  }

  function normalizeAvizierFileType(fileType, fileName) {
    const lowered = String(fileType || "").toLowerCase();
    if (lowered) return lowered;
    const fileLower = String(fileName || "").toLowerCase();
    if (fileLower.endsWith(".pdf")) return "application/pdf";
    if (fileLower.endsWith(".jpg") || fileLower.endsWith(".jpeg")) return "image/jpeg";
    return "";
  }

  function setAvizierUploadStatus(message, kind = "") {
    const uploadEl = e("avizierUploadStatus");
    if (!uploadEl) return;
    uploadEl.textContent = message;
    uploadEl.classList.remove("error", "success");
    if (kind) {
      uploadEl.classList.add(kind);
    }
  }

  async function uploadAvizierAttachments(files, onProgress = null) {
    const uploads = files.map(async (file, i) => {
      const normalizedType = normalizeAvizierFileType(file.type, file.name);
      if (!AVIZIER_ALLOWED_FILE_TYPES.has(normalizedType)) {
        throw new Error(`Tip fișier neacceptat pentru ${file.name}. Acceptat: JPG sau PDF.`);
      }
      if (file.size > AVIZIER_MAX_FILE_BYTES) {
        throw new Error(`${file.name} depășește 10MB.`);
      }
      if (typeof onProgress === "function") {
        onProgress({ index: i + 1, total: files.length, fileName: file.name, stage: "upload" });
      }
      const form = new FormData();
      form.append("file", file);
      form.append("module_name", "avizier");
      const uploadRes = await fetch("/api/uploads/direct", { method: "POST", body: form });
      const uploadData = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) {
        throw new Error(uploadData.error || `Încărcarea a eșuat pentru ${file.name}.`);
      }
      return {
        file_url: uploadData.file_url,
        file_name: uploadData.file_name || file.name,
        file_type: uploadData.file_type || normalizedType,
        file_size_bytes: Number(uploadData.file_size_bytes || file.size || 0),
      };
    });
    return Promise.all(uploads);
  }

  function setAvizierComposerMode() {
    const editing = Boolean(avizierEditingAnnouncementId);
    const headingEl = e("avizierFormHeading");
    const hintEl = e("avizierFormModeHint");
    const cancelBtn = e("avizierCancelEditBtn");
    const submitBtn = e("createAvizierBtn");

    if (headingEl) {
      headingEl.textContent = editing ? "Editează anunțul" : "Creează anunț";
    }
    if (hintEl) {
      hintEl.textContent = editing
        ? "Editezi un anunț existent. Atașamentele rămân dacă nu selectezi fișiere noi (înlocuire)."
        : "Folosește paragrafe, liste și formatare simplă pentru o lectură mai ușoară.";
    }
    if (cancelBtn) {
      cancelBtn.classList.toggle("hidden", !editing);
    }
    if (submitBtn) {
      submitBtn.dataset.defaultText = editing ? "Salvează modificările" : "Publică anunțul";
      setButtonActionIcon(submitBtn, "megaphone");
      hydrateLucideIcons();
    }
  }

  function updateAvizierFormVisibility() {
    const createCard = e("createAvizierCard");
    const lockedCard = e("avizierLockedCard");
    const scopeEl = e("avizierScope");
    const buildingEl = e("avizierBuilding");
    const buildingRow = e("avizierBuildingRow");

    if (!createCard || !lockedCard || !scopeEl || !buildingEl || !buildingRow) return;

    if (!currentUser) {
      createCard.classList.add("hidden");
      lockedCard.classList.add("hidden");
      return;
    }

    const hasPostAccess = currentUser.role === "admin" || String(currentUser.avizier_permission || "none") !== "none";
    createCard.classList.toggle("hidden", !hasPostAccess);
    lockedCard.classList.toggle("hidden", hasPostAccess);
    if (!hasPostAccess) return;

    if (currentUser.avizier_permission === "reprezentant_bloc" && currentUser.role !== "admin") {
      scopeEl.value = "building";
      scopeEl.disabled = true;
      buildingEl.value = String(currentUser.building_number || "");
      buildingEl.disabled = true;
      buildingRow.classList.remove("hidden");
      return;
    }

    scopeEl.disabled = false;
    const isBuilding = scopeEl.value === "building";
    buildingRow.classList.toggle("hidden", !isBuilding);
    buildingEl.disabled = !isBuilding;
  }

  function resetAvizierComposer() {
    avizierEditingAnnouncementId = null;
    const form = e("createAvizierForm");
    if (form) form.reset();

    const priorityEl = e("avizierPriority");
    const pinnedEl = e("avizierPinned");
    const filesEl = e("avizierFiles");
    const scopeEl = e("avizierScope");
    const buildingEl = e("avizierBuilding");

    if (priorityEl) priorityEl.value = "normal";
    if (pinnedEl) pinnedEl.checked = false;
    if (filesEl) filesEl.value = "";
    setAvizierUploadStatus("Niciun fișier selectat.");

    if (currentUser?.avizier_permission === "reprezentant_bloc" && currentUser?.role !== "admin") {
      if (scopeEl) scopeEl.value = "building";
      if (buildingEl) buildingEl.value = String(currentUser.building_number || "");
    }

    updateAvizierFormVisibility();
    setAvizierComposerMode();
  }

  function applyAvizierFormat(formatType) {
    const textarea = e("avizierMessage");
    if (!textarea) return;
    const start = Number(textarea.selectionStart || 0);
    const end = Number(textarea.selectionEnd || 0);
    const selected = textarea.value.slice(start, end);
    const insertWrapped = (prefix, suffix, placeholder) => {
      const content = selected || placeholder;
      const next = `${prefix}${content}${suffix}`;
      textarea.setRangeText(next, start, end, "end");
      textarea.focus();
    };

    if (formatType === "bold") {
      insertWrapped("**", "**", "text");
      return;
    }
    if (formatType === "italic") {
      insertWrapped("*", "*", "text");
      return;
    }
    if (formatType === "link") {
      insertWrapped("", "", "https://example.com");
      return;
    }
    if (formatType === "paragraph") {
      textarea.setRangeText("\n\n", start, end, "end");
      textarea.focus();
      return;
    }
    if (formatType === "bullets") {
      const content = selected || "Item one\nItem two";
      const lines = content.split(/\r?\n/).map((line) => (line.trim() ? `- ${line.replace(/^[-*]\s+/, "")}` : "- "));
      textarea.setRangeText(lines.join("\n"), start, end, "end");
      textarea.focus();
      return;
    }
    if (formatType === "numbers") {
      const content = selected || "Item one\nItem two";
      const lines = content
        .split(/\r?\n/)
        .map((line, idx) => `${idx + 1}. ${line.replace(/^\d+\.\s+/, "").trim() || "Item"}`);
      textarea.setRangeText(lines.join("\n"), start, end, "end");
      textarea.focus();
    }
  }

  function findAvizierAnnouncementById(announcementId) {
    return (Array.isArray(avizierAnnouncements) ? avizierAnnouncements : []).find(
      (item) => String(item.id) === String(announcementId)
    ) || null;
  }

  function startAvizierEdit(item) {
    if (!item) return;
    const decoded = decodeAvizierTitle(item.title);
    avizierEditingAnnouncementId = String(item.id);

    const titleEl = e("avizierTitle");
    const messageEl = e("avizierMessage");
    const priorityEl = e("avizierPriority");
    const pinnedEl = e("avizierPinned");
    const scopeEl = e("avizierScope");
    const buildingEl = e("avizierBuilding");
    const filesEl = e("avizierFiles");

    if (titleEl) titleEl.value = decoded.cleanTitle || "";
    if (messageEl) messageEl.value = String(item.message || "");
    if (priorityEl) priorityEl.value = decoded.priority || "normal";
    if (pinnedEl) pinnedEl.checked = Boolean(decoded.pinned);
    if (scopeEl) scopeEl.value = String(item.scope || "general");
    if (item.scope === "building" && item.building_id != null && buildingEl) {
      buildingEl.value = String(item.building_id);
    }
    if (filesEl) filesEl.value = "";

    setAvizierUploadStatus("Niciun fișier selectat. Atașamentele existente rămân dacă nu alegi înlocuire.");
    updateAvizierFormVisibility();
    setAvizierComposerMode();

    const card = e("createAvizierCard");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    if (titleEl) titleEl.focus();
  }

  function filteredAvizierAnnouncements() {
    if (avizierScopeFilter === "general") {
      return avizierAnnouncements.filter((item) => item.scope === "general");
    }
    if (avizierScopeFilter === "building") {
      return avizierAnnouncements.filter((item) => item.scope === "building");
    }
    return avizierAnnouncements;
  }

  function setAvizierScopeFilter(scope) {
    const nextScope = ["all", "general", "building"].includes(scope) ? scope : "all";
    avizierPage = 0;
    avizierScopeFilter = nextScope;

    const scopeFilters = e("avizierScopeFilters");
    if (scopeFilters) {
      scopeFilters
        .querySelectorAll("[data-avizier-filter]")
        .forEach((button) => button.classList.toggle("active", button.dataset.avizierFilter === avizierScopeFilter));
    }

    renderAvizierAnnouncements();
  }

  function renderAvizierAnnouncements(items) {
    if (Array.isArray(items)) {
      avizierAnnouncements = items;
      avizierPage = 0;
    }

    const countEl = e("avizierCount");
    const listEl = e("avizierList");
    const moduleEl = e("avizierModule");
    if (!listEl) return;

    const visibleAnnouncements = filteredAvizierAnnouncements()
      .map((item) => {
        const decoded = decodeAvizierTitle(item.title);
        return { ...item, ...decoded };
      })
      .sort((a, b) => {
        const pinScoreA = a.pinned ? 1 : 0;
        const pinScoreB = b.pinned ? 1 : 0;
        if (pinScoreA !== pinScoreB) return pinScoreB - pinScoreA;
        const priorityRank = { urgent: 3, important: 2, normal: 1 };
        const prA = priorityRank[a.priority] || 1;
        const prB = priorityRank[b.priority] || 1;
        if (prA !== prB) return prB - prA;
        return (parseDateSafe(b.created_at)?.getTime() || 0) - (parseDateSafe(a.created_at)?.getTime() || 0);
      });

    if (countEl) countEl.textContent = String(visibleAnnouncements.length);

    if (!visibleAnnouncements.length) {
      listEl.innerHTML = `<div class="empty-state">📋 Niciun anunț momentan.</div>`;
      const loadMoreWrap = e("avizierLoadMoreWrap");
      if (loadMoreWrap) loadMoreWrap.style.display = "none";
      if (moduleEl) decorateDynamicActionIcons(moduleEl);
      hydrateLucideIcons();
      refreshHomeActivity();
      return;
    }

    const endIdx = (avizierPage + 1) * AVIZIER_PAGE_SIZE;
    const pageItems = visibleAnnouncements.slice(0, endIdx);
    const hasMore = visibleAnnouncements.length > endIdx;

    listEl.innerHTML = pageItems
      .map((item) => {
        const scopeLabel = item.scope === "building" ? "Pe bloc" : "General";
        const attachments = Array.isArray(item.attachments) ? item.attachments : [];
        const unread = !isAvizierRead(item.id);
        const longMessage = String(item.message || "").trim();
        const shouldTruncate = longMessage.length > 220;
        const collapsedPreviewText = shortenText(longMessage, 240);
        const canDelete = canDeleteAvizierAnnouncement(item);
        const canEdit = canEditAvizierAnnouncement(item);
        const attachmentCountLabel = attachments.length
          ? `${attachments.length} atașament${attachments.length === 1 ? "" : "e"}`
          : "";
        const priorityMetaBadge =
          item.priority === "important"
            ? `<span class="avizier-chip priority-important">⚠ Important</span>`
            : item.priority === "urgent"
              ? `<span class="avizier-chip priority-urgent">🔴 Urgent</span>`
              : "";

        return `
          <article class="announcement-card avizier-card priority-${item.priority} ${unread ? "unread" : ""}" data-avizier-id="${item.id}">
            <div class="announcement-head">
              <h4 class="announcement-title">
                ${item.pinned ? `<span class="announcement-pin" aria-hidden="true">📌</span>` : ""}
                <span>${escapeHtml(item.cleanTitle)}</span>
              </h4>
              <span class="announcement-time">${formatRelativeTime(item.created_at)}</span>
            </div>
            <div class="announcement-meta">
              <span class="avizier-chip scope-${item.scope === "building" ? "building" : "general"}">${iconMarkup(
                item.scope === "building" ? "building-2" : "map-pinned"
              )}<span>${scopeLabel}</span></span>
              ${priorityMetaBadge}
              <span class="announcement-meta-sep">·</span>
              <span>de ${escapeHtml(item.created_by_username || "-")}</span>
              ${
                attachmentCountLabel
                  ? `<span class="announcement-meta-sep">·</span><span>${attachmentCountLabel}</span>`
                  : ""
              }
            </div>
            <div class="avizier-message-rich announcement-body" data-avizier-message="${item.id}" data-avizier-full="${encodeURIComponent(
              longMessage
            )}">
              ${
                shouldTruncate
                  ? `<p class="announcement-body-preview">${escapeHtml(collapsedPreviewText)}</p>`
                  : renderAvizierMessageHtml(longMessage)
              }
            </div>
            ${
              attachments.length
                ? `<div class="announcement-attachments">
                ${attachments
                  .map((attachment) => {
                    const fileName = String(attachment.file_name || "Fișier");
                    return `<a class="attachment-chip" href="${escapeHtml(
                      attachment.file_url
                    )}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(fileName)}">📎 Atașament · ${escapeHtml(
                      shortenText(fileName, 30)
                    )}</a>`;
                  })
                  .join("")}
              </div>`
                : ""
            }
            <div class="announcement-actions">
              ${
                canEdit
                  ? `<button type="button" class="table-action-btn avizier-edit-btn" data-avizier-edit="${item.id}">Editează</button>`
                  : ""
              }
              <button type="button" class="table-action-btn avizier-share-btn share-entity-btn" data-share-kind="announcement" data-share-id="${item.id}">Distribuie</button>
              ${
                shouldTruncate
                  ? `<button type="button" class="avizier-read-more" data-avizier-expand="${item.id}">Citește mai mult</button>`
                  : ""
              }
              ${
                canDelete
                  ? `<button type="button" class="table-action-btn danger avizier-delete-btn" data-avizier-delete="${item.id}" aria-label="Șterge anunțul" title="Șterge anunțul">Șterge</button>`
                  : ""
              }
            </div>
          </article>
        `;
      })
      .join("");

    const loadMoreWrap = e("avizierLoadMoreWrap");
    const loadMoreBtn = e("avizierLoadMoreBtn");
    if (loadMoreWrap) loadMoreWrap.style.display = hasMore ? "block" : "none";
    if (loadMoreBtn) loadMoreBtn.textContent = `Încarcă mai multe (${visibleAnnouncements.length - endIdx} rămase)`;

    if (moduleEl) decorateDynamicActionIcons(moduleEl);
    hydrateLucideIcons();
    refreshHomeActivity();
  }

  async function refreshAvizier() {
    if (!currentUser) return;
    const data = await cachedFetch("/api/avizier", {}, 90);
    moduleQuickStats.announcements = Array.isArray(data) ? data.length : 0;
    renderQuickStats();
    renderAvizierAnnouncements(data);
    markModuleRefreshed("avizier");
  }

  function buildAnnouncementSharePayload(item) {
    if (!item) return null;
    const decoded = decodeAvizierTitle(item.title);
    const scopeLabel =
      item.scope === "building" && Number(item.building_id || 0) > 0 ? `Bloc ${item.building_id}` : "General";
    const authorLabel = String(item.created_by_username || "").trim();
    return {
      kind: "announcement",
      kindLabel: "Anunț Avizier",
      title: String(decoded.cleanTitle || "Anunț").trim(),
      text: [scopeLabel, authorLabel ? `Publicat de ${authorLabel}` : ""].filter(Boolean).join(" · "),
      preview: shortenText(item.message || "", 180),
      url: moduleShareUrl("avizier", { announcement: item.id }),
    };
  }

  function announcementShareLookup(announcementId) {
    const all = Array.isArray(avizierAnnouncements) ? avizierAnnouncements : [];
    return all.find((item) => String(item.id) === String(announcementId)) || null;
  }

  function attachEvents() {
    if (eventsBound) return;
    eventsBound = true;

    const refreshBtn = e("refreshAvizierBtn");
    const scopeFilters = e("avizierScopeFilters");
    const scopeSelect = e("avizierScope");
    const cancelBtn = e("avizierCancelEditBtn");
    const formatToolbar = e("avizierFormatToolbar");
    const filesInput = e("avizierFiles");
    const createForm = e("createAvizierForm");
    const avizierList = e("avizierList");
    const loadMoreBtn = e("avizierLoadMoreBtn");

    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        try {
          await withRefreshPulse(refreshBtn, async () => refreshAvizier());
          showToast("Avizier actualizat.", "info");
        } catch (error) {
          setStatus(error.message, true);
        }
      });
    }

    if (scopeFilters) {
      scopeFilters.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-avizier-filter]");
        if (!btn) return;
        setAvizierScopeFilter(btn.dataset.avizierFilter);
      });
    }

    if (scopeSelect) {
      scopeSelect.addEventListener("change", () => {
        updateAvizierFormVisibility();
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        resetAvizierComposer();
      });
    }

    if (formatToolbar) {
      formatToolbar.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-avizier-format]");
        if (!btn) return;
        applyAvizierFormat(btn.dataset.avizierFormat);
      });
    }

    if (filesInput) {
      filesInput.addEventListener("change", () => {
        const files = Array.from(filesInput.files || []);
        if (!files.length) {
          setAvizierUploadStatus(
            avizierEditingAnnouncementId
              ? "Niciun fișier selectat. Atașamentele existente vor fi păstrate."
              : "Niciun fișier selectat."
          );
          return;
        }

        const bad = files.find((file) => !AVIZIER_ALLOWED_FILE_TYPES.has(normalizeAvizierFileType(file.type, file.name)));
        if (bad) {
          setAvizierUploadStatus(`Tip de fișier neacceptat: ${bad.name}. Acceptat: JPG sau PDF.`, "error");
          filesInput.value = "";
          return;
        }

        const tooBig = files.find((file) => Number(file.size || 0) > AVIZIER_MAX_FILE_BYTES);
        if (tooBig) {
          setAvizierUploadStatus(`${tooBig.name} depășește 10MB.`, "error");
          filesInput.value = "";
          return;
        }

        setAvizierUploadStatus(`${files.length} fișier(e) selectat(e).`);
      });
    }

    if (createForm) {
      createForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!currentUser) return;

        const scope = e("avizierScope")?.value || "general";
        const buildingId = scope === "building" ? Number(e("avizierBuilding")?.value || currentUser?.building_number || 0) : null;
        if (!canPostAvizier(currentUser, scope, buildingId)) {
          setStatus("Nu ai permisiunea să postezi în Avizier.", true);
          return;
        }

        const btn = e("createAvizierBtn");
        await withButtonProgress(btn, avizierEditingAnnouncementId ? "Se salvează..." : "Se postează...", async () => {
          try {
            const files = Array.from(e("avizierFiles")?.files || []);
            let attachments = [];
            if (files.length) {
              setAvizierUploadStatus(`Se încarcă ${files.length} fișier(e)...`);
              attachments = await uploadAvizierAttachments(files, (progress) => {
                setAvizierUploadStatus(`Se încarcă ${progress.index}/${progress.total}: ${progress.fileName}...`);
              });
              setAvizierUploadStatus(`Încărcare completă: ${attachments.length} fișier(e).`, "success");
            } else {
              setAvizierUploadStatus("Niciun fișier selectat.");
            }

            const payload = {
              title: encodeAvizierTitle(
                String(e("avizierTitle")?.value || "").trim(),
                e("avizierPriority")?.value || "normal",
                Boolean(e("avizierPinned")?.checked)
              ),
              message: String(e("avizierMessage")?.value || "").trim(),
              scope,
              building_id: scope === "building" ? buildingId : null,
            };

            if (!avizierEditingAnnouncementId || files.length) {
              payload.attachments = attachments;
            }

            if (avizierEditingAnnouncementId) {
              await api(`/api/avizier/${avizierEditingAnnouncementId}/update`, {
                method: "POST",
                body: JSON.stringify(payload),
              });
              showToast("Anunț actualizat.");
              flashButtonSuccess(btn, "Salvat");
            } else {
              await api("/api/avizier", {
                method: "POST",
                body: JSON.stringify(payload),
              });
              showToast("Anunț publicat.");
              flashButtonSuccess(btn, "Publicat");
            }

            resetAvizierComposer();
            await refreshAvizier();
          } catch (error) {
            setStatus(error.message, true);
            setAvizierUploadStatus(`Încărcarea a eșuat: ${error.message || "eroare necunoscută"}`, "error");
          }
        });
      });
    }

    if (avizierList) {
      avizierList.addEventListener("click", (event) => {
        const shareBtn = event.target.closest('.share-entity-btn[data-share-kind="announcement"]');
        if (shareBtn) {
          openShareForEntity("announcement", shareBtn.dataset.shareId);
          return;
        }

        const editBtn = event.target.closest("[data-avizier-edit]");
        if (editBtn) {
          const announcementId = String(editBtn.dataset.avizierEdit || "").trim();
          const item = findAvizierAnnouncementById(announcementId);
          if (!item) {
            showToast("Anunțul nu a fost găsit. Reîncarcă și încearcă din nou.", "warning");
            return;
          }
          startAvizierEdit(item);
          return;
        }

        const deleteBtn = event.target.closest("[data-avizier-delete]");
        if (deleteBtn) {
          const announcementId = String(deleteBtn.dataset.avizierDelete || "").trim();
          if (!announcementId) return;
          requestActionConfirmation("Ștergi definitiv acest anunț?").then(async (confirmed) => {
            if (!confirmed) return;
            await withButtonProgress(deleteBtn, "Se șterge...", async () => {
              try {
                await api(`/api/avizier/${announcementId}/delete`, { method: "POST" });
                showToast("Anunț șters.");
                await refreshAvizier();
              } catch (error) {
                setStatus(error.message, true);
              }
            });
          });
          return;
        }

        const expandBtn = event.target.closest("[data-avizier-expand]");
        const card = event.target.closest("[data-avizier-id]");
        if (card) {
          const announcementId = String(card.dataset.avizierId || "").trim();
          if (announcementId) {
            markAvizierRead(announcementId);
            card.classList.remove("unread");
          }
        }

        if (!expandBtn) return;
        const announcementId = String(expandBtn.dataset.avizierExpand || "").trim();
        const messageEl = avizierList.querySelector(`[data-avizier-message="${announcementId}"]`);
        if (!messageEl) return;
        const fullText = decodeURIComponent(messageEl.dataset.avizierFull || "");
        const expanded = expandBtn.dataset.expanded === "1";
        if (expanded) {
          messageEl.innerHTML = renderAvizierMessageHtml(fullText, { truncate: 220 });
          expandBtn.dataset.expanded = "0";
          expandBtn.textContent = "Citește mai mult";
        } else {
          messageEl.innerHTML = renderAvizierMessageHtml(fullText);
          expandBtn.dataset.expanded = "1";
          expandBtn.textContent = "Afișează mai puțin";
        }
        hydrateLucideIcons();
      });
    }

    if (loadMoreBtn) {
      loadMoreBtn.addEventListener("click", () => {
        avizierPage += 1;
        renderAvizierAnnouncements();
        window.scrollBy({ top: 200, behavior: "smooth" });
      });
    }
  }

  function init() {
    attachEvents();
    fillBuildingSelect("avizierBuilding");
    setAvizierComposerMode();
    setAvizierUploadStatus("Niciun fișier selectat.");
    setAvizierScopeFilter("all");
    updateAvizierFormVisibility();
    if (typeof applyStaticActionIcons === "function") {
      applyStaticActionIcons();
    }

    if (typeof attachCharCounter === "function") {
      attachCharCounter("avizierMessage", "avizierMessageCounter", 4000);
      attachCharCounter("avizierTitle", "avizierTitleCounter", 200);
    }
  }

  return {
    init,
    refresh: refreshAvizier,
    clearState: () => {
      avizierAnnouncements = [];
      avizierEditingAnnouncementId = null;
      avizierPage = 0;
      avizierScopeFilter = "all";
    },
    updateFormVisibility: updateAvizierFormVisibility,
    setComposerMode: setAvizierComposerMode,
    setScopeFilter: setAvizierScopeFilter,
    getAnnouncements: () => avizierAnnouncements,
    buildSharePayload: buildAnnouncementSharePayload,
    shareLookup: announcementShareLookup,
    avizierPermissionLabel,
  };
})();

window.AvizierModule = AvizierModule;
