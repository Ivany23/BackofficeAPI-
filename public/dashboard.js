// Dashboard Heineken Retail Audit (26/11/2026).
// Le SO o ficheiro estatico dados/painel.enc (gerado pelo gerar_dashboard.py a partir dos CSV do SharePoint).
// Nao faz nenhum pedido a API nem ao Neon. O ficheiro esta cifrado (AES-256-GCM, chave derivada da chave da API
// com PBKDF2-SHA256) e e decifrado aqui no browser.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const fmt = n => Number(n).toLocaleString('pt-PT');
  const pct = (a, b, d = 0) => b ? (100 * a / b).toFixed(d).replace('.', ',') + '%' : '—';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dataPT = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—';
  const DIAS_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const CATS = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7'];
  const CHAVE_LS = 'chave_api';

  let D = null, M = null, iMes = 0;
  let mapa = null, camada = null, tiles = null;
  const filtro = { sem: -1, aud: -1, prov: -1, st: new Set([1, 0]) };

  /* ---------------- dica (tooltip) ---------------- */
  const dica = $('dica');
  function mostrar(e, html) { dica.innerHTML = html; dica.hidden = false; mover(e); }
  function mover(e) {
    const p = e.touches ? e.touches[0] : e;
    const x = Math.min(p.clientX + 14, innerWidth - dica.offsetWidth - 8);
    const y = p.clientY + 16 + dica.offsetHeight > innerHeight ? p.clientY - dica.offsetHeight - 12 : p.clientY + 16;
    dica.style.left = Math.max(8, x) + 'px'; dica.style.top = y + 'px';
  }
  function esconder() { dica.hidden = true; }
  function comDica(el, html) {
    el.addEventListener('pointerenter', e => mostrar(e, typeof html === 'function' ? html() : html));
    el.addEventListener('pointermove', mover);
    el.addEventListener('pointerleave', esconder);
  }

  /* ---------------- chave e decifrar ---------------- */
  const lerLS = () => { try { return localStorage.getItem(CHAVE_LS) || ''; } catch { return ''; } };
  const gravarLS = v => { try { v ? localStorage.setItem(CHAVE_LS, v) : localStorage.removeItem(CHAVE_LS); } catch { /* sem storage */ } };
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  let ficheiro = null;
  async function obterFicheiro() {
    if (ficheiro) return ficheiro;
    const r = await fetch('dados/painel.enc', { cache: 'no-cache' });
    if (!r.ok) throw new Error('ficheiro de dados não encontrado (' + r.status + ')');
    ficheiro = await r.json();
    return ficheiro;
  }

  async function decifrar(chave) {
    const f = await obterFicheiro();
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(chave), 'PBKDF2', false, ['deriveKey']);
    const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(f.sal), iterations: f.it },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    let gz;
    try {
      gz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(f.iv), additionalData: new TextEncoder().encode(f.ad) }, k, b64(f.ct));
    } catch { const e = new Error('Chave inválida'); e.chave = true; throw e; }
    const txt = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(txt);
  }

  async function abrir(chave) {
    const msg = $('msg'), btn = $('abrir');
    msg.className = 'folha-msg'; msg.textContent = 'A abrir…'; btn.disabled = true;
    try {
      if (!window.crypto?.subtle || !window.DecompressionStream) throw new Error('Este browser é antigo. Use o Chrome, Edge ou Safari actualizados.');
      D = await decifrar(chave);
      gravarLS(chave);
      $('folha').hidden = true; $('app').hidden = false; $('tabbar').hidden = false; $('meses').hidden = false; $('sair').hidden = false;
      iniciar();
    } catch (e) {
      $('folha').hidden = false;
      msg.className = 'folha-msg erro';
      msg.textContent = e.chave ? 'Chave inválida. Confirme e cole outra vez.' : 'Não foi possível abrir: ' + e.message;
      if (e.chave) gravarLS('');
    } finally { btn.disabled = false; }
  }

  $('form-chave').addEventListener('submit', e => { e.preventDefault(); abrir($('chave').value.trim()); });
  $('sair').addEventListener('click', () => { gravarLS(''); location.reload(); });

  /* ---------------- controlo segmentado ---------------- */
  function moverPolegar(seg) {
    const pol = seg.querySelector('.seg-pol');
    const b = seg.querySelector('button[aria-selected="true"], button[aria-pressed="true"]');
    if (!pol || !b) return;
    pol.style.width = b.offsetWidth + 'px';
    pol.style.transform = `translateX(${b.offsetLeft}px)`;
  }
  function montarSeg(seg, itens, ativo, aoEscolher, attr = 'aria-pressed') {
    seg.querySelectorAll('button').forEach(b => b.remove());
    itens.forEach(([rot, val, titulo]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = rot; b.setAttribute(attr, String(val === ativo));
      if (attr === 'aria-selected') b.setAttribute('role', 'tab');
      if (titulo) b.title = titulo;
      b.onclick = () => {
        seg.querySelectorAll('button').forEach(x => x.setAttribute(attr, String(x === b)));
        moverPolegar(seg); aoEscolher(val);
      };
      seg.appendChild(b);
    });
    requestAnimationFrame(() => moverPolegar(seg));
  }
  addEventListener('resize', () => document.querySelectorAll('.seg').forEach(moverPolegar));

  /* ---------------- arranque ---------------- */
  function iniciar() {
    iMes = D.meses.length - 1;
    montarSeg($('meses'), D.meses.map((m, i) => [m.rotulo.replace(/ \d+$/, ''), i, m.rotulo]), iMes, i => { iMes = i; mudarMes(); }, 'aria-selected');
    $('rodape').textContent = `Dados estáticos gerados a ${new Date(D.gerado_em).toLocaleString('pt-PT')} a partir dos relatórios publicados no SharePoint · dados até ${dataPT(D.dados_ate)} · este dashboard não consulta a base de dados.`;
    ['f-auditor', 'f-provincia'].forEach(id => $(id).addEventListener('change', e => {
      filtro[id === 'f-auditor' ? 'aud' : 'prov'] = +e.target.value; desenharMapa(true);
    }));
    document.querySelectorAll('.chip[data-st]').forEach(c => c.addEventListener('click', () => {
      const s = +c.dataset.st;
      filtro.st.has(s) ? filtro.st.delete(s) : filtro.st.add(s);
      c.classList.toggle('on', filtro.st.has(s)); c.setAttribute('aria-pressed', String(filtro.st.has(s)));
      desenharMapa(false);
    }));
    separadores();
    mudarMes();
  }

  function mudarMes() {
    M = D.meses[iMes];
    filtro.sem = -1; filtro.aud = -1; filtro.prov = -1;
    resumo(); semanas(); donuts(); equipa(); provincias(); produtos(); filtrosMapa(); desenharMapa(true);
    document.querySelectorAll('.bloco-sec').forEach(s => { s.style.animation = 'none'; void s.offsetWidth; s.style.animation = ''; });
  }

  const anterior = () => iMes > 0 ? D.meses[iMes - 1] : null;
  const ultimoMes = () => iMes === D.meses.length - 1;

  function delta(atual, antes, rot, emPontos) {
    if (antes == null) return '';
    const d = emPontos ? atual - antes : (antes ? 100 * (atual - antes) / antes : 0);
    if (!isFinite(d)) return '';
    const s = d > 0.05 ? '<span class="seta-c">▲</span>' : d < -0.05 ? '<span class="seta-b">▼</span>' : '•';
    const v = Math.abs(d).toFixed(emPontos ? 1 : 0).replace('.', ',') + (emPontos ? ' p.p.' : '%');
    return `<span class="delta">${s} ${v}</span> <span>vs ${rot}</span>`;
  }

  /* ---------------- resumo / KPIs ---------------- */
  const IC = {
    visitas: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 4l9 6.5M5 9.5V20h14V9.5M9.5 20v-5.5h5V20"/></svg>',
    done: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    nd: '<svg viewBox="0 0 24 24"><path d="M12 7v6M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg>',
    aud: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 6M17.5 14.2a5 5 0 0 1 3 4.8"/></svg>',
    fb: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    hk: '<svg viewBox="0 0 24 24"><path d="M9 3h6v4l1.5 2.5V20a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V9.5L9 7z"/></svg>',
    prov: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
    dia: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  };

  function resumo() {
    const k = M.kpi, a = anterior(), ka = a?.kpi, rotA = a?.curto;
    const ate = M.dados_ate;
    $('sobre').textContent = ultimoMes() ? 'Mês em curso' : 'Mês fechado';
    $('titulo').textContent = M.rotulo;
    $('estado-dados').innerHTML = (ultimoMes() ? `<span class="etiqueta viva">Dados até ${dataPT(ate)}</span>` : `<span class="etiqueta">Último dia com leituras: ${dataPT(ate)}</span>`)
      + `<span class="etiqueta">${fmt(k.dias)} dias com leituras</span>`;
    const hTot = k.h_on + k.h_oos + k.h_ns, hTotA = ka ? ka.h_on + ka.h_oos + ka.h_ns : 0;
    const taxa = k.visitas ? 100 * k.done / k.visitas : 0, taxaA = ka?.visitas ? 100 * ka.done / ka.visitas : null;
    const cards = [
      ['Visitas', k.visitas, IC.visitas, '--c1', `${fmt(k.lojas)} lojas`, delta(k.visitas, ka?.visitas, rotA)],
      ['Audit done', k.done, IC.done, '--done', `<span class="delta">${pct(k.done, k.visitas, 1)}</span><span>das visitas</span>`, delta(taxa, taxaA, rotA, true), taxa],
      ['Audit not done', k.not_done, IC.nd, '--nd', `${pct(k.not_done, k.visitas, 1)} das visitas`, delta(k.not_done, ka?.not_done, rotA)],
      ['Auditores activos', k.auditores, IC.aud, '--c3', k.aud_registado < k.visitas ? `auditor registado em ${fmt(k.aud_registado)} visitas` : 'com visitas no mês', delta(k.auditores, ka?.auditores, rotA)],
      ['Heineken on shelf', hTot ? pct(k.h_on, hTot, 1) : '—', IC.hk, '--verde', `${fmt(k.h_on)} de ${fmt(hTot)} leituras`, hTot && hTotA ? delta(100 * k.h_on / hTot, 100 * ka.h_on / hTotA, rotA, true) : ''],
      ['Feedbacks', k.feedbacks, IC.fb, '--c5', `${pct(k.feedbacks, k.lojas)} das lojas`, delta(k.feedbacks, ka?.feedbacks, rotA)],
      ['Províncias', k.provincias, IC.prov, '--c4', `${fmt(M.provincias.length)} grupos no mapa`, ''],
      ['Visitas com PAP', k.pap_visitas, IC.dia, '--c2', `VQ: ${fmt(k.vq_visitas)} visitas`, delta(k.pap_visitas, ka?.pap_visitas, rotA)],
    ];
    $('kpis').innerHTML = cards.map(([rot, val, ic, cor, det, dl, anel]) => {
      const r = 19, c = 2 * Math.PI * r;
      const svgAnel = anel != null ? `<svg class="anel" viewBox="0 0 46 46" aria-hidden="true"><circle class="fundo" cx="23" cy="23" r="${r}"/><circle class="val" cx="23" cy="23" r="${r}" stroke-dasharray="${(anel / 100) * c} ${c}"/></svg>` : '';
      return `<div class="kpi">${svgAnel}<div class="kpi-top"><span class="kpi-ic" style="background:var(${cor})">${ic}</span>${rot}</div>
        <div class="kpi-val">${typeof val === 'number' ? fmt(val) : val}</div>
        <div class="kpi-det">${det}</div>${dl ? `<div class="kpi-det">${dl}</div>` : ''}</div>`;
    }).join('');
  }

  /* ---------------- semanas ---------------- */
  function semanas() {
    const S = M.semanas, mes = M.mes, ano = +mes.slice(0, 4), m = +mes.slice(4);
    const fim = M.dados_ate ? +M.dados_ate.slice(8, 10) : 0;
    $('sem-info').textContent = `Semanas do mês: dias 1–7, 8–14, 15–21, 22–28 e 29 até ao fim · ${fmt(M.kpi.visitas)} visitas`;
    $('sem-cards').innerHTML = S.map((s, i) => {
      const ant = i > 0 ? S[i - 1] : null;
      const emCurso = ultimoMes() && fim >= s.de && fim < s.ate;
      const futura = ultimoMes() && fim < s.de;
      const dl = !emCurso && ant && ant.visitas && s.visitas ? delta(s.visitas, ant.visitas, `S${ant.n}`) : '';
      const w = s.visitas ? 100 * s.done / s.visitas : 0;
      return `<button type="button" class="sem-card${s.visitas ? '' : ' vazia'}" data-i="${i}">
        <div class="s-tit"><b>Semana ${s.n}</b><span>${String(s.de).padStart(2, '0')}–${String(s.ate).padStart(2, '0')}/${String(m).padStart(2, '0')}</span></div>
        <div class="s-val">${fmt(s.visitas)} <small>visitas</small></div>
        <div class="s-barra">${s.visitas ? `<i style="width:${w}%;background:var(--done)"></i><i style="width:${100 - w}%;background:var(--nd)"></i>` : ''}</div>
        <div class="s-det"><span>${s.visitas ? `${pct(s.done, s.visitas)} done · ${s.auditores} auditores` : futura ? 'ainda por vir' : 'sem leituras'}</span>${emCurso ? '<span class="badge">em curso</span>' : ''}</div>
        ${dl ? `<div class="s-det" style="margin-top:4px"><span>${dl}</span></div>` : ''}</button>`;
    }).join('');
    $('sem-cards').querySelectorAll('.sem-card').forEach(b => b.addEventListener('click', () => {
      filtro.sem = +b.dataset.i; filtrosMapa(); desenharMapa(true);
      $('mapa-sec').scrollIntoView({ behavior: 'smooth' });
    }));

    // colunas por dia (todos os dias do mes)
    const nDias = new Date(ano, m, 0).getDate();
    const porDia = Object.fromEntries(M.dias.map(([d, a, b]) => [+d.slice(8, 10), [a, b]]));
    const max = Math.max(1, ...M.dias.map(([, a, b]) => a + b));
    const passo = max > 200 ? 100 : max > 100 ? 50 : max > 40 ? 20 : 10;
    const topo = Math.ceil(max / passo) * passo;
    let html = '<div class="eixo-y">';
    for (let v = 0; v <= topo; v += passo) html += `<div style="bottom:${100 * v / topo}%"><span>${v}</span></div>`;
    html += '</div>';
    for (let d = 1; d <= nDias; d++) {
      const [a, b] = porDia[d] || [0, 0];
      const ds = new Date(ano, m - 1, d).getDay();
      const cls = ['col', ds === 0 || ds === 6 ? 'fds' : '', d > 1 && (d - 1) % 7 === 0 ? 'sem-ini' : ''].join(' ');
      const so = a && b ? '' : ' so';
      html += `<div class="${cls}" data-d="${d}">${b ? `<i class="n${so}" style="height:${100 * b / topo}%"></i>` : ''}${a ? `<i class="d${so}" style="height:${100 * a / topo}%"></i>` : ''}
        ${d === 1 || d % 5 === 0 ? `<span class="x">${d}</span>` : ''}</div>`;
    }
    $('dias').innerHTML = html;
    $('dias').setAttribute('aria-label', `Visitas por dia em ${M.rotulo}`);
    $('dias').querySelectorAll('.col').forEach(c => {
      const d = +c.dataset.d, [a, b] = porDia[d] || [0, 0], ds = DIAS_SEM[new Date(ano, m - 1, d).getDay()];
      comDica(c, `<b>${ds}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}</b> · semana ${Math.floor((d - 1) / 7) + 1}<br>
        <span class="linha-d"><i class="pt done"></i>Done: <b>${fmt(a)}</b></span><span class="linha-d"><i class="pt nd"></i>Not done: <b>${fmt(b)}</b></span>Total: <b>${fmt(a + b)}</b>`);
    });
    const melhor = M.dias.reduce((x, y) => (y[1] + y[2] > x[1] + x[2] ? y : x), M.dias[0]);
    $('dias-info').textContent = melhor ? `Média ${fmt(Math.round(M.kpi.visitas / M.kpi.dias))} por dia com leituras · melhor dia ${dataPT(melhor[0])} (${fmt(melhor[1] + melhor[2])})` : '—';

    $('taxa').innerHTML = S.map(s => `<div class="taxa-l"><span>Semana ${s.n}</span><div class="t-b"><i style="width:${s.visitas ? 100 * s.done / s.visitas : 0}%"></i></div><b>${s.visitas ? pct(s.done, s.visitas) : '—'}</b></div>`).join('')
      + `<div class="taxa-l" style="border-top:1px solid var(--linha);padding-top:10px"><span><b>Mês</b></span><div class="t-b"><i style="width:${100 * M.kpi.done / M.kpi.visitas}%"></i></div><b>${pct(M.kpi.done, M.kpi.visitas)}</b></div>`;
  }

  /* ---------------- donuts ---------------- */
  function donut(alvo, fatias, centro, sub) {
    const tot = fatias.reduce((s, f) => s + f[1], 0);
    const r = 70, C = 2 * Math.PI * r, gap = fatias.filter(f => f[1]).length > 1 ? 2.2 : 0;
    let off = 0, circ = '';
    fatias.forEach(([nome, v, cor], i) => {
      if (!v) return;
      const len = C * v / tot;
      circ += `<circle data-i="${i}" r="${r}" cx="84" cy="84" stroke="${cor}" stroke-dasharray="${Math.max(0.5, len - gap)} ${C}" stroke-dashoffset="${-off}"/>`;
      off += len;
    });
    $(alvo).innerHTML = `<div class="donut"><svg viewBox="0 0 168 168" role="img" aria-label="${esc(sub)}">${circ}</svg>
      <div class="centro"><b>${centro}</b><span>${esc(sub)}</span></div></div>
      <ul class="leg">${fatias.map(([n, v, cor]) => `<li><i class="pt" style="background:${cor}"></i><span title="${esc(n)}">${esc(n)}</span><b>${fmt(v)}</b><em>${pct(v, tot)}</em></li>`).join('')}</ul>`;
    $(alvo).querySelectorAll('circle[data-i]').forEach(c => {
      const [n, v, cor] = fatias[+c.dataset.i];
      comDica(c, `<span class="linha-d"><i class="pt" style="background:${cor}"></i><b>${esc(n)}</b></span>${fmt(v)} · ${pct(v, tot, 1)}`);
    });
  }
  const paleta = lista => lista.map(([n, v], i) => [n, v, n === 'Outros' ? css('--outros') : css(CATS[i % CATS.length])]);

  function donuts() {
    const k = M.kpi;
    donut('d-estado', [['Audit done', k.done, css('--done')], ['Audit not done', k.not_done, css('--nd')]], pct(k.done, k.visitas), 'audit done');
    const hT = k.h_on + k.h_oos + k.h_ns;
    if (hT) donut('d-heineken', [['On shelf', k.h_on, css('--on')], ['Out of stock', k.h_oos, css('--oos')], ['Not stocked', k.h_ns, css('--ns')]], pct(k.h_on, hT), 'on shelf');
    else $('d-heineken').innerHTML = '<p class="muted">Sem leituras PAP neste mês.</p>';
    donut('d-canais', paleta(M.canais), fmt(k.visitas), 'visitas');
    donut('d-feedback', paleta(M.feedback), fmt(k.feedbacks), 'feedbacks');
  }

  /* ---------------- equipa ---------------- */
  function equipa() {
    const A = M.auditores, S = M.semanas;
    const max = Math.max(1, ...A.filter(a => a.registado).flatMap(a => a.sem));
    const reg = A.filter(a => a.registado).length;
    $('eq-info').textContent = reg ? `${reg} auditores · visitas por semana, Audit done e dias de trabalho` : 'O auditor não foi registado nas visitas deste mês.';
    let pos = 0;
    $('eq').innerHTML = `<thead><tr><th></th><th>Auditor</th>${S.map(s => `<th class="c" title="dias ${s.de}–${s.ate}">S${s.n}</th>`).join('')}
      <th class="n">Visitas</th><th class="n">Done</th><th>Done / not done</th><th class="n">Dias</th></tr></thead><tbody>`
      + A.map(a => {
        const w = a.visitas ? 100 * a.done / a.visitas : 0;
        return `<tr class="${a.registado ? '' : 'nao-reg'}"><td class="pos">${a.registado ? ++pos : ''}</td><td class="nome" title="${esc(a.nome)}">${esc(a.nome)}</td>
        ${a.sem.map((v, i) => {
          const p = a.registado && v ? Math.round(15 + 85 * v / max) : 0;
          const estilo = a.registado && v ? `background:color-mix(in oklab, var(--verde) ${p}%, transparent);${p > 55 ? 'color:#fff' : ''}` : '';
          return `<td class="c"><span class="cel" style="${estilo}" data-a="${esc(a.nome)}" data-s="${i}">${v ? fmt(v) : '·'}</span></td>`;
        }).join('')}
        <td class="n"><b>${fmt(a.visitas)}</b></td><td class="n">${pct(a.done, a.visitas)}</td>
        <td><div class="barra-p"><i style="width:${w}%;background:var(--done)"></i><i style="width:${100 - w}%;background:var(--nd)"></i></div></td>
        <td class="n">${fmt(a.dias)}</td></tr>`;
      }).join('') + '</tbody>';
    $('eq').querySelectorAll('.cel').forEach(c => {
      const a = A.find(x => x.nome === c.dataset.a), i = +c.dataset.s, s = S[i];
      comDica(c, `<b>${esc(a.nome)}</b><br>Semana ${s.n} (dias ${s.de}–${s.ate})<br>Visitas: <b>${fmt(a.sem[i])}</b> · done: <b>${fmt(a.sem_done[i])}</b>`);
    });
  }

  function provincias() {
    const P = M.provincias, max = Math.max(1, ...P.map(p => p[1]));
    $('provs').innerHTML = P.map(([n, v, d], i) => `<button type="button" class="pv" data-i="${i}"><span title="${esc(n)}">${esc(n)}</span>
      <div class="pv-b" style="width:${100 * v / max}%"><i style="flex:${d};background:var(--done)"></i>${v - d ? `<i style="flex:${v - d};background:var(--nd)"></i>` : ''}</div><b>${fmt(v)}</b></button>`).join('');
    $('provs').querySelectorAll('.pv').forEach(b => {
      const [n, v, d] = P[+b.dataset.i];
      comDica(b, `<b>${esc(n)}</b><br><span class="linha-d"><i class="pt done"></i>Done: <b>${fmt(d)}</b> (${pct(d, v)})</span><span class="linha-d"><i class="pt nd"></i>Not done: <b>${fmt(v - d)}</b></span>`);
      b.addEventListener('click', () => { filtro.prov = +b.dataset.i; filtrosMapa(); desenharMapa(true); $('mapa-sec').scrollIntoView({ behavior: 'smooth' }); });
    });
  }

  /* ---------------- produtos ---------------- */
  function produtos() {
    const P = M.produtos;
    if (!P.length) { $('prods').innerHTML = '<p class="muted">Sem leituras PAP de produtos Heineken neste mês.</p>'; return; }
    $('prods').innerHTML = P.map((p, i) => {
      const t = p.on + p.oos + p.ns;
      const seg = (v, cor) => v ? `<i style="flex:${v};background:var(${cor})">${100 * v / t >= 9 ? pct(v, t) : ''}</i>` : '';
      return `<div class="pr" data-i="${i}"><div class="pr-nome" title="${esc(p.produto)}">${esc(p.produto)}<small>${fmt(t)} leituras</small></div>
        <div class="pr-b">${seg(p.on, '--on')}${seg(p.oos, '--oos')}${seg(p.ns, '--ns')}</div>
        <div class="pr-p">${p.preco != null ? `<b>${p.preco.toFixed(1).replace('.', ',')} MT</b><small>média de ${fmt(p.preco_n)} preços</small>` : '<small>sem preço unitário</small>'}</div></div>`;
    }).join('');
    $('prods').querySelectorAll('.pr').forEach(el => {
      const p = P[+el.dataset.i], t = p.on + p.oos + p.ns;
      comDica(el.querySelector('.pr-b'), `<b>${esc(p.produto)}</b><br><span class="linha-d"><i class="pt on"></i>On shelf: <b>${fmt(p.on)}</b> (${pct(p.on, t, 1)})</span>
        <span class="linha-d"><i class="pt oos"></i>Out of stock: <b>${fmt(p.oos)}</b> (${pct(p.oos, t, 1)})</span><span class="linha-d"><i class="pt ns"></i>Not stocked: <b>${fmt(p.ns)}</b> (${pct(p.ns, t, 1)})</span>
        ${p.preco != null ? `Preço unitário: ${fmt(p.preco_min)}–${fmt(p.preco_max)} MT` : ''}`);
    });
  }

  /* ---------------- mapa ---------------- */
  function filtrosMapa() {
    montarSeg($('f-semana'), [['Todas', -1], ...M.semanas.map((s, i) => [`S${s.n}`, i, `dias ${s.de}–${s.ate}`])], filtro.sem,
      v => { filtro.sem = v; desenharMapa(true); });
    const opc = (lista, todos, sel) => `<option value="-1">${todos}</option>` + lista.map((n, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');
    $('f-auditor').innerHTML = opc(M.auditores.map(a => a.nome), 'Todos os auditores', filtro.aud);
    $('f-provincia').innerHTML = opc(M.provincias.map(p => p[0]), 'Todas as províncias', filtro.prov);
  }

  function temaTiles() {
    if (!tiles) tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(mapa);
  }

  function desenharMapa(ajustar) {
    if (!window.L) { $('mapa-info').textContent = 'O mapa não carregou (sem ligação à biblioteca Leaflet).'; return; }
    if (!mapa) {
      mapa = L.map('mapa', { preferCanvas: true, zoomControl: true, attributionControl: true }).setView([-18.7, 35.5], 5);
      temaTiles();
      camada = L.layerGroup().addTo(mapa);
    }
    camada.clearLayers();
    const m = M.mapa, n = m.lat.length, cD = css('--done'), cN = css('--nd'), borda = css('--bg') || '#fff';
    const pts = [];
    let done = 0;
    const ano = M.mes.slice(0, 4), mm = M.mes.slice(4);
    for (let i = 0; i < n; i++) {
      if (filtro.sem >= 0 && m.sem[i] !== filtro.sem) continue;
      if (filtro.aud >= 0 && m.aud[i] !== filtro.aud) continue;
      if (filtro.prov >= 0 && m.prov[i] !== filtro.prov) continue;
      if (!filtro.st.has(m.st[i])) continue;
      const ok = m.st[i] === 1;
      done += ok;
      pts.push([m.lat[i], m.lon[i]]);
      L.circleMarker([m.lat[i], m.lon[i]], { radius: 5.5, color: borda, weight: 1.2, fillColor: ok ? cD : cN, fillOpacity: .92 })
        .bindTooltip(`<b>${esc(m.nome[i])}</b><br>SEM ID ${esc(m.sem_id[i])} · ${esc(M.provincias[m.prov[i]][0])}<br>${esc(M.auditores[m.aud[i]].nome)}<br>${String(m.dia[i]).padStart(2, '0')}/${mm}/${ano} · <b style="color:${ok ? cD : cN}">${ok ? 'Audit done' : 'Audit not done'}</b>`,
          { className: 'lt', direction: 'top', offset: [0, -6] })
        .addTo(camada);
    }
    const partes = [];
    if (filtro.sem >= 0) partes.push(`semana ${filtro.sem + 1}`);
    if (filtro.aud >= 0) partes.push(M.auditores[filtro.aud].nome);
    if (filtro.prov >= 0) partes.push(M.provincias[filtro.prov][0]);
    $('mapa-info').textContent = `${fmt(pts.length)} lojas no mapa (${fmt(done)} done · ${fmt(pts.length - done)} not done)` +
      (partes.length ? ` · ${partes.join(' · ')}` : '') + (M.sem_gps && !partes.length ? ` · ${fmt(M.sem_gps)} sem GPS válido` : '');
    setTimeout(() => {
      mapa.invalidateSize();
      if (ajustar && pts.length) mapa.fitBounds(pts, { padding: [24, 24], maxZoom: 14 });
    }, 60);
  }

  /* ---------------- barra de separadores (scroll spy) ---------------- */
  function separadores() {
    const links = [...document.querySelectorAll('.tabbar a')];
    const obs = new IntersectionObserver(ents => {
      ents.forEach(e => {
        if (e.isIntersecting) links.forEach(a => a.classList.toggle('ativo', a.dataset.s === e.target.id));
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    document.querySelectorAll('.bloco-sec').forEach(s => obs.observe(s));
    links[0].classList.add('ativo');
  }

  /* ---------------- inicio ---------------- */
  const guardada = lerLS();
  $('chave').value = guardada;
  $('folha').hidden = false;
  if (guardada) abrir(guardada);
  else $('chave').focus();
})();
