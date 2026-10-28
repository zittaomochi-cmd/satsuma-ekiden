"""Firebase Realtime Database の REST（読み書き・ストリーミング）の真似をするテスト用サーバー（本番では使わない）。

  python3 tools/mock-firebase.py 8781
  js/config.js の firebaseUrl を 'http://localhost:8781' にすると、本物の Firebase なしで送信→表示を試せる。
  鍵は "test" 固定。
"""
import json, queue, sys, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

DATA = {}
LOCK = threading.Lock()
LISTENERS = []
KEY = 'test'


def set_path(path, value):
    keys = [k for k in path.split('/') if k]
    o = DATA
    for k in keys[:-1]:
        o = o.setdefault(k, {})
    o[keys[-1]] = value


class H(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()

    def do_PATCH(self):
        u = urlparse(self.path)
        if parse_qs(u.query).get('auth', [''])[0] != KEY:
            self.send_response(401); self.cors(); self.end_headers(); self.wfile.write(b'{"error":"Permission denied"}'); return
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        base = u.path.removesuffix('.json')
        with LOCK:
            for k, v in body.items():
                set_path(f'{base}/{k}', v)
        for q in list(LISTENERS):
            q.put(('patch', base.removeprefix('/live') or '/', body))
        self.send_response(200); self.cors(); self.end_headers(); self.wfile.write(json.dumps(body).encode())

    def do_GET(self):
        if 'text/event-stream' not in self.headers.get('Accept', ''):
            o = DATA
            for k in [k for k in urlparse(self.path).path.removesuffix('.json').split('/') if k]:
                o = o.get(k) if isinstance(o, dict) else None
            self.send_response(200); self.cors(); self.send_header('Content-Type', 'application/json'); self.end_headers()
            with LOCK:
                self.wfile.write(json.dumps(o).encode())
            return
        self.send_response(200); self.cors()
        self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-cache'); self.end_headers()
        q = queue.Queue(); LISTENERS.append(q)
        try:
            with LOCK:
                snap = json.loads(json.dumps(DATA.get('live', {})))
            self.wfile.write(f'event: put\ndata: {json.dumps({"path": "/", "data": snap})}\n\n'.encode()); self.wfile.flush()
            while True:
                try:
                    ev, path, data = q.get(timeout=15)
                    self.wfile.write(f'event: {ev}\ndata: {json.dumps({"path": path, "data": data})}\n\n'.encode())
                except queue.Empty:
                    self.wfile.write(b'event: keep-alive\ndata: null\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            LISTENERS.remove(q)

    def log_message(self, *a):
        pass


ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8781), H).serve_forever()
