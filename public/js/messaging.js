(() => {
  "use strict";

  const POLL_INTERVAL_MS = 10000;
  const MESSAGES_PAGE_SIZE = 50;
  const CONVERSATIONS_PAGE_SIZE = 200;
  const PUSHER_CDN = "https://js.pusher.com/8.0/pusher.min.js";
  const SIDEBAR_COLLAPSED_KEY = "10blocuri_sidebar_collapsed_v1";

  const state = {
    user: null,
    conversations: [],
    activeConversationId: null,
    activeConversation: null,
    messages: [],
    nextMessagesCursor: null,
    loadingOlder: false,
    filter: "all",
    search: "",
    replyTo: null,
    attachment: null,
    attachmentUploading: false,
    pusher: null,
    pusherReady: false,
    usingPolling: false,
    userChannel: null,
    conversationChannel: null,
    pollingTimer: null,
    refreshTimer: null,
    typingUsers: new Map(),
    typingSendTimer: null,
    currentView: "list",
    longPressTimer: null,
    actionMessage: null,
    pullStartY: 0,
    pullDeltaY: 0,
    pullActive: false,
    messagingUnavailable: false,
  };

  const els = {
    body: document.body,
    status: document.getElementById("status"),
    toastContainer: document.getElementById("toastContainer"),
    conversationSearch: document.getElementById("conversationSearch"),
    filterRow: document.getElementById("conversationFilterRow"),
    conversationList: document.getElementById("conversationList"),
    pullRefreshIndicator: document.getElementById("pullRefreshIndicator"),
    createConversationBtn: document.getElementById("createConversationBtn"),
    mobileCreateBtn: document.getElementById("mobileCreateBtn"),
    mobileSearchBtn: document.getElementById("mobileSearchBtn"),
    mobileMessagesBadge: document.getElementById("mobileMessagesBadge"),
    chatAvatar: document.getElementById("chatAvatar"),
    chatTitle: document.getElementById("chatTitle"),
    chatTopic: document.getElementById("chatTopic"),
    btnEditTopic: document.getElementById("btnEditTopic"),
    btnToggleLock: document.getElementById("btnToggleLock"),
    btnDeleteConversation: document.getElementById("btnDeleteConversation"),
    btnSearchMessages: document.getElementById("btnSearchMessages"),
    btnInfoConversation: document.getElementById("btnInfoConversation"),
    pinnedBar: document.getElementById("pinnedBar"),
    pinnedText: document.getElementById("pinnedText"),
    lockedBar: document.getElementById("lockedBar"),
    messagesScroll: document.getElementById("messagesScroll"),
    emptyChat: document.getElementById("emptyChat"),
    composerDock: document.getElementById("chatComposerDock"),
    composerRow: document.getElementById("composerRow"),
    composerInput: document.getElementById("composerInput"),
    attachBtn: document.getElementById("attachBtn"),
    sendBtn: document.getElementById("sendBtn"),
    attachmentInput: document.getElementById("attachmentInput"),
    attachmentChip: document.getElementById("attachmentChip"),
    attachmentPreviewImage: document.getElementById("attachmentPreviewImage"),
    attachmentLabel: document.getElementById("attachmentLabel"),
    attachmentSize: document.getElementById("attachmentSize"),
    removeAttachmentBtn: document.getElementById("removeAttachmentBtn"),
    replyChip: document.getElementById("replyChip"),
    replyLabel: document.getElementById("replyLabel"),
    cancelReplyBtn: document.getElementById("cancelReplyBtn"),
    newConversationModal: document.getElementById("newConversationModal"),
    newConversationClose: document.getElementById("newConversationClose"),
    newConversationForm: document.getElementById("newConversationForm"),
    convTypeSelect: document.getElementById("convTypeSelect"),
    formDmFields: document.getElementById("formDmFields"),
    formBoardFields: document.getElementById("formBoardFields"),
    formAnnouncementFields: document.getElementById("formAnnouncementFields"),
    dmRecipient: document.getElementById("dmRecipient"),
    dmRecipientList: document.getElementById("dmRecipientList"),
    boardTitle: document.getElementById("boardTitle"),
    boardTopic: document.getElementById("boardTopic"),
    boardScope: document.getElementById("boardScope"),
    boardBuilding: document.getElementById("boardBuilding"),
    boardInitialMessage: document.getElementById("boardInitialMessage"),
    announcementTitle: document.getElementById("announcementTitle"),
    announcementBuilding: document.getElementById("announcementBuilding"),
    announcementMessage: document.getElementById("announcementMessage"),
    conversationCreateSubmit: document.getElementById("conversationCreateSubmit"),
    chatBackBtn: document.getElementById("chatBackBtn"),
    topThemeToggleBtn: document.getElementById("topThemeToggleBtn"),
    themeToggleBtn: document.getElementById("themeToggleBtn"),
    sidebarToggleBtn: document.getElementById("sidebarToggleBtn"),
    navUserBadge: document.getElementById("navUserBadge"),
    navUserInitials: document.getElementById("navUserInitials"),
    navUserText: document.getElementById("navUserText"),
    logoutBtn: document.getElementById("logoutBtn"),
    railUserBadge: document.getElementById("railUserBadge"),
    railUserInitials: document.getElementById("railUserInitials"),
    railUserText: document.getElementById("railUserText"),
    railLogoutBtn: document.getElementById("railLogoutBtn"),
    tabMessages: document.getElementById("tabMessages"),
    messageActionSheet: document.getElementById("messageActionSheet"),
    actionReply: document.getElementById("actionReply"),
    actionCopy: document.getElementById("actionCopy"),
    actionPin: document.getElementById("actionPin"),
    actionDelete: document.getElementById("actionDelete"),
    actionCancel: document.getElementById("actionCancel"),
    imageLightbox: document.getElementById("imageLightbox"),
    imageLightboxClose: document.getElementById("imageLightboxClose"),
    imageLightboxImg: document.getElementById("imageLightboxImg"),
  };

  function showStatus(message, isError = false) {
    if (!els.status) return;
    els.status.textContent = message || "";
    els.status.style.color = isError ? "#b91c1c" : "var(--muted)";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isMobile() {
    return window.matchMedia("(max-width: 767px)").matches;
  }

  function isAdmin() {
    if (!state.user) return false;
    return String(state.user.role || "") === "admin" || String(state.user.username || "") === "admin";
  }

  function isComitet() {
    return String(state.user?.avizier_permission || "") === "comitet";
  }

  function isReprezentant() {
    return String(state.user?.avizier_permission || "") === "reprezentant_bloc";
  }

  function getUserBuildingId() {
    const numeric = Number(state.user?.building_number || 0);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 10) return null;
    return `bloc${numeric}`;
  }

  function canPinInConversation(conversation) {
    if (!conversation) return false;
    if (isAdmin() || isComitet()) return true;
    if (isReprezentant()) {
      return conversation.scope === "building" && conversation.building_id === getUserBuildingId();
    }
    return false;
  }

  function canModerateAnyInConversation(conversation) {
    if (!conversation) return false;
    if (isAdmin()) return true;
    if (isComitet()) {
      return conversation.scope === "building" && conversation.building_id === getUserBuildingId();
    }
    return false;
  }

  function canPostAnnouncementConversation() {
    return isAdmin() || isComitet() || isReprezentant();
  }

  function canCreateNeighborhoodBoard() {
    return isAdmin() || isComitet();
  }

  function parseTheme() {
    const stored = localStorage.getItem("theme");
    return stored === "dark" ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
    localStorage.setItem("theme", theme === "dark" ? "dark" : "light");
    const label = theme === "dark" ? "Mod Luminos" : "Mod Întunecat";
    if (els.themeToggleBtn) {
      const labelEl = els.themeToggleBtn.querySelector("span");
      if (labelEl) labelEl.textContent = label;
    }
    if (els.topThemeToggleBtn) {
      els.topThemeToggleBtn.textContent = theme === "dark" ? "Mod Luminos" : "Temă";
    }
  }

  function toggleTheme() {
    applyTheme(document.body.getAttribute("data-theme") === "dark" ? "light" : "dark");
  }

  function toast(message, kind = "info") {
    if (!els.toastContainer) return;
    const item = document.createElement("div");
    item.style.padding = "10px 12px";
    item.style.borderRadius = "10px";
    item.style.marginBottom = "8px";
    item.style.fontSize = "13px";
    item.style.fontWeight = "700";
    item.style.border = "1px solid var(--border)";
    item.style.background = "var(--card)";
    item.style.color = "var(--text)";
    if (kind === "error") {
      item.style.background = "#fee2e2";
      item.style.color = "#991b1b";
    }
    if (kind === "success") {
      item.style.background = "#dcfce7";
      item.style.color = "#166534";
    }
    item.textContent = message;
    els.toastContainer.appendChild(item);
    setTimeout(() => item.remove(), 2800);
  }

  async function api(path, options = {}) {
    const init = {
      method: options.method || "GET",
      headers: { ...(options.headers || {}) },
      credentials: "same-origin",
      body: options.body,
    };

    if (init.body && !(init.body instanceof FormData)) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(init.body);
    }

    const response = await fetch(path, init);
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      const error = new Error(data.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.payload = data;
      throw error;
    }

    return data;
  }

  function avatarInitials(conversation) {
    const title = String(conversation?.title || "").trim();
    if (!title) return "#";
    const words = title.split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
  }

  function conversationPreview(conversation) {
    const lastMessage = String(conversation?.last_message?.content || "").trim();
    if (lastMessage) return { text: lastMessage, empty: false };
    return { text: "Nicio activitate încă", empty: true };
  }

  function conversationAvatarHtml(conversation) {
    const type = normalizeConversationType(conversation?.type);
    if (type === "dm") {
      return `<span class="conv-avatar circle dm">${escapeHtml(avatarInitials(conversation))}</span>`;
    }
    const icon = type === "announcement" ? "megaphone" : "messages-square";
    return `<span class="conv-avatar square board"><i data-lucide="${icon}" aria-hidden="true"></i></span>`;
  }

  function relativeTime(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "acum";
    if (diffMin < 60) return `${diffMin}m`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay === 1) return "Ieri";
    if (diffDay < 7) return `${diffDay}z`;
    return date.toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit" });
  }

  function dayLabel(iso) {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const dateKey = date.toLocaleDateString("ro-RO");
    if (dateKey === today.toLocaleDateString("ro-RO")) return "Astăzi";
    if (dateKey === yesterday.toLocaleDateString("ro-RO")) return "Ieri";
    return date.toLocaleDateString("ro-RO", { weekday: "short", day: "2-digit", month: "short" });
  }

  function formatClock(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    return date.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
  }

  function messageAttachmentUrl(message) {
    if (!message?.attachment_key) return null;
    return `/api/uploads/view?key=${encodeURIComponent(message.attachment_key)}`;
  }

  function isImageAttachmentType(typeValue) {
    return String(typeValue || "").toLowerCase().startsWith("image/");
  }

  function attachmentFileSizeBytes(message) {
    if (!message) return null;
    const raw = message.attachment_size_bytes ?? message.attachment_size ?? null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }

  function formatFileSize(bytesValue) {
    const bytes = Number(bytesValue || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  }

  function normalizeConversationType(type) {
    const value = String(type || "").toLowerCase();
    if (["dm", "board", "announcement"].includes(value)) return value;
    return "board";
  }

  function upsertConversation(conversation) {
    if (!conversation || !conversation.id) return;
    const next = [...state.conversations];
    const idx = next.findIndex((item) => Number(item.id) === Number(conversation.id));
    if (idx >= 0) next[idx] = { ...next[idx], ...conversation };
    else next.push(conversation);
    next.sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
    state.conversations = next;
  }

  function removeConversation(conversationId) {
    state.conversations = state.conversations.filter((item) => Number(item.id) !== Number(conversationId));
  }

  function getFilteredConversations() {
    const term = state.search.trim().toLowerCase();
    return state.conversations.filter((conversation) => {
      if (state.filter !== "all" && normalizeConversationType(conversation.type) !== state.filter) {
        return false;
      }

      if (!term) return true;

      const haystack = [
        conversation.title,
        conversation.topic,
        conversation.last_message?.content,
        conversation.last_message?.sender,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");

      return haystack.includes(term);
    });
  }

  function splitConversationGroups(items) {
    const groups = {
      building: [],
      neighborhood: [],
      dms: [],
    };

    for (const conversation of items) {
      const type = normalizeConversationType(conversation.type);
      if (type === "dm") {
        groups.dms.push(conversation);
        continue;
      }
      if (conversation.scope === "neighborhood") groups.neighborhood.push(conversation);
      else groups.building.push(conversation);
    }

    const byUpdated = (a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
    groups.building.sort(byUpdated);
    groups.neighborhood.sort(byUpdated);
    groups.dms.sort(byUpdated);

    return groups;
  }

  function typeLabel(type) {
    if (type === "dm") return "DM";
    if (type === "announcement") return "Anunț";
    return "Board";
  }

  function renderConversationGroup(title, items) {
    if (!items.length) return "";
    const rows = items
      .map((conversation) => {
        const active = Number(state.activeConversationId) === Number(conversation.id);
        const unread = Number(conversation.unread_count || 0);
        const isDm = normalizeConversationType(conversation.type) === "dm";
        const preview = conversationPreview(conversation);
        const type = normalizeConversationType(conversation.type);

        const unreadMarkup = unread > 0
          ? `<span class="unread-badge">${unread > 99 ? "99+" : unread}</span>`
          : "";

        return `
          <button class="conversation-item ${active ? "active" : ""}" data-conversation-id="${conversation.id}" type="button" aria-label="Deschide ${escapeHtml(conversation.title || "Conversație")}">
            ${conversationAvatarHtml(conversation)}
            <span class="conv-body">
              <span class="conv-title">${escapeHtml(conversation.title || (isDm ? "Mesaj direct" : "Conversație"))}</span>
              <span class="conv-topic-row">
                ${!isDm && conversation.topic ? `<span class="conv-topic">${escapeHtml(conversation.topic)}</span>` : "<span></span>"}
                <span class="conv-type-chip">${escapeHtml(typeLabel(type))}</span>
              </span>
              <span class="conv-preview ${preview.empty ? "is-empty" : ""}">${escapeHtml(preview.text)}</span>
            </span>
            <span class="conv-meta">
              <span class="conv-time">${escapeHtml(relativeTime(conversation.updated_at))}</span>
              ${unreadMarkup}
            </span>
          </button>
        `;
      })
      .join("");

    return `<section class="conv-group"><div class="group-title">${escapeHtml(title)}</div>${rows}</section>`;
  }

  function renderConversationList() {
    if (!els.conversationList) return;

    const filtered = getFilteredConversations();
    const grouped = splitConversationGroups(filtered);

    const html = [
      renderConversationGroup("Blocul meu", grouped.building),
      renderConversationGroup("Cartier", grouped.neighborhood),
      renderConversationGroup("Mesaje directe", grouped.dms),
    ]
      .filter(Boolean)
      .join("");

    if (!html) {
      els.conversationList.innerHTML = `
        <div class="empty-chat" style="margin:18px 0;">
          <div class="empty-chat-icon"><i data-lucide="message-square"></i></div>
          <div class="empty-chat-title">Nu există conversații pentru filtrul ales.</div>
          <div class="empty-chat-subtitle">Nicio activitate recentă. Fii primul care postează!</div>
        </div>
      `;
      hydrateIcons();
      return;
    }

    els.conversationList.innerHTML = html;
    hydrateIcons();
  }

  function renderUnreadBadge() {
    const totalUnread = state.conversations.reduce((sum, item) => sum + Number(item.unread_count || 0), 0);
    if (!els.mobileMessagesBadge) return;
    els.mobileMessagesBadge.textContent = totalUnread > 99 ? "99+" : String(totalUnread);
    els.mobileMessagesBadge.classList.toggle("show", totalUnread > 0);
  }

  function setActiveConversationHeader(conversation) {
    if (!conversation) {
      if (els.chatTitle) els.chatTitle.textContent = "Selectează o conversație";
      if (els.chatTopic) els.chatTopic.textContent = "";
      if (els.chatAvatar) {
        els.chatAvatar.innerHTML = `<i data-lucide="message-square" aria-hidden="true"></i>`;
        els.chatAvatar.className = "conv-avatar square board";
      }
      hydrateIcons();
      return;
    }

    const isDm = normalizeConversationType(conversation.type) === "dm";
    if (els.chatAvatar) {
      if (isDm) {
        els.chatAvatar.textContent = avatarInitials(conversation);
        els.chatAvatar.className = "conv-avatar circle dm";
      } else {
        const icon = normalizeConversationType(conversation.type) === "announcement" ? "megaphone" : "messages-square";
        els.chatAvatar.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
        els.chatAvatar.className = "conv-avatar square board";
      }
    }
    if (els.chatTitle) {
      els.chatTitle.textContent = conversation.title || (isDm ? "Mesaj direct" : "Conversație");
    }
    if (els.chatTopic) {
      els.chatTopic.textContent = isDm ? "" : (conversation.topic || "");
    }

    const adminOnly = isAdmin();
    for (const btn of [els.btnEditTopic, els.btnToggleLock, els.btnDeleteConversation]) {
      if (!btn) continue;
      btn.style.display = adminOnly ? "inline-flex" : "none";
    }
    if (els.btnToggleLock) {
      els.btnToggleLock.title = conversation.is_locked ? "Deblochează" : "Blochează";
      els.btnToggleLock.setAttribute("aria-label", conversation.is_locked ? "Deblochează board" : "Blochează board");
    }
    hydrateIcons();
  }

  function renderPinnedBar(conversation) {
    if (!els.pinnedBar || !els.pinnedText) return;
    const pinned = conversation?.pinned_message;
    if (!pinned || !pinned.content) {
      els.pinnedBar.classList.add("hidden");
      return;
    }

    els.pinnedText.textContent = pinned.content;
    els.pinnedBar.classList.remove("hidden");
  }

  function renderLockedBar(conversation) {
    if (!els.lockedBar) return;
    if (conversation?.is_locked) {
      els.lockedBar.classList.remove("hidden");
    } else {
      els.lockedBar.classList.add("hidden");
    }
  }

  function setComposerDisabled(disabled) {
    if (!els.composerInput || !els.composerRow || !els.sendBtn || !els.attachBtn) return;
    els.composerInput.disabled = Boolean(disabled);
    els.sendBtn.disabled = Boolean(disabled);
    els.attachBtn.disabled = Boolean(disabled);
    els.composerRow.classList.toggle("disabled", Boolean(disabled));
  }

  function updateComposerState() {
    if (!state.activeConversation) {
      setComposerDisabled(true);
      return;
    }

    const lockedAndNotAdmin = state.activeConversation.is_locked && !isAdmin();
    setComposerDisabled(lockedAndNotAdmin);
  }

  function renderReplyChip() {
    if (!els.replyChip || !els.replyLabel) return;
    if (!state.replyTo) {
      els.replyChip.classList.remove("show");
      els.replyLabel.textContent = "";
      return;
    }

    els.replyChip.classList.add("show");
    const snippet = String(state.replyTo.content || "").slice(0, 90);
    els.replyLabel.textContent = `Răspunzi la ${state.replyTo.sender}: ${snippet}`;
  }

  function renderAttachmentChip() {
    if (!els.attachmentChip || !els.attachmentLabel) return;
    if (!state.attachment) {
      els.attachmentChip.classList.remove("show");
      els.attachmentLabel.textContent = "";
      if (els.attachmentSize) {
        els.attachmentSize.textContent = "";
        els.attachmentSize.style.display = "none";
      }
      if (els.attachmentPreviewImage) {
        els.attachmentPreviewImage.src = "";
        els.attachmentPreviewImage.classList.add("hidden");
      }
      return;
    }

    const label = state.attachmentUploading ? `Se încarcă: ${state.attachment.attachment_name}` : state.attachment.attachment_name;
    els.attachmentChip.classList.add("show");
    els.attachmentLabel.textContent = label;
    const sizeLabel = formatFileSize(attachmentFileSizeBytes(state.attachment));
    if (els.attachmentSize) {
      els.attachmentSize.textContent = sizeLabel;
      els.attachmentSize.style.display = sizeLabel ? "inline-flex" : "none";
    }

    const showImage = isImageAttachmentType(state.attachment.attachment_type) && state.attachment.local_preview_url;
    if (els.attachmentPreviewImage) {
      if (showImage) {
        els.attachmentPreviewImage.src = state.attachment.local_preview_url;
        els.attachmentPreviewImage.classList.remove("hidden");
      } else {
        els.attachmentPreviewImage.src = "";
        els.attachmentPreviewImage.classList.add("hidden");
      }
    }
  }

  function revokeAttachmentPreview(attachment) {
    const previewUrl = String(attachment?.local_preview_url || "");
    if (!previewUrl || !previewUrl.startsWith("blob:")) return;
    try {
      URL.revokeObjectURL(previewUrl);
    } catch {
      // ignore revoke failures
    }
  }

  function closeImageLightbox() {
    if (!els.imageLightbox) return;
    els.imageLightbox.classList.remove("show");
    if (els.imageLightboxImg) {
      els.imageLightboxImg.src = "";
      els.imageLightboxImg.alt = "Imagine atașată";
    }
  }

  function openImageLightbox(src, label = "") {
    if (!els.imageLightbox || !els.imageLightboxImg || !src) return;
    els.imageLightboxImg.src = src;
    els.imageLightboxImg.alt = label || "Imagine atașată";
    els.imageLightbox.classList.add("show");
    hydrateIcons();
  }

  function bindMessageImageLoadStates() {
    if (!els.messagesScroll) return;
    els.messagesScroll.querySelectorAll(".message-image-wrap.loading .message-image").forEach((img) => {
      const wrap = img.closest(".message-image-wrap");
      if (!wrap) return;

      const onLoad = () => {
        wrap.classList.remove("loading", "is-error");
      };
      const onError = () => {
        wrap.classList.remove("loading");
        wrap.classList.add("is-error");
      };

      if (img.complete && img.naturalWidth > 0) {
        onLoad();
        return;
      }
      if (img.complete && img.naturalWidth === 0) {
        onError();
        return;
      }

      img.addEventListener("load", onLoad, { once: true });
      img.addEventListener("error", onError, { once: true });
    });
  }

  function messageIdKey(message) {
    return String(message.id);
  }

  function mergeLatestMessages(latestAsc) {
    const map = new Map();
    for (const message of state.messages) {
      map.set(messageIdKey(message), message);
    }
    for (const message of latestAsc) {
      map.set(messageIdKey(message), message);
    }
    const merged = [...map.values()].sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
    state.messages = merged;
  }

  function renderMessages(scrollToBottom = false) {
    if (!els.messagesScroll) return;

    if (!state.activeConversation) {
      els.messagesScroll.innerHTML = "";
      if (els.emptyChat) els.emptyChat.classList.remove("hidden");
      return;
    }

    if (els.emptyChat) els.emptyChat.classList.add("hidden");

    const rows = [];
    let lastDateKey = null;
    const isDm = normalizeConversationType(state.activeConversation.type) === "dm";

    for (const message of state.messages) {
      const createdAt = message.created_at || new Date().toISOString();
      const dateKey = new Date(createdAt).toDateString();
      if (dateKey !== lastDateKey) {
        rows.push(`<div class="date-divider">${escapeHtml(dayLabel(createdAt))}</div>`);
        lastDateKey = dateKey;
      }

      const sent = String(message.sender || "") === String(state.user?.username || "");
      const deleted = Boolean(message.deleted_at) || String(message.content || "").trim().toLowerCase() === "mesaj șters";
      const failed = Boolean(message.__failed);

      const senderLine = !sent && !isDm ? `<div class="message-sender">${escapeHtml(message.sender || "")}</div>` : "";
      const bubbleTextRaw = String(message.content || "");
      const bubbleText = escapeHtml(bubbleTextRaw);
      const hasText = bubbleTextRaw.trim().length > 0;
      const attachmentUrl = deleted ? null : messageAttachmentUrl(message);
      const isImageAttachment = attachmentUrl && isImageAttachmentType(message.attachment_type);
      const attachmentName = String(message.attachment_name || "Fișier");
      const fileSizeLabel = formatFileSize(attachmentFileSizeBytes(message));
      const fileSizeMarkup = fileSizeLabel ? `<span class="message-file-size">${escapeHtml(fileSizeLabel)}</span>` : "";

      let bubbleClassName = "message-bubble";
      let attachmentMarkup = "";
      if (isImageAttachment) {
        bubbleClassName += hasText ? " has-image-with-text" : " has-image-only";
        attachmentMarkup = `
          <button type="button"
                  class="message-image-trigger"
                  data-open-image="${escapeHtml(attachmentUrl)}"
                  data-image-name="${escapeHtml(attachmentName)}"
                  aria-label="Deschide imaginea ${escapeHtml(attachmentName)}">
            <span class="message-image-wrap loading ${sent ? "sent" : "received"}">
              <img class="message-image"
                   src="${escapeHtml(attachmentUrl)}"
                   alt="${escapeHtml(attachmentName)}"
                   loading="lazy" />
              <span class="message-image-loading" aria-hidden="true">
                <span class="message-image-spinner"></span>
              </span>
              <span class="message-image-error" aria-hidden="true">
                <i data-lucide="image-off" aria-hidden="true"></i>
                <span>Imaginea nu poate fi încărcată</span>
              </span>
            </span>
          </button>
        `;
      } else if (attachmentUrl) {
        attachmentMarkup = `
          <div class="message-file-card">
            <div class="message-file-icon"><i data-lucide="file-text" aria-hidden="true"></i></div>
            <div class="message-file-meta">
              <div class="message-file-name">${escapeHtml(attachmentName)}</div>
              ${fileSizeMarkup}
            </div>
            <a class="message-file-download"
               target="_blank"
               rel="noopener noreferrer"
               href="${escapeHtml(attachmentUrl)}">Descarcă</a>
          </div>
        `;
      }

      let bubbleInner = hasText ? `<div class="message-text">${bubbleText}</div>` : "";
      bubbleInner += attachmentMarkup;
      if (!bubbleInner) {
        bubbleInner = "<div class=\"message-text\"></div>";
      }

      rows.push(`
        <article id="msg-${escapeHtml(messageIdKey(message))}" class="message-row ${sent ? "sent" : "received"} ${deleted ? "deleted" : ""} ${failed ? "failed" : ""}" data-msg-id="${escapeHtml(messageIdKey(message))}" data-msg-sender="${escapeHtml(message.sender || "")}">
          ${senderLine}
          <div class="${bubbleClassName}">
            ${bubbleInner}
          </div>
          <div class="message-meta">${escapeHtml(formatClock(createdAt))}${failed ? " · Eșuat" : ""}</div>
        </article>
      `);
    }

    if (state.typingUsers.size > 0) {
      const users = [...state.typingUsers.keys()].join(", ");
      rows.push(`
        <div class="typing-indicator" id="typingIndicator">
          <span class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>
          <span>${escapeHtml(users)} scrie...</span>
        </div>
      `);
    }

    els.messagesScroll.innerHTML = rows.join("");
    bindMessageImageLoadStates();
    hydrateIcons();

    if (scrollToBottom) {
      requestAnimationFrame(() => {
        els.messagesScroll.scrollTop = els.messagesScroll.scrollHeight;
      });
    }
  }

  function isNearBottom() {
    if (!els.messagesScroll) return true;
    const delta = els.messagesScroll.scrollHeight - els.messagesScroll.scrollTop - els.messagesScroll.clientHeight;
    return delta < 80;
  }

  function scrollMessagesToBottom(smooth = false) {
    if (!els.messagesScroll) return;
    els.messagesScroll.scrollTo({
      top: els.messagesScroll.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }

  function hydrateIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function userInitials(user) {
    const username = String(user?.username || "").trim();
    if (!username) return "--";
    return username
      .split("_")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("")
      .slice(0, 2);
  }

  function displayResidence(user) {
    if (!user) return "";
    const building = Number(user.building_number || 0);
    const apartment = Number(user.apartment_number || 0);
    if (Number.isInteger(building) && building > 0 && Number.isInteger(apartment) && apartment > 0) {
      return `Bloc ${building} · Ap ${apartment}`;
    }
    if (Number.isInteger(building) && building > 0) {
      return `Bloc ${building}`;
    }
    return "";
  }

  function applyUserShellState() {
    if (!state.user) return;
    const initials = userInitials(state.user);
    const residence = displayResidence(state.user);
    const text = residence ? `${state.user.username} · ${residence}` : state.user.username;

    if (els.navUserInitials) els.navUserInitials.textContent = initials;
    if (els.navUserText) els.navUserText.textContent = text;
    if (els.railUserInitials) els.railUserInitials.textContent = initials;
    if (els.railUserText) els.railUserText.textContent = text;

    if (els.navUserBadge) els.navUserBadge.classList.remove("hidden");
    if (els.railUserBadge) els.railUserBadge.classList.remove("hidden");
    if (els.logoutBtn) els.logoutBtn.classList.remove("hidden");
    if (els.railLogoutBtn) els.railLogoutBtn.classList.remove("hidden");
  }

  async function loadCurrentUser() {
    const response = await api("/api/auth/me");
    if (!response?.user) {
      throw new Error("Sesiunea nu este activă. Reautentifică-te.");
    }
    state.user = response.user;
    applyUserShellState();
  }

  async function refreshConversations() {
    const params = new URLSearchParams();
    params.set("limit", String(CONVERSATIONS_PAGE_SIZE));
    if (state.filter !== "all") params.set("type", state.filter);

    const data = await api(`/api/messaging/conversations?${params.toString()}`);
    state.messagingUnavailable = Boolean(data?.unavailable);
    state.conversations = Array.isArray(data.conversations) ? data.conversations : [];

    if (state.activeConversationId) {
      const updated = state.conversations.find((item) => Number(item.id) === Number(state.activeConversationId));
      if (updated) {
        state.activeConversation = { ...(state.activeConversation || {}), ...updated };
      }
    }

    renderConversationList();
    renderUnreadBadge();
  }

  async function loadConversationDetail(conversationId) {
    const data = await api(`/api/messaging/conversations/${conversationId}`);
    return data.conversation;
  }

  async function loadMessagesPage({ reset = false, before = null } = {}) {
    if (!state.activeConversationId) return;

    const params = new URLSearchParams();
    params.set("limit", String(MESSAGES_PAGE_SIZE));
    if (before) params.set("before", before);

    const data = await api(`/api/messaging/conversations/${state.activeConversationId}/messages?${params.toString()}`);
    const rows = Array.isArray(data.messages) ? data.messages : [];
    const asc = rows.slice().reverse();

    if (reset) {
      state.messages = asc;
    } else {
      state.messages = [...asc, ...state.messages];
    }

    state.nextMessagesCursor = data.next_cursor || null;
  }

  async function refreshActiveMessages() {
    if (!state.activeConversationId) return;
    const nearBottom = isNearBottom();
    const params = new URLSearchParams();
    params.set("limit", String(MESSAGES_PAGE_SIZE));
    const data = await api(`/api/messaging/conversations/${state.activeConversationId}/messages?${params.toString()}`);
    const rows = Array.isArray(data.messages) ? data.messages : [];
    const asc = rows.slice().reverse();
    mergeLatestMessages(asc);
    state.nextMessagesCursor = data.next_cursor || state.nextMessagesCursor;
    renderMessages(nearBottom);
  }

  async function markConversationRead(conversationId) {
    await api(`/api/messaging/conversations/${conversationId}/read`, { method: "POST", body: {} });

    const conv = state.conversations.find((item) => Number(item.id) === Number(conversationId));
    if (conv) conv.unread_count = 0;
    renderConversationList();
    renderUnreadBadge();
  }

  async function openConversation(conversationId, { pushHistory = true, forceScrollBottom = true } = {}) {
    const id = Number(conversationId);
    if (!Number.isInteger(id) || id <= 0) return;

    const nearBottom = isNearBottom();
    state.activeConversationId = id;
    state.replyTo = null;
    renderReplyChip();

    const detail = await loadConversationDetail(id);
    state.activeConversation = detail;
    upsertConversation(detail);

    await loadMessagesPage({ reset: true });

    renderConversationList();
    setActiveConversationHeader(detail);
    renderPinnedBar(detail);
    renderLockedBar(detail);
    updateComposerState();
    renderMessages(forceScrollBottom || nearBottom);

    await markConversationRead(id).catch(() => {});
    subscribeConversationChannel(id);

    if (isMobile()) {
      setMobileView("chat", { pushHistory });
    }
  }

  async function loadOlderMessages() {
    if (!state.activeConversationId || !state.nextMessagesCursor || state.loadingOlder) return;
    state.loadingOlder = true;

    const previousHeight = els.messagesScroll?.scrollHeight || 0;
    const cursor = state.nextMessagesCursor;

    try {
      await loadMessagesPage({ reset: false, before: cursor });
      renderMessages(false);

      if (els.messagesScroll) {
        const nextHeight = els.messagesScroll.scrollHeight;
        els.messagesScroll.scrollTop = nextHeight - previousHeight + els.messagesScroll.scrollTop;
      }
    } catch (error) {
      toast(error.message || "Nu am putut încărca mesaje mai vechi.", "error");
    } finally {
      state.loadingOlder = false;
    }
  }

  function setMobileView(view, { pushHistory = false } = {}) {
    state.currentView = view === "chat" ? "chat" : "list";
    document.body.classList.toggle("mobile-chat-open", state.currentView === "chat" && isMobile());

    if (pushHistory) {
      const url = new URL(window.location.href);
      if (state.currentView === "chat" && state.activeConversationId) {
        url.searchParams.set("conv", String(state.activeConversationId));
      } else {
        url.searchParams.delete("conv");
      }
      history.pushState({ messagingView: state.currentView, conv: state.activeConversationId || null }, "", url);
    }
  }

  function openNewConversationModal() {
    if (!els.newConversationModal) return;
    els.newConversationModal.classList.add("show");
    updateConversationTypeFields();
  }

  function closeNewConversationModal() {
    if (!els.newConversationModal) return;
    els.newConversationModal.classList.remove("show");
  }

  function updateConversationTypeFields() {
    if (!els.convTypeSelect) return;
    const type = String(els.convTypeSelect.value || "dm");

    if (els.formDmFields) els.formDmFields.classList.toggle("hidden", type !== "dm");
    if (els.formBoardFields) els.formBoardFields.classList.toggle("hidden", type !== "board");
    if (els.formAnnouncementFields) els.formAnnouncementFields.classList.toggle("hidden", type !== "announcement");
  }

  function fillResidentDatalist() {
    if (!els.dmRecipientList) return;
    const fragment = document.createDocumentFragment();
    for (let building = 1; building <= 10; building += 1) {
      for (let apartment = 1; apartment <= 16; apartment += 1) {
        const option = document.createElement("option");
        option.value = `bloc${building}_apt${apartment}`;
        fragment.appendChild(option);
      }
    }
    els.dmRecipientList.replaceChildren(fragment);
  }

  function initRoleBasedOptions() {
    if (els.convTypeSelect && !canPostAnnouncementConversation()) {
      const option = els.convTypeSelect.querySelector('option[value="announcement"]');
      if (option) option.remove();
    }

    if (els.boardScope && !canCreateNeighborhoodBoard()) {
      els.boardScope.value = "building";
      const neighborhoodOption = els.boardScope.querySelector('option[value="neighborhood"]');
      if (neighborhoodOption) neighborhoodOption.disabled = true;
    }

    const userBuilding = getUserBuildingId();
    if (els.boardBuilding && userBuilding) {
      els.boardBuilding.value = userBuilding;
    }

    if (els.announcementBuilding && userBuilding) {
      els.announcementBuilding.value = userBuilding;
    }

    if (!isAdmin() && !isComitet()) {
      if (els.announcementBuilding) els.announcementBuilding.disabled = true;
      if (els.boardBuilding) els.boardBuilding.disabled = true;
    }
  }

  async function createConversationFromModal(event) {
    event.preventDefault();
    if (!els.convTypeSelect) return;

    const type = String(els.convTypeSelect.value || "dm");
    const payload = { type };

    if (type === "dm") {
      const recipient = String(els.dmRecipient?.value || "").trim().toLowerCase();
      if (!recipient) {
        throw new Error("Selectează destinatarul pentru DM.");
      }
      payload.participants = [recipient];
      payload.first_message = String(els.boardInitialMessage?.value || "").trim();
    }

    if (type === "board") {
      const title = String(els.boardTitle?.value || "").trim();
      if (!title) throw new Error("Titlul board-ului este obligatoriu.");
      payload.title = title;
      payload.topic = String(els.boardTopic?.value || "").trim();
      payload.scope = String(els.boardScope?.value || "building");
      payload.building_id = String(els.boardBuilding?.value || getUserBuildingId() || "");
      payload.first_message = String(els.boardInitialMessage?.value || "").trim();
    }

    if (type === "announcement") {
      const buildingId = String(els.announcementBuilding?.value || getUserBuildingId() || "");
      const content = String(els.announcementMessage?.value || "").trim();
      payload.title = String(els.announcementTitle?.value || `Anunțuri ${buildingId || "Bloc"}`).trim();
      payload.scope = "building";
      payload.building_id = buildingId;
      payload.first_message = content;
    }

    const data = await api("/api/messaging/conversations", {
      method: "POST",
      body: payload,
    });

    const conversation = data.conversation;
    if (!conversation?.id) {
      throw new Error("Conversația nu a putut fi creată.");
    }

    upsertConversation(conversation);
    renderConversationList();
    renderUnreadBadge();

    closeNewConversationModal();
    if (els.newConversationForm) els.newConversationForm.reset();

    await openConversation(conversation.id, { pushHistory: true, forceScrollBottom: true });
  }

  async function uploadAttachment(file) {
    if (state.attachment) {
      revokeAttachmentPreview(state.attachment);
    }
    const localPreviewUrl = isImageAttachmentType(file.type) ? URL.createObjectURL(file) : "";
    state.attachmentUploading = true;
    state.attachment = {
      attachment_name: file.name,
      attachment_type: file.type || "application/octet-stream",
      attachment_size_bytes: Number(file.size || 0) || null,
      local_preview_url: localPreviewUrl || null,
    };
    renderAttachmentChip();

    const form = new FormData();
    form.append("file", file);
    form.append("module_name", "messaging");

    const response = await fetch("/api/uploads/direct", {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Încărcarea fișierului a eșuat.");
    }

    state.attachment = {
      attachment_key: data.key,
      attachment_name: data.file_name || file.name,
      attachment_type: data.file_type || file.type || "application/octet-stream",
      attachment_size_bytes: Number(file.size || 0) || null,
      local_preview_url: localPreviewUrl || null,
    };

    if (!isImageAttachmentType(state.attachment.attachment_type) && localPreviewUrl) {
      revokeAttachmentPreview({ local_preview_url: localPreviewUrl });
      state.attachment.local_preview_url = null;
    }
  }

  async function handleAttachmentSelection(event) {
    const file = event.target?.files?.[0];
    if (!file) return;

    try {
      await uploadAttachment(file);
      toast("Atașament încărcat.", "success");
    } catch (error) {
      if (state.attachment) revokeAttachmentPreview(state.attachment);
      state.attachment = null;
      toast(error.message || "Atașamentul nu a putut fi încărcat.", "error");
    } finally {
      state.attachmentUploading = false;
      renderAttachmentChip();
      if (els.attachmentInput) els.attachmentInput.value = "";
    }
  }

  function clearAttachment() {
    if (state.attachment) {
      revokeAttachmentPreview(state.attachment);
    }
    state.attachment = null;
    state.attachmentUploading = false;
    renderAttachmentChip();
    if (els.attachmentInput) els.attachmentInput.value = "";
  }

  function clearReply() {
    state.replyTo = null;
    renderReplyChip();
  }

  function addOptimisticMessage(payload) {
    const tempId = `tmp-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const optimistic = {
      id: tempId,
      conversation_id: state.activeConversationId,
      sender: state.user.username,
      content: payload.content,
      reply_to_id: payload.reply_to_id || null,
      attachment_key: payload.attachment_key || null,
      attachment_name: payload.attachment_name || null,
      attachment_type: payload.attachment_type || null,
      attachment_size_bytes: payload.attachment_size_bytes || null,
      created_at: new Date().toISOString(),
      __optimistic: true,
      __failed: false,
    };

    state.messages.push(optimistic);
    renderMessages(true);
    return tempId;
  }

  function replaceOptimisticMessage(tempId, actualMessage) {
    const idx = state.messages.findIndex((message) => String(message.id) === String(tempId));
    if (idx < 0) return;
    state.messages[idx] = actualMessage;
    renderMessages(true);
  }

  function markOptimisticFailed(tempId) {
    const idx = state.messages.findIndex((message) => String(message.id) === String(tempId));
    if (idx < 0) return;
    state.messages[idx].__failed = true;
    renderMessages(false);
  }

  function emitTyping() {
    if (!state.pusherReady || !state.conversationChannel || !state.activeConversationId) return;

    if (state.typingSendTimer) return;
    state.typingSendTimer = setTimeout(() => {
      state.typingSendTimer = null;
    }, 1200);

    try {
      state.conversationChannel.trigger("client-typing", {
        username: state.user.username,
      });
    } catch {
      // no-op
    }
  }

  function showTypingUser(username) {
    const name = String(username || "").trim();
    if (!name || name === state.user?.username) return;

    const existing = state.typingUsers.get(name);
    if (existing) clearTimeout(existing);

    const timeoutId = setTimeout(() => {
      state.typingUsers.delete(name);
      renderMessages(false);
    }, 3000);

    state.typingUsers.set(name, timeoutId);
    renderMessages(false);
  }

  async function sendMessage() {
    if (!state.activeConversationId || !state.activeConversation) return;
    if (state.attachmentUploading) {
      toast("Atașamentul se încarcă încă.", "info");
      return;
    }

    const content = String(els.composerInput?.value || "").trim();
    if (!content && !state.attachment) return;

    const payload = {
      content,
      reply_to_id: state.replyTo?.id ? Number(state.replyTo.id) : undefined,
      attachment_key: state.attachment?.attachment_key,
      attachment_name: state.attachment?.attachment_name,
      attachment_type: state.attachment?.attachment_type,
      attachment_size_bytes: state.attachment?.attachment_size_bytes,
    };

    const tempId = addOptimisticMessage(payload);

    if (els.composerInput) {
      els.composerInput.value = "";
      autoSizeComposer();
    }

    clearReply();
    clearAttachment();

    try {
      const result = await api(`/api/messaging/conversations/${state.activeConversationId}/messages`, {
        method: "POST",
        body: payload,
      });

      if (result?.message) {
        replaceOptimisticMessage(tempId, result.message);
        state.activeConversation.last_message = {
          id: result.message.id,
          sender: result.message.sender,
          content: result.message.content,
          created_at: result.message.created_at,
        };
        state.activeConversation.updated_at = result.message.created_at;
        upsertConversation(state.activeConversation);
        renderConversationList();
      }
    } catch (error) {
      markOptimisticFailed(tempId);
      toast(error.message || "Mesajul nu a putut fi trimis.", "error");
    }
  }

  function handleIncomingMessage(data) {
    if (!state.activeConversationId) return;
    const normalized = {
      id: Number(data.id),
      conversation_id: state.activeConversationId,
      sender: String(data.sender || ""),
      content: String(data.content || ""),
      reply_to_id: data.reply_to_id == null ? null : Number(data.reply_to_id),
      attachment_key: data.attachment_key || null,
      attachment_name: data.attachment_name || null,
      attachment_type: data.attachment_type || null,
      attachment_size_bytes: data.attachment_size_bytes || data.attachment_size || null,
      created_at: data.created_at || new Date().toISOString(),
    };

    const exists = state.messages.some((message) => String(message.id) === String(normalized.id));
    if (!exists) {
      state.messages.push(normalized);
      state.messages.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
      renderMessages(true);
    }

    if (normalized.sender !== state.user.username) {
      playNotificationTone();
    }

    state.activeConversation.last_message = {
      id: normalized.id,
      sender: normalized.sender,
      content: normalized.content,
      created_at: normalized.created_at,
    };
    state.activeConversation.updated_at = normalized.created_at;
    upsertConversation(state.activeConversation);
    renderConversationList();
  }

  function handleDeletedMessage(data) {
    const id = Number(data.id);
    const msg = state.messages.find((item) => Number(item.id) === id);
    if (!msg) return;
    msg.content = "Mesaj șters";
    msg.deleted_at = new Date().toISOString();
    msg.deleted_by = data.deleted_by || null;
    renderMessages(false);
  }

  function handlePinnedEvent(data) {
    if (!state.activeConversation) return;
    if (data.is_pinned && data.message_id) {
      const msg = state.messages.find((item) => Number(item.id) === Number(data.message_id));
      state.activeConversation.pinned_message = msg
        ? { id: msg.id, sender: msg.sender, content: msg.content, created_at: msg.created_at }
        : { id: Number(data.message_id), sender: "", content: "Mesaj fixat", created_at: new Date().toISOString() };
    } else {
      state.activeConversation.pinned_message = null;
    }
    renderPinnedBar(state.activeConversation);
  }

  function handleLockedEvent(data) {
    if (!state.activeConversation) return;
    state.activeConversation.is_locked = Boolean(data.is_locked);
    renderLockedBar(state.activeConversation);
    updateComposerState();
  }

  function unsubscribeConversationChannel() {
    if (state.pusher && state.conversationChannel) {
      try {
        state.pusher.unsubscribe(state.conversationChannel.name);
      } catch {
        // no-op
      }
    }
    state.conversationChannel = null;
  }

  function subscribeConversationChannel(conversationId) {
    if (!state.pusherReady || !state.pusher) return;

    unsubscribeConversationChannel();

    const channelName = `private-conversation-${conversationId}`;
    const channel = state.pusher.subscribe(channelName);

    channel.bind("message:new", handleIncomingMessage);
    channel.bind("message:deleted", handleDeletedMessage);
    channel.bind("message:pinned", handlePinnedEvent);
    channel.bind("conversation:locked", handleLockedEvent);
    channel.bind("client-typing", (data) => {
      showTypingUser(data?.username);
    });

    state.conversationChannel = channel;
  }

  function subscribeUserChannel() {
    if (!state.pusherReady || !state.pusher || !state.user?.username) return;

    if (state.userChannel) {
      try {
        state.pusher.unsubscribe(state.userChannel.name);
      } catch {
        // no-op
      }
      state.userChannel = null;
    }

    const channelName = `private-user-${String(state.user.username).toLowerCase()}`;
    const channel = state.pusher.subscribe(channelName);

    channel.bind("conversation:new", (conversation) => {
      upsertConversation(conversation);
      renderConversationList();
      renderUnreadBadge();
    });

    channel.bind("unread:update", (payload) => {
      const conversationId = Number(payload?.conversation_id || 0);
      const count = Number(payload?.count || 0);
      if (conversationId > 0) {
        const conversation = state.conversations.find((item) => Number(item.id) === conversationId);
        if (conversation) conversation.unread_count = count;
      }
      renderConversationList();
      renderUnreadBadge();
    });

    state.userChannel = channel;
  }

  function stopPolling() {
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer);
      state.pollingTimer = null;
    }
  }

  function startPollingFallback() {
    stopPolling();
    state.usingPolling = true;
    state.pollingTimer = setInterval(async () => {
      try {
        await refreshConversations();
        if (state.activeConversationId) {
          await refreshActiveMessages();
        }
      } catch {
        // silent
      }
    }, POLL_INTERVAL_MS);
  }

  function loadPusherScript() {
    return new Promise((resolve, reject) => {
      if (window.Pusher) {
        resolve(window.Pusher);
        return;
      }

      const existing = document.querySelector(`script[src="${PUSHER_CDN}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve(window.Pusher));
        existing.addEventListener("error", () => reject(new Error("Pusher script failed to load")));
        return;
      }

      const script = document.createElement("script");
      script.src = PUSHER_CDN;
      script.async = true;
      script.onload = () => resolve(window.Pusher);
      script.onerror = () => reject(new Error("Pusher script failed to load"));
      document.head.appendChild(script);
    });
  }

  async function initRealtime() {
    const pusherKey = String(window.__PUSHER_KEY__ || "").trim();
    const pusherCluster = String(window.__PUSHER_CLUSTER__ || "eu").trim() || "eu";

    if (!pusherKey) {
      startPollingFallback();
      return;
    }

    try {
      const PusherCtor = await loadPusherScript();
      if (!PusherCtor) throw new Error("Pusher constructor unavailable");

      state.pusher = new PusherCtor(pusherKey, {
        cluster: pusherCluster,
        authEndpoint: "/api/messaging/pusher/auth",
        authTransport: "ajax",
      });

      state.pusherReady = true;
      state.usingPolling = false;
      subscribeUserChannel();
      if (state.activeConversationId) {
        subscribeConversationChannel(state.activeConversationId);
      }
    } catch (error) {
      console.warn("Pusher unavailable, switching to polling.", error);
      startPollingFallback();
    }
  }

  function scheduleConversationRefresh() {
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      refreshConversations().catch(() => {});
    }, 350);
  }

  async function updateTopic() {
    if (!state.activeConversationId || !state.activeConversation) return;

    const nextTitle = window.prompt("Titlu conversație", state.activeConversation.title || "");
    if (nextTitle == null) return;

    const nextTopic = window.prompt("Subiect / descriere", state.activeConversation.topic || "");
    if (nextTopic == null) return;

    const data = await api(`/api/messaging/conversations/${state.activeConversationId}`, {
      method: "POST",
      body: {
        action: "update",
        title: nextTitle,
        topic: nextTopic,
      },
    });

    state.activeConversation = data.conversation;
    upsertConversation(data.conversation);
    setActiveConversationHeader(data.conversation);
    renderConversationList();
    toast("Conversație actualizată.", "success");
  }

  async function toggleLock() {
    if (!state.activeConversationId || !state.activeConversation) return;
    const action = state.activeConversation.is_locked ? "unlock" : "lock";

    const data = await api(`/api/messaging/conversations/${state.activeConversationId}`, {
      method: "POST",
      body: { action },
    });

    state.activeConversation = data.conversation;
    upsertConversation(data.conversation);
    renderLockedBar(data.conversation);
    setActiveConversationHeader(data.conversation);
    updateComposerState();
    renderConversationList();
  }

  async function deleteActiveConversation() {
    if (!state.activeConversationId) return;
    if (!window.confirm("Ștergi definitiv această conversație?")) return;

    await api(`/api/messaging/conversations/${state.activeConversationId}`, {
      method: "POST",
      body: { action: "delete" },
    });

    removeConversation(state.activeConversationId);
    state.activeConversationId = null;
    state.activeConversation = null;
    state.messages = [];
    state.nextMessagesCursor = null;
    unsubscribeConversationChannel();

    renderConversationList();
    renderUnreadBadge();
    setActiveConversationHeader(null);
    renderPinnedBar(null);
    renderLockedBar(null);
    updateComposerState();
    renderMessages(false);
    setMobileView("list", { pushHistory: true });
  }

  function performMessageSearch() {
    if (!state.messages.length) {
      toast("Nu există mesaje în conversație.", "info");
      return;
    }

    const query = window.prompt("Caută în mesaje");
    if (!query) return;

    const lower = query.toLowerCase();
    const found = state.messages.find((message) => String(message.content || "").toLowerCase().includes(lower));
    if (!found) {
      toast("Niciun rezultat.", "info");
      return;
    }

    const target = document.getElementById(`msg-${found.id}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("new");
      setTimeout(() => target.classList.remove("new"), 900);
    }
  }

  function showConversationInfo() {
    if (!state.activeConversation) return;
    const participants = Array.isArray(state.activeConversation.participants)
      ? state.activeConversation.participants.map((p) => p.username).join(", ")
      : "-";

    window.alert(`Conversație: ${state.activeConversation.title || "-"}\nTip: ${state.activeConversation.type}\nVizibilitate: ${state.activeConversation.scope}\nParticipanți: ${participants}`);
  }

  function autoSizeComposer() {
    if (!els.composerInput) return;
    els.composerInput.style.height = "auto";
    const nextHeight = Math.min(els.composerInput.scrollHeight, 180);
    els.composerInput.style.height = `${Math.max(nextHeight, 44)}px`;
  }

  function updateViewportForKeyboard() {
    if (!isMobile() || !window.visualViewport || !els.composerDock) return;
    const vv = window.visualViewport;
    const keyboardOffset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    els.composerDock.style.transform = `translateY(-${keyboardOffset}px)`;
    if (keyboardOffset > 0) {
      scrollMessagesToBottom();
    }
  }

  function resetViewportKeyboardOffset() {
    if (!els.composerDock) return;
    els.composerDock.style.transform = "translateY(0)";
  }

  function closeActionSheet() {
    if (!els.messageActionSheet) return;
    els.messageActionSheet.classList.remove("show");
    state.actionMessage = null;
  }

  function openActionSheet(message) {
    if (!els.messageActionSheet || !message || !state.activeConversation) return;

    const ownMessage = String(message.sender || "") === String(state.user?.username || "");
    const canDelete = ownMessage || canModerateAnyInConversation(state.activeConversation);
    const canPin = canPinInConversation(state.activeConversation);

    if (els.actionDelete) els.actionDelete.style.display = canDelete ? "block" : "none";
    if (els.actionPin) els.actionPin.style.display = canPin ? "block" : "none";

    state.actionMessage = message;
    els.messageActionSheet.classList.add("show");
  }

  function bindLongPressHandlers() {
    if (!els.messagesScroll) return;

    const cancelLongPress = () => {
      if (state.longPressTimer) {
        clearTimeout(state.longPressTimer);
        state.longPressTimer = null;
      }
    };

    els.messagesScroll.addEventListener("touchstart", (event) => {
      const row = event.target.closest("[data-msg-id]");
      if (!row) return;
      const id = String(row.dataset.msgId || "");
      const message = state.messages.find((item) => String(item.id) === id);
      if (!message) return;

      state.longPressTimer = setTimeout(() => {
        openActionSheet(message);
      }, 420);
    }, { passive: true });

    ["touchend", "touchcancel", "touchmove", "scroll"].forEach((evt) => {
      els.messagesScroll.addEventListener(evt, cancelLongPress, { passive: true });
    });
  }

  function bindPullToRefresh() {
    if (!els.conversationList || !els.pullRefreshIndicator) return;

    const onStart = (event) => {
      if (!isMobile()) return;
      if (els.conversationList.scrollTop > 0) return;
      state.pullActive = true;
      state.pullStartY = event.touches[0].clientY;
      state.pullDeltaY = 0;
    };

    const onMove = (event) => {
      if (!state.pullActive) return;
      const currentY = event.touches[0].clientY;
      const delta = Math.max(0, currentY - state.pullStartY);
      state.pullDeltaY = delta;
      if (delta > 6) {
        els.pullRefreshIndicator.classList.add("show");
        els.pullRefreshIndicator.style.transform = `translateY(${Math.min(delta, 58)}px)`;
      }
    };

    const onEnd = async () => {
      if (!state.pullActive) return;
      const shouldRefresh = state.pullDeltaY > 70;
      state.pullActive = false;
      state.pullDeltaY = 0;
      els.pullRefreshIndicator.style.transform = "translateY(0)";
      els.pullRefreshIndicator.classList.remove("show");
      if (!shouldRefresh) return;

      try {
        await refreshConversations();
        if (state.activeConversationId) {
          await refreshActiveMessages();
        }
        toast("Actualizat.", "success");
      } catch (error) {
        toast(error.message || "Nu am putut actualiza.", "error");
      }
    };

    els.conversationList.addEventListener("touchstart", onStart, { passive: true });
    els.conversationList.addEventListener("touchmove", onMove, { passive: true });
    els.conversationList.addEventListener("touchend", onEnd, { passive: true });
    els.conversationList.addEventListener("touchcancel", onEnd, { passive: true });
  }

  function bindSidebarAndTopbarNavigation() {
    document.querySelectorAll("[data-nav-home], [data-mobile-home]").forEach((node) => {
      node.addEventListener("click", () => {
        window.location.href = "/";
      });
    });

    document.querySelectorAll("[data-nav-module][data-module-target]").forEach((node) => {
      node.addEventListener("click", () => {
        const target = String(node.dataset.moduleTarget || "");
        if (!target) return;
        window.location.href = `/?module=${encodeURIComponent(target)}`;
      });
    });

    document.querySelectorAll("[data-nav-messaging]").forEach((node) => {
      node.addEventListener("click", () => {
        window.location.href = "/messaging";
      });
    });

    const moreLinks = [
      ["#tabMore", "/?module=moduleContacts"],
      ["[data-go-profile]", "/profile"],
    ];

    for (const [selector, href] of moreLinks) {
      document.querySelectorAll(selector).forEach((node) => {
        node.addEventListener("click", () => {
          window.location.href = href;
        });
      });
    }
  }

  async function handleLogout() {
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
    } catch {
      // ignore logout errors; always redirect
    }
    window.location.href = "/";
  }

  function playNotificationTone() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
      gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.12);
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.14);
    } catch {
      // ignore
    }
  }

  async function handleDeepLinks() {
    const params = new URLSearchParams(window.location.search);
    const tab = String(params.get("tab") || "").toLowerCase();
    if (tab === "boards") state.filter = "board";
    if (tab === "announcements") state.filter = "announcement";
    if (els.filterRow) {
      els.filterRow.querySelectorAll("[data-filter]").forEach((node) => {
        node.classList.toggle("active", node.dataset.filter === state.filter);
      });
    }

    const dmUsername = String(params.get("dm") || "").trim().toLowerCase();
    if (dmUsername) {
      try {
        const response = await api("/api/messaging/conversations", {
          method: "POST",
          body: { type: "dm", participants: [dmUsername] },
        });
        const conversation = response?.conversation;
        if (conversation?.id) {
          upsertConversation(conversation);
          await openConversation(conversation.id, { pushHistory: false, forceScrollBottom: true });
          return;
        }
      } catch (error) {
        toast(error.message || "Nu am putut deschide DM.", "error");
      }
    }

    const convId = Number(params.get("conv") || 0);
    if (Number.isInteger(convId) && convId > 0) {
      try {
        await openConversation(convId, { pushHistory: false, forceScrollBottom: false });
      } catch (error) {
        toast(error.message || "Conversația nu a putut fi deschisă.", "error");
      }
    }
  }

  function bindEvents() {
    els.topThemeToggleBtn?.addEventListener("click", toggleTheme);
    els.themeToggleBtn?.addEventListener("click", toggleTheme);

    els.sidebarToggleBtn?.addEventListener("click", () => {
      const next = !document.body.classList.contains("sidebar-collapsed");
      document.body.classList.toggle("sidebar-collapsed", next);
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
    });

    els.conversationSearch?.addEventListener("input", (event) => {
      state.search = String(event.target.value || "");
      renderConversationList();
    });

    els.filterRow?.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-filter]");
      if (!chip) return;
      state.filter = chip.dataset.filter || "all";
      els.filterRow.querySelectorAll("[data-filter]").forEach((node) => {
        node.classList.toggle("active", node === chip);
      });
      scheduleConversationRefresh();
      renderConversationList();
    });

    els.conversationList?.addEventListener("click", (event) => {
      const item = event.target.closest("[data-conversation-id]");
      if (!item) return;
      const id = Number(item.dataset.conversationId || 0);
      if (!id) return;
      openConversation(id, { pushHistory: true, forceScrollBottom: true }).catch((error) => {
        toast(error.message || "Conversația nu s-a putut deschide.", "error");
      });
    });

    els.createConversationBtn?.addEventListener("click", openNewConversationModal);
    els.mobileCreateBtn?.addEventListener("click", openNewConversationModal);
    els.newConversationClose?.addEventListener("click", closeNewConversationModal);
    els.newConversationModal?.addEventListener("click", (event) => {
      if (event.target === els.newConversationModal) closeNewConversationModal();
    });

    els.convTypeSelect?.addEventListener("change", updateConversationTypeFields);
    els.newConversationForm?.addEventListener("submit", (event) => {
      createConversationFromModal(event).catch((error) => {
        toast(error.message || "Conversația nu a putut fi creată.", "error");
      });
    });

    els.chatBackBtn?.addEventListener("click", () => {
      if (isMobile()) {
        history.back();
      }
    });

    els.btnEditTopic?.addEventListener("click", () => {
      updateTopic().catch((error) => toast(error.message || "Nu s-a putut actualiza.", "error"));
    });

    els.btnToggleLock?.addEventListener("click", () => {
      toggleLock().catch((error) => toast(error.message || "Nu s-a putut schimba starea lock.", "error"));
    });

    els.btnDeleteConversation?.addEventListener("click", () => {
      deleteActiveConversation().catch((error) => toast(error.message || "Nu s-a putut șterge conversația.", "error"));
    });

    els.btnSearchMessages?.addEventListener("click", performMessageSearch);
    els.btnInfoConversation?.addEventListener("click", showConversationInfo);

    els.attachBtn?.addEventListener("click", () => {
      if (els.attachmentInput) els.attachmentInput.click();
    });

    els.attachmentInput?.addEventListener("change", (event) => {
      handleAttachmentSelection(event).catch((error) => {
        toast(error.message || "Nu s-a putut încărca fișierul.", "error");
      });
    });

    els.removeAttachmentBtn?.addEventListener("click", clearAttachment);
    els.cancelReplyBtn?.addEventListener("click", clearReply);

    els.sendBtn?.addEventListener("click", () => {
      sendMessage().catch((error) => toast(error.message || "Nu s-a putut trimite mesajul.", "error"));
    });

    els.composerInput?.addEventListener("input", () => {
      autoSizeComposer();
      emitTyping();
    });

    els.composerInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage().catch((error) => toast(error.message || "Nu s-a putut trimite mesajul.", "error"));
      }
    });

    els.messagesScroll?.addEventListener("scroll", () => {
      if (els.messagesScroll.scrollTop < 80) {
        loadOlderMessages().catch(() => {});
      }
    });

    els.messagesScroll?.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-open-image]");
      if (!trigger) return;
      const src = String(trigger.dataset.openImage || "").trim();
      if (!src) return;
      openImageLightbox(src, String(trigger.dataset.imageName || "").trim());
    });

    els.imageLightboxClose?.addEventListener("click", closeImageLightbox);
    els.imageLightbox?.addEventListener("click", (event) => {
      if (event.target === els.imageLightbox) {
        closeImageLightbox();
      }
    });

    bindLongPressHandlers();
    bindPullToRefresh();

    els.actionReply?.addEventListener("click", () => {
      if (!state.actionMessage) return;
      state.replyTo = {
        id: state.actionMessage.id,
        sender: state.actionMessage.sender,
        content: state.actionMessage.content,
      };
      renderReplyChip();
      closeActionSheet();
      els.composerInput?.focus();
    });

    els.actionCopy?.addEventListener("click", async () => {
      if (!state.actionMessage) return;
      try {
        await navigator.clipboard.writeText(String(state.actionMessage.content || ""));
        toast("Mesaj copiat.", "success");
      } catch {
        toast("Nu s-a putut copia mesajul.", "error");
      }
      closeActionSheet();
    });

    els.actionPin?.addEventListener("click", () => {
      if (!state.actionMessage || !state.activeConversationId) return;
      const alreadyPinned = Boolean(state.actionMessage.is_pinned);
      const payload = alreadyPinned
        ? { action: "unpin" }
        : { action: "pin", message_id: state.actionMessage.id };
      api(`/api/messaging/conversations/${state.activeConversationId}/pin`, {
        method: "POST",
        body: payload,
      })
        .then((result) => {
          if (result?.conversation) {
            state.activeConversation = { ...state.activeConversation, ...result.conversation };
            renderPinnedBar(state.activeConversation);
          }
        })
        .catch((error) => toast(error.message || "Nu s-a putut fixa mesajul.", "error"))
        .finally(closeActionSheet);
    });

    els.actionDelete?.addEventListener("click", () => {
      if (!state.actionMessage || !state.activeConversationId) return;
      api(`/api/messaging/conversations/${state.activeConversationId}/moderate`, {
        method: "POST",
        body: { message_id: state.actionMessage.id },
      })
        .then((result) => {
          if (result?.message) {
            handleDeletedMessage({ id: result.message.id, deleted_by: result.message.deleted_by });
          }
        })
        .catch((error) => toast(error.message || "Nu s-a putut șterge mesajul.", "error"))
        .finally(closeActionSheet);
    });

    els.actionCancel?.addEventListener("click", closeActionSheet);

    document.addEventListener("click", (event) => {
      if (els.messageActionSheet?.classList.contains("show")) {
        const isInsideSheet = event.target.closest("#messageActionSheet");
        const isMessageRow = event.target.closest("[data-msg-id]");
        if (!isInsideSheet && !isMessageRow) closeActionSheet();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && els.imageLightbox?.classList.contains("show")) {
        closeImageLightbox();
      }
    });

    window.addEventListener("popstate", async () => {
      if (!isMobile()) return;
      const params = new URLSearchParams(window.location.search);
      const conv = Number(params.get("conv") || 0);
      if (Number.isInteger(conv) && conv > 0) {
        try {
          await openConversation(conv, { pushHistory: false, forceScrollBottom: false });
        } catch {
          setMobileView("list", { pushHistory: false });
        }
        return;
      }
      setMobileView("list", { pushHistory: false });
    });

    window.addEventListener("resize", () => {
      if (!isMobile()) {
        document.body.classList.remove("mobile-chat-open");
      }
      updateViewportForKeyboard();
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateViewportForKeyboard);
      window.visualViewport.addEventListener("scroll", updateViewportForKeyboard);
    }

    els.composerInput?.addEventListener("focus", updateViewportForKeyboard);
    els.composerInput?.addEventListener("blur", resetViewportKeyboardOffset);

    els.mobileSearchBtn?.addEventListener("click", () => {
      els.conversationSearch?.focus();
    });

    els.logoutBtn?.addEventListener("click", () => {
      handleLogout().catch(() => {});
    });
    els.railLogoutBtn?.addEventListener("click", () => {
      handleLogout().catch(() => {});
    });

    bindSidebarAndTopbarNavigation();
  }

  async function boot() {
    try {
      applyTheme(parseTheme());
      const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
      document.body.classList.toggle("sidebar-collapsed", collapsed);
      bindEvents();
      fillResidentDatalist();

      await loadCurrentUser();
      initRoleBasedOptions();
      updateConversationTypeFields();

      await refreshConversations();
      if (state.messagingUnavailable) {
        showStatus("Mesageria nu este inițializată încă. Rulează migrarea pentru tabelul msg_*.", true);
      }
      await handleDeepLinks();
      await initRealtime();

      if (!state.activeConversationId) {
        setActiveConversationHeader(null);
        renderPinnedBar(null);
        renderLockedBar(null);
        updateComposerState();
        renderMessages(false);
      }

      renderUnreadBadge();
      hydrateIcons();
      if (!state.messagingUnavailable) {
        showStatus("");
      }
    } catch (error) {
      const message = error?.status === 401
        ? "Sesiunea a expirat. Te redirecționăm spre autentificare..."
        : (error.message || "Nu am putut încărca modulul Mesaje.");
      showStatus(message, true);
      toast(message, "error");
      if (error?.status === 401) {
        setTimeout(() => {
          window.location.href = "/";
        }, 1200);
      }
    }
  }

  document.addEventListener("DOMContentLoaded", boot);

  window.showContacts = function showContacts() {
    window.location.href = "/?module=moduleContacts";
  };

  window.showRecomandari = function showRecomandari() {
    window.location.href = "/?module=moduleRecomandari";
  };

  window.toggleMoreDrawer = function toggleMoreDrawer() {
    window.location.href = "/?module=moduleContacts";
  };
})();
