"""Teste local (imita o Vercel): python servidor_local.py  ->  http://localhost:8000
Le o .env desta pasta (NEON_POWERBI_URL, POWERBI_API_KEY). /api/* -> api/powerbi.py; resto -> public/."""
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

AQUI = Path(__file__).resolve().parent
for linha in (AQUI / '.env').read_text(encoding='utf-8').splitlines():
    if '=' in linha and not linha.startswith('#'):
        k, v = linha.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip())

from api.powerbi import handler as Api  # noqa: E402


class Local(SimpleHTTPRequestHandler):
    _responder, _erro = Api._responder, Api._erro

    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(AQUI / 'public'), **k)

    def do_GET(self):
        return Api.do_GET(self) if self.path.startswith('/api/') else super().do_GET()


if __name__ == '__main__':
    print('http://localhost:8000')
    ThreadingHTTPServer(('127.0.0.1', 8000), Local).serve_forever()
