/**
 * Camada de dados do site. Tudo vem de `static-data.generated.json` (núcleo) mais um arquivo por
 * autor (`static-autores/<id>`) e por município (`static-destinos/<ibge>`), carregados quando a
 * tela pede. Valores em reais nominais por ano orçamentário; `pago_total` = pago no ano + restos
 * a pagar pagos depois.
 */

import snapshot from "@/lib/static-data.generated.json";

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
export type FavorecidoRef = { codigo: string; slug: string; nome: string; tipo: string | null; valor: number };
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
  outros_destinos: Record<string, Totais>;
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

const DATA = snapshot as unknown as Core;

export type Metric = "empenhado" | "pago_total";
export const METRICS: Array<{ key: Metric; label: string }> = [
  { key: "empenhado", label: "Empenhado" },
  { key: "pago_total", label: "Pago" }
];
export const TIPO_LABELS: Record<string, string> = {
  FD: "Individual, finalidade definida",
  TE: "Individual, transferência especial",
  BC: "Bancada do RJ"
};
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
    generated_at: DATA.generated_at,
    snapshot_generated_at: DATA.snapshot_generated_at,
    years: DATA.years,
    latest_year: DATA.latest_year,
    totais: DATA.totais
  };
}
export function getYears(): number[] {
  return DATA.years;
}
export function getTotals(): Totais {
  return DATA.totais;
}
export function getByYear(): Record<string, Totais> {
  return DATA.por_ano;
}
export function getByTipo(): Record<string, Totais> {
  return DATA.por_tipo;
}
export function getByTipoYear(): Record<string, Record<string, Brief>> {
  return DATA.por_tipo_ano;
}
export function getOutrosDestinos(): Record<string, Totais> {
  return DATA.outros_destinos;
}
export function getAutores(): Autor[] {
  return DATA.autores;
}
export function getAutor(id: string): Autor | undefined {
  return DATA.autores.find((autor) => autor.id === id);
}
export function getRosterSemEmendas(): RosterPerson[] {
  return DATA.roster_sem_emendas;
}
export function getDestinos(): Destino[] {
  return DATA.destinos;
}
export function getDestino(ibge: string): Destino | undefined {
  return DATA.destinos.find((destino) => destino.ibge === ibge);
}
export function getFuncoes(): Funcao[] {
  return DATA.funcoes;
}
export function getFuncao(nome: string): Funcao | undefined {
  return DATA.funcoes.find((funcao) => funcao.nome === nome);
}
export function getFavorecidos(): Favorecido[] {
  return DATA.favorecidos ?? [];
}
export function getFavorecido(slug: string): Favorecido | undefined {
  return DATA.favorecidos?.find((item) => item.slug === slug);
}
export function getFavorecidosPorTipo() {
  return DATA.favorecidos_por_tipo ?? {};
}
export function getFavorecidosPorNatureza() {
  return DATA.favorecidos_por_natureza ?? {};
}
export function getIpca(): Ipca {
  return DATA.ipca;
}
/** Banco do Brasil aparece como favorecido dos repasses fundo a fundo do SUS; não é destinatário final. */
export const BB_CODIGO = "00000000000191";
export function getSources(): Source[] {
  return DATA.sources;
}
export function getStats(): Record<string, unknown> {
  return DATA.stats;
}

/** Valor de um grupo num ano ("all" = todos) para a métrica. */
export function valueFor(porAno: Record<string, Brief>, totais: Brief | Totais, year: number | "all", metric: Metric): number {
  if (year === "all") {
    return totais[metric];
  }
  return porAno[String(year)]?.[metric] ?? 0;
}

/** Nome curto para listas: nome parlamentar quando existe. */
export function displayName(autor: Pick<Autor, "nome" | "nome_parlamentar">): string {
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

const linhasAutor = new Map<string, Linha[]>();
const linhasDestino = new Map<string, Linha[]>();
let geo: GeoFeatureCollection | null = null;

export async function loadLinhasAutor(id: string): Promise<Linha[]> {
  const cached = linhasAutor.get(id);
  if (cached) {
    return cached;
  }
  try {
    const module = (await import(`@/lib/static-autores/${id}.generated.json`)) as { default?: Linha[] };
    const lines = (module.default ?? module) as Linha[];
    linhasAutor.set(id, lines);
    return lines;
  } catch {
    linhasAutor.set(id, []);
    return [];
  }
}

export async function loadLinhasDestino(ibge: string): Promise<Linha[]> {
  const cached = linhasDestino.get(ibge);
  if (cached) {
    return cached;
  }
  try {
    const module = (await import(`@/lib/static-destinos/${ibge}.generated.json`)) as { default?: Linha[] };
    const lines = (module.default ?? module) as Linha[];
    linhasDestino.set(ibge, lines);
    return lines;
  } catch {
    linhasDestino.set(ibge, []);
    return [];
  }
}

const recebimentosCache = new Map<string, Recebimento[]>();

export async function loadRecebimentos(slug: string): Promise<Recebimento[]> {
  const cached = recebimentosCache.get(slug);
  if (cached) {
    return cached;
  }
  try {
    const module = (await import(`@/lib/static-favorecidos/${slug}.generated.json`)) as { default?: Recebimento[] };
    const rows = (module.default ?? module) as Recebimento[];
    recebimentosCache.set(slug, rows);
    return rows;
  } catch {
    recebimentosCache.set(slug, []);
    return [];
  }
}

export async function loadGeo(): Promise<GeoFeatureCollection> {
  if (geo) {
    return geo;
  }
  const module = (await import("@/lib/static-geo.generated.json")) as { default?: GeoFeatureCollection };
  geo = (module.default ?? module) as GeoFeatureCollection;
  return geo;
}

/** Série anual completa (anos sem emenda viram zero), para os gráficos de barras. */
export function yearPoints(porAno: Record<string, Brief>, years: number[]): Array<{ year: number; empenhado: number; pago_total: number; n: number }> {
  return years.map((year) => {
    const brief = porAno[String(year)];
    return { year, empenhado: brief?.empenhado ?? 0, pago_total: brief?.pago_total ?? 0, n: brief?.n ?? 0 };
  });
}
