# Backoffice API – Power BI

API simples (Python, Vercel) + página de ajuda (HTML/CSS/JS) que entrega as tabelas dos relatórios ao Power BI
com credencial **Anónimo** (sem login Microsoft, sem gateway). Os dados estão numa base PostgreSQL (Neon),
esquema `powerbi`, carregada por um processo externo.

## Endpoints
| Pedido | Devolve |
|---|---|
| `GET /api/estado` | JSON público: tabelas, linhas, páginas, colunas, linhas por mês, data dos dados |
| `GET /api/dados?tabela=<t>&pagina=<n>&chave=<k>` | CSV UTF-8 com cabeçalho e até 10 000 linhas (a chave também pode ir no cabeçalho `x-api-key`) |

A página inicial (`/`) mostra o estado dos dados, testa a chave e gera o código Power Query pronto a colar.

## Publicar no Vercel
1. Importar este repositório no Vercel (Framework: **Other**).
2. **Settings → Environment Variables**:
   - `NEON_POWERBI_URL` – ligação PostgreSQL (`postgresql://…?sslmode=require`)
   - `POWERBI_API_KEY` – chave de leitura (longa e aleatória)
3. **Redeploy**.

## Teste local
```
pip install -r requirements.txt
copy .env.example .env   (e preencher)
python servidor_local.py   ->  http://localhost:8000
```

Nunca enviar `.env` para o repositório.
