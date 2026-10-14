# Emendas RJ

Emendas parlamentares da bancada federal do Rio de Janeiro, da Tomoyo, dentro do g0v.tomoyo.systems.

O ETL baixa o arquivo "Emendas parlamentares" do Portal da Transparência, define a bancada pelas
APIs da Câmara e do Senado, casa os autores do SIAFI com essa lista e publica um site estático:
por ano, por autor, por município de destino (com mapa e valor por habitante) e por função
orçamentária. Valores em reais nominais; "pago" soma o pago no ano com restos a pagar pagos depois.

Site: https://g0v.tomoyo.systems/emendas/

## Dados

| Fonte | Uso |
| --- | --- |
| [Portal da Transparência, emendas parlamentares](https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares) | zip único (`EmendasParlamentares.csv`, ~95 mil linhas, 2014–2026), lido por `backend/app/parsers/emendas.py` |
| [Câmara dos Deputados, dados abertos](https://dadosabertos.camara.leg.br/) | deputados por legislatura (54–57), filtrados por UF = RJ, mais o nome civil de cada um |
| [Senado Federal, dados abertos](https://legis.senado.leg.br/dadosabertos/) | senadores por legislatura com mandato pelo RJ e exercício efetivo |
| IBGE | malha municipal do RJ (API de malhas v3) e população do Censo 2022 (SIDRA 4714) |

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
  lib/static-autores/<id>.generated.json, lib/static-destinos/<ibge>.generated.json  sob demanda
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
puxa `main`, baixa o zip de novo, regenera os dados e, se algo mudou, constrói e publica. Falhas
avisam por e-mail. Para publicar na hora, depois de um push:

```bash
ssh root@mail.tomoyo.systems 'FORCE=1 SKIP_DATA=1 /root/g0v/build-emendas.sh'
```
