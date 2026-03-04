function toLower(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function isAdmin(user) {
  if (!user) return false;
  return toLower(user.username) === "admin" || toLower(user.role) === "admin";
}

export function isComitet(user) {
  return toLower(user?.avizier_permission) === "comitet";
}

export function isReprezentantBloc(user) {
  return toLower(user?.avizier_permission) === "reprezentant_bloc";
}

export function resolveUserBuildingId(user) {
  const numeric = Number(user?.building_number || 0);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 10) return null;
  return `bloc${numeric}`;
}

function sameBuilding(user, conversationOrBuildingId) {
  const userBuilding = resolveUserBuildingId(user);
  if (!userBuilding) return false;

  const buildingId =
    typeof conversationOrBuildingId === "string"
      ? conversationOrBuildingId
      : String(conversationOrBuildingId?.building_id || "");

  return toLower(buildingId) === toLower(userBuilding);
}

export function canViewConversation(user, conversation) {
  if (!user || !conversation) return false;
  if (isAdmin(user)) return true;

  const scope = toLower(conversation.scope);
  if (scope === "neighborhood") return true;
  if (scope === "building") return sameBuilding(user, conversation);
  return false;
}

export function canSendMessage(user, conversation, opts = {}) {
  if (!user || !conversation) return false;
  if (isAdmin(user)) return true;

  if (conversation.is_locked) return false;
  if (!canViewConversation(user, conversation)) return false;

  if (toLower(conversation.type) === "announcement") {
    return canPostAnnouncement(user, {
      scope: conversation.scope,
      building_id: conversation.building_id,
    });
  }

  if (toLower(conversation.type) === "dm") {
    return Boolean(opts.isParticipant);
  }

  return true;
}

export function canCreateBoard(user, scope, building_id) {
  if (!user) return false;
  if (isAdmin(user)) return true;

  const safeScope = toLower(scope || "building");
  if (safeScope === "neighborhood") {
    return isComitet(user);
  }

  return sameBuilding(user, building_id);
}

export function canPostAnnouncement(user, target = {}) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (isComitet(user)) return true;

  if (isReprezentantBloc(user)) {
    return toLower(target.scope) === "building" && sameBuilding(user, target.building_id);
  }

  return false;
}

export function canModerate(user, conversation) {
  if (!user || !conversation) return false;
  if (isAdmin(user)) return true;

  if (isComitet(user)) {
    return toLower(conversation.scope) === "building" && sameBuilding(user, conversation);
  }

  return false;
}

export function canDeleteBoard(user) {
  return isAdmin(user);
}

export function canLockBoard(user) {
  return isAdmin(user);
}

export function canPinMessage(user, conversation) {
  if (!user || !conversation) return false;
  if (isAdmin(user)) return true;
  if (isComitet(user)) return true;

  if (isReprezentantBloc(user)) {
    return toLower(conversation.scope) === "building" && sameBuilding(user, conversation);
  }

  return false;
}

export function canEditTopic(user, conversation) {
  if (!user || !conversation) return false;
  if (isAdmin(user)) return true;
  if (isComitet(user)) return true;

  if (isReprezentantBloc(user)) {
    return toLower(conversation.scope) === "building" && sameBuilding(user, conversation);
  }

  return toLower(conversation.created_by) === toLower(user.username);
}

export function canManageParticipants(user, conversation) {
  if (!user || !conversation) return false;
  if (isAdmin(user)) return true;
  if (isComitet(user)) return true;

  if (isReprezentantBloc(user)) {
    return toLower(conversation.scope) === "building" && sameBuilding(user, conversation);
  }

  return false;
}
