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
  fs.mkdirSync(config.publicDir, { recursive: true });
  fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });
  fs.mkdirSync(config.uploadsDir, { recursive: true });

  if (!fs.existsSync(config.dataFile)) {
    fs.writeFileSync(config.dataFile, "[]\n", "utf8");
  }

  return {
    mode: "local",
    async readAlbum() {
      try {
        const raw = await fs.promises.readFile(config.dataFile, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        if (error.code === "ENOENT") {
          return [];
        }
        throw error;
      }
    },
    async writeAlbum(photos) {
      await fs.promises.writeFile(config.dataFile, `${JSON.stringify(photos, null, 2)}\n`, "utf8");
    },
    async writeAsset(filename, file) {
      const filePath = resolveLocalUploadPath(config.uploadsDir, filename);
      if (!filePath) {
        throw Object.assign(new Error("Invalid upload path."), { statusCode: 400 });
      }

      await fs.promises.writeFile(filePath, file.data);
    },
    async deleteAsset(filename) {
      const filePath = resolveLocalUploadPath(config.uploadsDir, filename);
      if (!filePath) {
        return;
      }

      try {
        await fs.promises.unlink(filePath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    },
    async readAsset(filename) {
      const filePath = resolveLocalUploadPath(config.uploadsDir, filename);
      if (!filePath) {
        return null;
      }

      try {
        const data = await fs.promises.readFile(filePath);
        return {
          data,
          contentLength: data.length,
        };
      } catch (error) {
        if (error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
  };
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
