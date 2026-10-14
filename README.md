# Emendas

Emendas parlamentares da bancada federal, da Tomoyo, dentro do g0v.tomoyo.systems. Por enquanto só
o Rio de Janeiro; o desenho é nacional.

O ETL baixa o arquivo "Emendas parlamentares" do Portal da Transparência (emendas e favorecidos),
define a bancada pelas APIs da Câmara e do Senado, casa os autores do SIAFI com essa lista e publica
um site estático: por ano, por autor, por município de destino (com mapa e valor por habitante), por
função orçamentária e por favorecido. "Pago" soma o pago no ano com restos a pagar pagos depois.
Valores aparecem corrigidos pelo IPCA (média anual para o mês-base, série SIDRA 1737) no modelo do
gwern.net: o corrigido em primeiro plano, o nominal e o ano em subscrito; a tecla N mostra nominal.

Site: https://g0v.tomoyo.systems/emendas/

## Dados

| Fonte | Uso |
| --- | --- |
| [Portal da Transparência, emendas parlamentares](https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares) | zip único: `EmendasParlamentares.csv` (~95 mil linhas, 2014–2026) e `_PorFavorecido.csv` (827 mil linhas, filtradas para a bancada), lidos por `backend/app/parsers/` |
| [Câmara dos Deputados, dados abertos](https://dadosabertos.camara.leg.br/) | deputados por legislatura (54–57), filtrados por UF = RJ, mais o nome civil de cada um |
| [Senado Federal, dados abertos](https://legis.senado.leg.br/dadosabertos/) | senadores por legislatura com mandato pelo RJ e exercício efetivo |
| IBGE | malha municipal do RJ (API de malhas v3), população do Censo 2022 (SIDRA 4714) e IPCA mensal (SIDRA 1737) |

Ficam de fora: 2014 (sem autor no arquivo), emendas de relator (RP 9) e de comissão (RP 8),
bancadas de outros estados. Detalhes, contagens reais e ressalvas em `FINDINGS.md`.

## Layout

```text
backend/app/
  parsers/emendas.py          leitura do CSV (latin-1, números brasileiros, classificação da localidade)
  roster.py                   bancada fluminense a partir da Câmara e do Senado
  match.py                    autor do SIAFI -> pessoa da bancada (nome normalizado + legislatura + homônimos)
  etl/export_snapshot.py      data/snapshot.json (todas as linhas do RJ, agregados, auditoria)
  etl/export_static_frontend.py  frontend/lib: núcleo, um arquivo por autor, um por município, geometrias
frontend/
  lib/static-data.generated.json   ~560 KB: autores, destinos, funções, agregados, fontes
  lib/static-autores/<id>, lib/static-destinos/<ibge>, lib/static-favorecidos/<slug>  sob demanda
  lib/money.tsx               IPCA, modo real/nominal e o componente Money (padrão gwern)
  app/status                  última rodada, último build, arquivo do Portal; lê status.json do servidor
  app/, components/           Next.js App Router, Tailwind com tokens da tomoyo.systems, Recharts
deploy/build-site.sh          roda no servidor, por cron, uma vez por dia
```

## Setup

```bash
cd backend && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e ".[dev]"
.venv/bin/python -m app.etl.export_snapshot            # ~10 min na primeira vez (APIs da Câmara)
.venv/bin/python -m app.etl.export_static_frontend
cd ../frontend && npm ci && npm run dev
```

Gates: `cd backend && .venv/bin/python -m pytest -q`; `cd frontend && npx tsc --noEmit && npm run build && npm run test:visual`.

## Deploy

O site vive em `g0v.tomoyo.systems/emendas`, no mesmo nginx estático do Perdeu, Playboy (droplet
`mail.tomoyo.systems`, `/root/g0v/site/emendas`). O cron roda `/root/g0v/build-emendas.sh` (cópia de
`deploy/build-site.sh`, que se atualiza sozinha a partir de `main`) todo dia às 06:53 de Brasília:
puxa `main`, baixa o zip de novo, regenera os dados e, se algo mudou, constrói e publica. Cada
rodada entra em `/root/g0v/runs-emendas.jsonl` e no `status.json` da página `/status`; falhas avisam
por e-mail. Para publicar na hora, depois de um push:

```bash
ssh root@mail.tomoyo.systems 'FORCE=1 SKIP_DATA=1 /root/g0v/build-emendas.sh'
```
