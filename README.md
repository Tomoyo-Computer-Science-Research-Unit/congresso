# Emendas

Emendas parlamentares da bancada federal, da Tomoyo, dentro do g0v.tomoyo.systems: as 27 UFs num
site só. O RJ fica na raiz, as demais em /emendas/<uf>/; o seletor de UF do cabeçalho troca de UF
na mesma tela.

O ETL baixa o arquivo "Emendas parlamentares" do Portal da Transparência (emendas e favorecidos),
define a bancada pelas APIs da Câmara e do Senado, casa os autores do SIAFI com essa lista e publica
um site estático: por ano, por autor, por município de destino (com mapa e valor por habitante), por
função orçamentária e por favorecido. "Pago" soma o pago no ano com restos a pagar pagos depois.
Valores aparecem corrigidos pelo IPCA (média anual para o mês-base, série SIDRA 1737) no modelo do
gwern.net: o corrigido em primeiro plano, o nominal e o ano em subscrito; a tecla N mostra nominal.

Site: https://g0v.tomoyo.systems/emendas/ (RJ), https://g0v.tomoyo.systems/emendas/sp/, …/mg/, …/df/ etc.

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
  config.py                   as 27 UFs (UFS: código IBGE, bancada SIAFI 7102–7128, aliases de município), UF_ORDER
  roster.py                   bancada da UF a partir da Câmara e do Senado
  match.py                    autor do SIAFI -> pessoa da bancada (nome normalizado + legislatura + homônimos)
  etl/export_snapshot.py      --uf all: lê o zip uma vez e escreve data/snapshot.json (RJ) e data/snapshot-<uf>.json;
                              resolve linhas que duas UFs reclamam e casa pelo código SIAFI o que o nome não casou
  etl/export_static_frontend.py  frontend/data/<uf>: núcleo, um arquivo por autor, um por município, geometrias
frontend/
  data/ufs.json               lista de UFs para o site (gerada do config.py)
  data/<uf>/static-data.generated.json   núcleo, 0,35–1,8 MB: autores, destinos, funções, agregados, fontes
  data/<uf>/static-autores/<id>, static-destinos/<ibge>, static-favorecidos/<slug>,
    static-favorecidos-extra   sob demanda
  scripts/stage-data.mjs      copia data/<uf> para public/data/<uf> antes de dev/build; o site busca com fetch
  app/[uf]/                   as mesmas telas para as 26 UFs fora do RJ (generateStaticParams)
  lib/uf.ts, components/DataGate.tsx   UF do caminho; carrega o núcleo da UF antes da tela
  lib/money.tsx               IPCA, modo real/nominal e o componente Money (padrão gwern)
  app/status                  última rodada, último build, arquivo do Portal; lê status.json do servidor
  app/, components/           Next.js App Router, Tailwind com tokens da tomoyo.systems, Recharts
deploy/build-site.sh          roda no servidor, por cron, uma vez por dia
```

## Setup

```bash
cd backend && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e ".[dev]"
.venv/bin/python -m app.etl.export_snapshot --uf all --refresh  # ~20 s com cache; ~25 min na primeira vez (Câmara)
.venv/bin/python -m app.etl.export_static_frontend --uf all       # ~15 s com o IBGE em cache
cd ../frontend && npm ci && npm run dev
```

Gates: `cd backend && .venv/bin/python -m pytest -q`; `cd frontend && npx tsc --noEmit && npm run build && npm run test:visual`.

## Deploy

O site vive em `g0v.tomoyo.systems/emendas` (RJ na raiz, demais UFs em `/emendas/<uf>/`, dados em
`/emendas/data/<uf>/`), no mesmo nginx estático do Perdeu, Playboy (droplet `mail.tomoyo.systems`,
`/root/g0v/site/emendas`). Um build Next só gera as 27 UFs; o rsync protege os `status.json` por UF. O cron roda `/root/g0v/build-emendas.sh` (cópia de
`deploy/build-site.sh`, que se atualiza sozinha a partir de `main`) todo dia às 06:53 de Brasília:
puxa `main`, baixa o zip de novo, regenera os dados das 27 UFs (uma UF que falha fica com os dados
de main; as outras seguem) e, se algo mudou, constrói e publica. Tempo de ETL e de build vai no
registro da rodada. Cada
rodada entra em `/root/g0v/runs-emendas.jsonl` e no `status.json` da página `/status`; falhas avisam
por e-mail. Para publicar na hora, depois de um push:

```bash
ssh root@mail.tomoyo.systems 'FORCE=1 SKIP_DATA=1 /root/g0v/build-emendas.sh'
```
