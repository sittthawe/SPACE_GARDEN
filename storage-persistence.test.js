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
