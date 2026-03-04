function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase();
}

function normalizeBuildingId(buildingId) {
  const raw = String(buildingId || "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  if (/^bloc(10|[1-9])$/.test(raw)) return raw;

  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 10) {
    return `bloc${numeric}`;
  }

  return raw;
}

export function channelForConversation(id) {
  return `private-conversation-${Number(id)}`;
}

export function channelForUser(username) {
  return `private-user-${normalizeUsername(username)}`;
}

export function channelForBuilding(buildingId) {
  return `presence-building-${normalizeBuildingId(buildingId)}`;
}
