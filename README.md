*This project has been created as part of the 42 curriculum by c3c4d4.*

# Congresso

## Description

A bancada federal de cada UF, da Tomoyo, dentro do g0v.tomoyo.systems: emendas parlamentares,
votações nominais e faltas em plenário dos deputados federais e senadores, as 27 UFs num site só.
O RJ fica na raiz, as demais em /congresso/<uf>/; o seletor de UF do cabeçalho troca de UF na mesma
tela. O repositório se chamava `emendas-rj` até outubro de 2026.

O ETL baixa o arquivo "Emendas parlamentares" do Portal da Transparência (emendas e favorecidos),
define a bancada pelas APIs da Câmara e do Senado, casa os autores do SIAFI com essa lista e publica
um site estático: por ano, por autor, por município de destino (com mapa e valor por habitante), por
função orçamentária e por favorecido. "Pago" soma o pago no ano com restos a pagar pagos depois.
Valores aparecem corrigidos pelo IPCA (média anual para o mês-base, série SIDRA 1737) no modelo do
gwern.net: o corrigido em primeiro plano, o nominal e o ano em subscrito; a tecla N mostra nominal.

Votações: as votações nominais de plenário da Câmara e do Senado desde 2015-02-01 (legislaturas 55
a 57), com o voto da bancada da UF, o placar por partido e a orientação do governo. Presença:
faltas em sessões deliberativas da Câmara e em sessões com votação nominal do Senado, por mês. No
painel de cada autor: participação, votos com a maioria, contra o partido e contra o governo, a
lista de votos e as faltas.

Site: https://g0v.tomoyo.systems/congresso/ (RJ), https://g0v.tomoyo.systems/congresso/sp/, …/mg/, …/df/ etc.

### Layout

```text
backend/app/
  parsers/emendas.py          leitura do CSV (latin-1, números brasileiros, classificação da localidade)
  config.py                   as 27 UFs (UFS: código IBGE, bancada SIAFI 7102–7128, aliases de município), UF_ORDER
  roster.py                   bancada da UF a partir da Câmara e do Senado
  match.py                    autor do SIAFI -> pessoa da bancada (nome normalizado + legislatura + homônimos)
  etl/export_snapshot.py      --uf all: lê o zip uma vez e escreve data/snapshot.json (RJ) e data/snapshot-<uf>.json;
                              resolve linhas que duas UFs reclamam e casa pelo código SIAFI o que o nome não casou
  etl/export_static_frontend.py  frontend/data/<uf>: núcleo, um arquivo por autor, um por município, geometrias
  votos/fetch.py              downloads com retomada (o servidor da Câmara corta cada resposta em ~17 s)
  votos/camara.py, senado.py  parsers das votações, sessões e presença; exercício pelo histórico do deputado
  etl/export_votos.py         frontend/data/votacoes (comum às UFs) e, por UF, static-bancada,
                              static-votos/<ano>, static-parlamentares/<id>
frontend/
  data/ufs.json               lista de UFs para o site (gerada do config.py)
  data/<uf>/static-data.generated.json   núcleo, 0,35–1,8 MB: autores, destinos, funções, agregados, fontes
  data/<uf>/static-autores/<id>, static-destinos/<ibge>, static-favorecidos/<slug>,
    static-favorecidos-extra   sob demanda
  data/votacoes/              índice das votações, detalhe por ano, ementas, meta (comuns às 27 UFs)
  data/<uf>/static-bancada.generated.json   parlamentares da UF e faltas por mês
  data/<uf>/static-votos/<ano>, static-parlamentares/<id>   votos da bancada, sob demanda
  scripts/stage-data.mjs      copia data/<uf> para public/data/<uf> antes de dev/build; o site busca com fetch
  app/[uf]/                   as mesmas telas para as 26 UFs fora do RJ (generateStaticParams)
  lib/uf.ts, components/DataGate.tsx   UF do caminho; carrega o núcleo da UF antes da tela
  lib/money.tsx               IPCA, modo real/nominal e o componente Money (padrão gwern)
  app/status                  última rodada, último build, arquivo do Portal; lê status.json do servidor
  app/, components/           Next.js App Router, Tailwind com tokens da tomoyo.systems, Recharts
deploy/build-site.sh          roda no servidor, por cron, uma vez por dia
```

## Instructions

### Setup

```bash
cd backend && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e ".[dev]"
.venv/bin/python -m app.etl.export_snapshot --uf all --refresh  # ~20 s com cache; ~25 min na primeira vez (Câmara)
.venv/bin/python -m app.etl.export_static_frontend --uf all       # ~15 s com o IBGE em cache
.venv/bin/python -m app.etl.export_votos --uf all                 # ano corrente de novo; ~1 GB e ~2.100 históricos na primeira vez
cd ../frontend && npm ci && npm run dev
```

Gates: `cd backend && .venv/bin/python -m pytest -q`; `cd frontend && npx tsc --noEmit && npm run build && npm run test:visual`.

### Deploy

O site vive em `g0v.tomoyo.systems/congresso` (RJ na raiz, demais UFs em `/congresso/<uf>/`, dados em
`/congresso/data/<uf>/` e `/congresso/data/votacoes/`), no mesmo nginx estático do Perdeu, Playboy
(droplet `mail.tomoyo.systems`, `/root/g0v/site/congresso`). Um build Next só gera as 27 UFs; o rsync protege os `status.json` por UF. O cron roda `/root/g0v/build-emendas.sh` (cópia de
`deploy/build-site.sh`, que se atualiza sozinha a partir de `main`) todo dia às 06:53 de Brasília:
puxa `main`, baixa o zip de novo, regenera os dados das 27 UFs (uma UF que falha fica com os dados
de main; as outras seguem), baixa de novo os arquivos de votações do ano corrente da Câmara e do
Senado (anos passados ficam em cache; votos que falham ficam com os arquivos de main) e, se algo mudou, constrói e publica. Tempo de ETL e de build vai no
registro da rodada. Cada
rodada entra em `/root/g0v/runs-emendas.jsonl` e no `status.json` da página `/status`; falhas avisam
por e-mail. Para publicar na hora, depois de um push:

```bash
ssh root@mail.tomoyo.systems 'FORCE=1 SKIP_DATA=1 /root/g0v/build-emendas.sh'
```

## Resources

| Fonte | Uso |
| --- | --- |
| [Portal da Transparência, emendas parlamentares](https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares) | zip único: `EmendasParlamentares.csv` (~95 mil linhas, 2014–2026) e `_PorFavorecido.csv` (827 mil linhas, filtradas para a bancada), lidos por `backend/app/parsers/` |
| [Câmara dos Deputados, dados abertos](https://dadosabertos.camara.leg.br/) | deputados por legislatura (54–57), filtrados pela UF, mais o nome civil de cada um |
| [Senado Federal, dados abertos](https://legis.senado.leg.br/dadosabertos/) | senadores por legislatura com mandato pela UF e exercício efetivo |
| [Câmara, arquivos anuais](https://dadosabertos.camara.leg.br/arquivos/) | votacoes, votacoesVotos, votacoesOrientacoes, votacoesProposicoes, eventos, eventosOrgaos, eventosPresencaDeputados, 2015 em diante |
| [Câmara, API v2](https://dadosabertos.camara.leg.br/api/v2/) | histórico de exercício de cada deputado (`/deputados/{id}/historico`) e lacunas dos arquivos |
| [Senado, /votacao](https://legis.senado.leg.br/dadosabertos/votacao) | votações nominais com voto por senador, um ano por pedido; orientação de bancada do painel (`/plenario/votacao/orientacaoBancada`) |
| IBGE | malha municipal da UF (API de malhas v3, estados/33 e estados/35), população do Censo 2022 (SIDRA 4714) e IPCA mensal (SIDRA 1737) |

Detalhes, contagens reais e ressalvas em `FINDINGS.md`.

AI was used to scaffold the ETL (downloads with cache, snapshot and export scripts), to write the parsers of the Portal da Transparência, Câmara and Senado files and the frontend shell; the result was reviewed against the sources listed above and tested with the fixtures in `backend/tests/fixtures` and the Playwright tests in `frontend/tests`.

## Limitations

Ficam de fora: 2014 (sem autor no arquivo), emendas de relator (RP 9) e de comissão (RP 8).
As votações nominais e a presença cobrem a Câmara e o Senado desde 2015-02-01 (legislaturas 55
a 57). Detalhes, contagens reais e ressalvas em `FINDINGS.md`.
