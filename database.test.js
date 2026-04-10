const test = require("node:test");
const assert = require("node:assert/strict");

const { createPhotoDatabase, sanitizeDescriptionText } = require("./database");

function createMemoryStorage(mode = "local", initialAlbum = []) {
  let album = JSON.parse(JSON.stringify(initialAlbum));
  let writeCount = 0;

  return {
    mode,
    async readAlbum() {
      return JSON.parse(JSON.stringify(album));
    },
    async writeAlbum(photos) {
      writeCount += 1;
      album = JSON.parse(JSON.stringify(photos));
    },
    getAlbum() {
      return JSON.parse(JSON.stringify(album));
    },
    getWriteCount() {
      return writeCount;
    },
  };
}

test("photo database creates, updates, deletes, and summarizes records", async () => {
  const storage = createMemoryStorage();
  const database = createPhotoDatabase(storage);

  const createdPhoto = await database.createPhoto({
    title: "",
    description: "Soft light over the horizon",
    filename: "nested/path/new-image.png",
    file: {
      filename: "new-image.png",
      contentType: "image/png",
      data: Buffer.from([1, 2, 3]),
    },
    createdAt: "2026-04-10T11:00:00.000Z",
  });

  assert.equal(createdPhoto.title, "New image");
  assert.equal(createdPhoto.url, "/uploads/nested/path/new-image.png");
  assert.equal(storage.getAlbum().length, 1);

  const updatedPhoto = await database.updatePhoto(createdPhoto.id, {
    title: "Sunrise study",
    description: "Layered clouds and reflected color",
  });

  assert.equal(updatedPhoto.title, "Sunrise study");
  assert.equal(updatedPhoto.description, "Layered clouds and reflected color");

  const overview = await database.getOverview();
  assert.deepEqual(overview, {
    count: 1,
    totalBytes: 3,
    latestCreatedAt: "2026-04-10T11:00:00.000Z",
    database: {
      mode: "local",
      label: "Local JSON",
      driver: "File-backed storage",
    },
  });

  const deletedPhoto = await database.deletePhoto(createdPhoto.id);
  assert.equal(deletedPhoto.id, createdPhoto.id);
  assert.equal(storage.getAlbum().length, 0);
});

test("photo database repairs stored records before returning them", async () => {
  const storage = createMemoryStorage("r2", [
    {
      id: "seed-photo",
      title: "  Aurora   bloom ",
      description: "Dream scene --no blur",
      filename: "folder\\seed.png",
      createdAt: "2026-04-09T11:00:00.000Z",
      size: 512,
      url: "/wrong-path.png",
    },
  ]);
  const database = createPhotoDatabase(storage);

  const photos = await database.listPhotos();

  assert.equal(photos.length, 1);
  assert.equal(photos[0].title, "Aurora bloom");
  assert.equal(photos[0].description, "Dream scene\n\nNegative prompt:\nno blur");
  assert.equal(photos[0].filename, "folder/seed.png");
  assert.equal(photos[0].url, "/uploads/folder/seed.png");
  assert.equal(storage.getWriteCount(), 1);
  assert.deepEqual(database.describe(), {
    mode: "r2",
    label: "Cloudflare R2",
    driver: "Object storage",
  });
});

test("description sanitization keeps formatted prompt sections readable", () => {
  const description = sanitizeDescriptionText(
    "A surreal portrait 🎯 More Dark / Creepy Version black eyes ⚙️ Optional Negative Prompt blurry, low quality",
    8000
  );

  assert.equal(
    description,
    [
      "A surreal portrait",
      "",
      "More dark / creepy version:",
      "black eyes",
      "",
      "Optional negative prompt:",
      "blurry, low quality",
    ].join("\n")
  );
});
