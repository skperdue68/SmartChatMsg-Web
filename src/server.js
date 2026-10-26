import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
export function readConfig(env=process.env){
 const host=env.HOST||'127.0.0.1',port=Number(env.PORT||4173);let publicOrigin='';
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT must be 1-65535.');
 if(env.PUBLIC_ORIGIN){const value=new URL(env.PUBLIC_ORIGIN);if(!['http:','https:'].includes(value.protocol)||value.username||value.password||value.pathname!=='/'||value.search||value.hash)throw Error('PUBLIC_ORIGIN must be an HTTP(S) origin without a path or credentials.');publicOrigin=value.origin;}
 return {host,port,publicOrigin};
}
export function createServer(options={}) {
  const config=readConfig({HOST:options.host,PORT:options.port,PUBLIC_ORIGIN:options.publicOrigin});
  const publicHost=config.publicOrigin?new URL(config.publicOrigin).host.toLowerCase():null;
  return http.createServer(async (req, res) => {
    const host = (req.headers.host || "").toLowerCase();
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && host!==publicHost) {
      res.writeHead(403);
      return res.end("Host is not allowed. Configure PUBLIC_ORIGIN for public hosting.");
    }
    if (req.headers.origin && req.headers.origin !== (host===publicHost?config.publicOrigin:`http://${host}`) && req.headers.origin!==config.publicOrigin) {
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
  if(existsSync(resolve(process.cwd(),'.env')))process.loadEnvFile(resolve(process.cwd(),'.env'));
  const config=readConfig();
  createServer(config).listen(config.port,config.host,()=>console.log(`SmartChatMsg Web listening on ${config.host}:${config.port}${config.publicOrigin?' / public URL: '+config.publicOrigin:''}`));
}
