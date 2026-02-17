import crypto from "node:crypto";

const HASH_ALGO = "pbkdf2_sha256";
const HASH_ITERATIONS = 200000;

function toHex(buffer) {
  return Buffer.from(buffer).toString("hex");
}

export function hashPassword(password) {
  if (!password || typeof password !== "string") {
    throw new Error("password cannot be empty");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = toHex(crypto.pbkdf2Sync(password, salt, HASH_ITERATIONS, 32, "sha256"));
  return `${HASH_ALGO}$${HASH_ITERATIONS}$${salt}$${digest}`;
}

export function verifyPassword(password, encoded) {
  try {
    const [algorithm, iterationsRaw, salt, digest] = String(encoded || "").split("$", 4);
    if (algorithm !== HASH_ALGO) return false;
    const iterations = Number(iterationsRaw);
    if (!Number.isFinite(iterations) || iterations <= 0) return false;
    const computed = toHex(crypto.pbkdf2Sync(String(password || ""), salt, iterations, 32, "sha256"));
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(digest));
  } catch {
    return false;
  }
}

function getSessionSecret() {
  return process.env.FLASK_SECRET_KEY || process.env.SESSION_SECRET || "change-this-secret";
}

export function signSessionToken(userId) {
  const issuedAt = Date.now();
  const payload = `${userId}.${issuedAt}`;
  const sig = crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token) {
  try {
    const [idRaw, issuedAtRaw, sig] = String(token || "").split(".", 3);
    const userId = Number(idRaw);
    const issuedAt = Number(issuedAtRaw);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    if (!Number.isFinite(issuedAt)) return null;
    const payload = `${userId}.${issuedAt}`;
    const expected = crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(sig || ""), Buffer.from(expected))) return null;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - issuedAt > thirtyDays) return null;
    return { userId };
  } catch {
    return null;
  }
}
