const crypto = require("crypto");
const path = require("path");

const { buildPhotoUrl } = require("./storage");

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

function createPhotoDatabase(storage) {
  return {
    async listPhotos() {
      const photos = await readAlbum(storage);
      return photos.sort(comparePhotosByDateDesc);
    },
    async createPhoto(input) {
      const filename = normalizeStoredFilename(input.filename || input.storedFilename || input.file?.filename);
      const originalFilename = path.basename(input.file?.filename || input.originalFilename || filename || "image");
      const photo = {
        id: crypto.randomUUID(),
        title: sanitizeInlineText(input.title, 120) || titleFromFilename(originalFilename),
        description: sanitizeDescriptionText(input.description, 8000),
        filename,
        originalFilename,
        mimeType: input.file?.contentType || input.mimeType || "application/octet-stream",
        size: Number(input.file?.data?.length || input.size || 0),
        createdAt: input.createdAt || new Date().toISOString(),
        url: buildPhotoUrl(filename),
      };

      const photos = await readAlbum(storage);
      photos.unshift(photo);
      await storage.writeAlbum(photos);
      return photo;
    },
    async updatePhoto(photoId, updates) {
      const photos = await readAlbum(storage);
      const photoIndex = photos.findIndex((photo) => photo.id === photoId);
      if (photoIndex === -1) {
        return null;
      }

      const currentPhoto = photos[photoIndex];
      const hasTitle = Object.prototype.hasOwnProperty.call(updates, "title");
      const hasDescription = Object.prototype.hasOwnProperty.call(updates, "description");
      const nextTitle = hasTitle ? sanitizeInlineText(updates.title, 120) : currentPhoto.title;
      const nextDescription = hasDescription ? sanitizeDescriptionText(updates.description, 8000) : currentPhoto.description;
      const updatedPhoto = {
        ...currentPhoto,
        title: nextTitle || currentPhoto.title || "Untitled photo",
        description: nextDescription,
      };

      photos[photoIndex] = updatedPhoto;
      await storage.writeAlbum(photos);
      return updatedPhoto;
    },
    async deletePhoto(photoId) {
      const photos = await readAlbum(storage);
      const photoIndex = photos.findIndex((photo) => photo.id === photoId);
      if (photoIndex === -1) {
        return null;
      }

      const [photo] = photos.splice(photoIndex, 1);
      await storage.writeAlbum(photos);
      return photo;
    },
    async getOverview() {
      const photos = await this.listPhotos();
      const totalBytes = photos.reduce((sum, photo) => sum + Number(photo.size || 0), 0);

      return {
        count: photos.length,
        totalBytes,
        latestCreatedAt: photos[0]?.createdAt || "",
        database: describeDatabase(storage),
      };
    },
    describe() {
      return describeDatabase(storage);
    },
  };
}

async function readAlbum(storage) {
  const parsed = await storage.readAlbum();
  if (!Array.isArray(parsed)) {
    return [];
  }

  const normalizedPhotos = parsed.map((photo) => normalizePhotoRecord(photo));
  const hasChanges = normalizedPhotos.some((photo, index) => {
    const current = parsed[index] || {};
    return (
      photo.title !== current.title ||
      photo.description !== current.description ||
      photo.url !== current.url ||
      photo.filename !== current.filename
    );
  });

  if (hasChanges) {
    await storage.writeAlbum(normalizedPhotos);
  }

  return normalizedPhotos;
}

function describeDatabase(storage) {
  if (storage?.mode === "r2") {
    return {
      mode: "r2",
      label: "Cloudflare R2",
      driver: "Object storage",
    };
  }

  return {
    mode: "local",
    label: "Local JSON",
    driver: "File-backed storage",
  };
}

function comparePhotosByDateDesc(left, right) {
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
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

module.exports = {
  createPhotoDatabase,
  sanitizeDescriptionText,
};
