const VotingModule = (() => {
  "use strict";

  let currentPollDetail = null;
  let latestActivePolls = [];
  let latestClosedPolls = [];
  let pollWizardStep = 1;
  let pollUploadedAttachments = [];
  let pollUploadPromise = null;
  let pollUploadToken = 0;
  const closedPollSummaryCache = {};
  let eventsBound = false;

  const e = (id) => document.getElementById(id);
  const els = new Proxy(
    {},
    {
      get(_target, key) {
        return document.getElementById(String(key));
      },
    }
  );

      function buildPollSharePayload(poll) {
        if (!poll) return null;
        const scopeLabel =
          poll.scope === "building" && Number(poll.building_id || 0) > 0 ? `Bloc ${poll.building_id}` : "General";
        const timingLabel =
          String(poll.status || "") === "active"
            ? `Closes ${pollCountdownLabel(poll)}`
            : `Closed ${formatRelativeTime(poll.end_date)}`;
        return {
          kind: "poll",
          kindLabel: "Voting poll",
          title: String(poll.title || "Community poll").trim(),
          text: [scopeLabel, timingLabel].filter(Boolean).join(" · "),
          preview: shortenText(poll.description || "", 180),
          url: moduleShareUrl("voting", { poll: poll.id }),
        };
      }

      function pollShareLookup(pollId) {
        const allPolls = [
          ...(Array.isArray(latestActivePolls) ? latestActivePolls : []),
          ...(Array.isArray(latestClosedPolls) ? latestClosedPolls : []),
        ];
        return allPolls.find((poll) => String(poll.id) === String(pollId)) || null;
      }

      function formatPollDate(value) {
        return formatBucharestDateTime(value);
      }

      function pollStatusClass(poll) {
        if (poll.status === "active" && poll.has_voted) return "status-active-voted";
        if (poll.status === "active") return "status-active";
        if (poll.status === "closed") return "status-closed";
        if (poll.status === "draft") return "status-draft";
        if (poll.status === "archived") return "status-archived";
        return "status-closed";
      }

      function pollStatusChip(poll) {
        const statusClass = pollStatusClass(poll);
        const iconName =
          statusClass === "status-active-voted"
            ? "check-check"
            : statusClass === "status-active"
              ? "play-circle"
              : statusClass === "status-closed"
                ? "lock"
                : statusClass === "status-draft"
                  ? "file-pen-line"
                  : "archive";
        return `<span class="poll-chip ${statusClass}">${iconMarkup(iconName)}<span>${pollStatusLabel(poll)}</span></span>`;
      }

      function pollTypeChip(type) {
        return `<span class="poll-chip type">${iconMarkup("list-checks")}<span>${pollTypeLabel(type)}</span></span>`;
      }

      function pollScopeChip(poll) {
        const iconName = poll.scope === "building" ? "building-2" : "map-pinned";
        const scopeClass = poll.scope === "building" ? "building" : "neighbourhood";
        return `<span class="poll-chip scope ${scopeClass}">${iconMarkup(iconName)}<span>${pollScopeLabel(poll)}</span></span>`;
      }

      function pollTypeLabel(type) {
        if (type === "yes_no") return "Da / Nu";
        if (type === "multiple_choice") return "Alegere multiplă";
        if (type === "weighted") return "Clasament";
        return titleize(type);
      }

      function pollScopeLabel(poll) {
        if (poll.scope === "building") {
          return `Bloc ${poll.building_id}`;
        }
        return "Toți locatarii";
      }

      function pollStatusLabel(poll) {
        if (poll.status === "active") {
          return poll.has_voted ? "Activ - Votat" : "Activ";
        }
        return titleize(poll.status);
      }

      function pollCountdownLabel(poll) {
        const end = new Date(String(poll?.end_date || ""));
        if (Number.isNaN(end.getTime())) return "Se închide curând";
        const now = new Date();
        const diffMs = end.getTime() - now.getTime();
        if (diffMs <= 0) return "Închis";
        const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
        const days = Math.floor(totalHours / 24);
        const hours = totalHours % 24;
        if (days > 0) return `Se închide în ${days}z ${hours}h`;
        const mins = Math.max(1, Math.floor(diffMs / (1000 * 60)));
        return `Se închide în ${mins}m`;
      }

      function pollUrgencyMeta(poll) {
        const start = parseDateSafe(poll?.start_date);
        const end = parseDateSafe(poll?.end_date);
        const now = Date.now();
        if (!start || !end || end.getTime() <= start.getTime()) {
          return { progress: 75, color: "#22c55e" };
        }
        const total = Math.max(1, end.getTime() - start.getTime());
        const remaining = Math.max(0, end.getTime() - now);
        const ratio = Math.max(0, Math.min(1, remaining / total));
        const hoursLeft = remaining / (1000 * 60 * 60);
        let color = "#22c55e";
        if (hoursLeft <= 24) color = "#f59e0b";
        if (hoursLeft <= 2) color = "#ef4444";
        return { progress: Math.round(ratio * 100), color };
      }

      function resultStatusLabel(value) {
        if (value === "valid") return "Rezultat valid";
        if (value === "invalid_no_quorum" || value === "quorum_not_met") return "Invalid (cvorum neîndeplinit)";
        if (value === "pending") return "În așteptare";
        return titleize(value);
      }

      function pollDefaultWindow() {
        const now = bucharestAnchorNow();
        const start = new Date(now);
        start.setUTCMinutes(0, 0, 0);
        start.setUTCHours(start.getUTCHours() + 1);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 3);
        end.setUTCHours(20, 0, 0, 0);
        return { start: toInputValue(start), end: toInputValue(end) };
      }

      function setPollFormDefaults() {
        const windowDefaults = pollDefaultWindow();
        if (!els.pollStart.value) els.pollStart.value = windowDefaults.start;
        if (!els.pollEnd.value) els.pollEnd.value = windowDefaults.end;
        if (!els.pollStatus.value) els.pollStatus.value = "active";
      }

      function updatePollFormVisibility() {
        const type = els.pollType.value;
        const scope = els.pollScope.value;
        const requiresQuorum = els.pollRequiresQuorum.checked;

        const hasCustomOptions = type === "multiple_choice" || type === "weighted";
        els.pollOptionsRow.classList.toggle("hidden", !hasCustomOptions);
        els.pollAllowMultipleRow.classList.toggle("hidden", type !== "multiple_choice");
        if (type !== "multiple_choice") {
          els.pollAllowMultiple.checked = false;
        }

        const needsBuilding = scope === "building";
        els.pollBuildingRow.classList.toggle("hidden", !needsBuilding);

        els.pollQuorumRow.classList.toggle("hidden", !requiresQuorum);
        if (!requiresQuorum) {
          els.pollQuorumPercentage.value = "";
        }
      }

      function renderPollReviewSummary() {
        const rawOptions = (els.pollOptions.value || "")
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean);
        const optionList = rawOptions.length
          ? rawOptions.map((item) => `<li>${item}</li>`).join("")
          : "<li>Auto-generated from poll type</li>";
        const attachmentsCount = Array.from(els.pollFiles.files || []).length;
        els.pollReviewBox.innerHTML = `
          <div><b>Title:</b> ${els.pollTitle.value.trim() || "-"}</div>
          <div><b>Type:</b> ${pollTypeLabel(els.pollType.value)}</div>
          <div><b>Scope:</b> ${
            els.pollScope.value === "building"
              ? `Bloc ${els.pollBuilding.value || "-"}`
              : "Cartier"
          }</div>
          <div><b>Window:</b> ${formatBucharestDateTime(els.pollStart.value)} - ${formatBucharestDateTime(
            els.pollEnd.value
          )}</div>
          <div><b>Status on publish:</b> ${titleize(els.pollStatus.value || "active")}</div>
          <div><b>Options:</b><ul style="margin:6px 0 0 18px">${optionList}</ul></div>
          <div><b>Attachments:</b> ${attachmentsCount} file(s)</div>
        `;
      }

      function validatePollWizardStep(step) {
        if (step === 1) {
          if (!els.pollTitle.value.trim()) throw new Error("Title is required.");
          if (!els.pollType.value) throw new Error("Poll type is required.");
          return;
        }
        if (step === 2) {
          if (!els.pollScope.value) throw new Error("Scope is required.");
          if (els.pollScope.value === "building" && !els.pollBuilding.value) {
            throw new Error("Select a building for building-scope polls.");
          }
          if (!els.pollStart.value || !els.pollEnd.value) throw new Error("Start and end dates are required.");
          return;
        }
        if (step === 3) {
          const type = els.pollType.value;
          const hasCustomOptions = type === "multiple_choice" || type === "weighted";
          if (hasCustomOptions) {
            const labels = (els.pollOptions.value || "")
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean);
            if (labels.length < 2) throw new Error("Add at least 2 options.");
          }
        }
      }

      function setPollWizardStep(step) {
        pollWizardStep = Math.min(4, Math.max(1, Number(step || 1)));
        document.querySelectorAll("[id^='pollWizardStep']").forEach((panel) => {
          panel.classList.toggle("hidden", panel.id !== `pollWizardStep${pollWizardStep}`);
        });
        document.querySelectorAll(".wizard-steps .step").forEach((stepEl) => {
          const stepNumber = Number(stepEl.dataset.step || 0);
          stepEl.classList.toggle("active", stepNumber === pollWizardStep);
          stepEl.classList.toggle("completed", stepNumber < pollWizardStep);
        });
        document.querySelectorAll(".wizard-steps .step-connector").forEach((connectorEl, index) => {
          connectorEl.classList.toggle("completed", index + 1 < pollWizardStep);
        });
        els.pollWizardPrevBtn.classList.toggle("hidden", pollWizardStep === 1);
        els.pollWizardNextBtn.classList.toggle("hidden", pollWizardStep >= 4);
        els.createPollBtn.classList.toggle("hidden", pollWizardStep !== 4);
        if (pollWizardStep === 4) {
          renderPollReviewSummary();
        }
      }

      function buildPollCreatePayload() {
        const type = els.pollType.value;
        const scope = els.pollScope.value;
        const options = (els.pollOptions.value || "")
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean);
        return {
          title: els.pollTitle.value.trim(),
          description: (els.pollDescriptionInput.value || "").trim(),
          poll_type: type,
          scope,
          building_id: scope === "building" ? Number(els.pollBuilding.value || 0) : null,
          status: els.pollStatus.value || "active",
          allow_multiple_selections: type === "multiple_choice" ? els.pollAllowMultiple.checked : false,
          show_results_before_close: els.pollShowResultsEarly.checked,
          requires_quorum: els.pollRequiresQuorum.checked,
          quorum_percentage: els.pollRequiresQuorum.checked
            ? Number(els.pollQuorumPercentage.value || 0)
            : null,
          start_date: els.pollStart.value,
          end_date: els.pollEnd.value,
          options,
        };
      }

      function setPollUploadStatus(message, kind = "") {
        els.pollUploadStatus.textContent = message;
        els.pollUploadStatus.classList.remove("error", "success");
        if (kind) {
          els.pollUploadStatus.classList.add(kind);
        }
      }

      function clearPollUploadState() {
        pollUploadedAttachments = [];
        pollUploadPromise = null;
        pollUploadToken += 1;
        setPollUploadStatus("No files selected.");
      }

      async function uploadPollAttachments(files, onProgress = null) {
        const uploads = files.map(async (file, i) => {
          if (typeof onProgress === "function") {
            onProgress({ index: i, total: files.length, fileName: file.name, stage: "upload" });
          }
          const form = new FormData();
          form.append("file", file);
          form.append("module_name", "polls");

          const uploadRes = await fetch("/api/uploads/direct", {
            method: "POST",
            body: form,
          });
          const uploadData = await uploadRes.json().catch(() => ({}));
          if (!uploadRes.ok) {
            throw new Error(uploadData.error || `Upload failed for .`);
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

      async function startPollAttachmentUpload() {
        const files = Array.from(els.pollFiles.files || []);
        const token = ++pollUploadToken;

        if (!files.length) {
          clearPollUploadState();
          return;
        }

        setPollUploadStatus(`Uploading ${files.length} file(s)...`);

        pollUploadPromise = uploadPollAttachments(files, (progress) => {
          if (token !== pollUploadToken) {
            throw new Error("__upload_cancelled__");
          }
          if (progress.stage === "presign") {
            setPollUploadStatus(
              `Preparing upload ${progress.index + 1}/${progress.total}: ${progress.fileName}...`
            );
            return;
          }
          if (progress.stage === "upload") {
            setPollUploadStatus(
              `Uploading ${progress.index + 1}/${progress.total}: ${progress.fileName}...`
            );
            return;
          }
          if (progress.stage === "done") {
            setPollUploadStatus(`Uploaded ${progress.index}/${progress.total} file(s)...`);
          }
        })
          .then((attachments) => {
            if (token !== pollUploadToken) {
              return;
            }
            pollUploadedAttachments = attachments;
            setPollUploadStatus(
              `Upload complete: ${attachments.length} file(s) ready to attach.`,
              "success"
            );
          })
          .catch((error) => {
            if (token !== pollUploadToken || error.message === "__upload_cancelled__") {
              return;
            }
            pollUploadedAttachments = [];
            setPollUploadStatus(
              `Upload failed: ${error.message || "unknown error"}`,
              "error"
            );
            throw error;
          })
          .finally(() => {
            if (token === pollUploadToken) {
              pollUploadPromise = null;
            }
          });

        return pollUploadPromise;
      }

      function canManagePolls(user = currentUser) {
        if (!user) return false;
        return user.role === "admin" || String(user.avizier_permission || "none") === "comitet";
      }

      function renderActivePollCards(polls) {
        const canDeletePolls = canManagePolls();
        els.activePolls.innerHTML = polls.length
          ? polls
              .map((poll) => {
                const status = pollStatusChip(poll);
                const urgency = pollUrgencyMeta(poll);
                const uniqueVoters = Number(poll.unique_voters || 0);
                const eligibleVoters = Number(poll.eligible_voters || 0);
                const participation = eligibleVoters
                  ? Math.round((uniqueVoters / eligibleVoters) * 100)
                  : null;
                const quorumNeeded = Number(poll.quorum_percentage || 0);
                const quorumProgress =
                  quorumNeeded > 0 && participation != null
                    ? Math.min(100, Math.round((participation / quorumNeeded) * 100))
                    : 0;
                return `
                  <article class="poll-card card">
                    <div class="poll-card-head">
                      <h4>${poll.title}</h4>
                      <span class="poll-urgency" style="--urgency-progress:${urgency.progress}%; --urgency-color:${urgency.color}">
                        <span class="poll-urgency-inner">${iconMarkup("clock-3")}</span>
                      </span>
                    </div>
                    <span class="poll-countdown">${iconMarkup("clock-3")}<span>${pollCountdownLabel(poll)}</span></span>
                    <div class="poll-meta">
                      <span class="poll-chip"><span class="poll-status-dot" aria-hidden="true"></span><span>${poll.has_voted ? "Votat" : "Deschis"}</span></span>
                      ${pollScopeChip(poll)}
                      ${status}
                      ${poll.has_voted ? `<span class="poll-voted-badge">${iconMarkup("check-check")}<span>Deja votat</span></span>` : ""}
                    </div>
                    <div class="poll-participation">
                      ${
                        participation == null
                          ? "Datele de participare vor apărea după primele voturi."
                          : `${uniqueVoters} din ${eligibleVoters} locatari au votat (${participation}%).`
                      }
                    </div>
                    ${
                      poll.requires_quorum
                        ? `
                          <div class="poll-mini-quorum">
                            <div class="poll-note">Cvorum necesar: ${quorumNeeded}%</div>
                            <div class="poll-mini-track"><span class="poll-mini-fill" style="width:${quorumProgress}%"></span></div>
                          </div>
                        `
                        : ""
                    }
                    <div class="module-actions">
                      <button type="button" class="table-action-btn poll-open-btn" data-poll-id="${poll.id}">
                        ${poll.has_voted ? "Vezi sondajul" : "Votează"}
                      </button>
                      <button type="button" class="table-action-btn ghost poll-results-btn" data-poll-id="${poll.id}">Rezultate</button>
                      <button type="button" class="table-action-btn ghost share-entity-btn poll-share-btn" data-share-kind="poll" data-share-id="${poll.id}">Share</button>
                      ${
                        canDeletePolls
                          ? `<button type="button" class="table-action-btn danger poll-delete-btn" data-poll-id="${poll.id}">Delete</button>`
                          : ""
                      }
                    </div>
                  </article>
                `;
              })
              .join("")
          : `<div class="empty-state">🗳️ Nu există sondaje active acum. Revino mai târziu.</div>`;
        const moduleEl = e("votingModule");
        if (moduleEl) decorateDynamicActionIcons(moduleEl);
        hydrateLucideIcons();
      }

      function closedPollSummaryText(pollId) {
        const cached = closedPollSummaryCache[String(pollId)];
        if (!cached) return "Se încarcă...";
        return `${cached.winner} / ${cached.result}`;
      }

      async function warmClosedPollSummaries(polls) {
        const missing = polls.filter((poll) => !closedPollSummaryCache[String(poll.id)]);
        if (!missing.length) return;
        await Promise.all(
          missing.map(async (poll) => {
            try {
              const results = await api(`/api/polls/${poll.id}/results`);
              const options = Array.isArray(results.options) ? results.options : [];
              const winnerIds = Array.isArray(results.winners) ? results.winners : [];
              const winnerLabels = winnerIds
                .map((id) => options.find((opt) => opt.id === id)?.label || id)
                .filter(Boolean);
              let winner = "Fără câștigător";
              if (winnerLabels.length === 1) winner = winnerLabels[0];
              if (winnerLabels.length > 1) winner = `Egalitate: ${winnerLabels.join(", ")}`;
              closedPollSummaryCache[String(poll.id)] = {
                winner,
                result: resultStatusLabel(results.result_status),
              };
            } catch {
              closedPollSummaryCache[String(poll.id)] = {
                winner: "Indisponibil",
                result: "În așteptare",
              };
            }
          })
        );
        renderClosedPollRows(polls);
      }

      function renderClosedPollRows(polls) {
        const canDeletePolls = canManagePolls();
        // Table — only populate on desktop
        if (!isMobile()) {
          els.closedPollsTableWrap.classList.toggle("hidden", !polls.length);
          els.closedPollsEmpty.classList.toggle("hidden", Boolean(polls.length));
          els.closedPolls.innerHTML = polls.length
            ? polls
                .map((poll) => {
                  return `<tr>
                    ${td(`<div class="poll-title"><strong>${poll.title}</strong><small>${pollTypeLabel(poll.poll_type)}</small></div>`)}
                    ${td(pollScopeChip(poll))}
                    ${td(formatPollDate(poll.end_date))}
                    ${td(pollStatusChip(poll))}
                    ${td(closedPollSummaryText(poll.id))}
                    <td>
                      <button type="button" class="table-action-btn poll-open-btn" data-poll-id="${poll.id}">Vezi</button>
                      <button type="button" class="table-action-btn ghost poll-results-btn" data-poll-id="${poll.id}">Rezultate</button>
                      <button type="button" class="table-action-btn ghost share-entity-btn poll-share-btn" data-share-kind="poll" data-share-id="${poll.id}">Share</button>
                      ${
                        canDeletePolls
                          ? `<button type="button" class="table-action-btn danger poll-delete-btn" data-poll-id="${poll.id}">Delete</button>`
                          : ""
                      }
                    </td>
                  </tr>`;
                })
                .join("")
            : "";
        } else {
          els.closedPollsTableWrap.classList.add("hidden");
          els.closedPolls.innerHTML = "";
        }

        // Cards — only populate on mobile
        if (isMobile()) {
          els.closedPollCards.innerHTML = polls.length
            ? polls
                .map(
                  (poll) => `
                    <article class="poll-card card">
                      <div class="poll-card-head">
                        <h4>${poll.title}</h4>
                      </div>
                      <div class="poll-meta">
                        ${pollScopeChip(poll)}
                        ${pollStatusChip(poll)}
                      </div>
                      <div style="color:var(--muted); font-size:0.82rem">Închis: ${formatPollDate(poll.end_date)}</div>
                      <div style="color:var(--muted); font-size:0.82rem">Rezultat: ${closedPollSummaryText(poll.id)}</div>
                      <div class="module-actions">
                        <button type="button" class="table-action-btn poll-open-btn" data-poll-id="${poll.id}">Vezi</button>
                        <button type="button" class="table-action-btn ghost poll-results-btn" data-poll-id="${poll.id}">Rezultate</button>
                        <button type="button" class="table-action-btn ghost share-entity-btn poll-share-btn" data-share-kind="poll" data-share-id="${poll.id}">Share</button>
                        ${
                          canDeletePolls
                            ? `<button type="button" class="table-action-btn danger poll-delete-btn" data-poll-id="${poll.id}">Delete</button>`
                            : ""
                        }
                      </div>
                    </article>
                  `
                )
                .join("")
            : "";
          els.closedPollsEmpty.classList.toggle("hidden", Boolean(polls.length));
        } else {
          els.closedPollCards.innerHTML = "";
        }
        const moduleEl = e("votingModule");
        if (moduleEl) decorateDynamicActionIcons(moduleEl);
        hydrateLucideIcons();
      }

      function clearPollLists() {
        latestActivePolls = [];
        latestClosedPolls = [];
        if (!els.activePolls || !els.closedPolls || !els.closedPollCards) {
          return;
        }
        els.activePolls.innerHTML = `<div class="empty-state">🗳️ Nu există sondaje active acum. Revino mai târziu.</div>`;
        if (els.closedPollsTableWrap) els.closedPollsTableWrap.classList.add("hidden");
        if (els.closedPollsEmpty) els.closedPollsEmpty.classList.remove("hidden");
        els.closedPolls.innerHTML = "";
        els.closedPollCards.innerHTML = "";
        if (els.countActivePolls) els.countActivePolls.textContent = "0";
        if (els.countClosedPolls) els.countClosedPolls.textContent = "0";
        refreshHomeActivity();
        hydrateLucideIcons();
      }

      async function refreshVoting() {
        if (!currentUser) return;
        const polls = await cachedFetch("/api/polls", {}, 120);
        const allPolls = Array.isArray(polls) ? polls : [];
        const activePolls = allPolls.filter((poll) => poll.status === "active");
        const closedPolls = allPolls.filter((poll) => poll.status === "closed");
        latestActivePolls = activePolls;
        latestClosedPolls = closedPolls;
        moduleQuickStats.openPolls = activePolls.length;
        renderQuickStats();
        renderActivePollCards(activePolls);
        renderClosedPollRows(closedPolls);
        if (els.countActivePolls) els.countActivePolls.textContent = String(activePolls.length);
        if (els.countClosedPolls) els.countClosedPolls.textContent = String(closedPolls.length);
        markModuleRefreshed("voting");
        refreshHomeActivity();
        warmClosedPollSummaries(closedPolls).catch(() => {});
      }

      function closePollModal() {
        if (els.pollModal) els.pollModal.classList.add("hidden");
        currentPollDetail = null;
      }

      function updatePollVoteSubmitState() {
        if (!currentPollDetail || currentPollDetail.poll.status !== "active" || currentPollDetail.has_voted) {
          els.pollVoteBtn.disabled = true;
          return;
        }
        const poll = currentPollDetail.poll;
        if (poll.poll_type === "weighted") {
          const selects = Array.from(els.pollVoteOptions.querySelectorAll("select[data-option-id]"));
          const allFilled = selects.length > 0 && selects.every((select) => Number(select.value || 0) > 0);
          els.pollVoteBtn.disabled = !allFilled;
          return;
        }
        if (poll.poll_type === "multiple_choice" && poll.allow_multiple_selections) {
          const checked = els.pollVoteOptions.querySelector("input[type=checkbox]:checked");
          els.pollVoteBtn.disabled = !checked;
          return;
        }
        const selected = els.pollVoteOptions.querySelector("input[type=radio]:checked");
        els.pollVoteBtn.disabled = !selected;
      }

      function renderPollVote(data) {
        const poll = data.poll;
        const options = data.options || [];
        els.pollVoteBtn.disabled = true;

        els.pollVoteHint.textContent = "";
        els.pollVoteForm.classList.remove("hidden");
        els.pollVoteOptions.innerHTML = "";

        if (poll.status !== "active") {
          els.pollVoteHint.textContent = "Voting is currently closed for this poll.";
          els.pollVoteForm.classList.add("hidden");
          return;
        }
        if (data.has_voted) {
          els.pollVoteHint.textContent = "Your vote has already been recorded.";
          els.pollVoteForm.classList.add("hidden");
          return;
        }

        if (poll.poll_type === "weighted") {
          els.pollVoteHint.textContent = "Rank every option. Rank 1 is your top choice.";
          const rankOptions = options
            .map((_, idx) => `<option value="${idx + 1}">${idx + 1}</option>`)
            .join("");
          els.pollVoteOptions.innerHTML = `
            <div class="poll-rank-grid poll-vote-tiles">
              ${options
                .map(
                  (opt) => `
                    <div class="poll-vote-tile">
                      <div class="tile-label">${opt.label}</div>
                      <select data-option-id="${opt.id}" class="poll-rank-select" required>
                        <option value="">Rank</option>
                        ${rankOptions}
                      </select>
                    </div>
                  `
                )
              .join("")}
            </div>
          `;
          els.pollVoteOptions.querySelectorAll("select[data-option-id]").forEach((input) => {
            input.addEventListener("change", updatePollVoteSubmitState);
          });
          updatePollVoteSubmitState();
          return;
        }

        if (poll.poll_type === "multiple_choice" && poll.allow_multiple_selections) {
          els.pollVoteHint.textContent = "Choose one or more options.";
          els.pollVoteOptions.innerHTML = options
            .map(
              (opt) => `
                <label class="poll-vote-tile">
                  <input type="checkbox" value="${opt.id}" />
                  <span class="tile-label">${opt.label}</span>
                </label>
              `
            )
            .join("");
          els.pollVoteOptions.querySelectorAll("input[type=checkbox]").forEach((input) => {
            input.addEventListener("change", updatePollVoteSubmitState);
          });
          updatePollVoteSubmitState();
          return;
        }

        els.pollVoteHint.textContent = "Choose one option.";
        els.pollVoteOptions.innerHTML = options
          .map(
            (opt) => `
              <label class="poll-vote-tile ${
                poll.poll_type === "yes_no" && String(opt.label || "").toLowerCase() === "yes"
                  ? "is-yes"
                  : poll.poll_type === "yes_no" && String(opt.label || "").toLowerCase() === "no"
                    ? "is-no"
                    : ""
              }">
                <input type="radio" name="pollOption" value="${opt.id}" required />
                <span class="tile-label">${opt.label}</span>
              </label>
            `
          )
          .join("");
        els.pollVoteOptions.querySelectorAll("input[type=radio]").forEach((input) => {
          input.addEventListener("change", updatePollVoteSubmitState);
        });
        updatePollVoteSubmitState();
      }

      function renderPollResults(results) {
        const poll = results.poll;
        if (!poll) return;

        const quorumLine = poll.requires_quorum
          ? `Prezență: ${results.turnout_percentage}% (${results.unique_voters} din ${results.eligible_voters} locatari). Cvorum ${
              results.quorum_met ? "îndeplinit" : "neîndeplinit"
            }.`
          : `Prezență: ${results.turnout_percentage}% (${results.unique_voters} din ${results.eligible_voters} locatari).`;

        const options = results.options || [];
        const maxPoints = Math.max(
          1,
          ...options.map((opt) => Number(opt.points || 0))
        );
        const quorumTarget = Number(poll.quorum_percentage || 0);
        const turnoutValue = Number(results.turnout_percentage || 0);
        const quorumRatio = quorumTarget > 0 ? Math.min(100, Math.round((turnoutValue / quorumTarget) * 100)) : 0;

        const resultVisuals = options
          .map((opt) => {
            const ratio =
              poll.poll_type === "weighted"
                ? Math.max(0, Math.min(100, Math.round((Number(opt.points || 0) / maxPoints) * 100)))
                : Math.max(0, Math.min(100, Math.round(Number(opt.percentage || 0))));
            const metric =
              poll.poll_type === "weighted"
                ? `${opt.points} puncte`
                : `${opt.votes} voturi - ${opt.percentage}%`;
            return `
              <article class="poll-result-item">
                <div class="poll-result-head">
                  <b>${opt.label}</b>
                  <span class="poll-result-metric">${metric}</span>
                </div>
                <div class="poll-result-bar">
                  <span class="poll-result-fill" style="width:${ratio}%"></span>
                </div>
              </article>
            `;
          })
          .join("");

        const winnerLabelList = (results.winners || [])
          .map((id) => {
            const match = options.find((opt) => opt.id === id);
            return match ? match.label : id;
          });
        let winnerText = "Fără câștigător încă";
        if (winnerLabelList.length === 1) {
          winnerText = winnerLabelList[0];
        } else if (winnerLabelList.length > 1) {
          winnerText = `Egalitate: ${winnerLabelList.join(", ")}`;
        }

        els.pollResultsSection.innerHTML = `
          <h3>Rezultate</h3>
          <div class="poll-summary">
            <span>${quorumLine}</span>
            <span><b>Rezultat:</b> ${resultStatusLabel(results.result_status)}</span>
            <span><b>Câștigător:</b> ${winnerText}</span>
          </div>
          ${
            poll.requires_quorum
              ? `
                <div class="poll-quorum">
                  <div class="poll-quorum-head">
                    <span>Progres cvorum</span>
                    <span>${turnoutValue}% / ${quorumTarget}%</span>
                  </div>
                  <div class="poll-quorum-track">
                    <span class="poll-quorum-fill ${results.quorum_met ? "" : "low"}" style="width:${quorumRatio}%"></span>
                  </div>
                </div>
              `
              : ""
          }
          <div class="poll-result-list">
            ${
              resultVisuals ||
              `<p class="poll-note">Nu au fost trimise voturi încă.</p>`
            }
          </div>
        `;
        requestAnimationFrame(() => {
          els.pollResultsSection.querySelectorAll(".poll-result-fill").forEach((fill) => {
            const target = fill.style.width;
            fill.style.width = "0%";
            requestAnimationFrame(() => {
              fill.style.width = target;
            });
          });
        });
      }

      function buildVotePayload() {
        const poll = currentPollDetail.poll;
        const options = currentPollDetail.options || [];

        if (poll.poll_type === "weighted") {
          const selects = Array.from(els.pollVoteOptions.querySelectorAll("select[data-option-id]"));
          if (!selects.length) {
            throw new Error("Ranking options are missing.");
          }
          const ranked = [];
          const usedRanks = new Set();
          for (const select of selects) {
            const rank = Number(select.value || 0);
            if (!rank) {
              throw new Error("Select a rank for each option.");
            }
            if (rank < 1 || rank > options.length) {
              throw new Error("Ranks must be within the available range.");
            }
            if (usedRanks.has(rank)) {
              throw new Error("Each rank must be unique.");
            }
            usedRanks.add(rank);
            ranked.push({ rank, optionId: select.dataset.optionId });
          }
          ranked.sort((a, b) => a.rank - b.rank);
          return { ranking: ranked.map((item) => item.optionId) };
        }

        if (poll.poll_type === "multiple_choice" && poll.allow_multiple_selections) {
          const selected = Array.from(els.pollVoteOptions.querySelectorAll("input[type=checkbox]:checked")).map(
            (input) => input.value
          );
          if (!selected.length) {
            throw new Error("Select at least one option.");
          }
          return { option_ids: selected };
        }

        const selected = els.pollVoteOptions.querySelector("input[type=radio]:checked");
        if (!selected) {
          throw new Error("Select an option to vote.");
        }
        return { option_ids: [selected.value] };
      }

      async function loadPollModal(pollId) {
        const data = await api(`/api/polls/${pollId}`);
        currentPollDetail = data;

        const poll = data.poll;
        els.pollModalTitle.textContent = poll.title;
        const hasDescription = typeof poll.description === "string" && poll.description.trim().length > 0;
        els.pollDescription.textContent = hasDescription
          ? poll.description
          : "No additional details were added for this poll.";
        els.pollMeta.innerHTML = `
          ${pollTypeChip(poll.poll_type)}
          ${pollScopeChip(poll)}
          ${pollStatusChip({ ...poll, has_voted: data.has_voted })}
          <span class="poll-chip time">${iconMarkup("calendar-clock")}<span>Deschidere: ${formatPollDate(poll.start_date)}</span></span>
          <span class="poll-chip time">${iconMarkup("calendar-check")}<span>Închidere: ${formatPollDate(poll.end_date)}</span></span>
          <span class="poll-chip time">${iconMarkup("map-pin")}<span>Fus orar: București</span></span>
        `;

        const attachments = data.attachments || [];
        if (!attachments.length) {
          els.pollAttachments.innerHTML = `<span class="poll-note">No files were attached to this poll.</span>`;
        } else {
          els.pollAttachments.innerHTML = attachments
            .map(
              (item) =>
                `<a class="pill" href="${item.file_url}" target="_blank" rel="noopener noreferrer">${item.file_name} (${item.file_type})</a>`
            )
            .join("");
        }
        hydrateLucideIcons();

        renderPollVote(data);

        const canViewResults =
          poll.status === "closed" || poll.show_results_before_close || (currentUser && currentUser.role === "admin");
        if (!canViewResults) {
          els.pollResultsSection.innerHTML = `<p class="poll-note">Rezultatele sunt ascunse până la închiderea sondajului.</p>`;
          return;
        }
        try {
          const results = await api(`/api/polls/${pollId}/results`);
          renderPollResults(results);
        } catch (error) {
          els.pollResultsSection.innerHTML = `<p class="poll-note">Rezultatele nu sunt disponibile încă. Revino mai târziu.</p>`;
        }
      }

      async function openPollModal(pollId) {
        await loadPollModal(pollId);
        els.pollModal.classList.remove("hidden");
      }

      async function openPollResultsView(pollId) {
        await openPollModal(pollId);
        requestAnimationFrame(() => {
          els.pollResultsSection?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }

      async function handlePollDeleteAction(button) {
        if (!button) return;
        const pollId = String(button.dataset.pollId || "").trim();
        if (!pollId) return;
        const confirmed = await requestActionConfirmation("Delete this poll permanently? This will remove votes and attachments.");
        if (!confirmed) return;
        await withButtonProgress(button, "Deleting...", async () => {
          try {
            await api(`/api/polls/${pollId}/delete`, { method: "POST" });
            if (currentPollDetail && String(currentPollDetail.poll?.id || "") === pollId) {
              closePollModal();
            }
            delete closedPollSummaryCache[pollId];
            showToast("Poll deleted.");
            await refreshVoting();
          } catch (error) {
            setStatus(error.message, true);
          }
        });
      }


  function attachEvents() {
    if (eventsBound) return;
    eventsBound = true;

    const refreshBtn = e("refreshPollsBtn");
    const pollType = e("pollType");
    const pollScope = e("pollScope");
    const pollRequiresQuorum = e("pollRequiresQuorum");
    const pollWizardNextBtn = e("pollWizardNextBtn");
    const pollWizardPrevBtn = e("pollWizardPrevBtn");
    const pollFiles = e("pollFiles");
    const createPollForm = e("createPollForm");
    const activePolls = e("activePolls");
    const closedPolls = e("closedPolls");
    const closedPollCards = e("closedPollCards");
    const pollCloseBtn = e("pollCloseBtn");
    const pollModal = e("pollModal");
    const pollVoteForm = e("pollVoteForm");
    const pollOptions = e("pollOptions");

    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        try {
          await withRefreshPulse(refreshBtn, async () => refreshVoting());
          showToast("Sondaje actualizate.", "info");
        } catch (error) {
          setStatus(error.message, true);
        }
      });
    }

    if (pollType) {
      pollType.addEventListener("change", () => {
        updatePollFormVisibility();
        if (pollWizardStep === 4) renderPollReviewSummary();
      });
    }

    if (pollScope) {
      pollScope.addEventListener("change", () => {
        updatePollFormVisibility();
        if (pollWizardStep === 4) renderPollReviewSummary();
      });
    }

    if (pollRequiresQuorum) {
      pollRequiresQuorum.addEventListener("change", () => {
        updatePollFormVisibility();
        if (pollWizardStep === 4) renderPollReviewSummary();
      });
    }

    [e("pollTitle"), e("pollDescriptionInput"), e("pollStart"), e("pollEnd"), e("pollStatus"), e("pollOptions")]
      .filter(Boolean)
      .forEach((field) => {
        field.addEventListener("input", () => {
          if (pollWizardStep === 4) renderPollReviewSummary();
        });
      });

    if (pollWizardNextBtn) {
      pollWizardNextBtn.addEventListener("click", () => {
        try {
          validatePollWizardStep(pollWizardStep);
          setPollWizardStep(pollWizardStep + 1);
        } catch (error) {
          setStatus(error.message, true);
        }
      });
    }

    if (pollWizardPrevBtn) {
      pollWizardPrevBtn.addEventListener("click", () => {
        setPollWizardStep(pollWizardStep - 1);
      });
    }

    if (pollFiles) {
      pollFiles.addEventListener("change", async () => {
        try {
          await startPollAttachmentUpload();
          if (pollWizardStep === 4) renderPollReviewSummary();
        } catch (error) {
          setStatus(error.message, true);
        }
      });
    }

    if (createPollForm) {
      createPollForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!currentUser || currentUser.role !== "admin") {
          setStatus("Doar adminul poate crea sondaje.", true);
          return;
        }
        try {
          validatePollWizardStep(1);
          validatePollWizardStep(2);
          validatePollWizardStep(3);
        } catch (error) {
          setStatus(error.message, true);
          return;
        }
        await withButtonProgress(e("createPollBtn"), "Se creează...", async () => {
          try {
            const payload = buildPollCreatePayload();
            const files = Array.from(e("pollFiles")?.files || []);
            if (files.length) {
              if (pollUploadPromise) {
                await pollUploadPromise;
              } else if (!pollUploadedAttachments.length) {
                await startPollAttachmentUpload();
              }
              if (!pollUploadedAttachments.length) {
                throw new Error("Atașamentele nu s-au încărcat. Reselectează fișierele.");
              }
              payload.attachments = [...pollUploadedAttachments];
            }
            await api("/api/polls", {
              method: "POST",
              body: JSON.stringify(payload),
            });
            showToast("Sondaj creat.");
            flashButtonSuccess(e("createPollBtn"), "Publicat");
            createPollForm.reset();
            clearPollUploadState();
            setPollFormDefaults();
            updatePollFormVisibility();
            setPollWizardStep(1);
            await refreshVoting();
          } catch (error) {
            setStatus(error.message, true);
          }
        });
      });
    }

    const sharedCardHandler = async (event) => {
      const shareBtn = event.target.closest('.share-entity-btn[data-share-kind="poll"]');
      if (shareBtn) {
        openShareForEntity("poll", shareBtn.dataset.shareId);
        return;
      }
      const resultsBtn = event.target.closest(".poll-results-btn");
      if (resultsBtn) {
        try {
          await openPollResultsView(resultsBtn.dataset.pollId);
        } catch (error) {
          setStatus(error.message, true);
        }
        return;
      }
      const deleteBtn = event.target.closest(".poll-delete-btn");
      if (deleteBtn) {
        await handlePollDeleteAction(deleteBtn);
        return;
      }
      const button = event.target.closest(".poll-open-btn");
      if (!button) return;
      try {
        await openPollModal(button.dataset.pollId);
      } catch (error) {
        setStatus(error.message, true);
      }
    };

    if (activePolls) activePolls.addEventListener("click", sharedCardHandler);
    if (closedPolls) closedPolls.addEventListener("click", sharedCardHandler);
    if (closedPollCards) closedPollCards.addEventListener("click", sharedCardHandler);

    if (pollCloseBtn) {
      pollCloseBtn.addEventListener("click", () => closePollModal());
    }
    if (pollModal) {
      pollModal.addEventListener("click", (event) => {
        if (event.target === pollModal) closePollModal();
      });
    }

    if (pollVoteForm) {
      pollVoteForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!currentPollDetail) return;
        const pollId = currentPollDetail.poll.id;
        await withButtonProgress(e("pollVoteBtn"), "Se trimite...", async () => {
          try {
            const payload = buildVotePayload();
            await api(`/api/polls/${pollId}/vote`, {
              method: "POST",
              body: JSON.stringify(payload),
            });
            showToast("Vot trimis.");
            flashButtonSuccess(e("pollVoteBtn"), "Trimis");
            await refreshVoting();
            await loadPollModal(pollId);
          } catch (error) {
            setStatus(error.message, true);
          }
        });
      });
    }

    if (pollOptions) {
      pollOptions.addEventListener("input", function onPollOptionsInput() {
        const errEl = e("pollOptionsError");
        const type = e("pollType")?.value;
        const hasOptions = type === "multiple_choice" || type === "weighted";
        if (!hasOptions) return;
        const lines = this.value
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length < 2) {
          if (typeof showFieldError === "function") {
            showFieldError(this, errEl, "Adaugă cel puțin 2 opțiuni.");
          }
        } else if (typeof clearFieldError === "function") {
          clearFieldError(this, errEl);
          if (typeof markFieldValid === "function") markFieldValid(this);
        }
      });
    }
  }

  function init() {
    attachEvents();
    const createPollCard = e("createPollCard");
    if (createPollCard) {
      const isAdmin = Boolean(currentUser && currentUser.role === "admin");
      createPollCard.classList.toggle("hidden", !isAdmin);
    }
    fillBuildingSelect("pollBuilding");
    setPollFormDefaults();
    setPollWizardStep(1);
    updatePollFormVisibility();
    clearPollUploadState();
    if (typeof attachCharCounter === "function") {
      attachCharCounter("pollTitle", "pollTitleCounter", 200);
    }
    if (typeof applyStaticActionIcons === "function") {
      applyStaticActionIcons();
    }
  }

  return {
    init,
    refresh: refreshVoting,
    clearLists: clearPollLists,
    clearUploadState: clearPollUploadState,
    openModal: openPollModal,
    openResultsView: openPollResultsView,
    closeModal: closePollModal,
    setFormDefaults: setPollFormDefaults,
    setWizardStep: setPollWizardStep,
    updateFormVisibility: updatePollFormVisibility,
    buildSharePayload: buildPollSharePayload,
    shareLookup: pollShareLookup,
    getActivePolls: () => latestActivePolls,
    getClosedPolls: () => latestClosedPolls,
  };
})();

window.VotingModule = VotingModule;
