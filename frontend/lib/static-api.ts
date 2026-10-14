/**
 * Camada de dados do site. Cada UF tem um núcleo (`<basePath>/data/<uf>/static-data.generated.json`)
 * mais um arquivo por autor (`static-autores/<id>`), por município (`static-destinos/<ibge>`) e por
 * favorecido, todos JSON estáticos buscados com fetch. `DataGate` carrega o núcleo da UF da página
 * e o instala com `setCore` antes de renderizar a tela; os getters abaixo leem o núcleo instalado.
 * Valores em reais nominais por ano orçamentário; `pago_total` = pago no ano + restos a pagar
 * pagos depois.
 */

import { bancadaCurta, commonDataUrl, dataUrl, type UfInfo } from "@/lib/uf";

export type Totais = {
  n: number;
  emendas: number;
  empenhado: number;
  liquidado: number;
  pago: number;
  rp_pago: number;
  pago_total: number;
};
/** Resumo usado em séries anuais e rankings. */
export type Brief = { n: number; empenhado: number; pago_total: number };
export type Ranked = Brief & { id: string; nome?: string; partido?: string | null; casa?: string | null; por_ano?: Record<string, Brief> };
export type Autor = {
  id: string;
  nome: string | null;
  nome_parlamentar: string | null;
  casa: "camara" | "senado" | "bancada" | string | null;
  casas: string[];
  partido: string | null;
  partido_por_legislatura: Record<string, string>;
  legislaturas: number[];
  foto: string | null;
  codigos_siafi: string[];
  totais: Totais;
  por_ano: Record<string, Brief>;
  tipos: Record<string, Brief>;
  destinos: Ranked[];
  funcoes: Ranked[];
  favorecidos?: FavorecidoRef[];
};
export type Destino = {
  ibge: string;
  nome: string;
  populacao_2022: number | null;
  totais: Totais;
  por_ano: Record<string, Brief>;
  autores: Ranked[];
  funcoes: Ranked[];
  favorecidos?: FavorecidoRef[];
};
/** Destino sem município: estado, vários municípios, nacional, exterior, outros estados. */
export type OutroDestino = { nome: string; totais: Totais; por_ano: Record<string, Brief>; autores: Ranked[]; funcoes: Ranked[] };
export type Funcao = {
  nome: string;
  totais: Totais;
  por_ano: Record<string, Brief>;
  autores: Ranked[];
  destinos: Ranked[];
};
export type Favorecido = {
  codigo: string;
  slug: string;
  nome: string;
  natureza_juridica: string | null;
  tipo: string | null;
  uf: string | null;
  municipio: string | null;
  total: number;
  por_ano: Record<string, number>;
  n_autores: number;
  n_emendas: number;
};
export type FavorecidoRef = { codigo: string; slug: string; nome: string; tipo: string | null; valor: number; por_ano?: Record<string, number> };
export type Recebimento = { c: string; au: string; am: string; v: number; mn: string | null };
export type Ipca = { source_url: string; fetched_at: string; base_month: string; variable: string; method: string; factors: Record<string, number>; factors_dec: Record<string, number> };
export type RosterPerson = { nome: string; nome_parlamentar: string | null; partido: string | null; casa: string | null; legislaturas: number[] };
export type Source = { name: string; url: string; accessed_at?: string; checksum?: string; size_bytes?: number; rows?: number; via?: string; member?: string };
/** Linha de emenda, compacta: ano, número, tipo, autor, destino, função, ação e valores. */
export type Linha = {
  c: string;
  a: number;
  n: string;
  t: "FD" | "TE" | "BC" | string;
  au: string;
  loc: string;
  m: string | null;
  mn: string | null;
  uf: string | null;
  f: string;
  sf: string;
  ac: string;
  e: number;
  p: number;
  rp: number;
};
type Core = {
  generated_at: string;
  snapshot_generated_at: string | null;
  years: number[];
  latest_year: number;
  totais: Totais;
  por_ano: Record<string, Totais>;
  por_tipo: Record<string, Totais>;
  por_tipo_ano: Record<string, Record<string, Brief>>;
  outros_destinos: Record<string, OutroDestino>;
  autores: Autor[];
  roster_sem_emendas: RosterPerson[];
  destinos: Destino[];
  funcoes: Funcao[];
  favorecidos: Favorecido[];
  favorecidos_por_tipo: Record<string, { n_favorecidos: number; n_recebimentos: number; valor: number }>;
  favorecidos_por_natureza: Record<string, { n_favorecidos: number; n_recebimentos: number; valor: number }>;
  ipca: Ipca;
  sources: Source[];
  stats: Record<string, unknown>;
};
export type GeoFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{ type: "Feature"; geometry: { type: string; coordinates: unknown }; properties: { ibge: string; nome: string } }>;
};

export type { Core };

let CURRENT: { uf: UfInfo; core: Core } | null = null;
const coreCache = new Map<string, Promise<Core>>();

/** Busca (uma vez por UF) o núcleo de dados. */
export function loadCore(uf: UfInfo): Promise<Core> {
  let pending = coreCache.get(uf.code);
  if (!pending) {
    pending = fetch(dataUrl(uf, "static-data.generated.json")).then((response) => {
      if (!response.ok) {
        throw new Error(`núcleo de ${uf.code}: HTTP ${response.status}`);
      }
      return response.json() as Promise<Core>;
    });
    pending.catch(() => coreCache.delete(uf.code));
    coreCache.set(uf.code, pending);
  }
  return pending;
}

/** Instala o núcleo da UF que as telas vão ler. Chamado por DataGate antes de renderizar a tela. */
export function setCore(uf: UfInfo, core: Core): void {
  CURRENT = { uf, core };
}

export function currentUf(): UfInfo {
  if (!CURRENT) {
    throw new Error("núcleo de dados não carregado");
  }
  return CURRENT.uf;
}

function core(): Core {
  if (!CURRENT) {
    throw new Error("núcleo de dados não carregado");
  }
  return CURRENT.core;
}

export type Metric = "empenhado" | "pago_total";
export const METRICS: Array<{ key: Metric; label: string }> = [
  { key: "empenhado", label: "Empenhado" },
  { key: "pago_total", label: "Pago" }
];
export function tipoLabels(uf: UfInfo): Record<string, string> {
  return {
    FD: "Individual, finalidade definida",
    TE: "Individual, transferência especial",
    BC: bancadaCurta(uf)
  };
}
export const LOCALIDADE_LABELS: Record<string, string> = {
  municipio: "município",
  uf: "estado",
  multiplo: "múltiplos municípios",
  nacional: "nacional",
  exterior: "exterior",
  outro: "região",
  outras_ufs: "outros estados"
};
export const CASA_LABELS: Record<string, string> = { camara: "Câmara", senado: "Senado", bancada: "Bancada" };

// --- Núcleo --------------------------------------------------------------------------------

export function getMeta() {
  return {
    generated_at: core().generated_at,
    snapshot_generated_at: core().snapshot_generated_at,
    years: core().years,
    latest_year: core().latest_year,
    totais: core().totais
  };
}
export function getYears(): number[] {
  return core().years;
}
export function getTotals(): Totais {
  return core().totais;
}
export function getByYear(): Record<string, Totais> {
  return core().por_ano;
}
export function getByTipo(): Record<string, Totais> {
  return core().por_tipo;
}
export function getByTipoYear(): Record<string, Record<string, Brief>> {
  return core().por_tipo_ano;
}
export function getOutrosDestinos(): Record<string, OutroDestino> {
  return core().outros_destinos;
}
export function getAutores(): Autor[] {
  return core().autores;
}
export function getAutor(id: string): Autor | undefined {
  return core().autores.find((autor) => autor.id === id);
}
export function getRosterSemEmendas(): RosterPerson[] {
  return core().roster_sem_emendas;
}
export function getDestinos(): Destino[] {
  return core().destinos;
}
export function getDestino(ibge: string): Destino | undefined {
  return core().destinos.find((destino) => destino.ibge === ibge);
}
export function getFuncoes(): Funcao[] {
  return core().funcoes;
}
export function getFuncao(nome: string): Funcao | undefined {
  return core().funcoes.find((funcao) => funcao.nome === nome);
}
export function getFavorecidos(): Favorecido[] {
  return core().favorecidos ?? [];
}
export function getFavorecido(slug: string): Favorecido | undefined {
  return core().favorecidos?.find((item) => item.slug === slug);
}
export function getFavorecidosPorTipo() {
  return core().favorecidos_por_tipo ?? {};
}
export function getFavorecidosPorNatureza() {
  return core().favorecidos_por_natureza ?? {};
}
export function getIpca(): Ipca {
  return core().ipca;
}
/** Banco do Brasil aparece como favorecido dos repasses fundo a fundo do SUS; não é destinatário final. */
export const BB_CODIGO = "00000000000191";
export function getSources(): Source[] {
  return core().sources;
}
export function getStats(): Record<string, unknown> {
  return core().stats;
}

/** Valor de um grupo num ano ("all" = todos) para a métrica. */
export function valueFor(porAno: Record<string, Brief>, totais: Brief | Totais, year: number | "all", metric: Metric): number {
  if (year === "all") {
    return totais[metric];
  }
  return porAno[String(year)]?.[metric] ?? 0;
}

/** Nome curto para listas: nome parlamentar quando existe. */
export function displayName(autor: Pick<Autor, "nome" | "nome_parlamentar"> & { casa?: string | null }): string {
  // A bancada vem do SIAFI sem acento ("BANCADA DE SAO PAULO"); o nome por extenso tem.
  if (autor.casa === "bancada" && autor.nome) {
    return autor.nome;
  }
  return niceName(autor.nome_parlamentar || autor.nome);
}

/** Nomes vindos em caixa alta (SIAFI, roster da Câmara) viram caixa normal; os demais ficam como estão. */
export function niceName(value: string | null | undefined): string {
  const name = value ?? "";
  return name && name === name.toUpperCase() ? titleCase(name) : name;
}

export function titleCase(value: string | null | undefined): string {
  const small = new Set(["de", "da", "do", "das", "dos", "e"]);
  return (value ?? "")
    .toLowerCase()
    .split(" ")
    .map((word, index) => (index && small.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/** R$ em escala legível: 1,2 bi · 244 mi · 850 mil · 120. */
export function formatBRL(value: number | null | undefined, digits?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "–";
  }
  const abs = Math.abs(value);
  const fmt = (n: number, d: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  if (abs >= 1e9) {
    return `R$ ${fmt(value / 1e9, digits ?? 2)} bi`;
  }
  if (abs >= 1e6) {
    return `R$ ${fmt(value / 1e6, digits ?? (abs >= 1e8 ? 0 : 1))} mi`;
  }
  if (abs >= 1e3) {
    return `R$ ${fmt(value / 1e3, digits ?? 0)} mil`;
  }
  return `R$ ${fmt(value, digits ?? 0)}`;
}

export function formatBRLFull(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "–";
  }
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
}

export function formatInt(value: number | null | undefined): string {
  return value === null || value === undefined ? "–" : new Intl.NumberFormat("pt-BR").format(value);
}

// --- Arquivos sob demanda ------------------------------------------------------------------

async function fetchJson<T>(file: string): Promise<T> {
  const response = await fetch(dataUrl(currentUf(), file));
  if (!response.ok) {
    throw new Error(`${file}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}


const lazyCache = new Map<string, Promise<unknown>>();

/** Arquivo sob demanda da UF instalada, guardado por UF + nome (slugs repetem entre UFs). */
function lazy<T>(file: string, fallback: T): Promise<T> {
  const key = `${currentUf().code}:${file}`;
  let pending = lazyCache.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = fetchJson<T>(file).catch(() => fallback);
    lazyCache.set(key, pending);
  }
  return pending;
}

export function loadLinhasAutor(id: string): Promise<Linha[]> {
  return lazy<Linha[]>(`static-autores/${id}.generated.json`, []);
}

export function loadLinhasDestino(ibge: string): Promise<Linha[]> {
  return lazy<Linha[]>(`static-destinos/${ibge}.generated.json`, []);
}

export function loadRecebimentos(slug: string): Promise<Recebimento[]> {
  return lazy<Recebimento[]>(`static-favorecidos/${slug}.generated.json`, []);
}

/**
 * Favorecidos que alguma lista de autor ou município linka mas que ficaram fora do núcleo (fora do
 * RJ o núcleo leva só os 300 maiores). Um arquivo só, carregado quando alguém abre um deles.
 */
export function loadFavorecidosExtra(): Promise<Favorecido[]> {
  return lazy<Favorecido[]>("static-favorecidos-extra.generated.json", []);
}

export function loadGeo(): Promise<GeoFeatureCollection> {
  return lazy<GeoFeatureCollection>("static-geo.generated.json", { type: "FeatureCollection", features: [] });
}

/** Série anual completa (anos sem emenda viram zero), para os gráficos de barras. */
export function yearPoints(porAno: Record<string, Brief>, years: number[]): Array<{ year: number; empenhado: number; pago_total: number; n: number }> {
  return years.map((year) => {
    const brief = porAno[String(year)];
    return { year, empenhado: brief?.empenhado ?? 0, pago_total: brief?.pago_total ?? 0, n: brief?.n ?? 0 };
  });
}

// --- Votações e presença -------------------------------------------------------------------
//
// Comuns às 27 UFs (data/votacoes/): o índice de todas as votações nominais de plenário da Câmara e
// do Senado desde 2015-02-01, o detalhe por ano e as ementas. Por UF: a bancada com faltas por mês
// (static-bancada), o voto da bancada em cada votação do ano (static-votos/<ano>) e a lista de votos
// de cada parlamentar (static-parlamentares/<id>).

/**
 * Voto ou situação de um parlamentar numa votação. S sim, N não, A abstenção, O obstrução,
 * P presidindo, X presente sem voto, F ausente, J ausência justificada (Senado), "." fora do mandato.
 */
export type VotoCode = "S" | "N" | "A" | "O" | "P" | "V" | "X" | "F" | "J" | ".";
export const VOTO_LABELS: Record<string, string> = {
  S: "Sim",
  N: "Não",
  A: "Abstenção",
  O: "Obstrução",
  P: "Presidindo",
  V: "Votou",
  X: "Presente, sem voto",
  F: "Ausente",
  J: "Ausência justificada"
};
export const ORIENTACAO_LABELS: Record<string, string> = { S: "Sim", N: "Não", L: "Liberado", O: "Obstrução", A: "Abstenção" };
export const TIPO_VOTACAO_LABELS: Record<string, string> = { texto: "Texto", destaque: "Emenda ou destaque", requerimento: "Requerimento" };
export type Casa2 = "camara" | "senado";
export type VotacaoIdx = {
  id: string;
  casa: Casa2;
  data: string;
  titulo: string;
  tipo: string;
  resultado: "aprovado" | "rejeitado" | null;
  sim: number;
  nao: number;
  abst: number;
  obst: number;
  governo: string | null;
  prop: string | null;
};
export type VotacaoDetalhe = {
  ob: string;
  fr: string;
  h: string | null;
  f: string;
  pp: Record<string, [number, number, number, number]>;
  or: Record<string, string>;
  cnt: Record<string, number>;
};
export type BancadaPessoa = { id: string; nome: string; partido: string | null; casas: Casa2[]; autor: boolean };
/** Faltas de um mês: [faltas, ausências justificadas, sessões com o parlamentar em exercício]. */
export type PresencaCelula = [number, number, number];
export type Bancada = { pessoas: BancadaPessoa[]; presenca: Record<string, Record<string, PresencaCelula>> };
export type VotosAno = { m: Record<Casa2, string[]>; v: Record<string, string> };
/** [id da votação, voto, marcas]; marcas: 1 contra a maioria, 2 contra o partido, 4 contra o governo, 8 governo orientou, 16 partido com maioria. */
export type VotoLinha = [string, VotoCode, number];
export const FLAG = { contraMaioria: 1, contraPartido: 2, contraGoverno: 4, governoOrientou: 8, partidoMaioria: 16 } as const;
export type VotacoesMeta = {
  generated_at: string;
  inicio: string;
  anos: number[];
  votacoes: Record<Casa2, Record<string, number>>;
  sessoes: Record<Casa2, Record<string, number>>;
  com_orientacao_governo: Record<Casa2, number>;
  votos: number;
  sources: Source[];
  stats: { senado_descartadas?: { total: number; abertas: number; por_ano: Record<string, number>; ultima: string | null }; camara_votos_completados?: Record<string, number> };
};

const commonCache = new Map<string, Promise<unknown>>();
function common<T>(file: string, fallback: T): Promise<T> {
  let pending = commonCache.get(file) as Promise<T> | undefined;
  if (!pending) {
    pending = fetch(commonDataUrl(file))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`${file}: HTTP ${response.status}`);
        }
        return response.json() as Promise<T>;
      })
      .catch(() => fallback);
    commonCache.set(file, pending);
  }
  return pending;
}

type IdxRow = [string, string, string, string, string | null, number, number, number, number, string | null, string | null];
let indexPromise: Promise<VotacaoIdx[]> | null = null;
/** Todas as votações, da mais recente para a mais antiga. */
export function loadVotacoesIndex(): Promise<VotacaoIdx[]> {
  if (!indexPromise) {
    indexPromise = common<IdxRow[]>("index.generated.json", []).then((rows) =>
      rows.map(([id, data, titulo, tipo, r, sim, nao, abst, obst, governo, prop]) => ({
        id,
        casa: id.startsWith("s:") ? "senado" : "camara",
        data,
        titulo,
        tipo,
        resultado: r === "a" ? "aprovado" : r === "r" ? "rejeitado" : null,
        sim,
        nao,
        abst,
        obst,
        governo,
        prop
      }))
    );
  }
  return indexPromise;
}
export function loadVotacoesAno(ano: string | number): Promise<Record<string, VotacaoDetalhe>> {
  return common<Record<string, VotacaoDetalhe>>(`${ano}.generated.json`, {});
}
export function loadProposicoes(): Promise<Record<string, [string, string]>> {
  return common<Record<string, [string, string]>>("proposicoes.generated.json", {});
}
export function loadVotacoesMeta(): Promise<VotacoesMeta | null> {
  return common<VotacoesMeta | null>("meta.generated.json", null);
}
export function loadBancada(): Promise<Bancada> {
  return lazy<Bancada>("static-bancada.generated.json", { pessoas: [], presenca: {} });
}
export function loadVotosAno(ano: string | number): Promise<VotosAno> {
  return lazy<VotosAno>(`static-votos/${ano}.generated.json`, { m: { camara: [], senado: [] }, v: {} });
}
type ParlamentarFile = Partial<Record<Casa2, [number, string, string]>>;
const FLAG_CHARS = "0123456789abcdefghijklmnopqrstuv";
type Ordem = { casas: Record<Casa2, string[]>; rank: Map<string, number> };
let ordinalPromise: Promise<Ordem> | null = null;
/** Votações de cada casa da mais antiga para a mais recente: a posição é o índice nos arquivos por
 * parlamentar. `rank` é a posição no índice (mais recente primeiro). */
function ordinais(): Promise<Ordem> {
  if (!ordinalPromise) {
    ordinalPromise = loadVotacoesIndex().then((index) => {
      const casas: Record<Casa2, string[]> = { camara: [], senado: [] };
      for (let i = index.length - 1; i >= 0; i -= 1) {
        casas[index[i].casa].push(index[i].id);
      }
      return { casas, rank: new Map(index.map((item, position) => [item.id, position])) };
    });
  }
  return ordinalPromise;
}
/** Votos de um parlamentar, da votação mais recente para a mais antiga. */
export function loadVotosParlamentar(id: string): Promise<VotoLinha[]> {
  return Promise.all([lazy<ParlamentarFile>(`static-parlamentares/${id}.generated.json`, {}), ordinais()]).then(([file, ordem]) => {
    const rows: VotoLinha[] = [];
    for (const casa of ["camara", "senado"] as Casa2[]) {
      const entry = file[casa];
      if (!entry) continue;
      const [start, codes, flags] = entry;
      for (let i = 0; i < codes.length; i += 1) {
        const code = codes[i] as VotoCode;
        const vid = ordem.casas[casa][start + i];
        if (code !== "." && vid) {
          rows.push([vid, code, FLAG_CHARS.indexOf(flags[i] ?? "0")]);
        }
      }
    }
    return rows.sort((a, b) => (ordem.rank.get(a[0]) ?? 0) - (ordem.rank.get(b[0]) ?? 0));
  });
}

/** "Sim" ou "Não" venceu: aprovado em verde, rejeitado em vermelho, sem resultado em cinza. */
export function resultadoClass(resultado: string | null): string {
  return resultado === "aprovado" ? "voto-sim" : resultado === "rejeitado" ? "voto-nao" : "faint";
}
export function votoClass(code: string): string {
  return code === "S" ? "voto-sim" : code === "N" ? "voto-nao" : "faint";
}
export function formatDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}
export function formatPct(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "–" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value * 100)}%`;
}
/** Ementa em caixa de frase (as da Câmara vêm às vezes em caixa alta). */
export function ementaCase(text: string | null | undefined): string {
  const value = text ?? "";
  return value && value === value.toUpperCase() ? value.toLowerCase().replace(/^\p{L}/u, (c) => c.toUpperCase()) : value;
}

/** Resumo dos votos de um parlamentar num recorte. */
export type ResumoVotos = {
  votacoes: number;
  votou: number;
  presidindo: number;
  sim: number;
  nao: number;
  comMaioria: number;
  simOuNao: number;
  contraPartido: number;
  partidoBase: number;
  contraGoverno: number;
  governoBase: number;
  ausente: number;
  justificada: number;
  presenteSemVoto: number;
};
export function resumoVotos(linhas: VotoLinha[]): ResumoVotos {
  const r: ResumoVotos = { votacoes: 0, votou: 0, presidindo: 0, sim: 0, nao: 0, comMaioria: 0, simOuNao: 0, contraPartido: 0, partidoBase: 0, contraGoverno: 0, governoBase: 0, ausente: 0, justificada: 0, presenteSemVoto: 0 };
  for (const [, code, flags] of linhas) {
    r.votacoes += 1;
    if (code === "S" || code === "N" || code === "A" || code === "O") {
      r.votou += 1;
    }
    if (code === "P") r.presidindo += 1;
    if (code === "F") r.ausente += 1;
    if (code === "J") r.justificada += 1;
    if (code === "X") r.presenteSemVoto += 1;
    if (code === "S" || code === "N") {
      r.simOuNao += 1;
      if (code === "S") r.sim += 1;
      else r.nao += 1;
      if (!(flags & FLAG.contraMaioria)) r.comMaioria += 1;
      if (flags & FLAG.partidoMaioria) {
        r.partidoBase += 1;
        if (flags & FLAG.contraPartido) r.contraPartido += 1;
      }
      if (flags & FLAG.governoOrientou) {
        r.governoBase += 1;
        if (flags & FLAG.contraGoverno) r.contraGoverno += 1;
      }
    }
  }
  return r;
}
