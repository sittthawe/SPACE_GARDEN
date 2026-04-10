const test = require("node:test");
const assert = require("node:assert/strict");

const { createAlbumServer } = require("./server");

function createMemoryStorage(mode = "local") {
  return {
    mode,
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

test("system route exposes backend and database details", async (t) => {
  const { server } = createAlbumServer({
    host: "127.0.0.1",
    port: 0,
    storage: createMemoryStorage("r2"),
    adminPassword: "secret-pass",
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const response = await fetch(`${baseUrl}/api/system`);
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.deepEqual(payload, {
    backend: {
      runtime: "node-http",
    },
    database: {
      mode: "r2",
      label: "Cloudflare R2",
      driver: "Object storage",
    },
  });
});
