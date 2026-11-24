// Painel: totais, mapa OpenStreetMap, auditores (com subida desde a carga anterior), leituras por dia, provincias.
// Le /api/painel com a chave do ponto 2 (guardada neste browser). Os numeros vem do Neon em cada pedido.
(() => {
  const $ = id => document.getElementById(id);
  const fmt = n => Number(n).toLocaleString('pt-PT');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MESES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const cor = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const dataPT = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—';
  const horaPT = d => d ? new Date(d).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  // dica (tooltip)
  const dica = $('dica');
  const mostrar = (e, html) => { dica.innerHTML = html; dica.hidden = false; mover(e); };
  const mover = e => { const x = Math.min(e.clientX + 14, innerWidth - dica.offsetWidth - 8); dica.style.left = x + 'px'; dica.style.top = (e.clientY + 14) + 'px'; };
  const esconder = () => { dica.hidden = true; };

  let mapa, camada, dados, filtroAud = '', estados = new Set([1, 0]);

  function chave() { try { return localStorage.getItem('chave_api') || ''; } catch { return ''; } }

  async function carregar() {
    const k = ($('chave')?.value || '').trim() || chave();
    if (!k) { $('sem-chave').hidden = false; return; }
    try {
      const r = await fetch('/api/painel', { headers: { 'x-api-key': k }, cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.erro || r.status);
      $('sem-chave').hidden = true;
      dados = j;
      desenhar();
    } catch (err) {
      $('sem-chave').hidden = false;
      $('sem-chave').innerHTML = `<b>Não foi possível abrir o painel:</b> ${esc(err.message)}. Confirme a chave no <a href="#chave-sec">ponto 2</a>.`;
    }
  }

  function desenhar() {
    const d = dados, k = d.kpis, m = String(d.mes || '');
    $('p-mes').textContent = m ? `${MESES[+m.slice(4)]} ${m.slice(0, 4)}` : '—';
    $('p-ate').textContent = `Dados até ${dataPT(d.dados_ate)}`;
    $('p-carga').textContent = `Última carga ${horaPT(d.ultima_carga)}`;
    const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '—';
    const tiles = [
      ['Lojas no mês', k.lojas, `${k.auditores} auditores`, '--s1'],
      ['Audit done', k.done, `${pct(k.done, k.lojas)} das lojas`, '--good'],
      ['Audit not done', k.not_done, `${pct(k.not_done, k.lojas)} das lojas`, '--serious'],
      ['Visitas com PAP', k.pap_visitas, 'Product availability & price', '--s3'],
      ['Visitas com VQ', k.vq_visitas, 'Visibility & quality', '--s7'],
      ['Feedbacks', k.feedbacks, '1 por loja', '--s4'],
    ];
    $('kpis').innerHTML = tiles.map(([r, v, det, c]) =>
      `<div class="kpi" style="--cor:var(${c})"><div class="rot">${r}</div><div class="val">${fmt(v)}</div><div class="det">${esc(det)}</div></div>`).join('');
    auditores(); dias(); provincias(); preencherFiltro(); desenharMapa();
  }

  function auditores() {
    const a = dados.auditores, max = Math.max(...a.map(x => x.lojas), 1);
    const total = a.reduce((s, x) => s + (x.subida || 0), 0);
    $('aud-info').textContent = dados.carga_anterior
      ? `${a.length} auditores · +${fmt(total)} lojas desde a carga de ${horaPT(dados.carga_anterior)}`
      : `${a.length} auditores`;
    $('auditores').innerHTML = a.map(x => {
      const s = x.subida == null ? '' : `<span class="sobe ${x.subida > 0 ? 'mais' : 'zero'}">${x.subida > 0 ? '+' : ''}${fmt(x.subida)}</span>`;
      return `<div class="aud${filtroAud === x.nome ? ' sel' : ''}" tabindex="0" data-nome="${esc(x.nome)}"
                data-d="${x.done}" data-n="${x.not_done}" data-s="${x.subida ?? ''}">
        <span class="nome">${esc(x.nome)}</span>
        <span class="barra"><i class="d" style="width:${100 * x.done / max}%"></i><i class="n" style="width:${100 * x.not_done / max}%"></i></span>
        <span class="total">${fmt(x.lojas)}</span>${s || '<span></span>'}</div>`;
    }).join('');
    document.querySelectorAll('.aud').forEach(el => {
      const nome = el.dataset.nome;
      el.onmousemove = e => mostrar(e, `<b>${esc(nome)}</b><br>Lojas: ${fmt(+el.dataset.d + +el.dataset.n)}<br>Audit done: ${fmt(el.dataset.d)}<br>Audit not done: ${fmt(el.dataset.n)}${el.dataset.s !== '' ? `<br>Desde a carga anterior: ${+el.dataset.s > 0 ? '+' : ''}${fmt(el.dataset.s)}` : ''}<br><i>Clique para ver no mapa</i>`);
      el.onmouseleave = esconder;
      const escolher = () => { filtroAud = filtroAud === nome ? '' : nome; $('f-auditor').value = filtroAud; auditores(); desenharMapa(); document.getElementById('mapa-sec').scrollIntoView(); };
      el.onclick = escolher;
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); escolher(); } };
    });
  }

  function dias() {
    const ds = dados.dias, W = 640, H = 240, P = { l: 36, r: 8, t: 10, b: 26 };
    const max = Math.max(...ds.map(x => x.done + x.not_done), 1);
    const passo = Math.pow(10, Math.floor(Math.log10(max))); const topo = Math.ceil(max / passo) * passo;
    const bw = (W - P.l - P.r) / ds.length, y = v => P.t + (H - P.t - P.b) * (1 - v / topo);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = topo * i / 4; g += `<line class="grade" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/><text class="eixo" x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(Math.round(v))}</text>`; }
    ds.forEach((x, i) => {
      const x0 = P.l + i * bw + bw * .18, w = bw * .64, yd = y(x.done), yn = y(x.done + x.not_done);
      g += `<g class="col" data-i="${i}"><rect x="${P.l + i * bw}" y="${P.t}" width="${bw}" height="${H - P.t - P.b}" fill="transparent"/>
        <rect x="${x0}" y="${yd}" width="${w}" height="${Math.max(0, y(0) - yd)}" rx="3" fill="${cor('--good')}"/>
        ${x.not_done ? `<rect x="${x0}" y="${yn}" width="${w}" height="${Math.max(0, yd - yn - 2)}" rx="3" fill="${cor('--serious')}"/>` : ''}</g>`;
      if (ds.length <= 16 || i % 2 === 0) g += `<text class="eixo" x="${x0 + w / 2}" y="${H - 8}" text-anchor="middle">${x.dia.slice(8, 10)}/${x.dia.slice(5, 7)}</text>`;
    });
    $('dias').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Visitas por dia">${g}</svg>`;
    $('dias').querySelectorAll('.col').forEach(el => {
      const x = ds[+el.dataset.i];
      el.onmousemove = e => mostrar(e, `<b>${dataPT(x.dia)}</b><br>Visitas: ${fmt(x.done + x.not_done)}<br>Audit done: ${fmt(x.done)}<br>Audit not done: ${fmt(x.not_done)}`);
      el.onmouseleave = esconder;
    });
  }

  function provincias() {
    const p = dados.provincias, max = Math.max(...p.map(x => x.lojas), 1);
    $('provincias').innerHTML = p.map(x => `<div class="bh" data-t="${esc(x.nome)}: ${fmt(x.lojas)} lojas"><span>${esc(x.nome)}</span>
      <span><i class="b" style="display:block;width:${100 * x.lojas / max}%"></i></span><span class="v">${fmt(x.lojas)}</span></div>`).join('');
  }

  function preencherFiltro() {
    const s = $('f-auditor'), atual = filtroAud;
    s.innerHTML = '<option value="">Todos os auditores</option>' + dados.auditores.map(a => `<option>${esc(a.nome)}</option>`).join('');
    s.value = atual;
  }

  function desenharMapa() {
    if (!window.L) { $('mapa-info').textContent = 'Não foi possível carregar o mapa (sem ligação ao OpenStreetMap).'; return; }
    if (!mapa) {
      mapa = L.map('mapa', { preferCanvas: true, zoomControl: true }).setView([-18.7, 35.5], 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(mapa);
      camada = L.layerGroup().addTo(mapa);
    }
    camada.clearLayers();
    const good = cor('--good'), serious = cor('--serious'), pts = [];
    for (const [la, lo, nome, sn, sem, aud, done, dia] of dados.lojas) {
      if (filtroAud && aud !== filtroAud) continue;
      if (!estados.has(done)) continue;
      const mk = L.circleMarker([la, lo], { radius: 6, weight: 2, color: '#ffffff', fillColor: done ? good : serious, fillOpacity: .95 });
      mk.bindPopup(`<b>${esc(nome)}</b><br>Store No: ${esc(sn)} · S.E.M. ID: ${esc(sem || '—')}<br>Auditor: ${esc(aud)}<br>
        Estado: <b>${done ? '✔ Audit done' : '✖ Audit not done'}</b><br>Visita: ${dataPT(dia)}`);
      camada.addLayer(mk); pts.push([la, lo]);
    }
    const tot = dados.lojas.length;
    $('mapa-info').textContent = `${fmt(pts.length)} lojas no mapa${filtroAud ? ` · ${filtroAud}` : ''}` +
      (dados.sem_gps ? ` · ${fmt(dados.sem_gps)} sem GPS válido (fora do mapa)` : '') + ` · total com GPS ${fmt(tot)}`;
    if (pts.length) mapa.fitBounds(pts, { padding: [24, 24], maxZoom: 14 });
    setTimeout(() => mapa.invalidateSize(), 50);
  }

  $('f-auditor').onchange = e => { filtroAud = e.target.value; auditores(); desenharMapa(); };
  document.querySelectorAll('.chip[data-st]').forEach(b => b.onclick = () => {
    const v = +b.dataset.st;
    if (estados.has(v) && estados.size === 1) return;   // nunca os dois desligados
    estados.has(v) ? estados.delete(v) : estados.add(v); b.classList.toggle('on', estados.has(v)); desenharMapa();
  });
  $('chave')?.addEventListener('change', carregar);
  $('chave')?.addEventListener('input', () => { clearTimeout(carregar.t); carregar.t = setTimeout(carregar, 600); });
  document.querySelectorAll('.abas a').forEach(a => a.onclick = () => { document.querySelectorAll('.abas a').forEach(x => x.classList.remove('ativo')); a.classList.add('ativo'); });
  carregar();
  setInterval(carregar, 5 * 60 * 1000);   // a cada 5 min volta a ler (apanha a carga nova no Neon)
})();
