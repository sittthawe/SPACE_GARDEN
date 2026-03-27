const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createAlbumServer } = require("./server");

function createMemoryStorage() {
  return {
    mode: "r2",
    async readAlbum() {
      return [];
    },
    async writeAlbum() {},
    async writeAsset() {},
    async deleteAsset() {},
    async readAsset() {
      return null;
    },
  };
}

test("Render defaults local storage into ./storage when STORAGE_DIR is not set", async (t) => {
  const previousRender = process.env.RENDER;
  const previousStorageDir = process.env.STORAGE_DIR;

  process.env.RENDER = "true";
  delete process.env.STORAGE_DIR;

  t.after(() => {
    if (previousRender === undefined) {
      delete process.env.RENDER;
    } else {
      process.env.RENDER = previousRender;
    }

    if (previousStorageDir === undefined) {
      delete process.env.STORAGE_DIR;
    } else {
      process.env.STORAGE_DIR = previousStorageDir;
    }
  });

  const { server, config } = createAlbumServer({
    storage: createMemoryStorage(),
    adminPassword: "secret-pass",
  });

  assert.equal(config.storageRoot, path.join(process.cwd(), "storage"));
  assert.equal(config.uploadsDir, path.join(process.cwd(), "storage", "uploads"));
  assert.equal(config.dataFile, path.join(process.cwd(), "storage", "data", "album.json"));

  await new Promise((resolve) => server.close(resolve));
});

test("Render mirrors local uploads into an attached fallback disk and restores them after restart", async (t) => {
  const previousRender = process.env.RENDER;
  const previousStorageDir = process.env.STORAGE_DIR;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spacegarden-render-"));
  const ephemeralRoot = path.join(tempRoot, "ephemeral-storage");
  const fallbackRoot = path.join(tempRoot, "persistent-disk");
  const legacyRoot = path.join(tempRoot, "legacy-empty");

  process.env.RENDER = "true";
  delete process.env.STORAGE_DIR;

  fs.mkdirSync(fallbackRoot, { recursive: true });

  async function startTestServer() {
    const { server } = createAlbumServer({
      host: "127.0.0.1",
      port: 0,
      renderDefaultStorageDir: ephemeralRoot,
      renderReplicaStorageDirs: [fallbackRoot],
      legacyStorageDir: legacyRoot,
      adminPassword: "secret-pass",
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return server;
  }

  let activeServer = await startTestServer();
  let port = activeServer.address().port;
  let baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => activeServer.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });

    if (previousRender === undefined) {
      delete process.env.RENDER;
    } else {
      process.env.RENDER = previousRender;
    }

    if (previousStorageDir === undefined) {
      delete process.env.STORAGE_DIR;
    } else {
      process.env.STORAGE_DIR = previousStorageDir;
    }
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
  form.set("title", "Disk-backed upload");
  form.set("description", "Mirrored into a Render persistent disk");
  form.set("photo", new Blob([Buffer.from([3, 1, 4, 1, 5])], { type: "image/png" }), "disk-backed.png");

  const uploadResponse = await fetch(`${baseUrl}/api/admin/photos`, {
    method: "POST",
    headers: {
      Cookie: cookie,
    },
    body: form,
  });
  assert.equal(uploadResponse.status, 201);

  const uploadPayload = await uploadResponse.json();
  const mirroredAssetPath = path.join(fallbackRoot, "uploads", uploadPayload.photo.filename);
  const mirroredAlbumPath = path.join(fallbackRoot, "data", "album.json");
  assert.equal(fs.existsSync(mirroredAssetPath), true);
  assert.equal(fs.existsSync(mirroredAlbumPath), true);

  await new Promise((resolve) => activeServer.close(resolve));
  fs.rmSync(ephemeralRoot, { recursive: true, force: true });

  activeServer = await startTestServer();
  port = activeServer.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  const photosPayload = await fetch(`${baseUrl}/api/photos`).then((response) => response.json());
  assert.equal(photosPayload.photos.length, 1);
  assert.equal(photosPayload.photos[0].title, "Disk-backed upload");
  assert.equal(photosPayload.photos[0].filename, uploadPayload.photo.filename);

  const imageResponse = await fetch(`${baseUrl}${uploadPayload.photo.url}`);
  assert.equal(imageResponse.status, 200);
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), Buffer.from([3, 1, 4, 1, 5]));
});

test("local storage migrates legacy album data into a configured persistent directory", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spacegarden-"));
  const legacyRoot = path.join(tempRoot, "legacy");
  const storageRoot = path.join(tempRoot, "persistent");
  const legacyUploadsDir = path.join(legacyRoot, "uploads");
  const legacyDataDir = path.join(legacyRoot, "data");
  const legacyDataFile = path.join(legacyDataDir, "album.json");
  const legacyAssetPath = path.join(legacyUploadsDir, "seed.png");
  const legacyAssetData = Buffer.from([5, 4, 3, 2]);

  fs.mkdirSync(legacyUploadsDir, { recursive: true });
  fs.mkdirSync(legacyDataDir, { recursive: true });
  fs.writeFileSync(legacyAssetPath, legacyAssetData);
  fs.writeFileSync(
    legacyDataFile,
    `${JSON.stringify(
      [
        {
          id: "legacy-photo",
          title: "Legacy upload",
          description: "Migrated into persistent storage",
          filename: "seed.png",
          originalFilename: "seed.png",
          mimeType: "image/png",
          size: legacyAssetData.length,
          createdAt: "2026-03-25T00:00:00.000Z",
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
    storageDir: storageRoot,
    legacyStorageDir: legacyRoot,
    adminPassword: "secret-pass",
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const migratedDataFile = path.join(storageRoot, "data", "album.json");
  const migratedAssetPath = path.join(storageRoot, "uploads", "seed.png");
  assert.equal(fs.existsSync(migratedDataFile), true);
  assert.equal(fs.existsSync(migratedAssetPath), true);

  const photosPayload = await fetch(`${baseUrl}/api/photos`).then((response) => response.json());
  assert.equal(photosPayload.photos.length, 1);
  assert.equal(photosPayload.photos[0].title, "Legacy upload");

  const imageResponse = await fetch(`${baseUrl}/uploads/seed.png`);
  assert.equal(imageResponse.status, 200);
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), legacyAssetData);
});

test("local storage keeps uploaded photos across server restarts when reusing the same storage directory", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spacegarden-"));
  const storageRoot = path.join(tempRoot, "persistent");
  const legacyRoot = path.join(tempRoot, "legacy-empty");

  async function startTestServer() {
    const { server } = createAlbumServer({
      host: "127.0.0.1",
      port: 0,
      storageDir: storageRoot,
      legacyStorageDir: legacyRoot,
      adminPassword: "secret-pass",
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return server;
  }

  const firstServer = await startTestServer();
  let activeServer = firstServer;
  let port = firstServer.address().port;
  let baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => activeServer.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
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
  form.set("title", "Persistent upload");
  form.set("description", "Stored on disk across restarts");
  form.set("photo", new Blob([Buffer.from([7, 6, 5, 4])], { type: "image/png" }), "persistent.png");

  const uploadResponse = await fetch(`${baseUrl}/api/admin/photos`, {
    method: "POST",
    headers: {
      Cookie: cookie,
    },
    body: form,
  });
  assert.equal(uploadResponse.status, 201);

  const uploadPayload = await uploadResponse.json();
  await new Promise((resolve) => firstServer.close(resolve));

  const secondServer = await startTestServer();
  activeServer = secondServer;
  port = secondServer.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  const photosPayload = await fetch(`${baseUrl}/api/photos`).then((response) => response.json());
  assert.equal(photosPayload.photos.length, 1);
  assert.equal(photosPayload.photos[0].title, "Persistent upload");
  assert.equal(photosPayload.photos[0].filename, uploadPayload.photo.filename);

  const imageResponse = await fetch(`${baseUrl}${uploadPayload.photo.url}`);
  assert.equal(imageResponse.status, 200);
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), Buffer.from([7, 6, 5, 4]));
});
