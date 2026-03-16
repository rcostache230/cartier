/* parking.js — extracted Parking module logic */

const ParkingModule = (() => {
  let refreshDashboardPromise = null;

  function bindParkingElements() {
    const ids = {
      parkingModule: "parkingModule",
      parkingModeBanner: "parkingModeBanner",
      stats: "stats",
      sharedSpots: "sharedSpots",
      sharedSpotsTableWrap: "sharedSpotsTableWrap",
      sharedSpotsEmpty: "sharedSpotsEmpty",
      sharedSpotsCards: "sharedSpotsCards",
      myShared: "myShared",
      mySharedTableWrap: "mySharedTableWrap",
      mySharedEmpty: "mySharedEmpty",
      mySharedCards: "mySharedCards",
      claimedOnMine: "claimedOnMine",
      claimedOnMineTableWrap: "claimedOnMineTableWrap",
      claimedOnMineEmpty: "claimedOnMineEmpty",
      claimedOnMineCards: "claimedOnMineCards",
      myClaimed: "myClaimed",
      myClaimedTableWrap: "myClaimedTableWrap",
      myClaimedEmpty: "myClaimedEmpty",
      myClaimedCards: "myClaimedCards",
      countFree: "countFree",
      countShared: "countShared",
      countClaimedByOthers: "countClaimedByOthers",
      countMyClaims: "countMyClaims",
      kpiFree: "kpiFree",
      kpiShared: "kpiShared",
      kpiClaimedByOthers: "kpiClaimedByOthers",
      kpiMyClaims: "kpiMyClaims",
      availableSlot: "availableSlot",
    };
    Object.entries(ids).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el) {
        els[key] = el;
      }
    });
  }

  function parkingTypeShort(type) {
    if (type === "underground") return "UG";
    if (type === "above_ground") return "AG";
    return String(type || "-");
  }

  function parkingTypeWithIcon(type) {
    return `🅿 ${parkingTypeShort(type)}`;
  }

  function parkingStatusBadge(status, label = "") {
    const normalized = String(status || "")
      .trim()
      .toLowerCase();
    const badgeClass =
      normalized === "open" || normalized === "free"
        ? "free"
        : normalized === "claimed" || normalized === "reserved"
          ? "claimed"
          : normalized === "pending"
            ? "pending"
            : normalized === "expired"
              ? "expired"
              : normalized === "full" || normalized === "closed"
                ? "expired"
                : "default";
    const text = label || titleize(normalized || "status");
    return `<span class="parking-status-badge ${badgeClass}">${text}</span>`;
  }

  function renderParkingEmptyRow(colspan, message) {
    return `<tr class="parking-empty-row"><td colspan="${colspan}"><span class="parking-empty-inline">${iconMarkup("circle-off")}<span>${message}</span></span></td></tr>`;
  }

  function renderParkingEmptyCard(message) {
    return `<div class="parking-empty">${iconMarkup("car-front")}<span>${message}</span></div>`;
  }

  function updateCapacitySelectionHighlight() {
    bindParkingElements();
    if (!els.stats) return;
    const selectedBuilding = String(document.getElementById("claimBuilding")?.value || "");
    els.stats.querySelectorAll(".capacity-card").forEach((card) => {
      const isSelected =
        selectedBuilding && String(card.dataset.buildingNumber || "") === selectedBuilding;
      card.classList.toggle("is-selected", Boolean(isSelected));
      card.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });
  }

  function showCapacitySkeleton() {
    bindParkingElements();
    if (!els.stats) return;
    els.stats.innerHTML = Array.from({ length: 4 })
      .map(
        () => `
          <article class="capacity-card capacity-skeleton" aria-hidden="true">
            <div class="capacity-skeleton-line" style="width:44%"></div>
            <div class="capacity-skeleton-line mt-10"></div>
            <div class="capacity-skeleton-line" style="margin-top:8px; width:70%"></div>
          </article>
        `
      )
      .join("");
  }

  function refreshStats(stats) {
    bindParkingElements();
    currentBuildingStats = Array.isArray(stats) ? stats : [];
    if (!els.stats) return;
    if (!currentBuildingStats.length) {
      els.stats.innerHTML = `<div class="parking-empty">${iconMarkup("info")}<span>Nu există date de capacitate.</span></div>`;
      return;
    }

    els.stats.innerHTML = currentBuildingStats
      .map((s) => {
        const open = Number(s.open_shared_slots || 0);
        const reserved = Number(s.reserved_shared_slots || 0);
        const total = Number(s.underground_spaces || 0) + Number(s.above_ground_spaces || 0);
        const availabilityClass = open > 0 ? "available" : "unavailable";
        const selectedBuilding = String(document.getElementById("claimBuilding")?.value || "");
        const isSelected = selectedBuilding === String(s.building_number);

        const hasOpenUnderground = currentFreeSpots.some(
          (slot) =>
            String(slot.building_number) === String(s.building_number) &&
            slot.parking_type === "underground" &&
            String(slot.status || "OPEN").toUpperCase() === "OPEN"
        );
        const hasOpenAboveGround = currentFreeSpots.some(
          (slot) =>
            String(slot.building_number) === String(s.building_number) &&
            slot.parking_type === "above_ground" &&
            String(slot.status || "OPEN").toUpperCase() === "OPEN"
        );

        return `
          <article
            class="capacity-card ${availabilityClass} ${isSelected ? "is-selected" : ""}"
            data-building-number="${s.building_number}"
            role="button"
            tabindex="0"
            aria-label="Filter claims for Bloc ${s.building_number}"
            aria-pressed="${isSelected ? "true" : "false"}"
          >
            <div class="capacity-meta">
              <b>Bloc ${s.building_number}</b>
              <span class="availability ${availabilityClass}">
                ${open > 0 ? `${open} disponibil` : "indisponibil"}
              </span>
            </div>
            <div class="capacity-type-line">
              <div class="capacity-type">
                <span>UG ${Number(s.underground_spaces || 0)}</span>
                <span class="capacity-spot-indicator ${hasOpenUnderground ? "available" : "full"}">
                  ${hasOpenUnderground ? "disponibil" : "plin"}
                </span>
              </div>
              <div class="capacity-type">
                <span>AG ${Number(s.above_ground_spaces || 0)}</span>
                <span class="capacity-spot-indicator ${hasOpenAboveGround ? "available" : "full"}">
                  ${hasOpenAboveGround ? "disponibil" : "plin"}
                </span>
              </div>
            </div>
            <div class="capacity-help">Utilizare partajată ${open + reserved}/${total || 0}. Apasă pentru a rezerva.</div>
          </article>
        `;
      })
      .join("");
    updateCapacitySelectionHighlight();
  }

  function refreshTables(data) {
    bindParkingElements();
    if (!els.sharedSpots || !els.availableSlot) return;
    const freeSpots = data.shared_parking_spots || [];
    const myShared = data.my_shared_parking_spots || [];
    const claimedByOthers = data.my_shared_claimed_by_neighbours || [];
    const myClaims = data.my_claimed_parking_spots || [];
    if (Array.isArray(data.building_stats)) {
      currentBuildingStats = data.building_stats;
    }
    currentFreeSpots = freeSpots;
    currentClaimsOnMine = claimedByOthers;
    currentMyClaims = myClaims;

    els.sharedSpots.innerHTML = freeSpots
      .map(
        (s) =>
          `<tr>
            <td>${parkingStatusBadge("free", "Free")}</td>
            ${td(s.building_number)}
            ${td(s.parking_space_number)}
            ${td(parkingTypeWithIcon(s.parking_type))}
            ${td(s.owner_username)}
            ${td(s.owner_phone_number || "-")}
            ${td(formatBucharestDateTime(s.available_from))}
            ${td(formatBucharestDateTime(s.available_until))}
            <td><button type="button" class="table-action-btn alt quick-claim-btn" data-slot-id="${s.id}">Rezervă</button></td>
          </tr>`
      )
      .join("");
    els.sharedSpotsTableWrap.classList.toggle("hidden", !freeSpots.length);
    els.sharedSpotsEmpty.classList.toggle("hidden", Boolean(freeSpots.length));

    els.myShared.innerHTML = myShared
      .map(
        (s) =>
          `<tr>${td(s.parking_space_number)}${td(parkingTypeWithIcon(s.parking_type))}${td(parkingStatusBadge(s.status || "open"))}${td(formatBucharestDateTime(s.available_from))}${td(formatBucharestDateTime(s.available_until))}</tr>`
      )
      .join("");
    els.mySharedTableWrap.classList.toggle("hidden", !myShared.length);
    els.mySharedEmpty.classList.toggle("hidden", Boolean(myShared.length));

    els.claimedOnMine.innerHTML = claimedByOthers
      .map(
        (s) =>
          `<tr>${td(s.parking_space_number)}${td(s.reserved_by_username)}${td(s.reservation_contact_phone || s.reserved_by_phone_number || "-")}${td(formatBucharestDateTime(s.reservation_from))}${td(formatBucharestDateTime(s.reservation_until))}</tr>`
      )
      .join("");
    els.claimedOnMineTableWrap.classList.toggle("hidden", !claimedByOthers.length);
    els.claimedOnMineEmpty.classList.toggle("hidden", Boolean(claimedByOthers.length));

    els.myClaimed.innerHTML = myClaims
      .map(
        (s) =>
          `<tr>${td(s.building_number)}${td(s.parking_space_number)}${td(s.owner_username)}${td(s.owner_phone_number || "-")}${td(s.reservation_contact_phone || s.reserved_by_phone_number || "-")}${td(formatBucharestDateTime(s.reservation_from))}${td(formatBucharestDateTime(s.reservation_until))}</tr>`
      )
      .join("");
    els.myClaimedTableWrap.classList.toggle("hidden", !myClaims.length);
    els.myClaimedEmpty.classList.toggle("hidden", Boolean(myClaims.length));

    els.sharedSpotsCards.innerHTML = freeSpots.length
      ? freeSpots
          .map(
            (s) => `
              <article class="parking-spot-card card status-free">
                <div class="parking-spot-head">
                  <span class="spot-number-badge">${parkingTypeWithIcon(s.parking_type)} · ${s.parking_space_number}</span>
                  ${parkingStatusBadge("free", "Liber")}
                </div>
                <div class="parking-spot-meta">
                  <div><strong>Bloc ${s.building_number}</strong> · ${s.owner_username}</div>
                  <div>Contact: ${s.owner_phone_number || "-"}</div>
                  <div>${formatBucharestDateTime(s.available_from)} - ${formatBucharestDateTime(s.available_until)}</div>
                </div>
                <div class="parking-card-action">
                  <button type="button" class="table-action-btn alt quick-claim-btn" data-slot-id="${s.id}">Rezervă</button>
                </div>
              </article>
            `
          )
          .join("")
      : renderParkingEmptyCard("Nu există locuri disponibile acum. Revino mai târziu.");

    els.mySharedCards.innerHTML = myShared.length
      ? myShared
          .map(
            (s) => `
              <article class="parking-spot-card card ${String(s.status || "open").toLowerCase() === "open" ? "status-free" : "status-expired"}">
                <div class="parking-spot-head">
                  <span class="spot-number-badge">${parkingTypeWithIcon(s.parking_type)} · ${s.parking_space_number}</span>
                  ${parkingStatusBadge(s.status || "open")}
                </div>
                <div class="parking-spot-meta">
                  <div>${formatBucharestDateTime(s.available_from)} - ${formatBucharestDateTime(s.available_until)}</div>
                </div>
              </article>
            `
          )
          .join("")
      : renderParkingEmptyCard("Nu ai oferit încă niciun loc.");

    els.claimedOnMineCards.innerHTML = claimedByOthers.length
      ? claimedByOthers
          .map(
            (s) => `
              <article class="parking-spot-card card status-claimed">
                <div class="parking-spot-head">
                  <span class="spot-number-badge">${parkingTypeWithIcon(s.parking_type)} · ${s.parking_space_number}</span>
                  ${parkingStatusBadge("claimed", "Rezervat")}
                </div>
                <div class="parking-spot-meta">
                  <div>De: ${s.reserved_by_username}</div>
                  <div>Contact: ${s.reservation_contact_phone || s.reserved_by_phone_number || "-"}</div>
                  <div>${formatBucharestDateTime(s.reservation_from)} - ${formatBucharestDateTime(s.reservation_until)}</div>
                </div>
              </article>
            `
          )
          .join("")
      : renderParkingEmptyCard("Niciun loc al tău nu a fost rezervat.");

    els.myClaimedCards.innerHTML = myClaims.length
      ? myClaims
          .map(
            (s) => `
              <article class="parking-spot-card card status-claimed">
                <div class="parking-spot-head">
                  <span class="spot-number-badge">${parkingTypeWithIcon(s.parking_type)} · ${s.parking_space_number}</span>
                  ${parkingStatusBadge("claimed", "Rezervat")}
                </div>
                <div class="parking-spot-meta">
                  <div>Bloc ${s.building_number} · Proprietar ${s.owner_username}</div>
                  <div>Telefon proprietar: ${s.owner_phone_number || "-"}</div>
                  <div>Telefon rezervare: ${s.reservation_contact_phone || s.reserved_by_phone_number || "-"}</div>
                  <div>${formatBucharestDateTime(s.reservation_from)} - ${formatBucharestDateTime(s.reservation_until)}</div>
                </div>
              </article>
            `
          )
          .join("")
      : renderParkingEmptyCard("Nu ai rezervat încă niciun loc.");

    els.countFree.textContent = String(freeSpots.length);
    els.countShared.textContent = String(myShared.length);
    els.countClaimedByOthers.textContent = String(claimedByOthers.length);
    els.countMyClaims.textContent = String(myClaims.length);
    animateCounter(els.kpiFree, freeSpots.length);
    animateCounter(els.kpiShared, myShared.length);
    animateCounter(els.kpiClaimedByOthers, claimedByOthers.length);
    animateCounter(els.kpiMyClaims, myClaims.length);
    moduleQuickStats.freeSpots = freeSpots.length;
    renderQuickStats();
    refreshStats(currentBuildingStats);
    refreshHomeActivity();

    const parkingModuleEl = document.getElementById("parkingModule");
    if (parkingModuleEl) {
      decorateDynamicActionIcons(parkingModuleEl);
    }
  }

  function fillAvailableSpotSelect(slots) {
    bindParkingElements();
    if (!els.availableSlot) return;
    els.availableSlot.innerHTML = "";
    if (slots.length === 0) {
      els.availableSlot.appendChild(option("", "Nu există locuri libere pentru filtrul selectat"));
      els.availableSlot.disabled = true;
      return;
    }

    els.availableSlot.disabled = false;
    slots.forEach((slot) => {
      const label = `Bloc ${slot.building_number} | ${slot.parking_space_number} (${slot.parking_type}) - ${slot.owner_username}${slot.owner_phone_number ? ` / ${slot.owner_phone_number}` : ""}`;
      els.availableSlot.appendChild(option(String(slot.id), label));
    });
    syncClaimPeriodToSelection();
  }

  function syncClaimPeriodToSelection() {
    const slotId = Number(els.availableSlot.value || 0);
    const slot = currentOpenSlots.find((s) => s.id === slotId);
    if (!slot) return;
    document.getElementById("claimFrom").value = slot.available_from;
    document.getElementById("claimUntil").value = slot.available_until;
  }

  function deriveOpenSpotOptionsFromDashboard() {
    if (!currentUser) return [];
    const building = document.getElementById("claimBuilding").value;
    const type = document.getElementById("claimType").value;
    return currentFreeSpots.filter((slot) => {
      if (!slot) return false;
      if (slot.status && String(slot.status).toUpperCase() !== "OPEN") return false;
      if (slot.owner_username === currentUser.username) return false;
      if (building && String(slot.building_number) !== String(building)) return false;
      if (type && slot.parking_type !== type) return false;
      return true;
    });
  }

  function applyOpenSpotOptions(slots) {
    currentOpenSlots = Array.isArray(slots) ? slots : [];
    fillAvailableSpotSelect(currentOpenSlots);
  }

  function refreshOpenSpotOptions() {
    applyOpenSpotOptions(deriveOpenSpotOptionsFromDashboard());
  }

  async function refreshDashboard() {
    bindParkingElements();
    if (!els.stats || !els.sharedSpots) return;
    if (refreshDashboardPromise) return refreshDashboardPromise;

    showCapacitySkeleton();
    refreshDashboardPromise = (async () => {
      const data = await api("/api/dashboard");
      if (data && typeof data === "object") {
        moduleQuickStats.messagesUnread = Math.max(0, Number(data.messaging?.total_unread || 0));
        moduleQuickStats.activeListings = Math.max(
          0,
          Number(data.summary?.active_marketplace_listings || moduleQuickStats.activeListings || 0)
        );
        moduleQuickStats.openPolls = Math.max(0, Number(data.summary?.open_polls || moduleQuickStats.openPolls || 0));
        moduleQuickStats.announcements = Math.max(
          0,
          Number(data.summary?.avizier_announcements || moduleQuickStats.announcements || 0)
        );
        messagingRecentEntries = Array.isArray(data.messaging?.recent) ? data.messaging.recent : [];
        renderQuickStats();
      }
      refreshTables(data);
      refreshOpenSpotOptions();
      markModuleRefreshed("parking");
      return data;
    })().finally(() => {
      refreshDashboardPromise = null;
    });

    return refreshDashboardPromise;
  }

  async function claimSlotByPayload(payload, slotForDisplay, buttonEl) {
    const claimPhone = String(payload?.claim_phone_number || "").trim();
    if (!claimPhone) {
      throw new Error("Contact phone is required to claim a parking spot.");
    }
    payload.claim_phone_number = claimPhone;
    const confirmed = await requestClaimConfirmation(
      slotForDisplay,
      payload.requested_from,
      payload.requested_until
    );
    if (!confirmed) {
      showToast("Claim cancelled.", "error");
      return;
    }

    const runClaim = async () => {
      await api("/api/slots/claim", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await refreshDashboard();
      showToast("Spot claimed successfully.");
      if (buttonEl) flashButtonSuccess(buttonEl, "Claimed");
    };

    if (buttonEl) {
      await withButtonProgress(buttonEl, "Claiming...", runClaim);
    } else {
      await runClaim();
    }
  }

  async function filterClaimsByBuilding(buildingNumber) {
    bindParkingElements();
    if (!currentUser) return;
    document.getElementById("claimBuilding").value = String(buildingNumber);
    setActiveTab("action", "actionClaimPanel");
    updateCapacitySelectionHighlight();
    refreshOpenSpotOptions();
    document.getElementById("actionPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast(`Claim form filtered for Bloc ${buildingNumber}.`);
  }

  async function handleQuickClaimButton(button) {
    bindParkingElements();
    try {
      const slotId = Number(button.dataset.slotId || 0);
      const slot = currentFreeSpots.find((s) => s.id === slotId);
      if (!slot) {
        throw new Error("Selected spot is no longer available.");
      }

      setActiveTab("action", "actionClaimPanel");
      document.getElementById("claimBuilding").value = String(slot.building_number);
      document.getElementById("claimType").value = slot.parking_type || "";
      refreshOpenSpotOptions();

      const available = currentOpenSlots.find((s) => s.id === slotId);
      if (!available) {
        throw new Error("Spot was already claimed by someone else.");
      }

      els.availableSlot.value = String(slotId);
      document.getElementById("claimFrom").value = available.available_from;
      document.getElementById("claimUntil").value = available.available_until;
      document.getElementById("actionPanel").scrollIntoView({ behavior: "smooth", block: "start" });

      const payload = {
        slot_id: slotId,
        requested_from: available.available_from,
        requested_until: available.available_until,
        claim_phone_number: String(document.getElementById("claimPhone").value || "").trim(),
      };
      await claimSlotByPayload(payload, available, button);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function load() {
    if (window.__parkingModuleReady && typeof window.__parkingModuleReady.then === "function") {
      try {
        await window.__parkingModuleReady;
      } catch {
        // ignore fragment load failures; refreshDashboard will no-op safely
      }
    }
    bindParkingElements();
    await refreshDashboard();
  }

  return {
    load,
    refreshDashboard,
    refreshStats,
    refreshTables,
    fillAvailableSpotSelect,
    syncClaimPeriodToSelection,
    deriveOpenSpotOptionsFromDashboard,
    applyOpenSpotOptions,
    refreshOpenSpotOptions,
    filterClaimsByBuilding,
    handleQuickClaimButton,
    updateCapacitySelectionHighlight,
    showCapacitySkeleton,
    claimSlotByPayload,
    parkingStatusBadge,
    parkingTypeShort,
    parkingTypeWithIcon,
    renderParkingEmptyRow,
    renderParkingEmptyCard,
  };
})();

window.ParkingModule = ParkingModule;
