#!/usr/bin/env python3
"""Chess AI Proxy + Game Hub — Python version"""

import http.server
import json
import os
import re
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
from pathlib import Path

PORT = 8656
WWW_ROOT = '/www'
PIKAFISH_PATH = '/app/pikafish_data/pikafish'
PIKAFISH_NNUE = '/app/pikafish_data/pikafish.nnue'
DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions'

MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
}

OUR_TO_UCI = {
    'r': 'R', 'h': 'N', 'e': 'B', 'a': 'A', 'k': 'K', 'c': 'C', 'p': 'P',
    'R': 'r', 'H': 'n', 'E': 'b', 'A': 'a', 'K': 'k', 'C': 'c', 'P': 'p',
}


class PikafishClient:
    """UCI engine client for Pikafish."""

    def __init__(self):
        self.proc = None
        self.lock = threading.Lock()
        self.ready = False
        self._cond = threading.Condition()
        self._output = []

    def start(self):
        self.proc = subprocess.Popen(
            [PIKAFISH_PATH],
            cwd='/app/pikafish_data',
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True, bufsize=1,
        )

        def reader():
            for line in iter(self.proc.stdout.readline, ''):
                with self._cond:
                    self._output.append(line.rstrip())
                    self._cond.notify_all()

        threading.Thread(target=reader, daemon=True).start()

        self._send('uci')
        self._wait_for('uciok', 5000)
        self._send(f'setoption name NNUEFile value {PIKAFISH_NNUE}')
        self._send('isready')
        self._wait_for('readyok', 5000)
        self.ready = True

    def _send(self, line):
        self.proc.stdin.write(line + '\n')
        self.proc.stdin.flush()

    def _wait_for(self, prefix, timeout_ms):
        deadline = threading.get_event()._time if False else __import__('time').monotonic() + timeout_ms / 1000
        import time
        deadline = time.monotonic() + timeout_ms / 1000
        with self._cond:
            while True:
                for i, line in enumerate(self._output):
                    if line.startswith(prefix):
                        del self._output[:i + 1]
                        return line
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError(f'Timeout waiting for {prefix}')
                self._cond.wait(remaining)

    def search(self, fen, depth=10):
        self._send(f'position fen {fen}')
        self._send(f'go depth {depth}')
        line = self._wait_for('bestmove', 60000)
        m = re.search(r'bestmove\s+(\w+)', line)
        if not m or m.group(1) == '(none)':
            raise RuntimeError('no move')
        return m.group(1)

    def restart(self):
        self.proc.kill()
        self.proc.wait()
        import time
        time.sleep(1.5)
        self._output.clear()
        self.ready = False
        self.start()


def board_to_fen(board, color):
    rows = []
    for row in board:
        empty = 0
        fen_row = ''
        for p in row:
            t = (p or {}).get('type', ' ')
            if not t or t == ' ':
                empty += 1
            else:
                if empty:
                    fen_row += str(empty)
                    empty = 0
                fen_row += OUR_TO_UCI.get(t[0], '?')
        if empty:
            fen_row += str(empty)
        rows.append(fen_row)
    side = 'w' if color == 'r' else 'b'
    return f"{'/'.join(rows)} {side} - - 0 1"


def uci_to_coords(uci):
    fc = ord(uci[0]) - 97
    fr = 9 - int(uci[1])
    tc = ord(uci[2]) - 97
    tr = 9 - int(uci[3])
    return fr, fc, tr, tc


class Handler(http.server.SimpleHTTPRequestHandler):
    pikafish: PikafishClient = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WWW_ROOT, **kwargs)

    def log_message(self, fmt, *args):
        pass  # quiet

    def do_OPTIONS(self):
        self._cors()
        self.send_response(204)
        self.end_headers()

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def _send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self._cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length > 0 else {}

        if path == '/api/chess-pikafish':
            if not Handler.pikafish or not Handler.pikafish.ready:
                return self._send_json(503, {'ok': False, 'error': 'Pikafish not started'})

            board = body.get('board', [])
            color = body.get('color', 'r')
            depth = body.get('depth', 10)
            fen = board_to_fen(board, color)

            try:
                uci = Handler.pikafish.search(fen, depth)
            except Exception as e:
                print(f'Pikafish error: {e}', file=sys.stderr)
                Handler.pikafish.restart()
                uci = Handler.pikafish.search(fen, depth)

            fc, fr, tc, tr = uci_to_coords(uci)  # wait, i got confused - let me re-check
            # Actually the uci_to_coords above is wrong, let me inline it correctly
            fc_c = ord(uci[0]) - 97
            fr_r = 9 - int(uci[1])
            tc_c = ord(uci[2]) - 97
            tr_r = 9 - int(uci[3])
            return self._send_json(200, {
                'ok': True,
                'move': {'fr': fr_r, 'fc': fc_c, 'tr': tr_r, 'tc': tc_c},
            })

        if path == '/api/chess-ai':
            auth = self.headers.get('Authorization', '')
            api_key = auth[7:] if auth.startswith('Bearer ') else ''
            if not api_key:
                return self._send_json(400, {'error': 'Missing API key'})
            try:
                req = urllib.request.Request(
                    DEEPSEEK_URL,
                    data=json.dumps(body).encode(),
                    headers={
                        'Content-Type': 'application/json',
                        'Authorization': f'Bearer {api_key}',
                    },
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    result = resp.read()
                    self.send_response(resp.status)
                    self._cors()
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Content-Length', len(result))
                    self.end_headers()
                    self.wfile.write(result)
            except Exception as e:
                return self._send_json(500, {'error': f'Proxy error: {e}'})
            return

        self._send_json(404, {'error': 'Not found'})


def main():
    print('Starting Pikafish...', flush=True)
    pikafish = PikafishClient()
    try:
        pikafish.start()
        print('Pikafish ready', flush=True)
    except Exception as e:
        print(f'Pikafish start failed: {e}', file=sys.stderr, flush=True)

    Handler.pikafish = pikafish

    server = http.server.HTTPServer(('0.0.0.0', PORT), Handler)
    print(f'Chess AI Proxy + Game Hub running on port {PORT}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
