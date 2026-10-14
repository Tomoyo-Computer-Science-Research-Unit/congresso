# FINDINGS — emendas parlamentares das bancadas federais (RJ primeiro; SP na seção 8; as 27 UFs na seção 9)

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
   `empenhado` for "money committed". The data stays nominal; section 6 gives IPCA factors the
   frontend can apply; 2015–2017 are also under-reported (2015 nationally only 3,714 rows).
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
    app/parsers/favorecidos.py  parser for _PorFavorecido.csv (streams, filters by amendment code; slug())
    app/favorecidos.py  aggregation of recebimentos per favorecido (section 5)
    app/ipca.py       IPCA series from SIDRA + deflator factors (section 6)
    app/roster.py     Câmara + Senado roster, national name index, cross-house merge
    app/match.py      strict / loose / collision matcher
    app/etl/export_snapshot.py  orchestration, aggregates, snapshot writer
    app/etl/export_static_frontend.py  frontend/lib/static-*.generated.json (core, autores, destinos, favorecidos, geo)
    tests/            20 pytest tests on fixtures (mini latin-1 CSVs, mini roster, IPCA toy series)
```

## 5. Favorecidos — pra quem foi o dinheiro (added 2026-10-14)

Source: the third member of the same zip, `EmendasParlamentares_PorFavorecido.csv` (182,652,083
bytes, 827,457 rows, 13 columns: Código da Emenda; Código/Nome do Autor; Número; Tipo de Emenda;
Ano/Mês `YYYYMM`; Código do Favorecido; Favorecido; Natureza Jurídica; Tipo Favorecido; UF
Favorecido; Município Favorecido; Valor Recebido). One row = (amendment, favorecido, month) payment
total. It is streamed (`app/parsers/favorecidos.py`) and only rows whose `Código da Emenda` is in
the snapshot (7,783 RJ codes incl. Bancada RJ) are parsed; the file is ordered by favorecido name,
not by code, so the whole file is read every run (≈3 s). The author id attached to each row is the
snapshot's (`autor_id` of the amendment code), never re-matched from this file's name column;
0 rows disagreed on the SIAFI author code.

Quirks: `Tipo Favorecido` has a truncated variant `Inscrição Genéric` (normalised) and the values
`Pessoa Jurídica | Pessoa Fisica | Unidade Gestora | Inscrição Genérica | Sem informação | Inválido`;
`UF Favorecido` uses `-1` and blank for unknown; code `-8` / `SEM INFORMACAO` is the unknown
favorecido. CPFs of pessoas físicas come masked by the Portal (`***.638.223-**`); they are kept
exactly as given, used only as grouping keys, and never reconstructed. For file names the code is
slugged (`***.638.223-**` → `xxx638223xx`, `-8` → `m8`; CNPJs unchanged).

### 5.1 Numbers (zip of 2026-10-10)

| metric | value |
|---|---:|
| rows matched to RJ amendments | **40,679** (of 827,457) |
| distinct favorecidos (Código do Favorecido) | **9,800** |
| amendments with ≥1 payment row | 6,958 of 7,783 (825 without: 733 of them have `pago + rp_pago = 0`, mostly 2026 empenhos not yet paid) |
| payment months covered | 2015-10 … 2026-10 |
| total `Valor Recebido` | **R$ 12,278.8 mi** |
| `pago + rp_pago` of the same amendments in the main file | R$ 12,415.3 mi (gap R$ 136.5 mi = 1.1 %) |

By `Tipo Favorecido` (rows / R$ mi): Pessoa Jurídica 36,310 / 12,235.4 · Inscrição Genérica
241 / 30.1 · Pessoa Física 3,757 / 5.8 (2,234 masked CPFs: diárias, bolsas, pequenos pagamentos) ·
Unidade Gestora 93 / 4.0 · Sem informação 224 / 3.3 · Inválido 54 / 0.2.

By `Natureza Jurídica` (R$ mi): Sociedade de Economia Mista 4,397.0 (2 favorecidos — see the
Banco do Brasil caveat below) · Fundo Público da Adm. Direta Municipal 2,917.0 (169 fundos) ·
Associação Privada 1,824.4 (612) · Município 1,058.5 (118) · Sociedade Empresária Limitada 966.5
(5,431) · Fundação Privada 686.8 · Órgão Público do Executivo Estadual 130.2 · Fundo Público
Estadual 73.3 · S.A. Fechada 51.7 · Sem informação 43.3 · S.A. Aberta 21.6 · Estado 20.9 ·
Empresa Pública 15.8 · Sociedade Simples Ltda 14.5 · Empresário Individual 10.4.

Payments by calendar year of payment (R$ mi): 2015 4.4 · 2016 295.8 · 2017 446.8 · 2018 682.2 ·
2019 570.7 · 2020 887.3 · 2021 897.8 · 2022 941.0 · 2023 1,708.1 · 2024 1,534.0 · 2025 2,291.2 ·
2026 2,019.5 (to October).

Top 15 favorecidos (R$ mi; n_em = distinct amendments, n_au = distinct authors):

| # | código | favorecido | natureza | UF/município | total | n_em | n_au |
|---|---|---|---|---|---:|---:|---:|
| 1 | 00000000000191 | BANCO DO BRASIL SA | Soc. Economia Mista | DF Brasília | 4,397.0 | 2,476 | 124 |
| 2 | 11128809000110 | FUNDO MUNICIPAL DE SAUDE DE DUQUE DE CAXIAS | Fundo Público Municipal | RJ Duque de Caxias | 259.2 | 57 | 31 |
| 3 | 02385669000174 | FIOTEC – Fund. p/ Desenv. Científico e Tecnológico em Saúde | Fundação Privada | RJ Rio de Janeiro | 250.1 | 165 | 28 |
| 4 | 01953247000195 | INSTITUTO CARIOCA DE ATIVIDADES – ICA | Associação Privada | RJ Rio de Janeiro | 154.6 | 33 | 17 |
| 5 | 03686998000118 | CENTRO DE PESQUISAS E DE AÇÕES SOCIAIS E CULTURAIS – CPASC | Associação Privada | RJ Rio de Janeiro | 134.0 | 32 | 15 |
| 6 | 29138336000105 | MUNICIPIO DE SAO JOAO DE MERITI | Município | RJ São João de Meriti | 124.2 | 41 | 27 |
| 7 | 10435993000188 | FUNDO MUNICIPAL DE SAUDE DE SAO JOAO DE MERITI | Fundo Público Municipal | RJ São João de Meriti | 119.5 | 41 | 23 |
| 8 | 12292556000188 | FUNDO MUNICIPAL DE SAUDE DE CABO FRIO | Fundo Público Municipal | RJ Cabo Frio | 115.5 | 31 | 16 |
| 9 | 72060999000175 | FUNDAÇÃO COPPETEC | Fundação Privada | RJ Rio de Janeiro | 111.0 | 89 | 29 |
| 10 | 11884903000107 | FUNDO MUNICIPAL DE SAUDE DE SAO GONCALO | Fundo Público Municipal | RJ São Gonçalo | 102.9 | 26 | 13 |
| 11 | 11384874000106 | FUNDO MUNICIPAL DE SAUDE (Campos dos Goytacazes) | Fundo Público Municipal | RJ Campos | 97.1 | 33 | 21 |
| 12 | 42429480000150 | FUNDAÇÃO UNIVERSITÁRIA JOSÉ BONIFÁCIO | Fundação Privada | RJ Rio de Janeiro | 96.8 | 115 | 44 |
| 13 | 03438229000109 | FUNDAÇÃO EUCLIDES DA CUNHA (FEC/UFF) | Fundação Privada | RJ Niterói | 96.8 | 122 | 42 |
| 14 | 32690668000102 | SECRETARIA DE ESTADO DE POLÍCIA MILITAR – SEPM | Órgão Público Estadual | RJ Rio de Janeiro | 96.4 | 35 | 24 |
| 15 | 13164086000130 | INSTITUTO REALIZANDO O FUTURO | Associação Privada | RJ Rio de Janeiro | 96.2 | 22 | 19 |

Concentration: the top 300 favorecidos hold 88.4 % of the money; 703 favorecidos received ≥ R$ 1
mi (94.8 %); 2,266 received ≥ R$ 100 k (99.2 %). By UF of the favorecido: RJ 6,997.7 · DF 4,535.0
· SP 247.1 · MG 100.1 · GO 74.2 · SC 71.1 · PR 35.1 · unknown 34.0 (R$ mi).

**Banco do Brasil caveat (36 % of the money).** The 4,005 rows (R$ 4,397 mi) with favorecido
`00000000000191 BANCO DO BRASIL SA`, município Brasília, are 95 % função Saúde (ações "Incremento
temporário ao custeio dos serviços de atenção básica/especializada" R$ 1,177 mi, "Apoio à
manutenção de unidades de saúde" R$ 711 mi, "Estruturação de unidades…" R$ 617 mi): the SUS
fundo-a-fundo transfers of the Fundo Nacional de Saúde, whose ordem bancária is issued to the
bank that credits the municipal/state health funds. The Portal records the bank as the
favorecido, so the real recipient (which municipal fund) is not in this file for those rows; the
amendment's own `municipio_destino`/`localidade` is the only clue (R$ 1,719 mi of it has a
município, R$ 2,460 mi is "múltiplo"). The pattern stops after 2024 (BB 2023 R$ 812 mi, 2024 686,
2025 21, 2026 22) while `FUNDO MUNICIPAL DE SAUDE DE …` entries explode in 2025–2026 (Duque de
Caxias: 2024 50.6 → 2025 84.2 → 2026 119.2), consistent with the FNS now registering the fund as
favorecido. Any "who received" ranking must show BB as "repasse fundo a fundo via Banco do
Brasil", not as a beneficiary. Caixa (`00360305000104`) is small: 1,305 rows, R$ 15.6 mi.

### 5.2 Gap between `Valor Recebido` and `pago + rp_pago` (R$ 136.5 mi, 1.1 %)

Per budget year the two agree within 0.5–3.7 % (2015 188.7 vs 187.7; 2021 912.8 vs 879.3 is the
widest; 2026 1,427.8 vs 1,418.5). Decomposition over the 7,783 amendments:

- 6,546 amendments match to the cent;
- 92 paid amendments have **no favorecido row at all**: R$ 62.8 mi (e.g. `202171200008` Bancada
  RJ 2021 "Reestruturação e modernização…" R$ 16.4 mi; `202441020019` 2024 R$ 6.4 mi). Spread
  over all years and localidade types, so it is not a cutoff; most plausible is payments made by
  documents the "por favorecido" extraction does not classify (e.g. descentralizações/TEDs to
  other federal units, payments whose favorecido is a UG recorded elsewhere) — unverified;
- 358 amendments received **less** than paid: R$ 77.4 mi. 142 of them have a gap < 5 % of the
  amount (R$ 3.8 mi in total), the size of tax/contribution retentions (ISS, INSS, IR withheld
  from suppliers go to the Receita/município, not to the favorecido). The remaining large gaps
  concentrate in Associação Privada (R$ 28.8 mi), Empresa Pública (11.6), Município (11.0) and
  Sociedade Empresária (10.9), localidade `uf`/`nacional` — consistent with partial devoluções
  (GRU returns) that reduce the favorecido side, or with payments to a favorecido not yet
  consolidated in the monthly file;
- 54 amendments received **more** than paid: R$ 3.7 mi (e.g. `202671200008` +0.94 mi), i.e.
  restos a pagar cancelled after payment or payments later re-classified.

Transferências Especiais (RP6 "Pix"), which go straight to the município, reconcile almost
exactly: R$ 671.1 mi received vs R$ 672.9 mi paid. Treat `Valor Recebido` as the payment-document
view and `pago + rp_pago` as the budget-execution view; both come from the same 2026-10-09
extraction, so there is no timing gap between them.

### 5.3 Data added

`data/snapshot.json` (now 15.9 MB): `favorecidos[]` (9,800 × {codigo, nome (most frequent
spelling), natureza_juridica, tipo, uf, municipio, total_recebido, por_ano (by payment year),
por_autor {autor_id: valor}, n_emendas}) and `recebimentos[]` (40,679 × {codigo_emenda, autor_id,
ano_mes "YYYY-MM", favorecido_codigo, valor}); `stats.favorecidos` carries the totals above.

`frontend/lib/static-data.generated.json` (894 KB, was 559 KB): `favorecidos` = top 300 by total
({codigo, slug, nome, natureza_juridica, tipo, uf, municipio, total, por_ano, n_autores,
n_emendas}), `favorecidos_por_tipo` and `favorecidos_por_natureza` ({n_favorecidos,
n_recebimentos, valor}), each `autores[]` entry gets `favorecidos` (top 8 by value received from
that author) and each `destinos[]` entry gets `favorecidos` (top 8 favorecidos **seated in** that
município: `UF Favorecido = RJ` and `Município Favorecido` normalised against the IBGE names; one
alias needed, `TRAJANO DE MORAIS` → Trajano de Moraes; 0 unmatched names left). `stats.favorecidos_export`.

`frontend/lib/static-favorecidos/<slug>.generated.json` (1,013 files, 4.6 MB; largest Banco do
Brasil 339 KB): rows `{c: codigo_emenda, au: autor_id, am: "YYYY-MM", v: valor, mn: município
destino da emenda quando único, senão null}` sorted by month desc. Files are written only for
favorecidos some list can reach (top 300 ∪ every autor top 8 ∪ every destino top 8) plus everyone
with ≥ R$ 1 mi, because the frontend loads these via webpack dynamic `import()` over the directory
and 9,800 chunks would be unreasonable; the remaining 8,787 favorecidos (0.8 % of the money) have
no detail file. Each list entry carries `slug`, which is the file name.

## 6. IPCA deflator (added 2026-10-14)

Source: IBGE/SIDRA tabela 1737, variável 2266 "IPCA – Número-índice (base: dezembro de 1993 =
100)", `https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/2266/p/all` (JSON, 562 months from
1979-12; first element is the header row; months not yet published come as non-numeric and are
skipped). Cached at `data/raw/ipca_1737_2266.json` by the same fetcher. Latest month on
2026-10-14: **2026-09**, index 7,695.82. `app/ipca.py`.

Convention. `factor[Y] = index[base_month] / mean(index of the months of Y)`. Budget-year flows
(empenho, pagamento) are spread across the year, so the average price level of the year is the
right deflator for a yearly total: it turns "R$ X paid during 2019" into "the same purchasing
power in 2026-09 reais". Using December would overstate the correction for money that was mostly
spent before December. `factor_dec[Y] = index[base_month] / index[Y-12]` ("reais de dezembro de
Y", the common convention in Brazilian fiscal reporting) is also exported so the frontend can
offer either. For the current year the mean uses the published months (9 in 2026) and
`factor_dec` falls back to the base month (= 1.0). All data stays nominal; the frontend multiplies.
Payments in `recebimentos` carry a month, so a finer monthly deflation is possible later from the
same series.

| ano | factor (mean of year → 2026-09) | factor_dec (Dec of year → 2026-09) |
|---|---:|---:|
| 2015 | 1.7855 | 1.7128 |
| 2016 | 1.6420 | 1.6115 |
| 2017 | 1.5873 | 1.5653 |
| 2018 | 1.5312 | 1.5088 |
| 2019 | 1.4761 | 1.4465 |
| 2020 | 1.4302 | 1.3840 |
| 2021 | 1.3205 | 1.2575 |
| 2022 | 1.2084 | 1.1887 |
| 2023 | 1.1553 | 1.1362 |
| 2024 | 1.1070 | 1.0838 |
| 2025 | 1.0541 | 1.0395 |
| 2026 | 1.0137 (9 months) | 1.0000 (Dec not published) |

(2014 = 1.9468 / 1.8956 is also exported; the snapshot has no 2014
authors.) Exported in the core as `ipca: {source_url, fetched_at, base_month, variable, method,
factors, factors_dec}`. Tests: `tests/test_ipca.py` (toy series: flat year, December jump, partial
year, missing years).

## 7. How gwern.net presents inflation-adjusted money (research note, checked 2026-10-14)

Sources read: https://gwern.net/style-guide (section "Currency/Inflation"), https://gwern.net/about
(nothing on currency), https://gwern.net/subscript (section "Inflation"), the rendered HTML of
https://gwern.net/bitcoin-is-worse-is-better, https://gwern.net/tea, https://gwern.net/blackmail
(https://gwern.net/dnm-arrest and https://gwern.net/silk-road contain **no** adjusted amounts; their
₿/$ figures are plain text like "₿11 (then $935)"), and in https://github.com/gwern/gwern.net:
`build/Inflation.hs` (time-stamp 2026-04-27), `build/Config/Inflation.hs`, `css/initial.css`,
`css/default.css`, `js/rewrite.js`.

1. **Primary text = the inflation-adjusted (current-year) amount.** The nominal amount and its
   year are demoted to a small stacked superscript/subscript right after it. `Inflation.hs`
   rejects the usual alternatives explicitly: "the author usually settles for either replacing
   the number, using an ad hoc currency unit like '$2012', or verbosely putting it in parentheses,
   like '$10 ($100 in 2019)'". (The header's first example `$50.50<sub>1970</sub><sup>$343.83</sup>`
   is stale; the code emits adjusted first:
   `[Str "$"++adjusted, Span ("",["subsup"],[]) [Superscript [Str "$"++old], Subscript [Str oldYear]]]`.)

2. **Markup.** `<span class="inflation-adjusted" data-year-original data-amount-original
   data-year-current data-amount-current title="CPI inflation-adjusted US dollar: from nominal $N
   in YYYY → real $N in YYYY">$ADJUSTED<span class="subsup"><sup>$NOMINAL</sup><sub>YYYY</sub></span></span>`.
   No parentheses, no footnote; the long sentence lives in the `title` tooltip (for Bitcoin the
   tooltip also carries the full `YYYY-MM-DD`, inline shows only the year). CSS (`initial.css`):
   `.subsup { display: inline-flex; flex-flow: column; align-items: flex-start; vertical-align:
   text-bottom; margin-left: 0.15em; margin-right: 0.1em; position: relative; bottom: -0.1em }
   .subsup sup, .subsup sub { position: relative; line-height: 1; font-size: 0.6em }`; and
   (`default.css`) `span.inflation-adjusted { white-space: nowrap } span.inflation-adjusted .subsup
   { align-items: flex-end; bottom: 0 }` — nominal on top, year underneath, both 0.6em,
   right-aligned, never line-broken. `rewrite.js` ("INFLATION ADJUSTMENT") then rounds for
   display: adjusted ≥ 100 → integer; integer nominal with ≥ 2-digit adjusted → integer; strips
   trailing `.00`; compacts the nominal with k/m/b. Copying yields `$8 [2011; $12 in 2026]`.

3. **Exact examples** (server HTML, verbatim; visible text after the JS rounding in bold):
   - bitcoin-is-worse-is-better: `<span class="inflation-adjusted" data-year-original="2011"
     data-amount-original="8" data-year-current="2026" data-amount-current="12.42" title="CPI
     inflation-adjusted US dollar: from nominal $8 in 2011 → real $12.42 in 2026">$12.42<span
     class="subsup"><sup>$8</sup><sub>2011</sub></span></span>` → **$12** with ⁸ ₂₀₁₁ stacked.
   - same page: `…data-year-original="2008" data-amount-original="500" … data-amount-current="777.66"
     …>$777.66<span class="subsup"><sup>$500</sup><sub>2008</sub></span></span>` → **$778**.
   - tea: `…data-year-original="2012" data-amount-original="12" … data-amount-current="18.28"
     …>$18.28<span class="subsup"><sup>$12</sup><sub>2012</sub></span></span>` → **$18**.
   - blackmail (Bitcoin): `<span class="inflation-adjusted" data-year-original="2013-10-01"
     data-amount-original="111,114" data-year-current="2026" data-amount-current="31,420,185.26"
     title="Exchange-rate-adjusted currency: ₿111,114 in 2013-10-01 → $31,420,185.26">$31,420,185.26<span
     class="subsup"><sup>₿111,114</sup><sub>2013</sub></span></span>` → **$31,420,185**.

4. **Style-guide rules** (verbatim): "Dollar/₿ prices or values should be inflation-adjusted if
   they reflect some real transaction or amount, rather than being placeholders, especially in any
   historical context. This includes in quotes, as the original nominal amount is still available
   to the reader. If you buy something for '$1' in 2026, it should be written [$1]($2026) …
   whereas if it's describing an economics or thought experiment and is just an arbitrary unit of
   value, it should be left as-is." "Due to the extreme volatility, ₿ amounts must be written
   with a specific YYYY-MM-DD date like [₿1](₿2026-01-01)." "Numbers over ≈1,000 or those
   confusable with years get digit-group commas (eg. $1,234.56)". Ranges are forbidden
   (`[$1–10]($2000)` is a fatal error; write two adjusted amounts). The style guide has **no**
   rounding or significant-figure rule and no fixed base year; those are in code: adjustment is
   dropped when `adjusted/nominal < 1.20` (`minPercentage = 1 + 0.20`, dollars only, so recent
   years are shown plain), base year = year of the site build (`CM.currentYear`, pages currently
   say 2026, so every rebuild re-bases), Haskell prints 2 decimals and the browser rounds as in
   (2). Index: CPI 1913–1958, then PCE (BEA/FRED `DPCERG3A086NBEA`), last known annual rate
   carried forward; Bitcoin via a historical exchange-rate table (btcvol.info) re-based to
   current dollars.

What this suggests for Emendas RJ, if the frontend adopts it: show the deflated value as the
primary figure with the nominal and the budget year stacked small to its right, wrap the pair in
`white-space: nowrap`, put the full sentence ("R$ X nominais em 2019 → R$ Y de set/2026, IPCA") in
a tooltip, and skip the adjustment when the factor is below some threshold (gwern uses 1.20;
with IPCA that would hide 2022–2026).

## 8. São Paulo (added 2026-10-14)

Same zip, same code path: `python -m app.etl.export_snapshot --uf SP` and
`python -m app.etl.export_static_frontend --uf SP` (snapshot `data/snapshot-sp.json`, frontend data
`frontend/data/sp/`). Per-UF constants live in `app/config.py` (`UFS`); nothing else is
state-specific in the backend. Run on the zip of 2026-10-10 (sha256 `669d4524…`, 32,490,844 bytes;
the SP run read the cached file, it did not download again).

- Bancada code: `7125 BANCADA DE SAO PAULO` (66 rows), found among the `71xx` codes of the CSV
  (7102 Acre … 7128 Tocantins, one per state). Collective author `bancada-sp`.
- Roster: **211 people** who exercised an SP federal mandate in legislaturas 54–57 (Câmara list
  filtered on `siglaUf == "SP"`: 91 / 83 / 81 / 90 deputies per legislature; Senado
  `UfParlamentar == "SP"` with exercise: 4 / 5 / 5 / 3). Four people served in both houses and are
  merged: Antonio Carlos Rodrigues, José Aníbal, Major Olimpio, Mara Gabrilli. First run fetched 211
  `/deputados/{id}` details (~80 s); the national Câmara listings were already cached from RJ.
- Matching: 9,511 strict rows, **0 loose, 0 excluded collisions**; 176 of 211 people have at least
  one executed amendment. Unmatched SP-looking individual authors (≥ 40 % of rows destined to SP,
  code not matched): **0**.
- National homonym index: one name of the SP roster also exists outside it, `ROBERTO FREIRE`
  (`senado:71`). It is the same man: deputy for SP in legislaturas 54–55 (Câmara 73805) and listed
  by the Senado as 1º suplente for PE in legislatura 54, never in exercise. His 17 rows (2015,
  SIAFI 1234) match strict to the SP deputy and stay; the collision is only logged.
- Multi-code authors: Mara Gabrilli 2807/4094, Major Olimpio 3712/9229, Missionário José Olimpio
  2809/3088, João Cury 3597/4551, Ribamar Silva 4200/4545. Reassigned codes: 3088 is
  `MISSIONARIO JOSE OLIMPIO (EX-PARLAMENTAR EDUARDO BOLSONARO, NOS TERMOS DA DECISAO ADPF 854…`
  (3 rows, attributed to Missionário José Olimpio as SIAFI records them), 3597 João Cury Neto ex
  Alberto Mourão (6 rows), 4200 Ribamar Silva ex Ricardo Silva (2 rows), both art. 78 LDO 2025.
- Rows kept: **9,577** (9,574 distinct codes): Finalidade Definida 9,021 · Transferências
  Especiais 490 · Bancada SP 66. Destination: SP 8,651 · no UF 823 · PB 17 · DF 13 · MG 11 · others.
  Localidade: múltiplo 3,663 · município 2,852 · uf 2,323 · nacional 715 · exterior 21 · outro 3.
  Author-less rows destined to SP (not kept): 2014 1,391 · 2016 7 · 2017 466 · 2018 1 · 2019 7 · 2020 7.

| ano | rows | empenhado | liquidado | pago | RP pagos |
|---|---:|---:|---:|---:|---:|
| 2015 | 499 | 378.4 | 6.3 | 3.2 | 310.5 |
| 2016 | 750 | 887.0 | 168.2 | 165.0 | 640.2 |
| 2017 | 723 | 1,012.6 | 129.7 | 129.0 | 779.1 |
| 2018 | 757 | 1,152.8 | 558.1 | 556.9 | 502.4 |
| 2019 | 1,091 | 1,227.6 | 638.4 | 636.2 | 480.4 |
| 2020 | 844 | 1,348.9 | 929.2 | 922.6 | 346.2 |
| 2021 | 839 | 1,423.1 | 918.8 | 914.5 | 434.3 |
| 2022 | 793 | 1,534.2 | 1,054.9 | 1,045.0 | 438.4 |
| 2023 | 769 | 2,662.0 | 2,236.0 | 2,230.1 | 351.0 |
| 2024 | 933 | 3,125.7 | 2,358.5 | 2,351.3 | 601.2 |
| 2025 | 835 | 3,186.8 | 2,379.6 | 2,366.7 | 388.6 |
| 2026 | 744 | 2,868.8 | 1,654.4 | 1,647.6 | 0.0 |

(R$ mi nominal.) Total 2015–2026: empenhado R$ 20.81 bi, pago R$ 12.97 bi, RP pagos R$ 5.27 bi.
Largest authors by empenhado (R$ mi): Bancada de SP 2,473 · Mara Gabrilli 372 · Giordano 289 ·
Pastor Marco Feliciano 260 · Jefferson Campos 257 · Carlos Zarattini 254 · Tiririca 254 · Alex
Manente 254 · Miguel Lombardi 252 · Nilto Tatto 251. Largest municipalities by pago + RP pago
(R$ mi): São Paulo 255.1 · Carapicuíba 168.6 · Embu das Artes 162.8 · Osasco 56.0 · Itapevi 51.5 ·
Praia Grande 50.7 · Guarulhos 48.3 · Campinas 37.8 · Cotia 36.8 · Mauá 35.6. 484 of the 645
municipalities have at least one amendment with a named município.

Favorecidos: 55,166 payment rows to 8,738 favorecidos, R$ 18,136.6 mi received vs R$ 18,240.5 mi
pago + RP pago (gap 0.6 %); 683 amendments without a favorecido row; 0 author-code disagreements.
Banco do Brasil (SUS fundo a fundo) is **40 %** of the money (R$ 7,273 mi; the pattern stops after
2024 as in RJ). By UF of the favorecido: SP 10,276 · DF 7,429 · RJ 144 (R$ mi). The top 300 hold
75 % of the money (88 % in RJ); 1,621 favorecidos received ≥ R$ 1 mi. Favorecido municipality
names needing aliases against IBGE: `EMBU` → Embu das Artes, `SÃO LUÍS DO PARAITINGA` → São Luiz
do Paraitinga, `FLORÍNIA` → Florínea (`UFS["SP"].municipio_aliases`); 0 unmatched after that.

Frontend size. With the RJ limits the SP core would be 3.3 MB with 2,965 favorecidos. SP uses
`LIMITS["SP"]` in `export_static_frontend.py`: core keeps the top 300 favorecidos only; the other
2,083 favorecidos that some author or municipality list links to go to
`static-favorecidos-extra.generated.json` (668 KB, loaded when one of them is opened); lists per
author/municipality keep 5 favorecidos; municipality entries keep 5 authors and drop the função
list and per-year favorecido split the Destinos screen does not show; core money in whole reais.
Result: core 1.77 MB (313 KB gzip) vs RJ 1.74 MB (314 KB gzip); 2,383 favorecido files (11 MB),
177 author files (3.1 MB), 484 municipality files (2.3 MB), geometry 645 municipalities (288 KB).

## 9. As 27 UFs (added 2026-10-14)

`python -m app.etl.export_snapshot --uf all` reads `EmendasParlamentares.csv` and
`_PorFavorecido.csv` once and writes one snapshot per UF (19–21 s with caches warm, 0.96 GB peak
RSS); `export_static_frontend --uf all` writes `frontend/data/<uf>/` (12–31 s; the first run fetched
25 IBGE meshes and population tables). Warming the roster for the 25 new UFs took ~25 min: the
national Câmara listings were cached, ~1,900 new `/deputados/{id}` calls at the polite pace.

- Bancada codes: one `71xx` per UF in the CSV, 7102 Acre … 7128 Tocantins (7125 São Paulo, 7126
  Santa Catarina); all 27 in `config._UFS_RAW`.
- National coverage: 73,832 individual-amendment rows with an author; every one is kept by exactly
  one UF. Three changes were needed once all UFs run together (`export_snapshot.resolve_cross_uf`,
  `match_by_code`):
  1. **Loose vs strict across UFs.** Vitor Paulo (Câmara 92355) was deputy for RJ in legislatura 54
     and for DF in 55. The RJ-only run had accepted his 11 rows of 2019 as "loose"; DF matches them
     strict, so they move to DF (and DF's 4 loose rows of 2015 stay in RJ). RJ goes from 7,797 to
     7,786 rows.
  2. **Two homonyms with mandates in the same legislature.** "PEDRO CHAVES" is a GO deputy (Pedro
     Pinheiro Chaves, SIAFI 3672) and an MS senator (Pedro Chaves dos Santos Filho, SIAFI 3843), both
     in legislatura 55. A row claimed strict by two UFs goes to the UF that matches more rows of the
     same SIAFI code (the full civil spelling only matches one of them); 24 rows left GO and 40 left
     MS, each to its owner.
  3. **Match by SIAFI code.** 56 rows had a spelling no roster carries ("NELSINHO TRAD FILHO",
     "LUIZ DO CARMO", "DEP. JOSIVALDO JP", "DEP. ROSEANA SARNEY", an art. 78 form for Maria Goreth);
     their code already belonged to one matched person, so they follow the code (quality "codigo"):
     AP 7, GO 18, MA 11, MS 20. `GIM` (5 rows, Gim Argello, DF) needed a name alias
     (`config.SIAFI_NAME_ALIASES`).
- Collisions logged by the national index, all resolved by the rules above or by legislature: Bebeto
  (RJ/BA), Dr. João (RJ/BA), Davidson Magalhães (BA), Pedro Chaves (GO/MS), Mariana Carvalho (MA/RO),
  Antonio Andrade (MG/TO), Marcondes Gadelha (PB), Silvio Costa and Waldemar Oliveira (PE), Liziane
  Bayer and Reginete Bispo (RS), Roberto Freire (SP), Pedro Fernandes (MA), Rodolfo Nogueira (MS).
- Favorecido municipality aliases added for BA, CE, MT, MG, PA, PB, PE, RN, RR, SE, TO (renamed
  municipalities such as Açu → Assú, Presidente Juscelino → Serra Caiada, Augusto Severo → Campo
  Grande, Seridó → São Vicente do Seridó, Fortaleza do Tabocão → Tabocão). One name stays unmatched:
  Boa Esperança do Norte (MT, R$ 1.1 mi), installed after the 2022 census.
- DF has one municipality (Brasília, 5300108): the map draws one polygon and most DF money is
  "Distrito Federal inteiro" (localidade `uf`).
- IBGE `servicodados` started serving only its leaf certificate (Sectigo DV R36) on 2026-10-14;
  `app/http.py` adds that intermediate (fetched from the AIA URL) and retries.
- Size: `frontend/data` is 157 MB, 26,551 files (favorecido files 90 MB). Cores 0.35 MB (DF) to
  1.77 MB (SP). RJ keeps its original limits; the other 26 UFs use the SP limits.

Build: per-UF Next builds took 21 s (RJ) and 34 s (SP) here on 12 cores, about 15 min for 27 and an
estimated 40+ min on the 4-vCPU droplet. The site is now one Next build: routes `/` (RJ) and
`/[uf]/…` (generateStaticParams, 195 pages), data copied to `public/data/<uf>/` and fetched by the
client (`DataGate`, `lib/static-api.ts`) instead of imported. That build takes 44 s here (copying
the 157 MB of data included).

| UF | roster | casados | linhas | empenhado (R$ mi) | pago+RP (R$ mi) | bancada (R$ mi emp.) | maior autor individual | maior município (pago+RP) | núcleo |
|---|---:|---:|---:|---:|---:|---:|---|---|---:|
| RJ | 158 | 130 | 7,786 | 14,485 | 12,409 | 2,381 | Romário (372) | Rio de Janeiro (396.9) | 1.74 MB |
| AC | 35 | 31 | 1,652 | 5,433 | 3,968 | 2,347 | Sérgio Petecão (361) | Rio Branco (221.1) | 0.41 MB |
| AL | 40 | 29 | 1,259 | 5,800 | 5,143 | 2,464 | Renan Calheiros (369) | Arapiraca (122.2) | 0.43 MB |
| AP | 38 | 31 | 1,406 | 5,372 | 4,460 | 2,381 | Davi Alcolumbre (384) | Macapá (327.7) | 0.37 MB |
| AM | 36 | 30 | 1,262 | 5,636 | 5,190 | 2,557 | Eduardo Braga (368) | Manaus (336.6) | 0.43 MB |
| BA | 102 | 88 | 5,084 | 13,211 | 11,964 | 2,284 | Otto Alencar (374) | Salvador (75.2) | 1.11 MB |
| CE | 83 | 61 | 3,073 | 9,195 | 8,610 | 2,507 | Eduardo Girão (292) | Fortaleza (146.1) | 0.81 MB |
| DF | 38 | 33 | 1,752 | 5,125 | 3,627 | 2,263 | Izalci Lucas (354) | Brasília (7.7) | 0.35 MB |
| ES | 36 | 33 | 1,868 | 5,914 | 4,944 | 2,356 | Marcos do Val (320) | Serra (155.2) | 0.50 MB |
| GO | 59 | 51 | 2,575 | 7,608 | 6,764 | 2,378 | Jorge Kajuru (311) | Goiânia (22.2) | 0.66 MB |
| MA | 85 | 61 | 1,927 | 8,174 | 7,547 | 2,499 | Weverton (369) | Imperatriz (41.6) | 0.67 MB |
| MT | 46 | 32 | 1,161 | 5,474 | 4,728 | 2,375 | Wellington Fagundes (363) | Cuiabá (245.3) | 0.46 MB |
| MS | 35 | 28 | 1,476 | 5,451 | 4,253 | 2,391 | Nelsinho Trad (314) | Campo Grande (263.4) | 0.44 MB |
| MG | 151 | 118 | 7,025 | 16,838 | 15,265 | 2,448 | Rodrigo Pacheco (370) | Muriaé (111.4) | 1.40 MB |
| PA | 56 | 47 | 2,107 | 7,939 | 7,207 | 2,517 | Jader Barbalho (384) | Belém (53.3) | 0.60 MB |
| PB | 44 | 33 | 2,236 | 6,421 | 5,637 | 2,345 | Veneziano Vital do Rêgo (353) | Campina Grande (147.0) | 0.57 MB |
| PR | 93 | 76 | 4,117 | 10,954 | 9,442 | 2,333 | Oriovisto Guimarães (313) | Curitiba (60.7) | 0.96 MB |
| PE | 77 | 65 | 3,733 | 9,572 | 8,474 | 2,329 | Humberto Costa (360) | Recife (128.0) | 0.79 MB |
| PI | 37 | 34 | 1,206 | 6,174 | 5,838 | 2,478 | Marcelo Castro (370) | Teresina (44.7) | 0.46 MB |
| RN | 32 | 28 | 1,773 | 5,495 | 4,907 | 2,400 | Zenaide Maia (358) | Natal (124.0) | 0.45 MB |
| RS | 84 | 70 | 4,484 | 11,273 | 9,892 | 2,417 | Luis Carlos Heinze (376) | Porto Alegre (102.4) | 0.93 MB |
| RO | 39 | 31 | 1,182 | 5,405 | 4,601 | 2,341 | Marcos Rogério (376) | Porto Velho (168.7) | 0.41 MB |
| RR | 40 | 30 | 1,206 | 5,543 | 3,802 | 2,435 | Dr. Hiran (331) | Boa Vista (564.9) | 0.36 MB |
| SC | 62 | 48 | 2,500 | 7,546 | 6,846 | 2,395 | Esperidião Amin (358) | Joinville (54.3) | 0.71 MB |
| SP | 211 | 176 | 9,577 | 20,808 | 18,241 | 2,473 | Mara Gabrilli (372) | São Paulo (255.1) | 1.77 MB |
| SE | 35 | 26 | 1,385 | 5,514 | 4,806 | 2,385 | Laércio Oliveira (350) | Aracaju (171.3) | 0.42 MB |
| TO | 39 | 26 | 1,368 | 5,349 | 4,620 | 2,287 | Professora Dorinha Seabra (353) | Araguaína (120.7) | 0.46 MB |
