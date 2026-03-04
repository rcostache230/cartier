(() => {
  document.addEventListener("DOMContentLoaded", async () => {
    const badges = ["msg-unread-badge", "msg-unread-badge-mobile", "mobileMessagesBadge"]
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    if (!badges.length) return;

    const paint = (n) => {
      const total = Math.max(0, Number(n || 0));
      const text = total > 99 ? "99+" : String(total);
      badges.forEach((badge) => {
        badge.textContent = text;
        badge.style.display = total > 0 ? "inline-flex" : "none";
      });
    };

    const fetchUnread = async () => {
      const res = await fetch("/api/messaging/unread", { credentials: "same-origin" }).catch(() => null);
      if (!res || !res.ok) return;
      const data = await res.json().catch(() => ({}));
      paint(data?.total || 0);
    };

    const key = typeof PUSHER_KEY !== "undefined" ? String(PUSHER_KEY || "").trim() : "";
    let username = typeof USERNAME !== "undefined" ? String(USERNAME || "").trim().toLowerCase() : "";
    if (!username) username = String(window.currentUser?.username || "").trim().toLowerCase();
    if (!username) {
      const me = await fetch("/api/auth/me", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      username = String(me?.user?.username || "").trim().toLowerCase();
    }

    await fetchUnread();
    if (key && username && window.Pusher) {
      try {
        new window.Pusher(key, { cluster: "eu", authEndpoint: "/api/messaging/pusher/auth" })
          .subscribe(`private-user-${username}`)
          .bind("unread:update", (payload) => paint(payload?.total || 0));
        return;
      } catch {}
    }
    setInterval(fetchUnread, 30000);
  });
})();
