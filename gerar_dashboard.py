"""
gerar_dashboard.py - dados ESTATICOS do dashboard (26/11/2026)
==============================================================
Le os 5 CSV da pasta Heineken/Fonte (os mesmos que o enviar_neon.py carrega no Neon), calcula os numeros do
dashboard para TODOS os meses e grava public/dados/painel.enc. O dashboard so le este ficheiro: NAO toca no Neon.

O ficheiro vai para o GitHub (repositorio publico), por isso e CIFRADO: AES-256-GCM com chave derivada da chave
da API (PBKDF2-SHA256). Sem a chave da API, o ficheiro nao se le. A chave vem do .env desta pasta (POWERBI_API_KEY).

Verificacoes (pára se falhar): semanas, dias, auditores, provincias e canais somam o total de visitas do mes;
done + not done = visitas; pontos no mapa + sem GPS = visitas; o ficheiro cifrado volta a dar os mesmos dados.

Uso:  python gerar_dashboard.py [pasta_fonte]          depois: git add public/dados/painel.enc; commit; push
"""
import base64
import calendar
import gzip
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

AQUI = Path(__file__).resolve().parent
FONTE = Path(sys.argv[1]) if len(sys.argv) > 1 else \
    Path.home() / 'OneDrive - Tangerine Enterprises LDA' / 'Heineken' / 'Fonte'
SAIDA = AQUI / 'public' / 'dados' / 'painel.enc'
ITER = 250_000
MESES_PT = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro',
            'Outubro', 'Novembro', 'Dezembro']
DONE = 'Audit done'


def chave_api():
    m = re.search(r'^POWERBI_API_KEY=(\S+)', (AQUI / '.env').read_text(encoding='utf-8'), re.M)
    return m.group(1) if m else os.environ['POWERBI_API_KEY']


def ler(t, **k):
    return pd.read_csv(FONTE / f'{t}.csv', dtype=str, keep_default_na=False, encoding='utf-8-sig', **k)


def semana(dia):            # semana do mes: 1 = dias 1-7, 2 = 8-14, 3 = 15-21, 4 = 22-28, 5 = 29-31
    return (int(dia[8:10]) - 1) // 7


def contar(serie, vazio, top=None):
    c = serie.replace('', vazio).value_counts()
    lst = [[n, int(v)] for n, v in c.items()]
    if top and len(lst) > top:
        lst = lst[:top] + [['Outros', sum(v for _, v in lst[top:])]]
    return lst


def gps(lat, lon):
    try:
        la, lo = float(lat), float(lon)
    except ValueError:
        return None
    return (round(la, 5), round(lo, 5)) if -27 <= la <= -10 and 30 <= lo <= 41.5 else None


def main():
    demo, vdb, fb = ler('demographics'), ler('survey_visit_db'), ler('survey_feedback')
    pap = ler('product_availability_price', usecols=['visit_nu', 'auditor_name', 'brand', 'product', 'on_shelf',
                                                     'out_of_stock', 'not_stocked', 'unit_price', 'survey_number'])
    vq_vis = ler('visibility_quality', usecols=['visit_nu', 'survey_number']).drop_duplicates()
    assert demo.store_nu.is_unique, 'demographics: store_nu repetido'
    loja = demo.set_index('store_nu')
    aud_demo = dict(zip(demo.visit_nu, demo.auditor_name))
    aud_pap = pap[pap.auditor_name != ''].drop_duplicates('visit_nu').set_index('visit_nu').auditor_name.to_dict()

    meses = []
    for mes in sorted(vdb.survey_number.unique()):
        v = vdb[vdb.survey_number == mes].copy()
        n = len(v)
        assert v.store_nu.isin(loja.index).all(), f'{mes}: visita sem loja nas demographics'
        v['done'] = v.status == DONE
        v['aud'] = [aud_demo.get(x) or aud_pap.get(x) or '' for x in v.visit_nu]
        v['prov'] = loja.loc[v.store_nu, 'province'].values
        v['canal'] = loja.loc[v.store_nu, 'channel'].values
        v['wk'] = v.survey_date.map(semana)
        assert (v.survey_date.str[:7] == f'{mes[:4]}-{mes[4:]}').all(), f'{mes}: data fora do mes'

        # semanas e dias
        ultimo = v.survey_date.max()
        fim_mes = calendar.monthrange(int(mes[:4]), int(mes[4:]))[1]
        semanas = []
        for s in range(semana(f'{mes[:4]}-{mes[4:]}-{fim_mes:02d}') + 1):
            g = v[v.wk == s]
            semanas.append({'n': s + 1, 'de': s * 7 + 1, 'ate': min(s * 7 + 7, fim_mes), 'visitas': len(g),
                            'done': int(g.done.sum()), 'auditores': int(g.aud[g.aud != ''].nunique()),
                            'dias': int(g.survey_date.nunique())})
        dias = [[d, int(g.done.sum()), int((~g.done).sum())] for d, g in v.groupby('survey_date')]

        # auditores (visitas e done por semana)
        auds = []
        for a, g in v.groupby('aud'):
            auds.append({'nome': a or 'Não registado', 'registado': bool(a), 'visitas': len(g),
                         'done': int(g.done.sum()), 'dias': int(g.survey_date.nunique()),
                         'sem': [int((g.wk == s).sum()) for s in range(len(semanas))],
                         'sem_done': [int(((g.wk == s) & g.done).sum()) for s in range(len(semanas))]})
        auds.sort(key=lambda x: (not x['registado'], -x['visitas'], x['nome']))

        provs = [[p or 'Sem província', len(g), int(g.done.sum())] for p, g in v.groupby('prov')]
        provs.sort(key=lambda x: -x[1])

        # Heineken: disponibilidade e precos (PAP)
        h = pap[(pap.survey_number == mes) & (pap.brand == 'Heineken')]
        on, oos, ns = (int((h[c] == '-1').sum()) for c in ('on_shelf', 'out_of_stock', 'not_stocked'))
        prods = []
        for p, g in h.groupby('product'):
            preco = pd.to_numeric(g.unit_price, errors='coerce')
            preco = preco[preco > 0]
            prods.append({'produto': p, 'on': int((g.on_shelf == '-1').sum()), 'oos': int((g.out_of_stock == '-1').sum()),
                          'ns': int((g.not_stocked == '-1').sum()),
                          'preco': round(float(preco.mean()), 1) if len(preco) else None,
                          'preco_min': float(preco.min()) if len(preco) else None,
                          'preco_max': float(preco.max()) if len(preco) else None, 'preco_n': int(len(preco))})
        prods.sort(key=lambda x: -(x['on'] / max(1, x['on'] + x['oos'] + x['ns'])))

        # lojas para o mapa (colunas; indices para auditor e provincia)
        nomes_aud = [x['nome'] for x in auds]
        nomes_prov = [x[0] for x in provs]
        mapa = {'lat': [], 'lon': [], 'st': [], 'sem': [], 'aud': [], 'prov': [], 'nome': [], 'sem_id': [], 'dia': []}
        sem_gps = 0
        for r in v.itertuples():
            pt = gps(loja.at[r.store_nu, 'store_latitude'], loja.at[r.store_nu, 'store_longitude'])
            if not pt:
                sem_gps += 1
                continue
            mapa['lat'].append(pt[0]); mapa['lon'].append(pt[1]); mapa['st'].append(1 if r.done else 0)
            mapa['sem'].append(int(r.wk)); mapa['aud'].append(nomes_aud.index(r.aud or 'Não registado'))
            mapa['prov'].append(nomes_prov.index(r.prov or 'Sem província'))
            mapa['nome'].append(loja.at[r.store_nu, 'store_name']); mapa['sem_id'].append(r.sem_id)
            mapa['dia'].append(int(r.survey_date[8:10]))

        fb_m = fb[fb.survey_number == mes]
        k = {'visitas': n, 'done': int(v.done.sum()), 'not_done': int((~v.done).sum()),
             'lojas': int(v.store_nu.nunique()), 'auditores': int(v.aud[v.aud != ''].nunique()),
             'aud_registado': int((v.aud != '').sum()), 'feedbacks': len(fb_m),
             'provincias': int(v.prov[v.prov != ''].nunique()),
             'pap_visitas': int(pap.loc[pap.survey_number == mes, 'visit_nu'].nunique()),
             'vq_visitas': int((vq_vis.survey_number == mes).sum()),
             'dias': int(v.survey_date.nunique()), 'h_on': on, 'h_oos': oos, 'h_ns': ns}

        # verificacoes
        assert k['done'] + k['not_done'] == n
        assert sum(s['visitas'] for s in semanas) == n and sum(s['done'] for s in semanas) == k['done']
        assert sum(d[1] + d[2] for d in dias) == n
        assert sum(a['visitas'] for a in auds) == n and all(sum(a['sem']) == a['visitas'] for a in auds)
        assert sum(p[1] for p in provs) == n
        assert len(mapa['lat']) + sem_gps == n
        canais = contar(v.canal, 'Sem canal', 7)
        assert sum(c[1] for c in canais) == n
        fbc = contar(fb_m.category, 'Sem categoria', 7)
        assert sum(c[1] for c in fbc) == len(fb_m)
        assert sum(p['on'] + p['oos'] + p['ns'] for p in prods) == on + oos + ns

        meses.append({'mes': mes, 'rotulo': f'{MESES_PT[int(mes[4:])]} {mes[:4]}', 'curto': MESES_PT[int(mes[4:])][:3],
                      'dados_ate': ultimo, 'kpi': k, 'semanas': semanas, 'dias': dias, 'auditores': auds,
                      'provincias': provs, 'canais': canais, 'feedback': fbc, 'status': contar(v.status_detalhado[~v.done], 'Sem detalhe', 6),
                      'produtos': prods, 'mapa': mapa, 'sem_gps': sem_gps})
        print(f'  {mes}: {n:,} visitas ({k["done"]:,} done), {len(semanas)} semanas, {len(auds)} auditores, '
              f'{len(mapa["lat"]):,} no mapa, {sem_gps} sem GPS, {len(prods)} produtos Heineken')

    dados = {'gerado_em': datetime.now().isoformat(timespec='seconds'), 'dados_ate': vdb.survey_date.max(),
             'meses': meses}
    bruto = gzip.compress(json.dumps(dados, ensure_ascii=False, separators=(',', ':')).encode('utf-8'), 9)

    sal, iv = os.urandom(16), os.urandom(12)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=sal, iterations=ITER)
    k = kdf.derive(chave_api().encode('utf-8'))
    ct = AESGCM(k).encrypt(iv, bruto, b'heineken-dashboard-v1')
    b64 = lambda x: base64.b64encode(x).decode()
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps({'v': 1, 'it': ITER, 'sal': b64(sal), 'iv': b64(iv), 'ad': 'heineken-dashboard-v1',
                                 'ct': b64(ct)}), encoding='utf-8')

    # volta a ler o ficheiro gravado e confere
    f = json.loads(SAIDA.read_text(encoding='utf-8'))
    k2 = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=base64.b64decode(f['sal']), iterations=f['it']) \
        .derive(chave_api().encode('utf-8'))
    volta = json.loads(gzip.decompress(AESGCM(k2).decrypt(base64.b64decode(f['iv']), base64.b64decode(f['ct']),
                                                          f['ad'].encode())))
    assert volta == json.loads(json.dumps(dados, ensure_ascii=False)), 'ficheiro cifrado nao volta aos mesmos dados'
    print(f'[OK] {SAIDA.relative_to(AQUI)}: {SAIDA.stat().st_size / 1024:,.0f} KB cifrados, dados ate '
          f'{dados["dados_ate"]}, {len(meses)} meses')


if __name__ == '__main__':
    main()
