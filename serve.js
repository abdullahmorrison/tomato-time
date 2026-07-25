// Local static server for development only. The deployed site is served by GitHub
// Pages; the streamer never runs this.
//
//   node serve.js            -> http://localhost:4747

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 4747;
const ROOT = path.dirname(fileURLToPath(import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    const file = path.join(ROOT, rel);

    // Never serve outside the project directory.
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    });
  })
  .listen(PORT, () => {
    console.log(`Tomato Time dev server: http://localhost:${PORT}`);
    console.log(`Overlay: http://localhost:${PORT}/overlay.html?channel=tenzinniznet&debug=on`);
  });
