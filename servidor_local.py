"""Teste local (imita o Vercel): python servidor_local.py  ->  http://localhost:8000
Le o .env desta pasta (NEON_POWERBI_URL, POWERBI_API_KEY)."""
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
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(AQUI), **k)

    def _api(self):
        if self.path.startswith('/api/estado'):
            self.path = '/api/powerbi?acao=estado'
        Api.do_GET(self) if self.command != 'OPTIONS' else Api.do_OPTIONS(self)

    def do_GET(self):
        if self.path.startswith('/api/'):
            Api._responder = Api._responder  # noqa: PLW0127
            return Api.__dict__['do_GET'](self) if not self.path.startswith('/api/estado') else self._api()
        return super().do_GET()

    _responder = Api._responder
    _erro = Api._erro


if __name__ == '__main__':
    print('http://localhost:8000')
    ThreadingHTTPServer(('127.0.0.1', 8000), Local).serve_forever()
