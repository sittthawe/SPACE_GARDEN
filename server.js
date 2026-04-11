const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { createPhotoDatabase } = require("./database");
const { buildStorageSettings, createStorageAdapter } = require("./storage");

const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_ADMIN_PASSWORD = "RasDave26";
const DEFAULT_RENDER_STORAGE_DIR = path.join(process.cwd(), "storage");
const DEFAULT_RENDER_REPLICA_STORAGE_DIRS = ["/var/data"];
const DEFAULT_VERCEL_STORAGE_DIR = path.join(os.tmpdir(), "spacegarden-storage");

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

function buildConfig(overrides = {}) {
  const storageSettings = buildStorageSettings(overrides);
  const defaultHost = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
  const resolvedStorage = resolveStoragePaths(overrides);
  const uploadsDir = overrides.uploadsDir || path.join(resolvedStorage.storageRoot, "uploads");
  const dataFile = overrides.dataFile || path.join(resolvedStorage.storageRoot, "data", "album.json");
  const replicaStorageRoots = resolvedStorage.replicaStorageRoots || [];
  const useImplicitLegacyFallback = !overrides.uploadsDir && !overrides.dataFile;
  const adminPassword = overrides.adminPassword || process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;

  return {
    host: overrides.host || defaultHost,
    port: overrides.port ?? Number(process.env.PORT || 3000),
    publicDir: overrides.publicDir || PUBLIC_DIR,
    storageRoot: resolvedStorage.storageRoot,
    storageRootSource: resolvedStorage.source,
    uploadsDir,
    dataFile,
    replicaStorageRoots,
    replicaUploadsDirs: replicaStorageRoots.map((root) => path.join(root, "uploads")),
    replicaDataFiles: replicaStorageRoots.map((root) => path.join(root, "data", "album.json")),
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
    adminPassword,
    sessionSecret: overrides.sessionSecret || process.env.SESSION_SECRET || adminPassword,
  };
}

function createAlbumServer(overrides = {}) {
  const config = buildConfig(overrides);
  config.storage = createStorageAdapter(config, overrides);
  config.database = createPhotoDatabase(config.storage);

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
      if (config.replicaStorageRoots.length > 0) {
        console.log(`Additional local storage roots detected: ${config.replicaStorageRoots.join(", ")}`);
      }
      if (isRenderEnvironment()) {
        if (config.storageRootSource === "explicit") {
          console.log(`Render persistence is using STORAGE_DIR=${config.storageRoot}.`);
        } else {
          const durableRoots = [config.storageRoot, ...config.replicaStorageRoots];
          console.log(
            `On Render, attach a persistent disk at ${durableRoots.join(" or ")} or set STORAGE_DIR to your disk path to keep uploads across deploys.`
          );
        }
      } else if (isVercelEnvironment() && config.storageRootSource === "vercel-default") {
        console.log(
          `On Vercel, local storage is using the temporary directory ${config.storageRoot}. Configure R2 to keep uploads and album metadata across invocations and deploys.`
        );
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
  const renderDefaultStorageRoot = path.resolve(overrides.renderDefaultStorageDir || DEFAULT_RENDER_STORAGE_DIR);
  const vercelDefaultStorageRoot = path.resolve(overrides.vercelDefaultStorageDir || DEFAULT_VERCEL_STORAGE_DIR);
  const explicitStorageDir = overrides.storageDir || process.env.STORAGE_DIR;

  if (explicitStorageDir) {
    return {
      storageRoot: path.resolve(explicitStorageDir),
      legacyStorageRoot,
      replicaStorageRoots: [],
      source: "explicit",
    };
  }

  if (isRenderEnvironment()) {
    return {
      storageRoot: renderDefaultStorageRoot,
      legacyStorageRoot,
      replicaStorageRoots: resolveRenderReplicaStorageRoots(overrides, renderDefaultStorageRoot, legacyStorageRoot),
      source: "render-default",
    };
  }

  if (isVercelEnvironment()) {
    return {
      storageRoot: vercelDefaultStorageRoot,
      legacyStorageRoot,
      replicaStorageRoots: [],
      source: "vercel-default",
    };
  }

  return {
    storageRoot: legacyStorageRoot,
    legacyStorageRoot,
    replicaStorageRoots: [],
    source: "legacy-default",
  };
}

function isRenderEnvironment() {
  return String(process.env.RENDER || "").toLowerCase() === "true";
}

function isVercelEnvironment() {
  return String(process.env.VERCEL || "") === "1";
}

function resolveRenderReplicaStorageRoots(overrides, storageRoot, legacyStorageRoot) {
  const configuredRoots =
    overrides.renderReplicaStorageDirs ||
    process.env.RENDER_REPLICA_STORAGE_DIRS?.split(path.delimiter) ||
    DEFAULT_RENDER_REPLICA_STORAGE_DIRS;

  return configuredRoots
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry))
    .filter((entry, index, values) => values.findIndex((candidate) => pathsMatch(candidate, entry)) === index)
    .filter((entry) => !pathsMatch(entry, storageRoot) && !pathsMatch(entry, legacyStorageRoot))
    .filter((entry) => fs.existsSync(entry));
}

function pathsMatch(left, right) {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);

  if (process.platform === "win32") {
    return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase();
  }

  return resolvedLeft === resolvedRight;
}

async function handleRequest(req, res, config, sessions) {
  applySecurityHeaders(res);

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (req.method === "GET" && pathname === "/api/photos") {
      return sendJson(res, 200, { photos: await config.database.listPhotos() });
    }

    if (req.method === "GET" && pathname === "/api/system") {
      return sendJson(res, 200, {
        backend: {
          runtime: "node-http",
        },
        database: config.database.describe(),
      });
    }

    if (req.method === "GET" && pathname === "/api/admin/session") {
      return sendJson(res, 200, { authenticated: isAuthenticated(req, config) });
    }

    if (req.method === "POST" && pathname === "/api/admin/login") {
      return handleAdminLogin(req, res, config);
    }

    if (req.method === "POST" && pathname === "/api/admin/logout") {
      return handleAdminLogout(req, res);
    }

    if (req.method === "POST" && pathname === "/api/admin/photos") {
      return handlePhotoUpload(req, res, config);
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/admin/photos/")) {
      const photoId = pathname.replace("/api/admin/photos/", "").trim();
      return handlePhotoUpdate(req, res, config, photoId);
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/admin/photos/")) {
      const photoId = pathname.replace("/api/admin/photos/", "").trim();
      return handlePhotoDelete(req, res, config, photoId);
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

async function handleAdminLogin(req, res, config) {
  const body = await parseJsonBody(req, 8 * 1024);
  const password = typeof body.password === "string" ? body.password : "";

  if (!password || password !== config.adminPassword) {
    return sendJson(res, 401, { error: "Invalid admin password." });
  }

  res.setHeader("Set-Cookie", buildSessionCookie(createSessionToken(config), config.sessionTtlMs));
  return sendJson(res, 200, { authenticated: true });
}

async function handleAdminLogout(req, res) {
  res.setHeader("Set-Cookie", clearSessionCookie());
  return sendJson(res, 200, { authenticated: false });
}

async function handlePhotoUpload(req, res, config) {
  if (!isAuthenticated(req, config)) {
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
  const photo = await config.database.createPhoto({
    title: fields.title,
    description: fields.description,
    file,
    filename: storedFileName,
  });

  return sendJson(res, 201, { photo });
}

async function handlePhotoDelete(req, res, config, photoId) {
  if (!isAuthenticated(req, config)) {
    return sendJson(res, 401, { error: "Admin login required." });
  }

  if (!photoId) {
    return sendJson(res, 400, { error: "Missing photo id." });
  }

  const photo = await config.database.deletePhoto(photoId);
  if (!photo) {
    return sendJson(res, 404, { error: "Photo not found." });
  }

  if (photo.filename) {
    await config.storage.deleteAsset(photo.filename);
  }

  return sendJson(res, 200, { deletedId: photo.id });
}

async function handlePhotoUpdate(req, res, config, photoId) {
  if (!isAuthenticated(req, config)) {
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

  const updatedPhoto = await config.database.updatePhoto(photoId, body);
  if (!updatedPhoto) {
    return sendJson(res, 404, { error: "Photo not found." });
  }

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

function isAuthenticated(req, config) {
  const token = parseCookies(req).album_admin;
  if (!token) {
    return false;
  }

  return Boolean(readSessionToken(token, config));
}

function buildSessionCookie(token, maxAgeMs) {
  const segments = [
    `album_admin=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];

  if (shouldUseSecureCookies()) {
    segments.push("Secure");
  }

  return segments.join("; ");
}

function clearSessionCookie() {
  const segments = ["album_admin=", "HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=0"];

  if (shouldUseSecureCookies()) {
    segments.push("Secure");
  }

  return segments.join("; ");
}

function shouldUseSecureCookies() {
  return isVercelEnvironment() || String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function createSessionToken(config) {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Date.now() + config.sessionTtlMs,
    }),
    "utf8"
  ).toString("base64url");

  return `${payload}.${signSessionPayload(payload, config.sessionSecret)}`;
}

function readSessionToken(token, config) {
  if (typeof token !== "string") {
    return null;
  }

  const separatorIndex = token.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
    return null;
  }

  const payload = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  const expectedSignature = signSessionPayload(payload, config.sessionSecret);
  if (!safeTokenEquals(signature, expectedSignature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed.exp !== "number" || parsed.exp < Date.now()) {
      return null;
    }

    return parsed;
  } catch (error) {
    return null;
  }
}

function signSessionPayload(payload, secret) {
  return crypto.createHmac("sha256", String(secret || DEFAULT_ADMIN_PASSWORD)).update(payload).digest("base64url");
}

function safeTokenEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
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
  const boundaryBuffer = Buffer.from(`--${boundary}`, "latin1");
  const partBoundaryBuffer = Buffer.from(`\r\n--${boundary}`, "latin1");
  const headerSeparator = Buffer.from("\r\n\r\n", "latin1");
  const fields = {};
  const files = [];
  let cursor = body.indexOf(boundaryBuffer);

  while (cursor !== -1) {
    let partStart = cursor + boundaryBuffer.length;

    if (body[partStart] === 0x2d && body[partStart + 1] === 0x2d) {
      break;
    }

    if (body[partStart] === 0x0d && body[partStart + 1] === 0x0a) {
      partStart += 2;
    }

    const headerEnd = body.indexOf(headerSeparator, partStart);
    if (headerEnd === -1) {
      break;
    }

    const headerText = body.toString("latin1", partStart, headerEnd);
    const bodyStart = headerEnd + headerSeparator.length;
    const nextBoundaryIndex = body.indexOf(partBoundaryBuffer, bodyStart);
    if (nextBoundaryIndex === -1) {
      break;
    }

    const partBody = body.subarray(bodyStart, nextBoundaryIndex);
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
        data: partBody,
      });
    } else {
      fields[fieldName] = partBody.toString("utf8");
    }

    cursor = nextBoundaryIndex + 2;
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

async function serveUploadedAsset(res, config, relativePath) {
  const asset = await config.storage.readAsset(relativePath);
  if (!asset) {
    return sendJson(res, 404, { error: "File not found." });
  }

  if (asset.stream) {
    res.writeHead(200, {
      "Content-Type": asset.contentType || getContentType(relativePath),
      "Content-Length": asset.contentLength || 0,
      ...(asset.cacheControl ? { "Cache-Control": asset.cacheControl } : {}),
    });
    asset.stream.pipe(res);
    asset.stream.on("error", () => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Unable to read the requested file." });
      } else {
        res.destroy();
      }
    });
    return;
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

