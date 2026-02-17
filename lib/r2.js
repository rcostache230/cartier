import crypto from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let cachedClient = null;
let cachedConfig = null;

function pickR2Config() {
  const accountId = String(process.env.R2_ACCOUNT_ID || "").trim();
  const endpoint = String(process.env.R2_ENDPOINT || "").trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || "").trim();
  const bucket = String(process.env.R2_BUCKET || "").trim();

  const resolvedEndpoint = endpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

  if (!resolvedEndpoint || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  return {
    endpoint: resolvedEndpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    region: String(process.env.R2_REGION || "auto"),
  };
}

export function isR2Configured() {
  if (cachedConfig === null) {
    cachedConfig = pickR2Config();
  }
  return Boolean(cachedConfig);
}

function getR2ConfigOrThrow() {
  if (cachedConfig === null) {
    cachedConfig = pickR2Config();
  }
  if (!cachedConfig) {
    throw new Error("R2 is not configured. Missing R2 endpoint, credentials, or bucket env vars.");
  }
  return cachedConfig;
}

function getR2Client() {
  if (cachedClient) return cachedClient;
  const cfg = getR2ConfigOrThrow();
  cachedClient = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  return cachedClient;
}

function sanitizeFileName(name) {
  const base = String(name || "file").trim() || "file";
  return base
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function sanitizeModule(moduleName) {
  const moduleValue = String(moduleName || "misc").trim().toLowerCase();
  return moduleValue.replace(/[^a-z0-9/_-]+/g, "-") || "misc";
}

export async function createUploadTarget({ userId, fileName, fileType, moduleName = "misc" }) {
  const cfg = getR2ConfigOrThrow();
  const client = getR2Client();

  const cleanedName = sanitizeFileName(fileName);
  const cleanedModule = sanitizeModule(moduleName);
  const stamp = new Date().toISOString().slice(0, 10);
  const key = `${cleanedModule}/${stamp}/u${userId}-${crypto.randomUUID()}-${cleanedName}`;
  const contentType = String(fileType || "application/octet-stream") || "application/octet-stream";

  const command = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ContentType: contentType,
  });

  const expiresIn = 600;
  const uploadUrl = await getSignedUrl(client, command, { expiresIn });

  return {
    key,
    uploadUrl,
    expiresIn,
    fileUrl: `/api/uploads/view?key=${encodeURIComponent(key)}`,
  };
}

export async function createViewUrl(key, expiresIn = 900) {
  const cfg = getR2ConfigOrThrow();
  const client = getR2Client();
  const command = new GetObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn });
}
