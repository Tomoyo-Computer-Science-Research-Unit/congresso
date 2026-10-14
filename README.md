# Emendas

Emendas parlamentares da bancada federal, da Tomoyo, dentro do g0v.tomoyo.systems: Rio de Janeiro e
São Paulo, um build do mesmo site por UF.

O ETL baixa o arquivo "Emendas parlamentares" do Portal da Transparência (emendas e favorecidos),
define a bancada pelas APIs da Câmara e do Senado, casa os autores do SIAFI com essa lista e publica
um site estático: por ano, por autor, por município de destino (com mapa e valor por habitante), por
função orçamentária e por favorecido. "Pago" soma o pago no ano com restos a pagar pagos depois.
Valores aparecem corrigidos pelo IPCA (média anual para o mês-base, série SIDRA 1737) no modelo do
gwern.net: o corrigido em primeiro plano, o nominal e o ano em subscrito; a tecla N mostra nominal.

Sites: https://g0v.tomoyo.systems/emendas/ (RJ) e https://g0v.tomoyo.systems/emendas/sp/ (SP).

## Dados

| Fonte | Uso |
| --- | --- |
| [Portal da Transparência, emendas parlamentares](https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares) | zip único: `EmendasParlamentares.csv` (~95 mil linhas, 2014–2026) e `_PorFavorecido.csv` (827 mil linhas, filtradas para a bancada), lidos por `backend/app/parsers/` |
| [Câmara dos Deputados, dados abertos](https://dadosabertos.camara.leg.br/) | deputados por legislatura (54–57), filtrados pela UF, mais o nome civil de cada um |
| [Senado Federal, dados abertos](https://legis.senado.leg.br/dadosabertos/) | senadores por legislatura com mandato pela UF e exercício efetivo |
| IBGE | malha municipal da UF (API de malhas v3, estados/33 e estados/35), população do Censo 2022 (SIDRA 4714) e IPCA mensal (SIDRA 1737) |

Ficam de fora: 2014 (sem autor no arquivo), emendas de relator (RP 9) e de comissão (RP 8),
bancadas de outros estados. Detalhes, contagens reais e ressalvas em `FINDINGS.md`.

## Layout

```text
backend/app/
  parsers/emendas.py          leitura do CSV (latin-1, números brasileiros, classificação da localidade)
  config.py                   constantes por UF (UFS: código IBGE, bancada SIAFI 7120/7125, aliases de município)
  roster.py                   bancada da UF a partir da Câmara e do Senado
  match.py                    autor do SIAFI -> pessoa da bancada (nome normalizado + legislatura + homônimos)
  etl/export_snapshot.py      data/snapshot.json (RJ) ou data/snapshot-sp.json: linhas da UF, agregados, auditoria
  etl/export_static_frontend.py  frontend/data/<uf>: núcleo, um arquivo por autor, um por município, geometrias
frontend/
  data/<uf>/static-data.generated.json   ~1,7 MB: autores, destinos, funções, agregados, fontes
  data/<uf>/static-autores/<id>, static-destinos/<ibge>, static-favorecidos/<slug>,
    static-favorecidos-extra   sob demanda; o build lê a pasta da UF pelo alias "@uf-data"
  lib/uf.ts                   textos por UF (nome, preposição, bancada, exemplo de homônimo)
  lib/money.tsx               IPCA, modo real/nominal e o componente Money (padrão gwern)
  app/status                  última rodada, último build, arquivo do Portal; lê status.json do servidor
  app/, components/           Next.js App Router, Tailwind com tokens da tomoyo.systems, Recharts
deploy/build-site.sh          roda no servidor, por cron, uma vez por dia
```

## Setup

```bash
cd backend && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e ".[dev]"
.venv/bin/python -m app.etl.export_snapshot --refresh  # RJ; ~10 min na primeira vez (APIs da Câmara)
.venv/bin/python -m app.etl.export_static_frontend
.venv/bin/python -m app.etl.export_snapshot --uf SP     # mesmo zip, sem baixar de novo
.venv/bin/python -m app.etl.export_static_frontend --uf SP
cd ../frontend && npm ci && npm run dev                 # RJ; NEXT_PUBLIC_UF=SP npm run dev para SP
```

Gates: `cd backend && .venv/bin/python -m pytest -q`; `cd frontend && npx tsc --noEmit && npm run build && npm run build:sp && npm run test:visual`
(`test:visual` roda o Playwright do RJ e depois o de SP, `PW_UF=SP`).

## Deploy

O RJ vive em `g0v.tomoyo.systems/emendas` e SP em `g0v.tomoyo.systems/emendas/sp`, no mesmo nginx
estático do Perdeu, Playboy (droplet `mail.tomoyo.systems`, `/root/g0v/site/emendas` e
`/root/g0v/site/emendas/sp`; o rsync do RJ exclui `/sp/`). O cron roda `/root/g0v/build-emendas.sh` (cópia de
`deploy/build-site.sh`, que se atualiza sozinha a partir de `main`) todo dia às 06:53 de Brasília:
puxa `main`, baixa o zip de novo, regenera os dados das duas UFs (a falha de uma não derruba a
outra) e, se algo mudou, constrói e publica as duas. Cada
rodada entra em `/root/g0v/runs-emendas.jsonl` e no `status.json` da página `/status`; falhas avisam
por e-mail. Para publicar na hora, depois de um push:

```bash
ssh root@mail.tomoyo.systems 'FORCE=1 SKIP_DATA=1 /root/g0v/build-emendas.sh'
```
