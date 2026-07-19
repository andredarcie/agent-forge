// AgentForge static/dev server: serves the viewer, model files and node_modules,
// exposes a small JSON API and an SSE endpoint for hot reload.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

export async function startServer({ root, port = 4747, silent = false, watch = true } = {}) {
  const sseClients = new Set();

  async function listModels() {
    const dir = path.join(root, 'models');
    try {
      const files = await fsp.readdir(dir);
      return files.filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, '')).sort();
    } catch {
      return [];
    }
  }

  function broadcast(msg) {
    for (const res of sseClients) {
      try { res.write(`data: ${msg}\n\n`); } catch { /* client gone */ }
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);

      if (pathname === '/' || pathname === '/index.html') {
        return sendFile(res, path.join(root, 'web', 'viewer.html'));
      }

      if (pathname === '/api/models') {
        const models = await listModels();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ models }));
      }

      if (pathname === '/api/screenshot' && req.method === 'POST') {
        const body = await readBody(req);
        const { model = 'untitled', dataURL } = JSON.parse(body);
        if (!dataURL || !dataURL.startsWith('data:image/png;base64,')) {
          res.writeHead(400); return res.end('bad dataURL');
        }
        const safe = model.replace(/[^a-zA-Z0-9-_]/g, '_');
        const outDir = path.join(root, 'renders', safe);
        await fsp.mkdir(outDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const file = path.join(outDir, `viewer-${stamp}.png`);
        await fsp.writeFile(file, Buffer.from(dataURL.split(',')[1], 'base64'));
        const rel = path.relative(root, file).replaceAll('\\', '/');
        if (!silent) console.log(`  screenshot saved → ${rel}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ saved: rel }));
      }

      if (pathname === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('data: connected\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      // Static files — restrict to project root, block traversal.
      const filePath = path.normalize(path.join(root, pathname));
      if (!filePath.startsWith(path.normalize(root + path.sep))) {
        res.writeHead(403); return res.end('forbidden');
      }
      return sendFile(res, filePath);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(err && err.stack ? err.stack : err));
    }
  });

  function sendFile(res, filePath) {
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('not found: ' + filePath);
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  const watchers = [];
  if (watch) {
    let timer = null;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => broadcast('reload'), 120);
    };
    for (const dir of ['models', 'web']) {
      const full = path.join(root, dir);
      if (fs.existsSync(full)) {
        try {
          watchers.push(fs.watch(full, { recursive: true }, onChange));
        } catch { /* recursive watch unsupported */ }
      }
    }
    // keep-alive ping so proxies don't drop SSE
    const ping = setInterval(() => broadcast('ping'), 25000);
    watchers.push({ close: () => clearInterval(ping) });
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const actualPort = server.address().port;
  if (!silent) console.log(`AgentForge viewer → http://127.0.0.1:${actualPort}/`);

  return {
    server,
    port: actualPort,
    close: () => {
      for (const w of watchers) w.close();
      for (const res of sseClients) { try { res.end(); } catch {} }
      server.close();
    },
  };
}
