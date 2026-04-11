import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createAlbumServer } = require("../server");

const { server } = createAlbumServer({
  host: "0.0.0.0",
  port: 0,
});

export default function handler(req, res) {
  req.url = reconstructOriginalUrl(req.url);
  return server.emit("request", req, res);
}

function reconstructOriginalUrl(requestUrl) {
  const url = new URL(requestUrl || "/", "http://localhost");
  const searchParams = new URLSearchParams(url.search);
  const pathSegments = searchParams
    .getAll("path")
    .flatMap((value) => String(value || "").split("/"))
    .map((value) => value.trim())
    .filter(Boolean);

  searchParams.delete("path");

  const pathname = pathSegments.length > 0 ? `/${pathSegments.map((segment) => encodeURIComponent(segment)).join("/")}` : "/";
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}
