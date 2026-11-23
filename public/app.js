const BASE = location.origin;
const fmt = n => Number(n).toLocaleString('pt-PT');
const $ = id => document.getElementById(id);

const TIPOS = {
  demographics: `{"visit_nu", type text}, {"store_nu", Int64.Type}, {"sem_id", Int64.Type},
    {"store_name", type text}, {"channel", type text}, {"classification", type text},
    {"region", type text}, {"province", type text}, {"district", type text},
    {"age", Int64.Type}, {"gender", type text}, {"contact_no", type text},
    {"tills", Int64.Type}, {"store_latitude", type number}, {"store_longitude", type number},
    {"date_modified", type date}, {"survey_number", Int64.Type},
    {"primeiro_mes", Int64.Type}, {"ultimo_mes", Int64.Type}, {"meses_auditada", Int64.Type}`,
  survey_visit_db: `{"visit_nu", type text}, {"store_nu", Int64.Type}, {"sem_id", Int64.Type},
    {"survey_date", type date}, {"status", type text}, {"survey_number", Int64.Type},
    {"status_detalhado", type text}`,
  survey_feedback: `{"visit_nu", type text}, {"store_nu", Int64.Type}, {"sem_id", Int64.Type},
    {"shop_name", type text}, {"category", type text}, {"details", type text},
    {"survey_date", type date}, {"survey_number", Int64.Type}`,
  product_availability_price: `{"visit_nu", type text}, {"auditor_name", type text}, {"store_nu", Int64.Type},
    {"customer_id", type text}, {"store_nu_origem", type text}, {"sem_id", Int64.Type},
    {"store_name", type text}, {"region", type text}, {"province", type text},
    {"sku", Int64.Type}, {"product", type text}, {"brand", type text},
    {"availability", Int64.Type}, {"on_shelf", Int64.Type},
    {"out_of_stock", Int64.Type}, {"not_stocked", Int64.Type},
    {"pack_price", type number}, {"unit_price", type number},
    {"store_latitude", type number}, {"store_longitude", type number},
    {"date_modified", type date}, {"survey_date", type date}, {"survey_number", Int64.Type}`,
  visibility_quality: `{"visit_nu", type text}, {"store_nu", Int64.Type}, {"sem_id", Int64.Type},
    {"store_name", type text}, {"region", type text}, {"province", type text},
    {"item", type text}, {"value", type text},
    {"survey_latitude", type number}, {"survey_longitude", type number},
    {"survey_date", type date}, {"survey_number", Int64.Type}`,
};

const FN = `(tabela as text, tipos as list) as table =>
let
    // nº de paginas da tabela (pedido publico, sem dados)
    Estado     = Json.Document(Web.Contents(ApiBase, [RelativePath = "api/estado", Timeout = #duration(0, 0, 5, 0)])),
    Info       = List.First(List.Select(Estado[tabelas], each [tabela] = tabela)),
    Verifica1  = if Info = null or not Info[carregada] then error "Tabela " & tabela & " ainda nao carregada na API" else null,
    // descarregar todas as paginas e juntar
    Paginas    = List.Numbers(1, Info[paginas]),
    Partes     = List.Transform(Paginas, (p) =>
                     Table.PromoteHeaders(
                         Csv.Document(
                             Web.Contents(ApiBase, [RelativePath = "api/dados",
                                 Query = [tabela = tabela, pagina = Text.From(p), chave = ChaveApi],
                                 Timeout = #duration(0, 0, 5, 0)]),
                             [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
                         [PromoteAllScalars = true])),
    Junta      = Table.Combine(Partes),
    Verifica2  = if Table.RowCount(Junta) <> Info[linhas] then error "Linhas incompletas em " & tabela else null,
    // tipos so nas colunas que existem; numeros e datas lidos em formato en-US (ponto decimal)
    Existentes = List.Select(tipos, each List.Contains(Table.ColumnNames(Junta), _{0})),
    Tipado     = Table.TransformColumnTypes(Junta, Existentes, "en-US")
in
    if Verifica1 = null and Verifica2 = null then Tipado else Tipado`;

function lerChave() { try { return localStorage.getItem('chave_api') || ''; } catch { return ''; } }
function gravarChave(v) { try { localStorage.setItem('chave_api', v); } catch { /* sem storage */ } }
const mStr = s => '"' + s.replace(/"/g, '""') + '"';

function blocos() {
  const chave = $('chave').value.trim() || 'COLE_AQUI_A_CHAVE';
  const lista = [
    ['ApiBase', `${mStr(BASE)} meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]`],
    ['ChaveApi', `${mStr(chave)} meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]`],
    ['fnTabela', FN],
    ...Object.entries(TIPOS).map(([t, tipos]) => [t, `fnTabela("${t}", {\n    ${tipos}\n})`]),
  ];
  $('blocos').innerHTML = '';
  lista.forEach(([nome, codigo], i) => {
    const d = document.createElement('div');
    d.className = 'bloco';
    d.innerHTML = `<div class="bloco-cab"><b>Bloco ${i + 1} — nome da consulta: <code>${nome}</code></b>
      <button class="sec copiar" type="button">Copiar</button></div><pre></pre>`;
    d.querySelector('pre').textContent = codigo;
    d.querySelector('button').onclick = e => copiar(codigo, e.target);
    $('blocos').appendChild(d);
  });
  const ex = `${BASE}/api/dados?tabela=survey_visit_db&pagina=1&chave=${encodeURIComponent(chave)}`;
  $('exemplo').textContent = ex;
}

async function copiar(texto, botao) {
  try { await navigator.clipboard.writeText(texto); botao.textContent = 'Copiado'; }
  catch { botao.textContent = 'Seleccione e copie à mão'; }
  setTimeout(() => (botao.textContent = 'Copiar'), 1800);
}

async function carregarEstado() {
  try {
    const r = await fetch('/api/estado', { cache: 'no-store' });
    const e = await r.json();
    if (!r.ok) throw new Error(e.erro || r.status);
    $('porpagina').textContent = fmt(e.por_pagina);
    const tb = $('estado').querySelector('tbody');
    tb.innerHTML = '';
    let ate = '', quando = '';
    for (const t of e.tabelas) {
      const tr = document.createElement('tr');
      const meses = t.meses ? Object.entries(t.meses).map(([m, n]) => `${m.slice(4)}/${m.slice(0, 4)}: ${fmt(n)}`).join(' · ') : '—';
      tr.innerHTML = `<td><code>${t.tabela}</code></td><td class="num">${t.carregada ? fmt(t.linhas) : '—'}</td>
        <td class="num">${t.paginas || '—'}</td><td class="meses">${meses}</td><td>${t.dados_ate || '—'}</td>
        <td>${t.carregado_em ? new Date(t.carregado_em).toLocaleString('pt-PT') : '<span class="bad">por carregar</span>'}</td>`;
      tb.appendChild(tr);
      if (t.dados_ate && t.dados_ate > ate) ate = t.dados_ate;
      if (t.carregado_em && t.carregado_em > quando) quando = t.carregado_em;
    }
    $('resumo').innerHTML = ate ? `Dados até <b>${ate}</b> · última actualização ${new Date(quando).toLocaleString('pt-PT')}` : 'Ainda sem dados carregados.';
  } catch (err) {
    $('resumo').innerHTML = `<span class="bad">Não foi possível ler o estado: ${err.message}</span>`;
  }
}

async function testar() {
  const chave = $('chave').value.trim();
  if (!chave) { $('teste').innerHTML = '<span class="bad">Cole primeiro a chave.</span>'; return; }
  $('teste').textContent = 'A testar…';
  const t0 = performance.now();
  try {
    const r = await fetch('/api/dados?tabela=survey_visit_db&pagina=1', { headers: { 'x-api-key': chave }, cache: 'no-store' });
    const txt = await r.text();
    if (!r.ok) throw new Error(JSON.parse(txt).erro || r.status);
    const n = txt.trim().split(/\r?\n/).length - 1;
    $('teste').innerHTML = `<span class="ok">Chave OK</span> — survey_visit_db, página 1: ${fmt(n)} linhas em ${Math.round(performance.now() - t0)} ms.`;
  } catch (err) {
    $('teste').innerHTML = `<span class="bad">Falhou: ${err.message}</span>`;
  }
}

document.querySelectorAll('.base').forEach(s => (s.textContent = BASE));
$('chave').value = lerChave();
$('chave').addEventListener('input', () => { gravarChave($('chave').value.trim()); blocos(); });
$('mostrar').onclick = () => {
  const p = $('chave').type === 'password';
  $('chave').type = p ? 'text' : 'password';
  $('mostrar').textContent = p ? 'Esconder' : 'Mostrar';
};
$('testar').onclick = testar;
document.querySelector('.copiar[data-alvo]').onclick = e => copiar($('exemplo').textContent, e.target);
blocos();
carregarEstado();
