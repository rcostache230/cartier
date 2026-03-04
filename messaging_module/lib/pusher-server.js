import Pusher from "pusher";
import {
  channelForConversation,
  channelForUser,
  channelForBuilding,
} from "./pusher-channels.js";

const appId = String(process.env.PUSHER_APP_ID || "").trim();
const key = String(process.env.PUSHER_KEY || "").trim();
const secret = String(process.env.PUSHER_SECRET || "").trim();
const cluster = String(process.env.PUSHER_CLUSTER || "eu").trim() || "eu";

const isConfigured = Boolean(appId && key && secret);

const pusher = isConfigured
  ? new Pusher({
      appId,
      key,
      secret,
      cluster,
      useTLS: true,
    })
  : null;

function logPusherError(action, error) {
  if (!error) return;
  console.warn(`[pusher] ${action} failed:`, error?.message || error);
}

async function safeTrigger(channel, event, data) {
  if (!pusher || !channel || !event) return;
  try {
    await pusher.trigger(channel, event, data);
  } catch (error) {
    logPusherError(`trigger ${event} on ${channel}`, error);
  }
}

export function isPusherEnabled() {
  return Boolean(pusher);
}

export async function triggerConversation(conversationId, event, data) {
  const channel = channelForConversation(conversationId);
  await safeTrigger(channel, event, data);
}

export async function triggerUser(username, event, data) {
  const channel = channelForUser(username);
  await safeTrigger(channel, event, data);
}

export async function triggerBuilding(buildingId, event, data) {
  const channel = channelForBuilding(buildingId);
  await safeTrigger(channel, event, data);
}

export function authorizeChannel(socketId, channelName, channelData) {
  if (!pusher) return null;
  try {
    if (channelData && typeof channelData === "object") {
      return pusher.authorizeChannel(socketId, channelName, channelData);
    }
    return pusher.authorizeChannel(socketId, channelName);
  } catch (error) {
    logPusherError(`authorize ${channelName}`, error);
    return null;
  }
}
