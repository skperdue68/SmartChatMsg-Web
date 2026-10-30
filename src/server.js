import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createLibraryStore, LibraryError } from './library-store.js';
const MAX_REQUEST_BYTES = 40 * 1024 * 1024 + 16384;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const paths = {
  "/": ["index.html", "text/html"],
  "/style.css": ["style.css", "text/css"],
  "/app.js": ["app.js", "text/javascript"],
  "/scheduling-sliders.js": ["scheduling-sliders.js", "text/javascript"],
  "/logo.svg": ["logo.svg", "image/svg+xml"],
  "/portable.js": ["portable.js", "text/javascript"],
  "/model.js": ["../src/model.js", "text/javascript"],
  "/lua-data.js": ["../src/lua-data.js", "text/javascript"],
};
export function readConfig(env=process.env){
 const host=env.HOST||'127.0.0.1',port=Number(env.PORT||4173);let publicOrigin='';
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT must be 1-65535.');
 if(env.PUBLIC_ORIGIN){const value=new URL(env.PUBLIC_ORIGIN);if(!['http:','https:'].includes(value.protocol)||value.username||value.password||value.pathname!=='/'||value.search||value.hash)throw Error('PUBLIC_ORIGIN must be an HTTP(S) origin without a path or credentials.');publicOrigin=value.origin;}
 return {host,port,publicOrigin,libraryDir:resolve(env.LIBRARY_DIR || 'data/shared-library')};
}
export function createServer(options={}) {
  const config=readConfig({HOST:options.host,PORT:options.port,PUBLIC_ORIGIN:options.publicOrigin,LIBRARY_DIR:options.libraryDir});
  const library = createLibraryStore(config.libraryDir);
  const publicHost=config.publicOrigin?new URL(config.publicOrigin).host.toLowerCase():null;
  return http.createServer(async (req, res) => {
    const host = (req.headers.host || "").toLowerCase();
    const path = new URL(req.url, 'http://localhost').pathname;
    const api = path === '/api/library' || path.startsWith('/api/library/');
    const json = (status, value, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(value));
    };
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && host!==publicHost) {
      if (api) return json(403, {error:'Host is not allowed.'});
      res.writeHead(403);
      return res.end("Host is not allowed. Configure PUBLIC_ORIGIN for public hosting.");
    }
    if (req.headers.origin && req.headers.origin !== (host===publicHost?config.publicOrigin:`http://${host}`) && req.headers.origin!==config.publicOrigin) {
      if (api) return json(403, {error:'Origin not allowed.'});
      res.writeHead(403);
      return res.end("Origin not allowed.");
    }
    if (api) {
      try {
        if (path === '/api/library' && req.method === 'POST') {
          if (!req.headers.origin) return json(403, {error:'A matching Origin is required.'});
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return json(415, {error:'Use application/json.'});
          if (Number(req.headers['content-length']) > MAX_REQUEST_BYTES) return json(413, {error:'Request is too large.'});
          let length = 0; const chunks = [];
          for await (const chunk of req) {
            length += chunk.length;
            if (length > MAX_REQUEST_BYTES) { json(413, {error:'Request is too large.'}); return; }
            chunks.push(chunk);
          }
          let body;
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { return json(400, {error:'Provide valid JSON.'}); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, {error:'Provide a name and Lua text.'});
          return json(201, {file:await library.save(body.name, body.lua, {overwrite:body.overwrite??false})});
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, {error:'Method not allowed.'}, {Allow:path === '/api/library' ? 'GET, HEAD, POST' : 'GET, HEAD'});
        if (path === '/api/library') return json(200, {files:await library.list()});
        const lua = await library.load(path.slice('/api/library/'.length));
        res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8', 'Content-Length':lua.length, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
        return res.end(req.method === 'HEAD' ? undefined : lua);
      } catch (error) { return json(error instanceof LibraryError ? error.status : 500, {error:error instanceof LibraryError ? error.message : 'Unable to access the shared library.'}); }
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      return res.end();
    }
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
