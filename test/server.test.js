const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createAlbumServer } = require("../server");

function toMojibake(value) {
  return Buffer.from(value, "utf8").toString("latin1");
}

function createMemoryStorage() {
  const assets = new Map();
  let album = [];

  return {
    mode: "r2",
    async readAlbum() {
      return JSON.parse(JSON.stringify(album));
    },
    async writeAlbum(photos) {
      album = JSON.parse(JSON.stringify(photos));
    },
    async writeAsset(filename, file) {
      assets.set(filename, {
        data: Buffer.from(file.data),
        contentType: file.contentType,
        contentLength: file.data.length,
        cacheControl: "public, max-age=31536000, immutable",
      });
    },
    async deleteAsset(filename) {
      assets.delete(filename);
    },
    async readAsset(filename) {
      const asset = assets.get(filename);
      return asset
        ? {
            ...asset,
            data: Buffer.from(asset.data),
          }
        : null;
    },
    getAlbum() {
      return JSON.parse(JSON.stringify(album));
    },
    hasAsset(filename) {
      return assets.has(filename);
    },
  };
}

test("photo album API supports login, upload, edit, list, and delete", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spacegarden-"));
  const uploadsDir = path.join(tempRoot, "uploads");
  const dataFile = path.join(tempRoot, "data", "album.json");

  const { server } = createAlbumServer({
    host: "127.0.0.1",
    port: 0,
    uploadsDir,
    dataFile,
    adminPassword: "secret-pass",
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const initialPhotos = await fetch(`${baseUrl}/api/photos`).then((response) => response.json());
  assert.equal(initialPhotos.photos.length, 0);

  const failedLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: "wrong-pass" }),
  });
  assert.equal(failedLogin.status, 401);

  const loginResponse = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: "secret-pass" }),
  });
  assert.equal(loginResponse.status, 200);

  const cookie = (loginResponse.headers.get("set-cookie") || "").split(";")[0];
  assert.match(cookie, /^album_admin=/);

  const form = new FormData();
  form.set("title", "Golden hour");
  form.set("description", "Warm light through the trees");
  form.set("photo", new Blob([Buffer.from([1, 2, 3, 4])], { type: "image/png" }), "golden-hour.png");

  const uploadResponse = await fetch(`${baseUrl}/api/admin/photos`, {
    method: "POST",
    headers: {
      Cookie: cookie,
    },
    body: form,
  });
  assert.equal(uploadResponse.status, 201);

  const uploadPayload = await uploadResponse.json();
  assert.equal(uploadPayload.photo.title, "Golden hour");

  const editResponse = await fetch(`${baseUrl}/api/admin/photos/${uploadPayload.photo.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      title: "Golden hour revised",
      description: "Warm light drifting through the trees at infinity",
    }),
  });
  assert.equal(editResponse.status, 200);

  const editPayload = await editResponse.json();
  assert.equal(editPayload.photo.title, "Golden hour revised");
  assert.equal(editPayload.photo.description, "Warm light drifting through the trees at infinity");

  const listedPhotos = await fetch(`${baseUrl}/api/photos`).then((response) => response.json());
  assert.equal(listedPhotos.photos.length, 1);
  assert.equal(listedPhotos.photos[0].title, "Golden hour revised");
  assert.equal(listedPhotos.photos[0].description, "Warm light drifting through the trees at infinity");

  const deleteResponse = await fetch(`${baseUrl}/api/admin/photos/${uploadPayload.photo.id}`, {
    method: "DELETE",
    headers: {
      Cookie: cookie,
    },
  });
  assert.equal(deleteResponse.status, 200);

  const finalPhotos = await fetch(`${baseUrl}/api/photos`).then((response) => response.json());
  assert.equal(finalPhotos.photos.length, 0);
});

test("photo album repairs mojibake prompt text from stored data", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spacegarden-"));
  const uploadsDir = path.join(tempRoot, "uploads");
  const dataDir = path.join(tempRoot, "data");
  const dataFile = path.join(dataDir, "album.json");
  const expectedDescription = [
    "A surreal biomechanical female humanoid in a clean studio composition",
    "",
    "More dark / creepy version:",
    "black void eyes and chrome spikes",
    "",
    "Optional negative prompt:",
    "blurry, low quality",
  ].join("\n");

  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    dataFile,
    `${JSON.stringify(
      [
        {
          id: "seed-photo",
          title: "Biomechanical Futuristic Cyberpunk",
          description: toMojibake(
            "A surreal biomechanical female humanoid in a clean studio composition 🎯 More Dark / Creepy Version black void eyes and chrome spikes ⚙️ Optional Negative Prompt blurry, low quality"
          ),
          filename: "seed.png",
          originalFilename: "seed.png",
          mimeType: "image/png",
          size: 512,
          createdAt: "2026-03-24T17:04:18.671Z",
          url: "/uploads/seed.png",
        },
      ],
      null,
      2
    )}\n`,
    "utf8"
  );

  const { server } = createAlbumServer({
    host: "127.0.0.1",
    port: 0,
    uploadsDir,
    dataFile,
    adminPassword: "secret-pass",
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const photosPayload = await fetch(`${baseUrl}/api/photos`).then((response) => response.json());
  assert.equal(photosPayload.photos.length, 1);
  assert.equal(photosPayload.photos[0].description, expectedDescription);

  const savedAlbum = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  assert.equal(savedAlbum[0].description, expectedDescription);
});

test("photo album supports remote-style storage adapters for album and image bytes", async (t) => {
  const storage = createMemoryStorage();
  const { server } = createAlbumServer({
    host: "127.0.0.1",
    port: 0,
    storage,
    adminPassword: "secret-pass",
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const loginResponse = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: "secret-pass" }),
  });
  assert.equal(loginResponse.status, 200);

  const cookie = (loginResponse.headers.get("set-cookie") || "").split(";")[0];
  const form = new FormData();
  form.set("title", "Remote storage");
  form.set("description", "Stored outside the app filesystem");
  form.set("photo", new Blob([Buffer.from([9, 8, 7, 6])], { type: "image/png" }), "remote.png");

  const uploadResponse = await fetch(`${baseUrl}/api/admin/photos`, {
    method: "POST",
    headers: {
      Cookie: cookie,
    },
    body: form,
  });
  assert.equal(uploadResponse.status, 201);

  const uploadPayload = await uploadResponse.json();
  assert.equal(uploadPayload.photo.url.startsWith("/uploads/"), true);
  assert.equal(storage.hasAsset(uploadPayload.photo.filename), true);

  const imageResponse = await fetch(`${baseUrl}${uploadPayload.photo.url}`);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), Buffer.from([9, 8, 7, 6]));

  const storedAlbum = storage.getAlbum();
  assert.equal(storedAlbum.length, 1);
  assert.equal(storedAlbum[0].title, "Remote storage");

  const deleteResponse = await fetch(`${baseUrl}/api/admin/photos/${uploadPayload.photo.id}`, {
    method: "DELETE",
    headers: {
      Cookie: cookie,
    },
  });
  assert.equal(deleteResponse.status, 200);
  assert.equal(storage.hasAsset(uploadPayload.photo.filename), false);
  assert.equal(storage.getAlbum().length, 0);
});
