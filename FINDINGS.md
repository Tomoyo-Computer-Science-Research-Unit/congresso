# FINDINGS — emendas parlamentares da bancada fluminense

Prototype data layer. Written 2026-10-13/14 after running the ETL end to end. Everything below was
observed, not assumed; numbers come from the files cached under `data/raw/` and from `data/snapshot.json`.

## 1. Sources and how they were fetched

### 1.1 Portal da Transparência — bulk download "Emendas parlamentares"

- Landing page: https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares
  (plain GET works; the page says "Última atualização: 01/10/2024" in its footer, which is the
  page template date, not the dataset date — see 1.1.3).
- Download mechanics. The page runs
  `new DownloadPlanilhas("emendas-parlamentares", [], "UNICO", "/download-de-dados/emendas-parlamentares/")`
  from `/static/js/portal/download-planilhas.js`. For "UNICO" datasets the generated link is
  `GET https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares/UNICO`, which
  answers **302** to a static S3 object behind CloudFront:
  `https://dadosabertos-download.cgu.gov.br/PortalDaTransparencia/saida/emendas-parlamentares/EmendasParlamentares.zip`.
  No POST, no session, no token. The final URL is stable and is what `app/config.py` uses
  (`PORTAL_ZIP_URL`); the `/UNICO` hop is kept in `sources[].via`.
- AWS WAF caveat: the portal sits behind AWS WAF with a JavaScript challenge/captcha. During this
  session the HTML page and the `/UNICO` redirect were never blocked, but two requests to
  `/static/js/...` and to `/pagina-interna/...` (data dictionary) were answered with the
  "Human Verification" captcha page on the first try and succeeded on a retry a few minutes later.
  The S3 zip itself (`dadosabertos-download.cgu.gov.br`) is not behind the WAF. If the redirect ever
  gets captcha-walled, fetch the S3 URL directly.
- Fetched with `httpx` streaming to `data/raw/EmendasParlamentares.zip`, sha256 sidecar written next to it.
- File: **32,490,844 bytes** zip, `Last-Modified: Sat, 10 Oct 2026 02:57:21 GMT`,
  ETag `72f9fcea51fa8749b051c122ef15f572-4`,
  sha256 `669d4524ff013489b2e432ed433348d2fe021d5d9aee041a9030e210416feb6d`.
  Members (all dated 2026-10-09 17:34):

  | member | bytes | data rows |
  |---|---:|---:|
  | `EmendasParlamentares.csv` | 47,402,115 | 94,663 |
  | `EmendasParlamentares_Convenios.csv` | 26,022,323 | 85,343 |
  | `EmendasParlamentares_PorFavorecido.csv` | 182,652,083 | 827,457 |

  Encoding latin-1 (ISO-8859-1), `;` separator, every field double-quoted, numbers `1300000,00`
  (no thousands separator in practice, but the parser also accepts `1.234.567,89`), missing values
  as `Sem informação` or `S/I`.

#### 1.1.1 Real column list — `EmendasParlamentares.csv` (28 columns)

The current layout differs from the task brief: there is a **`Código do Autor da Emenda`** column
(SIAFI author code) and IBGE codes for município/UF, which the brief did not expect.

```
Código da Emenda; Ano da Emenda; Tipo de Emenda; Código do Autor da Emenda; Nome do Autor da Emenda;
Número da emenda; Localidade de aplicação do recurso; Código Município IBGE; Município; Código UF IBGE;
UF; Região; Código Função; Nome Função; Código Subfunção; Nome Subfunção; Código Programa; Nome Programa;
Código Ação; Nome Ação; Código Plano Orçamentário; Nome Plano Orçamentário; Valor Empenhado;
Valor Liquidado; Valor Pago; Valor Restos A Pagar Inscritos; Valor Restos A Pagar Cancelados;
Valor Restos A Pagar Pagos
```

Semantics (from the Portal's data dictionary, page `pagina-interna/603482-dicionario-de-dados-emendas-parlamentares`):
`Código da Emenda` = 12 digits: 4 (year) + 4 (SIAFI author code) + 4 (author's amendment number),
e.g. `201517750015` = 2015 / 1775 (Jandira Feghali) / 0015. Author code and name are "conforme
registrado no SIAFI". `Localidade de aplicação do recurso` is the plano-de-trabalho attribute for
where the money is spent; município/UF IBGE fields are blank depending on it. Values are
empenhado/liquidado/pago and restos a pagar inscritos/cancelados/pagos **for the amendment in that
budget year's execution**, nominal reais.

Other members: `_Convenios.csv` (12 columns: Código da Emenda, função/subfunção, Localidade do
gasto, Tipo de Emenda, Data Publicação Convênio, Convenente, Objeto Convênio, Número Convênio,
Valor Convênio) and `_PorFavorecido.csv` (13 columns: Código da Emenda, Código/Nome do Autor,
Número, Tipo, Ano/Mês, Código do Favorecido, Favorecido, Natureza Jurídica, Tipo Favorecido, UF
Favorecido, Município Favorecido, Valor Recebido). Both join on `Código da Emenda`. Not loaded in
this prototype; they are the natural next step for "who actually received the money".

#### 1.1.2 Shape of the data

- Row ≠ emenda. One `Código da Emenda` can appear on several rows (different ação/localidade/PO):
  59 codes repeat (max 2 rows). Treat rows as line items; aggregate by `codigo` when counting emendas.
- Year coverage 2014–2026 (13 years). Rows per year (whole country):
  2014 11,155 · 2015 3,714 · 2016 8,051 · 2017 9,633 · 2018 7,230 · 2019 8,476 · 2020 8,621 ·
  2021 6,595 · 2022 6,108 · 2023 6,110 · 2024 6,990 · 2025 6,310 · 2026 5,670.
- **2014 has no author at all**: all 11,155 rows have `Código da Emenda = "Sem informação"`,
  author code `S/I`, number `S/I`. 2014 can only be analysed by destination, never by author.
  Author attribution therefore starts in 2015.
- Author-less rows after 2014 are almost entirely `Emenda de Relator` and `Emenda de Bancada`
  (2016: 457, 2017: 3,835, 2018: 37, 2019: 231, 2020: 241); from 2021 on every row has a code.
- `Tipo de Emenda` values: `Emenda Individual - Transferências com Finalidade Definida` (79,885),
  `Emenda Individual - Transferências Especiais` (5,108, the "Pix" amendments, RP6 since 2020),
  `Emenda de Relator` (3,892, RP9), `Emenda de Bancada` (3,588, RP7), `Emenda de Comissão` (2,190, RP8).
- Special author codes: `-99 RELATOR GERAL` (Emenda de Comissão, 1,848 rows), `8100 RELATOR GERAL`
  (Emenda de Relator, 331 rows), `7102`–`7128` = state bancadas (`7120 BANCADA DO RIO DE JANEIRO`,
  114 rows), `90xx`/`91xx`/`92xx` = individual authors registered later (senators and substitutes,
  e.g. `9219 FLAVIO BOLSONARO`). Regular individual codes are 4 digits < 7000.
- The same person can have two SIAFI codes (one per house or per mandate), e.g. `AROLDE DE OLIVEIRA`
  1308 and 4090, `FLAVIO BOLSONARO` 9219 (+ a Câmara-era code). The same code can carry two name
  spellings (`AUREO`/`AUREO RIBEIRO`, `CHICO DANGELO`/`CHICO D'ANGELO`) and, since LDO 2025 art. 78,
  the reassigned form `TIAGO DIMAS (EX-PARLAMENTAR LAZARO BOTELHO, NOS TERMOS ART. 78 LDO 2025 ...)`:
  the code's amendments were transferred to the substitute. The parser splits that into
  (current, former) and tries both.
- `Localidade de aplicação do recurso` patterns and how the parser classifies them
  (`localidade` field in the snapshot): `MUNICÍPIO - UF` with IBGE code → `municipio` (37,702 rows);
  `MÚLTIPLO` with UF but no município → `multiplo` (28,443); `ESTADO (UF)` → `uf` (22,837);
  `Nacional` → `nacional` (5,356); region names (`Sudeste`, `Norte`…) → `outro` (256); `Exterior` → `exterior` (69).
- Exactly one row has a negative value (parser keeps the sign).

#### 1.1.3 Update cadence

The S3 object is regenerated daily-to-weekly (observed `Last-Modified` 2026-10-10, CSV members
stamped 2026-10-09; the Portal states emendas data comes from SIAFI/Tesouro Gerencial with monthly
consolidation but the file carries the current year's execution up to the previous day). Treat it
as "rolling, re-download weekly"; the ETL compares sha256 and only re-parses when it changed
(`--refresh`).

### 1.2 Portal da Transparência API (reference only, not used)

- OpenAPI: https://api.portaldatransparencia.gov.br/v3/api-docs (public, no key needed to read).
- Relevant endpoints: `GET /api-de-dados/emendas` (params `codigoEmenda, numeroEmenda, nomeAutor,
  tipoEmenda, ano, codigoFuncao, codigoSubfuncao, pagina*`) returning `ConsultaEmendasDTO`
  (`codigoEmenda, ano, tipoEmenda, autor, nomeAutor, numeroEmenda, localidadeDoGasto, funcao,
  subfuncao, valorEmpenhado, valorLiquidado, valorPago, valorRestoInscrito, valorRestoCancelado,
  valorRestoPago` — all strings) and `GET /api-de-dados/emendas/documentos/{codigo}` (empenhos /
  pagamentos documents per amendment). The API returns **less** than the CSV (no município/UF
  IBGE, no programa/ação/PO), paginated 15 per page.
- Key: header `chave-api-dados`. Obtained by registering an e-mail at
  http://www.portaldatransparencia.gov.br/api-de-dados/cadastrar-email (gov.br login, key sent by
  e-mail; limits ~90 req/min 06:00–24:00, 300 req/min at night). **Not registered** in this work.
- Verdict: use the bulk zip; the API is only worth it for per-amendment document drill-downs.

### 1.3 Author roster — "bancada fluminense"

Definition used: every person who **exercised** a federal mandate for UF = RJ (deputado federal or
senador, titular or suplente em exercício) in legislaturas 54 (2011–2015), 55 (2015–2019),
56 (2019–2023), 57 (2023–2027). Legislatura 54 is needed because amendments to the 2015 budget were
filed in late 2014 by the 54th legislature; in general the authoring legislature of budget year Y
is the one in office in Y-1 (`config.legislatura_autora`: 2015→54, 2016–2019→55, 2020–2023→56,
2024–2027→57).

- Câmara: `GET https://dadosabertos.camara.leg.br/api/v2/deputados?idLegislatura=N&itens=100&pagina=P`
  (national list, 9–10 pages per legislature; items carry `id, nome, siglaPartido, siglaUf,
  idLegislatura, urlFoto`). RJ members are filtered client-side on `siglaUf == "RJ"`.
  **Blocker found**: the UF-filtered variant `?siglaUf=RJ&idLegislatura=54` returns page 1 but
  page 2 answers `504 upstream request timeout` consistently (with or without `ordenarPor`), so the
  ETL does not use it. Civil names come from `GET /deputados/{id}` (`nomeCivil`,
  `ultimoStatus.nomeEleitoral`), one cached call per RJ member. The list returns everyone who held
  the seat at any time in the legislature (titulars and substitutes who took office), which is the
  desired "exercised" semantics; mandate dates for deputies are the legislature span (per-person
  dates would need `/deputados/{id}/historico`, not fetched). `siglaPartido` is the party recorded
  for that legislature listing.
- Senado: `GET https://legis.senado.leg.br/dadosabertos/senador/lista/legislatura/N` (JSON via
  `Accept: application/json`; ~250 entries per legislature including never-sworn suplentes). A
  person is in the roster when a `Mandato` has `UfParlamentar == "RJ"`, covers legislature N, and has
  at least one `Exercicios.Exercicio` (= actually took office). Mandate dates come from the
  Exercicio dates clipped to the legislature. Party is `SiglaPartidoParlamentar` = **current**
  party only (the list endpoint has no per-legislature party; a historical party would need
  `/senador/{codigo}/filiacoes`). Photo: `UrlFotoParlamentar`.
- People who served in both houses (Arolde de Oliveira, Lindbergh Farias, Marcelo Crivella, Romário) are merged on the
  normalized civil name; the merged record keeps both ids (`ids: {camara, senado}`), `casa` = house
  of the latest mandate, `casas` = both.

### 1.4 Name matching (SIAFI name → roster person)

`app/names.normalize`: unidecode → upper → drop apostrophes/punctuation → collapse spaces.
`app/match.Matcher`, per (author name, year):

1. **strict** — normalized name equals a roster person's civil name, nome parlamentar or
   nomeEleitoral **and** that person has a mandate in the authoring legislature of the year;
2. **loose** — name equals a roster person in another legislature and the name is unique in the
   national index (all deputies of all four legislatures + all senators). Kept because the Câmara
   list occasionally lacks short-lived substitutes;
3. **collision** — the name matches an RJ person and a non-RJ person nationwide and no
   legislature-consistent RJ match exists → excluded and listed;
4. **none** — not an RJ name (the vast majority: other states).

Emendas de bancada: only SIAFI code `7120 BANCADA DO RIO DE JANEIRO` is included (`autor_id =
"bancada-rj"`). Relator (`-99`, `8100`) and other states' bancadas are excluded. Rows with no author
are excluded (counted in `stats.rows_without_author_dest_rj_by_year` when the destination is RJ).

### 1.5 Optional author-id sources (documented, not integrated)

- **SIOP (Ministério do Planejamento) dados abertos**: https://www1.siop.planejamento.gov.br/siopdoc/doku.php/acesso_publico:dados_abertos
  publishes the whole budget as RDF/SPARQL plus yearly CSVs. Emendas are the rows with
  classifier **RP = 6 (individual, since 2014), 7 (bancada, since 2017), 8 (comissão), 9 (relator)**;
  the SIOP "Painel de Emendas" exports carry *Autor* and *Cód. Autor* (the same 4-digit SIAFI/SIOP
  author code seen in the Portal CSV), but still no Câmara/Senado id. It would add the LOA-approved
  (dotação) value, which the Portal file lacks; it would not remove the name-matching step.
- **Câmara**: the `dadosabertos` v2 API has no emendas resource; `https://dadosabertos.camara.leg.br/arquivos/`
  answered 403 to a plain GET. Câmara's "Emendas Parlamentares" transparency panel
  (camara.leg.br/transparencia/emendas-parlamentares) is a Power BI embed, not an API.
- **Senado**: `legis.senado.leg.br/dadosabertos` has no `orcamento`/emendas resource (404).
- Practical alternative that *does* give stable ids: keep a hand-curated table
  `codigo_siafi → autor_id` seeded from this ETL's matches (`autores[].codigos_siafi`); it is small
  (a few hundred codes nationally, ~100 for RJ) and removes name matching entirely after the first run.

## 2. Results of the end-to-end run (2026-10-14, zip of 2026-10-10)

Run: `cd backend && .venv/bin/python -m app.etl.export_snapshot` (1.7 s with the cache warm;
first run ~10 min, dominated by ~40 Câmara list pages + 152 `/deputados/{id}` calls at a polite pace).

### 2.1 Counts

| metric | value |
|---|---:|
| rows in `EmendasParlamentares.csv` (Brazil, 2014–2026) | 94,663 |
| rows with an author code (2015–2026) | 76,022 (= strict 7,672 + loose 11 + collision 60 + none 68,279 individual/comissão candidates, plus bancada/relator codes) |
| rows kept in the snapshot (RJ authors + Bancada RJ) | **7,797** (7,783 distinct `codigo`) |
| of which Emenda Individual – Finalidade Definida / Transferências Especiais / Bancada RJ | 7,460 / 223 / 114 |
| roster size (people who exercised an RJ federal mandate, legs 54–57) | 158 (152 deputies + 10 senators − 4 people merged across houses: Arolde de Oliveira, Lindbergh Farias, Marcelo Crivella, Romário) |
| roster people with at least one matched amendment | **130 / 158** |
| snapshot `autores` | 131 (130 people + `bancada-rj`) |
| author names matched strict / loose / excluded as collision | 7,672 rows / 11 rows / 60 rows |
| unmatched RJ-looking individual authors (no roster match, ≥40 % of rows destined to RJ) | **0** |
| destination of kept rows | RJ 6,871 · no UF (nacional/exterior/múltiplo sem UF) 836 · SP 48 · DF 15 · BA 10 · others 17 |
| localidade of kept rows | municipio 3,418 · uf 2,315 · multiplo 1,271 · nacional 771 · exterior 14 · outro 8 |
| 2014 rows destined to RJ (no author, not in snapshot) | 430 (plus 6/93/8/5 author-less rows in 2016/2017/2019/2020) |

Match rate on the thing that matters: of the 158 roster people, 28 never appear as a SIAFI author.
All 28 are explainable: 22 are legislatura-54-only deputies (their only possible year is 2015, where
the Portal file is very thin — 3,714 rows nationally — and most are short-term substitutes:
Alexandre Cardoso, Alfredo Sirkis, Brizola Neto, Cristiano, Dr. Aluizio, Dr. Carlos Alberto,
Dr. Dilson Drumond, Dr. Paulo César, Dudu Luiz Eduardo, Eliane Rolim, Fernando Lopes, Manuel Rosa
Neca, Neilton Mulim, Nelson Bornier, Rodrigo Bethlem, Solange Almeida, Stepan Nercessian, Péricles
Olivier); 2 are leg-55 substitutes (Atila A. Nunes, Nelson Nahim); 2 leg-56 substitutes (Marcão
Gomes, Ricardo Pericar); 6 are leg-57 substitutes sworn in recently (Bruno Bonetti, Caio Vianna,
Heloísa Helena, Luis Carlos Gomes, Marcos Braz, Renan Ferreirinha). None of the 28 has a
same-named SIAFI author with RJ-destined spending, so these are true "no amendments executed"
cases, not matching failures.

Collisions detected by the national index (both are handled correctly):
- `BEBETO`: SIAFI code 3028 (2016–2019) is Adalberto Souza Galvão, BA, leg 55 → excluded (60 rows);
  code 4312 (2024–2026) is Carlos Roberto Rodrigues "Bebeto", RJ, leg 57 → strict.
- `DR JOAO`: RJ (João Ferreira Neto, leg 55) and BA (João Caldas, leg 56); all SIAFI rows fall in
  leg-55 years → strict to the RJ one.
- `VITOR PAULO`: 2015 strict (leg 54); 11 rows in 2019 accepted as **loose** (name unique nationwide;
  the Câmara leg-55 listing does not show his substitute period).

Multi-code authors found (same person, two SIAFI codes): Romário 2788/3799, Marcelo Crivella
2010/4416, Enfermeira Rejane 4489/4550, Arolde de Oliveira 1308/4090, Lindbergh Farias 2881/3273.

### 2.2 Value per year — RJ authors + Bancada RJ (R$ nominal, millions)

| ano | rows | empenhado | liquidado | pago | RP pagos |
|---|---:|---:|---:|---:|---:|
| 2015 | 279 | 244.1 | — | 4.4 | 184.2 |
| 2016 | 568 | 533.2 | — | 173.7 | 244.9 |
| 2017 | 578 | 682.0 | — | 295.5 | 293.1 |
| 2018 | 829 | 758.8 | — | 435.1 | 195.6 |
| 2019 | 770 | 831.0 | — | 402.3 | 331.8 |
| 2020 | 764 | 966.8 | — | 572.1 | 288.3 |
| 2021 | 701 | 1,026.2 | — | 610.8 | 302.0 |
| 2022 | 695 | 1,068.4 | — | 624.4 | 343.5 |
| 2023 | 652 | 1,873.7 | — | 1,353.5 | 397.7 |
| 2024 | 733 | 2,209.5 | — | 1,134.2 | 873.0 |
| 2025 | 627 | 2,261.4 | — | 1,471.0 | 456.4 |
| 2026 | 601 | 2,039.2 | — | 1,427.8 | 0.0 |

(`liquidado` is in the snapshot's `agregados.por_ano`; omitted here for width.) Total 2015–2026:
empenhado R$ 14.49 bi, pago R$ 8.51 bi, RP pagos R$ 3.91 bi. For scale, the whole country in
2025 is R$ 47.1 bi empenhado.

Largest authors by empenhado 2015–2026 (R$ mi): Bancada do RJ 2,381 · Romário 372 · Flávio
Bolsonaro 308 · Carlos Portinho 296 · Aureo 259 · Hugo Leal 248 · Soraya Santos 248 · Altineu
Côrtes 247 · Sóstenes Cavalcante 243 · Benedita da Silva 241. Largest destination municipalities
by pago: Rio de Janeiro 237 · São João de Meriti 202 · Duque de Caxias 201 · Campos dos
Goytacazes 108 · Mesquita 73 · São Gonçalo 66 · Belford Roxo 62 · Nova Iguaçu 58.

### 2.3 Snapshot

`data/snapshot.json`, 7.4 MB, minified. Keys: `generated_at, years, autores, roster, emendas,
agregados{por_ano, por_autor_ano, por_municipio_destino_ano, por_funcao_ano, por_tipo_ano},
sources, stats`. `emendas[]` keeps every kept row with `codigo, ano, tipo, numero, autor_id,
autor_codigo_siafi, autor_nome, match (strict|loose|bancada), localidade, localidade_raw,
uf_destino(+ibge), municipio_destino(+ibge), funcao/subfuncao/programa/acao (name + code),
plano_orcamentario, valor_empenhado, valor_liquidado, valor_pago, rp_inscrito, rp_cancelado,
rp_pago`. `autores[]` = roster people that matched + `bancada-rj`, with `codigos_siafi`; `roster[]`
= the full 158-person bancada (useful to show "no amendments" people). `stats` carries the match
audit (collisions, never-matched, author-less rows).

## 3. Caveats (ranked)

1. **Author identity is a name, matched to a roster.** SIAFI gives a 4-digit author code and a
   free-text name; neither is a Câmara/Senado id. Matching is exact on normalized names with a
   legislature check and a national homonym index, which caught the only two homonyms (Bebeto, Dr.
   João). It will break silently if SIAFI renames a code holder (art. 78 LDO 2025 cases are handled
   when the suffix is present) or if two RJ people share a nome parlamentar. Mitigation: freeze
   `codigo_siafi → autor_id` into a curated table after this run.
2. **"Bancada do Rio de Janeiro" is a collective author.** Its 114 rows / R$ 2.38 bi (the single
   largest "author") are decided by the whole delegation; they are included with `autor_id =
   "bancada-rj"` and must not be attributed to individuals. Relator (RP9, 2020–2022 "orçamento
   secreto") and comissão amendments have no individual author and are excluded; a share of them
   was spent in RJ and is invisible here. 2014 has no authors at all and is excluded.
3. **Values are execution in nominal reais, by budget year of the amendment.** `empenhado` ≠
   money delivered: `pago` is cash paid in that year, `rp_pago` is paid in later years out of
   restos a pagar (so a 2019 amendment's money often shows up as `rp_pago`, and 2026 has `rp_pago
   = 0` by construction). Sum `pago + rp_pago` for "money that reached the destination so far"; use
   `empenhado` for "money committed". No deflation is applied (an IPCA series would be needed for
   constant reais); 2015–2017 are also under-reported (2015 nationally only 3,714 rows).
4. Destination granularity: 44 % of kept rows have a município; the rest is "UF", "múltiplo" or
   "nacional" (e.g. transfers to state funds, SUS ceilings), so municipal rankings undercount.
5. Rows are line items (ação × localidade × PO), not amendments: count `codigo` distinct for
   "number of amendments" (7,783 vs 7,797 rows).
6. Roster: deputies' mandate dates are legislature spans, not individual terms; senators' party
   is the current one for all legislatures; the Câmara list omits a few short substitute periods
   (why the "loose" rule exists).
7. The Portal download page sits behind AWS WAF; the S3 object does not. Keep the direct S3 URL as
   the primary and the `/UNICO` redirect as discovery.

## 4. Layout

```
emendas-rj/
  FINDINGS.md
  data/raw/           EmendasParlamentares.zip (+.sha256), senado_legislatura_5x.json, camara/*.json
  data/snapshot.json
  backend/
    pyproject.toml    (.venv = uv venv --python 3.12; httpx, unidecode, pytest)
    app/config.py     URLs, legislature table, legislatura_autora()
    app/http.py       cached streaming fetch + sha256 sidecars + retries
    app/names.py      normalize(), split_siafi_author()
    app/parsers/emendas.py  CSV parser (latin-1, BR numbers, localidade classifier)
    app/roster.py     Câmara + Senado roster, national name index, cross-house merge
    app/match.py      strict / loose / collision matcher
    app/etl/export_snapshot.py  orchestration, aggregates, snapshot writer
    tests/            12 pytest tests on fixtures (mini latin-1 CSV, mini roster)
```
