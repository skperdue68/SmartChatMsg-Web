import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const paths = {
  "/": ["index.html", "text/html"],
  "/style.css": ["style.css", "text/css"],
  "/app.js": ["app.js", "text/javascript"],
  "/logo.svg": ["logo.svg", "image/svg+xml"],
  "/portable.js": ["portable.js", "text/javascript"],
  "/model.js": ["../src/model.js", "text/javascript"],
  "/lua-data.js": ["../src/lua-data.js", "text/javascript"],
};
export function createServer() {
  return http.createServer(async (req, res) => {
    const host = req.headers.host || "";
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
      res.writeHead(403);
      return res.end("Local connections only.");
    }
    if (req.headers.origin && req.headers.origin !== `http://${host}`) {
      res.writeHead(403);
      return res.end("Origin not allowed.");
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      return res.end();
    }
    const path = new URL(req.url, `http://${host}`).pathname;
    const file = paths[path];
    if (!file) {
      res.writeHead(404);
      return res.end("Not found");
    }
    try {
      const data = await readFile(resolve(root, file[0]));
      res.writeHead(200, {
        "Content-Type": file[1] + "; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("PORT must be 1–65535");
  createServer().listen(port, "127.0.0.1", () =>
    console.log(`SmartChatMsg Web: http://127.0.0.1:${port}`),
  );
}
