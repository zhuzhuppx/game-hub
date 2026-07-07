const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8656;
const WWW_ROOT = '/www';
const PIKAFISH_PATH = '/app/pikafish_data/pikafish';
const PIKAFISH_NNUE = '/app/pikafish_data/pikafish.nnue';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

// ==================== MIME ====================
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// ==================== Pikafish UCI Client ====================
class PikafishClient {
  constructor() {
    this.queue = [];
    this.resolvers = [];
    this.ready = false;
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.proc = spawn(PIKAFISH_PATH, [], {
        cwd: '/app/pikafish_data',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.proc.stdout.on('data', (buf) => {
        const lines = buf.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          if (this.resolvers.length > 0 && this.resolvers[0].prefix && line.startsWith(this.resolvers[0].prefix)) {
            this.resolvers.shift().resolve(line);
          }
        }
      });

      this.proc.stderr.on('data', (d) => process.stderr.write(d));
      this.proc.on('error', (e) => reject(e));
      this.proc.on('exit', (code) => {
        if (!this.ready) reject(new Error(`Pikafish exited with ${code}`));
      });

      this.send('uci');
      this.waitFor('uciok', 5000)
        .then(() => this.send(`setoption name NNUEFile value ${PIKAFISH_NNUE}`))
        .then(() => this.send('isready'))
        .then(() => this.waitFor('readyok', 5000))
        .then(() => { this.ready = true; resolve(); })
        .catch(reject);
    });
  }

  send(line) {
    this.proc.stdin.write(line + '\n');
  }

  waitFor(prefix, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${prefix}`)), timeout);
      this.resolvers.push({ prefix, resolve: (line) => { clearTimeout(timer); resolve(line); } });
    });
  }

  async search(fen, depth = 10) {
    this.send(`position fen ${fen}`);
    this.send(`go depth ${depth}`);
    const line = await this.waitFor('bestmove', 60000);
    const m = line.match(/bestmove\s+(\w+)/);
    if (!m || m[1] === '(none)') throw new Error('no move');
    return m[1];
  }

  restart() {
    this.proc.kill('SIGKILL');
    return new Promise(r => setTimeout(r, 1500)).then(() => this.start());
  }
}

// ==================== FEN Conversion ====================
const OUR_TO_UCI = {
  r: 'R', h: 'N', e: 'B', a: 'A', k: 'K', c: 'C', p: 'P',
  R: 'r', H: 'n', E: 'b', A: 'a', K: 'k', C: 'c', P: 'p',
};

function boardToFEN(board, color) {
  const rows = [];
  for (let r = 0; r < 10; r++) {
    let empty = 0;
    let row = '';
    for (let c = 0; c < 9; c++) {
      const p = board[r]?.[c];
      if (!p || !p.type || p.type === ' ') { empty++; continue; }
      if (empty > 0) { row += empty; empty = 0; }
      row += OUR_TO_UCI[p.type[0]] || '?';
    }
    if (empty > 0) row += empty;
    rows.push(row);
  }
  const side = color === 'r' ? 'w' : 'b';
  return `${rows.join('/')} ${side} - - 0 1`;
}

// ==================== HTTP Helpers ====================
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

function sendJSON(res, status, data) {
  const json = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(json);
}

function sendStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ==================== Server ====================
async function main() {
  console.log('Starting Pikafish...');
  let pikafish;
  try {
    pikafish = new PikafishClient();
    await pikafish.start();
    console.log('Pikafish ready');
  } catch (e) {
    console.error('Pikafish start failed:', e.message);
  }

  const server = http.createServer(async (req, res) => {
    // CORS preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // Pikafish engine
    if (pathname === '/api/chess-pikafish' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const json = JSON.parse(body);
        if (!pikafish || !pikafish.ready) {
          return sendJSON(res, 503, { ok: false, error: 'Pikafish not started' });
        }
        const board = json.board || [];
        const color = json.color || 'r';
        const depth = json.depth || 10;
        const fen = boardToFEN(board, color);

        let uci;
        try {
          uci = await pikafish.search(fen, depth);
        } catch (e) {
          console.error('Pikafish error:', e.message);
          await pikafish.restart();
          uci = await pikafish.search(fen, depth);
        }

        const fc = uci.charCodeAt(0) - 97;
        const uciFr = parseInt(uci[1]);
        const tc = uci.charCodeAt(2) - 97;
        const uciTr = parseInt(uci[3]);
        const fr = 9 - uciFr;
        const tr = 9 - uciTr;
        return sendJSON(res, 200, { ok: true, move: { fr, fc, tr, tc } });
      } catch (e) {
        console.error('/api/chess-pikafish error:', e);
        return sendJSON(res, 500, { ok: false, error: e.message });
      }
    }

    // DeepSeek proxy
    if (pathname === '/api/chess-ai' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const auth = req.headers.authorization || '';
        const apiKey = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!apiKey) return sendJSON(res, 400, { error: 'Missing API key' });

        const dsResp = await fetch(DEEPSEEK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body,
          signal: AbortSignal.timeout(60000),
        });
        const text = await dsResp.text();
        res.writeHead(dsResp.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(text);
      } catch (e) {
        console.error('/api/chess-ai error:', e);
        return sendJSON(res, 500, { error: `Proxy error: ${e.message}` });
      }
      return;
    }

    // Static files
    let file = pathname === '/' ? '/index.html' : pathname;
    let fullPath = path.join(WWW_ROOT, file);
    if (!fullPath.startsWith(WWW_ROOT)) { res.writeHead(404); res.end('404'); return; }
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) fullPath = path.join(fullPath, 'index.html');
    } catch (e) {
      res.writeHead(404); res.end('404 Not Found'); return;
    }
    sendStatic(res, fullPath);
  });

  server.listen(PORT, () => {
    console.log(`Chess AI Proxy + Game Hub running on port ${PORT}`);
  });
}

main().catch(console.error);
