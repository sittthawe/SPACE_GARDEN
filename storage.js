const fs = require("fs");
const path = require("path");

function buildStorageSettings(overrides = {}) {
  if (overrides.storage) {
    return {
      mode: overrides.storage.mode || "custom",
      r2: null,
    };
  }

  const explicitMode = overrides.storageMode || process.env.STORAGE_MODE || "";
  const r2 = buildR2Settings(overrides.r2);

  if (explicitMode === "local") {
    return {
      mode: "local",
      r2: null,
    };
  }

  if (explicitMode === "r2" && !r2) {
    throw new Error("R2 storage mode requires R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.");
  }

  if (explicitMode === "r2" || r2) {
    return {
      mode: "r2",
      r2,
    };
  }

  return {
    mode: "local",
    r2: null,
  };
}

function createStorageAdapter(config, overrides = {}) {
  if (overrides.storage) {
    return overrides.storage;
  }

  if (config.storageMode === "r2") {
    return createR2Storage(config);
  }

  return createLocalStorage(config);
}

function createLocalStorage(config) {
  initializeLocalStorage(config);

  return {
    mode: "local",
    async readAlbum() {
      try {
        const raw = await fs.promises.readFile(config.dataFile, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        if (error.code === "ENOENT") {
          return readFirstAvailableAlbum(config);
        }
        throw error;
      }
    },
    async writeAlbum(photos) {
      const serialized = `${JSON.stringify(photos, null, 2)}\n`;
      await fs.promises.writeFile(config.dataFile, serialized, "utf8");
      await mirrorAlbumWrites(config, serialized);
    },
    async writeAsset(filename, file) {
      const filePath = resolveLocalUploadPath(config.uploadsDir, filename);
      if (!filePath) {
        throw Object.assign(new Error("Invalid upload path."), { statusCode: 400 });
      }

      await fs.promises.writeFile(filePath, file.data);
      await mirrorAssetWrites(config, filename, file.data);
    },
    async deleteAsset(filename) {
      await deleteLocalAsset(config.uploadsDir, filename, true);
      await mirrorAssetDeletes(config, filename);
    },
    async readAsset(filename) {
      for (const uploadsDir of [config.uploadsDir, ...getReplicaUploadDirs(config)]) {
        const asset = await readLocalAssetFromDirectory(uploadsDir, filename);
        if (asset) {
          return asset;
        }
      }

      return null;
    },
  };
}

function initializeLocalStorage(config) {
  fs.mkdirSync(config.publicDir, { recursive: true });
  fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  ensureReplicaDirectories(config);

  migrateLegacyAlbum(config);
  migrateLegacyUploads(config);

  if (!fs.existsSync(config.dataFile)) {
    fs.writeFileSync(config.dataFile, "[]\n", "utf8");
  }
}

function migrateLegacyAlbum(config) {
  if (fs.existsSync(config.dataFile)) {
    return;
  }

  for (const sourceFile of getAlbumMigrationSources(config)) {
    if (!fs.existsSync(sourceFile)) {
      continue;
    }

    fs.copyFileSync(sourceFile, config.dataFile);
    return;
  }
}

function migrateLegacyUploads(config) {
  for (const sourceDir of getUploadMigrationSources(config)) {
    if (!fs.existsSync(sourceDir)) {
      continue;
    }

    copyDirectoryContents(sourceDir, config.uploadsDir);
  }
}

function ensureReplicaDirectories(config) {
  for (const dataFile of getReplicaDataFiles(config)) {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  }

  for (const uploadsDir of getReplicaUploadDirs(config)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

function copyDirectoryContents(sourceDir, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, destinationPath);
      continue;
    }

    if (!entry.isFile() || fs.existsSync(destinationPath)) {
      continue;
    }

    fs.copyFileSync(sourcePath, destinationPath);
  }
}

async function readFirstAvailableAlbum(config) {
  for (const dataFile of getReplicaDataFiles(config)) {
    try {
      const raw = await fs.promises.readFile(dataFile, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  return [];
}

async function mirrorAlbumWrites(config, serialized) {
  for (const dataFile of getReplicaDataFiles(config)) {
    await mirrorWrite(() => fs.promises.writeFile(dataFile, serialized, "utf8"), `album metadata to ${dataFile}`);
  }
}

async function mirrorAssetWrites(config, filename, data) {
  for (const uploadsDir of getReplicaUploadDirs(config)) {
    const filePath = resolveLocalUploadPath(uploadsDir, filename);
    if (!filePath) {
      continue;
    }

    await mirrorWrite(() => fs.promises.writeFile(filePath, data), `upload asset to ${filePath}`);
  }
}

async function mirrorAssetDeletes(config, filename) {
  for (const uploadsDir of getReplicaUploadDirs(config)) {
    await deleteLocalAsset(uploadsDir, filename, false);
  }
}

async function deleteLocalAsset(baseDir, filename, strict) {
  const filePath = resolveLocalUploadPath(baseDir, filename);
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }

    if (strict) {
      throw error;
    }

    console.warn(`Unable to remove mirrored upload at ${filePath}: ${error.message}`);
  }
}

async function readLocalAssetFromDirectory(baseDir, filename) {
  const filePath = resolveLocalUploadPath(baseDir, filename);
  if (!filePath) {
    return null;
  }

  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) {
      return null;
    }

    return {
      stream: fs.createReadStream(filePath),
      contentLength: stats.size,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function mirrorWrite(writeOperation, label) {
  try {
    await writeOperation();
  } catch (error) {
    console.warn(`Unable to mirror ${label}: ${error.message}`);
  }
}

function getReplicaDataFiles(config) {
  return uniquePaths(config.replicaDataFiles || []);
}

function getReplicaUploadDirs(config) {
  return uniquePaths(config.replicaUploadsDirs || []);
}

function getAlbumMigrationSources(config) {
  return uniquePaths([...(config.replicaDataFiles || []), config.legacyDataFile]).filter(
    (entry) => entry && !pathsMatch(entry, config.dataFile)
  );
}

function getUploadMigrationSources(config) {
  return uniquePaths([...(config.replicaUploadsDirs || []), config.legacyUploadsDir]).filter(
    (entry) => entry && !pathsMatch(entry, config.uploadsDir)
  );
}

function uniquePaths(paths) {
  return paths
    .filter(Boolean)
    .map((entry) => path.resolve(entry))
    .filter((entry, index, values) => values.findIndex((candidate) => pathsMatch(candidate, entry)) === index);
}

function pathsMatch(left, right) {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);

  if (process.platform === "win32") {
    return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase();
  }

  return resolvedLeft === resolvedRight;
}

function createR2Storage(config) {
  const client = createR2Client(config.r2);

  return {
    mode: "r2",
    async readAlbum() {
      const { GetObjectCommand } = getS3Sdk();

      try {
        const response = await client.send(
          new GetObjectCommand({
            Bucket: config.r2.bucket,
            Key: config.r2.albumKey,
          })
        );

        const raw = (await bodyToBuffer(response.Body)).toString("utf8");
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        if (isMissingObjectError(error)) {
          return [];
        }
        throw error;
      }
    },
    async writeAlbum(photos) {
      const { PutObjectCommand } = getS3Sdk();

      await client.send(
        new PutObjectCommand({
          Bucket: config.r2.bucket,
          Key: config.r2.albumKey,
          Body: `${JSON.stringify(photos, null, 2)}\n`,
          ContentType: "application/json; charset=utf-8",
        })
      );
    },
    async writeAsset(filename, file) {
      const { PutObjectCommand } = getS3Sdk();

      await client.send(
        new PutObjectCommand({
          Bucket: config.r2.bucket,
          Key: buildR2ObjectKey(config.r2.uploadPrefix, filename),
          Body: file.data,
          ContentType: file.contentType,
          CacheControl: "public, max-age=31536000, immutable",
        })
      );
    },
    async deleteAsset(filename) {
      const { DeleteObjectCommand } = getS3Sdk();

      await client.send(
        new DeleteObjectCommand({
          Bucket: config.r2.bucket,
          Key: buildR2ObjectKey(config.r2.uploadPrefix, filename),
        })
      );
    },
    async readAsset(filename) {
      const { GetObjectCommand } = getS3Sdk();

      try {
        const response = await client.send(
          new GetObjectCommand({
            Bucket: config.r2.bucket,
            Key: buildR2ObjectKey(config.r2.uploadPrefix, filename),
          })
        );

        const data = await bodyToBuffer(response.Body);
        return {
          data,
          contentLength: response.ContentLength || data.length,
          contentType: response.ContentType,
          cacheControl: response.CacheControl,
        };
      } catch (error) {
        if (isMissingObjectError(error)) {
          return null;
        }
        throw error;
      }
    },
  };
}

function buildR2Settings(overrides = {}) {
  const settings = {
    accountId: overrides.accountId || process.env.R2_ACCOUNT_ID || "",
    bucket: overrides.bucket || process.env.R2_BUCKET || "",
    accessKeyId: overrides.accessKeyId || process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: overrides.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY || "",
    endpoint: overrides.endpoint || process.env.R2_ENDPOINT || "",
    albumKey: normalizeObjectKey(overrides.albumKey || process.env.R2_ALBUM_KEY || "album.json", "album.json"),
    uploadPrefix: normalizePrefix(overrides.uploadPrefix || process.env.R2_UPLOAD_PREFIX || "uploads"),
  };

  const requiredValues = [settings.accountId, settings.bucket, settings.accessKeyId, settings.secretAccessKey];
  const hasAny = requiredValues.some(Boolean);
  const hasAll = requiredValues.every(Boolean);

  if (!hasAny) {
    return null;
  }

  if (!hasAll) {
    throw new Error("R2 storage requires R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.");
  }

  return {
    ...settings,
    endpoint: settings.endpoint || `https://${settings.accountId}.r2.cloudflarestorage.com`,
  };
}

function createR2Client(r2Config) {
  const { S3Client } = getS3Sdk();

  return new S3Client({
    region: "auto",
    endpoint: r2Config.endpoint,
    credentials: {
      accessKeyId: r2Config.accessKeyId,
      secretAccessKey: r2Config.secretAccessKey,
    },
  });
}

function getS3Sdk() {
  try {
    return require("@aws-sdk/client-s3");
  } catch (error) {
    error.message = `${error.message} Install @aws-sdk/client-s3 before using R2 storage.`;
    throw error;
  }
}

function buildPhotoUrl(filename) {
  const segments = String(filename || "")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment));

  return `/uploads/${segments.join("/")}`;
}

function resolveLocalUploadPath(baseDir, relativePath) {
  const safePath = normalizeObjectKey(relativePath, "");
  if (!safePath) {
    return null;
  }

  const normalizedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(baseDir, safePath);
  if (resolvedPath !== normalizedBase && !resolvedPath.startsWith(`${normalizedBase}${path.sep}`)) {
    return null;
  }

  return resolvedPath;
}

function buildR2ObjectKey(prefix, relativePath) {
  const safePath = normalizeObjectKey(relativePath, "");
  if (!safePath) {
    throw Object.assign(new Error("Invalid object key."), { statusCode: 400 });
  }

  return prefix ? `${prefix}/${safePath}` : safePath;
}

function normalizePrefix(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function normalizeObjectKey(value, fallback) {
  const normalized = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");

  if (!normalized) {
    return fallback;
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return fallback;
  }

  return normalized;
}

async function bodyToBuffer(body) {
  if (!body) {
    return Buffer.alloc(0);
  }

  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (typeof body === "string") {
    return Buffer.from(body);
  }

  if (typeof body.transformToByteArray === "function") {
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  if (typeof body.getReader === "function") {
    const chunks = [];
    const reader = body.getReader();

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      chunks.push(Buffer.from(value));
    }

    return Buffer.concat(chunks);
  }

  if (typeof body[Symbol.asyncIterator] === "function") {
    const chunks = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported object body type.");
}

function isMissingObjectError(error) {
  return (
    error?.name === "NoSuchKey" ||
    error?.name === "NotFound" ||
    error?.$metadata?.httpStatusCode === 404
  );
}

module.exports = {
  buildPhotoUrl,
  buildStorageSettings,
  createStorageAdapter,
};
