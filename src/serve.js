import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.xml': 'application/xml'
};

// Serves a folder of built files (a static export, a dist/ folder) so it can be checked like any URL.
// Clean URLs work: /about tries /about, /about.html and /about/index.html. Unknown paths return 404.html if present.
export function serveFolder(root) {
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const candidates = [urlPath, urlPath + '.html', path.posix.join(urlPath, 'index.html')];
    for (const c of candidates) {
      const file = path.join(base, c);
      if (!file.startsWith(base)) break;
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
        return;
      }
    }
    const notFound = path.join(base, '404.html');
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    if (fs.existsSync(notFound)) fs.createReadStream(notFound).pipe(res);
    else res.end('<!doctype html><title>404</title><h1>Not found</h1>');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
