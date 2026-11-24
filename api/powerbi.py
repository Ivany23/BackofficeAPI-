"""
API Power BI - Heineken (Vercel, Python). Le as tabelas do esquema `powerbi` no Neon (carregadas pelo
enviar_neon.py a partir da pasta Heineken/Fonte do SharePoint) e entrega-as em CSV, por paginas.

  GET /api/estado                                   -> JSON publico: tabelas, linhas, paginas, meses, datas
  GET /api/dados?tabela=<t>&pagina=<n>&chave=<k>    -> CSV (cabecalho + ate POR_PAGINA linhas), UTF-8
      (a chave tambem pode ir no cabecalho HTTP  x-api-key)

Variaveis de ambiente (Vercel -> Settings -> Environment Variables):
  NEON_POWERBI_URL   ligacao PostgreSQL ao Neon
  POWERBI_API_KEY    chave de leitura (quem a tiver le os dados)
"""
import csv
import hmac
import io
import json
import math
import os
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

import psycopg2

TABELAS = ('demographics', 'survey_visit_db', 'survey_feedback', 'product_availability_price',
           'visibility_quality')
POR_PAGINA = 10000   # PAP: ~3,2 MB por pagina (limite de resposta do Vercel: 4,5 MB)


def ligar():
    return psycopg2.connect(os.environ['NEON_POWERBI_URL'], connect_timeout=10)


def q(nome):
    return '"' + nome.replace('"', '""') + '"'


def estado():
    with ligar() as con, con.cursor() as k:
        k.execute('SELECT tabela, linhas, colunas, meses, dados_ate, carregado_em FROM powerbi.cargas')
        linhas = {r[0]: r for r in k.fetchall()}
    tabs = []
    for t in TABELAS:
        if t not in linhas:
            tabs.append({'tabela': t, 'carregada': False, 'linhas': 0, 'paginas': 0})
            continue
        _, n, cols, meses, ate, quando = linhas[t]
        tabs.append({'tabela': t, 'carregada': True, 'linhas': n, 'paginas': max(1, math.ceil(n / POR_PAGINA)),
                     'colunas': cols, 'meses': meses, 'dados_ate': ate,
                     'carregado_em': quando.isoformat(timespec='seconds')})
    return {'por_pagina': POR_PAGINA, 'tabelas': tabs}


def pagina_csv(tabela, pagina):
    with ligar() as con, con.cursor() as k:
        k.execute('SELECT colunas, linhas FROM powerbi.cargas WHERE tabela = %s', (tabela,))
        r = k.fetchone()
        if not r:
            return None, 'Tabela ainda nao carregada'
        cols, n = r
        paginas = max(1, math.ceil(n / POR_PAGINA))
        if pagina > paginas:
            return None, f'Pagina {pagina} nao existe (a tabela {tabela} tem {paginas} paginas)'
        k.execute(f'SELECT {", ".join(q(c) for c in cols)} FROM powerbi.{q(tabela)} '
                  'WHERE _linha > %s AND _linha <= %s ORDER BY _linha',
                  ((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA))
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator='\r\n')
        w.writerow(cols)
        w.writerows(k.fetchall())
    return buf.getvalue(), None


def painel():
    """Dados do painel (mes mais recente): totais, auditores (+ subida desde a carga anterior), dias, provincias e
    lojas para o mapa. Lido do Neon em cada pedido -> sobe sozinho a cada carga."""
    with ligar() as con, con.cursor() as k:
        k.execute('SELECT max(survey_number) FROM powerbi.survey_visit_db')
        mes = k.fetchone()[0]
        k.execute("""SELECT d.store_nu, d.sem_id, d.store_name, d.auditor_name, d.province, d.store_latitude,
                            d.store_longitude, v.status, v.survey_date
                     FROM powerbi.demographics d JOIN powerbi.survey_visit_db v ON v.visit_nu = d.visit_nu
                     WHERE d.survey_number = %s""", (mes,))
        linhas = k.fetchall()
        k.execute('SELECT count(DISTINCT visit_nu) FROM powerbi.product_availability_price WHERE survey_number = %s',
                  (mes,))
        pap = k.fetchone()[0]
        k.execute('SELECT count(*) FROM powerbi.survey_feedback WHERE survey_number = %s', (mes,))
        fb = k.fetchone()[0]
        k.execute('SELECT count(DISTINCT visit_nu) FROM powerbi.visibility_quality WHERE survey_number = %s', (mes,))
        vq = k.fetchone()[0]
        k.execute('SELECT max(carregado_em) FROM powerbi.cargas')
        carga = k.fetchone()[0]
        anterior, quando_ant = {}, None
        k.execute("SELECT to_regclass('powerbi.historico_auditores')")
        if k.fetchone()[0]:
            k.execute("""SELECT DISTINCT carregado_em FROM powerbi.historico_auditores WHERE mes = %s
                         ORDER BY carregado_em DESC LIMIT 2""", (mes,))
            cargas = [r[0] for r in k.fetchall()]
            if len(cargas) == 2:
                quando_ant = cargas[1]
                k.execute('SELECT auditor, lojas FROM powerbi.historico_auditores WHERE mes = %s AND carregado_em = %s',
                          (mes, quando_ant))
                anterior = dict(k.fetchall())
    aud, dias, prov, pontos, sem_gps = {}, {}, {}, [], 0
    for sn, sem, nome, a, pv, lat, lon, st, dia in linhas:
        done = st == 'Audit done'
        x = aud.setdefault(a or '(sem auditor)', {'lojas': 0, 'done': 0, 'not_done': 0})
        x['lojas'] += 1
        x['done' if done else 'not_done'] += 1
        y = dias.setdefault(dia, [0, 0])
        y[0 if done else 1] += 1
        prov[pv or '(sem provincia)'] = prov.get(pv or '(sem provincia)', 0) + 1
        try:
            la, lo = float(lat), float(lon)
            assert -27 <= la <= -10 and 30 <= lo <= 41.5
        except (ValueError, TypeError, AssertionError):
            sem_gps += 1
            continue
        pontos.append([round(la, 6), round(lo, 6), nome, sn, sem, a, 1 if done else 0, dia, pv or '(sem provincia)'])
    auditores = sorted(({'nome': n, **v, 'subida': (v['lojas'] - anterior[n]) if n in anterior
                         else (v['lojas'] if anterior else None)} for n, v in aud.items()),
                       key=lambda z: -z['lojas'])
    return {
        'mes': mes, 'dados_ate': max(dias) if dias else None,
        'ultima_carga': carga.isoformat(timespec='seconds') if carga else None,
        'carga_anterior': quando_ant.isoformat(timespec='seconds') if quando_ant else None,
        'kpis': {'lojas': len(linhas), 'done': sum(v['done'] for v in aud.values()),
                 'not_done': sum(v['not_done'] for v in aud.values()), 'pap_visitas': pap, 'feedbacks': fb,
                 'vq_visitas': vq, 'auditores': len(aud)},
        'auditores': auditores,
        'dias': [{'dia': d, 'done': v[0], 'not_done': v[1]} for d, v in sorted(dias.items())],
        'provincias': [{'nome': n, 'lojas': v} for n, v in sorted(prov.items(), key=lambda z: -z[1])],
        'lojas': pontos, 'sem_gps': sem_gps,
    }


class handler(BaseHTTPRequestHandler):
    def _responder(self, codigo, corpo, tipo, extra=None):
        dados = corpo.encode('utf-8')
        self.send_response(codigo)
        self.send_header('Content-Type', tipo)
        self.send_header('Content-Length', str(len(dados)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'x-api-key')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(dados)

    def _erro(self, codigo, msg):
        self._responder(codigo, json.dumps({'erro': msg}, ensure_ascii=False), 'application/json; charset=utf-8')

    def do_OPTIONS(self):
        self._responder(204, '', 'text/plain')

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        try:
            url = urlparse(self.path)
            p = {k: v[0] for k, v in parse_qs(url.query).items()}
            if p.get('acao') == 'estado' or url.path.rstrip('/').endswith('/estado'):
                return self._responder(200, json.dumps(estado(), ensure_ascii=False),
                                       'application/json; charset=utf-8')
            esperada = os.environ.get('POWERBI_API_KEY', '')
            dada = p.get('chave') or self.headers.get('x-api-key') or ''
            if not esperada:
                return self._erro(500, 'POWERBI_API_KEY nao configurada no servidor')
            if not hmac.compare_digest(dada.encode(), esperada.encode()):
                return self._erro(403, 'Chave invalida')
            if p.get('acao') == 'painel' or url.path.rstrip('/').endswith('/painel'):
                return self._responder(200, json.dumps(painel(), ensure_ascii=False, separators=(',', ':')),
                                       'application/json; charset=utf-8')
            tabela = p.get('tabela', '')
            if tabela not in TABELAS:
                return self._erro(400, f'tabela tem de ser uma de: {", ".join(TABELAS)}')
            try:
                pagina = int(p.get('pagina', '1'))
                assert pagina >= 1
            except (ValueError, AssertionError):
                return self._erro(400, 'pagina tem de ser um numero inteiro >= 1')
            corpo, erro = pagina_csv(tabela, pagina)
            if erro:
                return self._erro(404, erro)
            self._responder(200, corpo, 'text/csv; charset=utf-8',
                            {'Content-Disposition': f'inline; filename="{tabela}_p{pagina}.csv"'})
        except Exception as e:  # noqa: BLE001
            self._erro(500, f'{type(e).__name__}: {e}')
