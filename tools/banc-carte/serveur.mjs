import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ICI = path.dirname(new URL(import.meta.url).pathname);
const WEB = path.join(ICI, '..', '..', 'web');
const TYPE = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
               '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  for (const f of [path.join(ICI, u), path.join(WEB, u)])
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      r.writeHead(200, { 'content-type': TYPE[path.extname(f)] ?? 'application/octet-stream' });
      return r.end(fs.readFileSync(f));
    }
  r.writeHead(404); r.end('non');
}).listen(4289, () => console.log('4289'));
