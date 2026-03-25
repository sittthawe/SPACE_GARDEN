const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { buildPhotoUrl, buildStorageSettings, createStorageAdapter } = require("./storage");

const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_ADMIN_PASSWORD = "RasDave26";
const DEFAULT_RENDER_STORAGE_DIR = path.join(process.cwd(), "storage");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

const EXTENSIONS_BY_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

const ALLOWED_IMAGE_TYPES = new Set(Object.keys(EXTENSIONS_BY_TYPE));
const MOJIBAKE_MARKER = /[\u00C3\u00C2\u00E2\u00F0][\u0080-\u017F]/u;
const DESCRIPTION_SECTION_REPLACEMENTS = [
  {
    pattern: /\s*(?:\u{1F3AF}\s*)?More Dark \/ Creepy Version\b\s*:?\s*/giu,
    replacement: "\n\nMore dark / creepy version:\n",
  },
  {
    pattern: /\s*(?:\u2699\uFE0F?\s*)?Optional Negative Prompt\b\s*:?\s*/giu,
    replacement: "\n\nOptional negative prompt:\n",
  },
  {
    pattern: /\s*(?:(?:\u{1F3AF}|\u{1F527}|\u{1F6AB})\s*)?(?<!Optional )Negative Prompt(?:\s*\(Important\))?\s*:?\s*/giu,
    replacement: "\n\nNegative prompt:\n",
  },
  {
    pattern: /\s*(?:\u{1F3AF}\s*)?Style Enhancer\b\s*:?\s*/giu,
    replacement: "\n\nStyle notes:\n",
  },
  {
    pattern: /\s*(?:\u{1F3A5}\s*)?Optional shot(?: on)?\b\s*:?\s*/giu,
    replacement: "\n\nOptional shot:\n",
  },
];

function buildConfig(overrides = {}) {
  const storageSettings = buildStorageSettings(overrides);
  const defaultHost = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
  const resolvedStorage = resolveStoragePaths(overrides);
  const uploadsDir = overrides.uploadsDir || path.join(resolvedStorage.storageRoot, "uploads");
  const dataFile = overrides.dataFile || path.join(resolvedStorage.storageRoot, "data", "album.json");
  const useImplicitLegacyFallback = !overrides.uploadsDir && !overrides.dataFile;

  return {
    host: overrides.host || defaultHost,
    port: overrides.port ?? Number(process.env.PORT || 3000),
    publicDir: overrides.publicDir || PUBLIC_DIR,
    storageRoot: resolvedStorage.storageRoot,
    storageRootSource: resolvedStorage.source,
    uploadsDir,
    dataFile,
    legacyUploadsDir:
      overrides.legacyUploadsDir ||
      (useImplicitLegacyFallback ? path.join(resolvedStorage.legacyStorageRoot, "uploads") : uploadsDir),
    legacyDataFile:
      overrides.legacyDataFile ||
      (useImplicitLegacyFallback ? path.join(resolvedStorage.legacyStorageRoot, "data", "album.json") : dataFile),
    storageMode: storageSettings.mode,
    r2: storageSettings.r2,
    maxUploadBytes: overrides.maxUploadBytes || 15 * 1024 * 1024,
    sessionTtlMs: overrides.sessionTtlMs || 8 * 60 * 60 * 1000,
    adminPassword: overrides.adminPassword || process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD,
  };
}

function createAlbumServer(overrides = {}) {
  const config = buildConfig(overrides);
  config.storage = createStorageAdapter(config, overrides);

  const sessions = new Map();
  const server = http.createServer((req, res) => {
    void handleRequest(req, res, config, sessions);
  });

  return { server, config, sessions };
}

function startServer(overrides = {}) {
  const { server, config } = createAlbumServer(overrides);
  server.listen(config.port, config.host, () => {
    console.log(`SPACEGARDEN is running at http://${config.host}:${config.port}`);
    if (config.storageMode === "local") {
      console.log(`Local uploads are stored at ${config.storageRoot}`);
      if (config.storageRootSource === "render-default") {
        console.log("On Render, attach a persistent disk to this same path to keep uploads across deploys.");
      }
    } else if (config.storageMode === "r2") {
      console.log("Using Cloudflare R2 for image and album storage.");
    }
    if (config.adminPassword === DEFAULT_ADMIN_PASSWORD) {
      console.log("Admin password is using the built-in default value. Set ADMIN_PASSWORD before production use.");
    }
  });
  return server;
}

function resolveStoragePaths(overrides = {}) {
  const legacyStorageRoot = path.resolve(overrides.legacyStorageDir || __dirname);
  const explicitStorageDir = overrides.storageDir || process.env.STORAGE_DIR;

  if (explicitStorageDir) {
    return {
      storageRoot: path.resolve(explicitStorageDir),
      legacyStorageRoot,
      source: "explicit",
    };
  }

  if (String(process.env.RENDER || "").toLowerCase() === "true") {
    return {
      storageRoot: DEFAULT_RENDER_STORAGE_DIR,
      legacyStorageRoot,
      source: "render-default",
    };
  }

  return {
    storageRoot: legacyStorageRoot,
    legacyStorageRoot,
    source: "legacy-default",
  };
}

async function handleRequest(req, res, config, sessions) {
  applySecurityHeaders(res);

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (req.method === "GET" && pathname === "/api/photos") {
      return sendJson(res, 200, { photos: await listPhotos(config) });
    }

    if (req.method === "GET" && pathname === "/api/admin/session") {
      return sendJson(res, 200, { authenticated: isAuthenticated(req, sessions) });
    }

    if (req.method === "POST" && pathname === "/api/admin/login") {
      return handleAdminLogin(req, res, config, sessions);
    }

    if (req.method === "POST" && pathname === "/api/admin/logout") {
      return handleAdminLogout(req, res, sessions);
    }

    if (req.method === "POST" && pathname === "/api/admin/photos") {
      return handlePhotoUpload(req, res, config, sessions);
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/admin/photos/")) {
      const photoId = pathname.replace("/api/admin/photos/", "").trim();
      return handlePhotoUpdate(req, res, config, sessions, photoId);
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/admin/photos/")) {
      const photoId = pathname.replace("/api/admin/photos/", "").trim();
      return handlePhotoDelete(req, res, config, sessions, photoId);
    }

    if (req.method === "GET" && pathname === "/") {
      return serveFile(res, path.join(config.publicDir, "index.html"));
    }

    if (req.method === "GET" && pathname === "/admin") {
      return serveFile(res, path.join(config.publicDir, "admin.html"));
    }

    if (req.method === "GET" && pathname.startsWith("/uploads/")) {
      const relativePath = pathname.replace("/uploads/", "");
      return serveUploadedAsset(res, config, relativePath);
    }

    if (req.method === "GET") {
      const relativePath = pathname.replace(/^\//, "");
      return servePublicAsset(res, config.publicDir, relativePath);
    }

    return sendJson(res, 404, { error: "Route not found." });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const message = statusCode >= 500 ? "Something went wrong on the server." : error.message;
    if (statusCode >= 500) {
      console.error(error);
    }
    return sendJson(res, statusCode, { error: message });
  }
}

function applySecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'"
  );
}

async function listPhotos(config) {
  const photos = await readAlbum(config);
  return photos.sort((left, right) => {
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

async function readAlbum(config) {
  const parsed = await config.storage.readAlbum();
  if (!Array.isArray(parsed)) {
    return [];
  }

  const normalizedPhotos = parsed.map((photo) => normalizePhotoRecord(photo));
  const hasChanges = normalizedPhotos.some((photo, index) => {
    const current = parsed[index] || {};
    return photo.title !== current.title || photo.description !== current.description || photo.url !== current.url || photo.filename !== current.filename;
  });

  if (hasChanges) {
    await writeAlbum(config, normalizedPhotos);
  }

  return normalizedPhotos;
}

async function writeAlbum(config, photos) {
  await config.storage.writeAlbum(photos);
}

async function handleAdminLogin(req, res, config, sessions) {
  const body = await parseJsonBody(req, 8 * 1024);
  const password = typeof body.password === "string" ? body.password : "";

  if (!password || password !== config.adminPassword) {
    return sendJson(res, 401, { error: "Invalid admin password." });
  }

  const token = crypto.randomUUID();
  sessions.set(token, {
    expiresAt: Date.now() + config.sessionTtlMs,
  });

  res.setHeader("Set-Cookie", buildSessionCookie(token, config.sessionTtlMs));
  return sendJson(res, 200, { authenticated: true });
}

async function handleAdminLogout(req, res, sessions) {
  const cookies = parseCookies(req);
  const token = cookies.album_admin;
  if (token) {
    sessions.delete(token);
  }

  res.setHeader("Set-Cookie", clearSessionCookie());
  return sendJson(res, 200, { authenticated: false });
}

async function handlePhotoUpload(req, res, config, sessions) {
  if (!isAuthenticated(req, sessions)) {
    return sendJson(res, 401, { error: "Admin login required." });
  }

  const contentType = req.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return sendJson(res, 400, { error: "Upload requests must use multipart/form-data." });
  }

  const body = await collectRequestBody(req, config.maxUploadBytes);
  const { fields, files } = parseMultipartForm(body, contentType);
  const file = files.find((entry) => entry.fieldName === "photo") || files[0];

  if (!file) {
    return sendJson(res, 400, { error: "Choose an image before uploading." });
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.contentType)) {
    return sendJson(res, 400, { error: "Only JPG, PNG, WEBP, GIF, and AVIF images are supported." });
  }

  const storedFileName = `${Date.now()}-${crypto.randomUUID()}${pickExtension(file.filename, file.contentType)}`;
  await config.storage.writeAsset(storedFileName, file);

  const title = sanitizeInlineText(fields.title, 120) || titleFromFilename(file.filename);
  const description = sanitizeDescriptionText(fields.description, 8000);
  const createdAt = new Date().toISOString();

  const photo = {
    id: crypto.randomUUID(),
    title,
    description,
    filename: storedFileName,
    originalFilename: file.filename,
    mimeType: file.contentType,
    size: file.data.length,
    createdAt,
    url: buildPhotoUrl(storedFileName),
  };

  const photos = await readAlbum(config);
  photos.unshift(photo);
  await writeAlbum(config, photos);

  return sendJson(res, 201, { photo });
}

async function handlePhotoDelete(req, res, config, sessions, photoId) {
  if (!isAuthenticated(req, sessions)) {
    return sendJson(res, 401, { error: "Admin login required." });
  }

  if (!photoId) {
    return sendJson(res, 400, { error: "Missing photo id." });
  }

  const photos = await readAlbum(config);
  const photoIndex = photos.findIndex((photo) => photo.id === photoId);

  if (photoIndex === -1) {
    return sendJson(res, 404, { error: "Photo not found." });
  }

  const [photo] = photos.splice(photoIndex, 1);
  await writeAlbum(config, photos);

  if (photo.filename) {
    await config.storage.deleteAsset(photo.filename);
  }

  return sendJson(res, 200, { deletedId: photo.id });
}

async function handlePhotoUpdate(req, res, config, sessions, photoId) {
  if (!isAuthenticated(req, sessions)) {
    return sendJson(res, 401, { error: "Admin login required." });
  }

  if (!photoId) {
    return sendJson(res, 400, { error: "Missing photo id." });
  }

  const body = await parseJsonBody(req, 24 * 1024);
  const hasTitle = Object.prototype.hasOwnProperty.call(body, "title");
  const hasDescription = Object.prototype.hasOwnProperty.call(body, "description");

  if (!hasTitle && !hasDescription) {
    return sendJson(res, 400, { error: "Add a title or description to update." });
  }

  const photos = await readAlbum(config);
  const photoIndex = photos.findIndex((photo) => photo.id === photoId);

  if (photoIndex === -1) {
    return sendJson(res, 404, { error: "Photo not found." });
  }

  const currentPhoto = photos[photoIndex];
  const nextTitle = hasTitle ? sanitizeInlineText(body.title, 120) : currentPhoto.title;
  const nextDescription = hasDescription ? sanitizeDescriptionText(body.description, 8000) : currentPhoto.description;
  const updatedPhoto = {
    ...currentPhoto,
    title: nextTitle || currentPhoto.title || "Untitled photo",
    description: nextDescription,
  };

  photos[photoIndex] = updatedPhoto;
  await writeAlbum(config, photos);

  return sendJson(res, 200, { photo: updatedPhoto });
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) {
        return cookies;
      }
      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function isAuthenticated(req, sessions) {
  const token = parseCookies(req).album_admin;
  if (!token) {
    return false;
  }

  const session = sessions.get(token);
  if (!session) {
    return false;
  }

  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }

  return true;
}

function buildSessionCookie(token, maxAgeMs) {
  return `album_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
}

function clearSessionCookie() {
  return "album_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
}

async function parseJsonBody(req, maxBytes) {
  const body = await collectRequestBody(req, maxBytes);
  if (body.length === 0) {
    return {};
  }

  try {
    return JSON.parse(body.toString("utf8"));
  } catch (error) {
    throw createHttpError(400, "Request body must be valid JSON.");
  }
}

async function collectRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;

    req.on("data", (chunk) => {
      if (exceeded) {
        return;
      }

      size += chunk.length;
      if (size > maxBytes) {
        exceeded = true;
        req.resume();
        reject(createHttpError(413, "Upload is too large."));
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!exceeded) {
        resolve(Buffer.concat(chunks));
      }
    });

    req.on("error", reject);
  });
}

function parseMultipartForm(body, contentType) {
  const boundaryMatch = /boundary=([^;]+)/i.exec(contentType);
  if (!boundaryMatch) {
    throw createHttpError(400, "Missing multipart boundary.");
  }

  const boundary = boundaryMatch[1].trim().replace(/^"|"$/g, "");
  const raw = body.toString("latin1");
  const parts = raw.split(`--${boundary}`).slice(1, -1);
  const fields = {};
  const files = [];

  for (const rawPart of parts) {
    let part = rawPart;

    if (part.startsWith("\r\n")) {
      part = part.slice(2);
    }

    if (part.endsWith("\r\n")) {
      part = part.slice(0, -2);
    }

    if (!part) {
      continue;
    }

    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      continue;
    }

    const headerText = part.slice(0, headerEnd);
    const bodyText = part.slice(headerEnd + 4);
    const headers = {};

    for (const headerLine of headerText.split("\r\n")) {
      const separatorIndex = headerLine.indexOf(":");
      if (separatorIndex === -1) {
        continue;
      }
      const key = headerLine.slice(0, separatorIndex).trim().toLowerCase();
      const value = headerLine.slice(separatorIndex + 1).trim();
      headers[key] = value;
    }

    const disposition = headers["content-disposition"] || "";
    const nameMatch = /name="([^"]+)"/i.exec(disposition);
    if (!nameMatch) {
      continue;
    }

    const fieldName = nameMatch[1];
    const fileNameMatch = /filename="([^"]*)"/i.exec(disposition);

    if (fileNameMatch && fileNameMatch[1]) {
      files.push({
        fieldName,
        filename: path.basename(fileNameMatch[1]),
        contentType: headers["content-type"] || "application/octet-stream",
        data: Buffer.from(bodyText, "latin1"),
      });
    } else {
      fields[fieldName] = bodyText;
    }
  }

  return { fields, files };
}

function pickExtension(filename, mimeType) {
  const ext = path.extname(filename || "").toLowerCase();
  if (EXTENSIONS_BY_TYPE[mimeType] && ext === EXTENSIONS_BY_TYPE[mimeType]) {
    return ext;
  }
  if (ext && Object.values(EXTENSIONS_BY_TYPE).includes(ext)) {
    return ext;
  }
  return EXTENSIONS_BY_TYPE[mimeType] || ".jpg";
}

function titleFromFilename(filename) {
  const baseName = path.parse(filename).name || "Untitled photo";
  const cleaned = baseName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "Untitled photo";
  }

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function sanitizeInlineText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return repairMojibake(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeDescriptionText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  let normalized = repairMojibake(value).replace(/\r\n?/g, "\n");

  for (const { pattern, replacement } of DESCRIPTION_SECTION_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  normalized = normalized.replace(/\s+--no\s+/giu, "\n\nNegative prompt:\nno ");
  normalized = normalized
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== ":")
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1] !== ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized.slice(0, maxLength);
}

function repairMojibake(value) {
  let normalized = String(value ?? "");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!MOJIBAKE_MARKER.test(normalized)) {
      break;
    }

    const repaired = Buffer.from(normalized, "latin1").toString("utf8");
    if (!repaired || repaired.includes("\uFFFD") || countMojibakeMarkers(repaired) >= countMojibakeMarkers(normalized)) {
      break;
    }

    normalized = repaired;
  }

  return normalized;
}

function countMojibakeMarkers(value) {
  const matches = String(value ?? "").match(/[\u00C3\u00C2\u00E2\u00F0][\u0080-\u017F]/gu);
  return matches ? matches.length : 0;
}

function normalizePhotoRecord(photo) {
  const source = photo && typeof photo === "object" ? photo : {};
  const filename = normalizeStoredFilename(source.filename);
  const title = sanitizeInlineText(source.title, 120) || "Untitled photo";
  const description = sanitizeDescriptionText(source.description, 8000);

  return {
    ...source,
    filename,
    title,
    description,
    url: filename ? buildPhotoUrl(filename) : source.url || "",
  };
}

async function serveUploadedAsset(res, config, relativePath) {
  const asset = await config.storage.readAsset(relativePath);
  if (!asset) {
    return sendJson(res, 404, { error: "File not found." });
  }

  const body = Buffer.isBuffer(asset.data) ? asset.data : Buffer.from(asset.data || "");
  res.writeHead(200, {
    "Content-Type": asset.contentType || getContentType(relativePath),
    "Content-Length": asset.contentLength || body.length,
    ...(asset.cacheControl ? { "Cache-Control": asset.cacheControl } : {}),
  });
  res.end(body);
}

function servePublicAsset(res, baseDir, relativePath) {
  const filePath = safeResolve(baseDir, relativePath);
  if (!filePath) {
    return sendJson(res, 404, { error: "File not found." });
  }
  return serveFile(res, filePath);
}

function safeResolve(baseDir, relativePath) {
  const normalizedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(baseDir, relativePath);

  if (resolvedPath !== normalizedBase && !resolvedPath.startsWith(`${normalizedBase}${path.sep}`)) {
    return null;
  }

  return resolvedPath;
}

function serveFile(res, filePath) {
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      return sendJson(res, 404, { error: "File not found." });
    }

    res.writeHead(200, {
      "Content-Type": getContentType(filePath),
      "Content-Length": stats.size,
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on("error", () => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Unable to read the requested file." });
      } else {
        res.destroy();
      }
    });
  });
}

function getContentType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function normalizeStoredFilename(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createAlbumServer,
  startServer,
};

