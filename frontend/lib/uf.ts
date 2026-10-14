/**
 * As 27 UFs num build só. O RJ mora na raiz do site (/emendas/), as demais em /emendas/<uf>/;
 * a UF da página vem do primeiro segmento do caminho. A lista sai do backend (data/ufs.json,
 * gerado de backend/app/config.py) e os dados de cada UF são JSON estáticos em
 * <basePath>/data/<uf>/, buscados quando a tela pede (lib/static-api.ts).
 */

import ufsJson from "@/data/ufs.json";

export type UfCode = string;

export type UfInfo = {
  code: UfCode;
  /** "Rio de Janeiro" */
  nome: string;
  /** "do" / "da" / "de": "Estado do Rio de Janeiro", "Bancada de São Paulo" */
  preposicao: string;
  /** "pelo" / "pela" / "por": "mandato pelo Rio de Janeiro" */
  pelo: string;
  /** autor coletivo das emendas de bancada (RP 7) */
  bancadaId: string;
  bancadaSiafi: string;
};

/** Ordem do seletor: RJ, depois as demais por nome. */
export const UFS: UfInfo[] = ufsJson as UfInfo[];
export const DEFAULT_UF: UfInfo = UFS.find((uf) => uf.code === "RJ") ?? UFS[0];
const BY_CODE = new Map(UFS.map((uf) => [uf.code.toLowerCase(), uf]));

/** Exemplos reais do índice nacional de homônimos, escritos à mão onde foram conferidos. */
export const HOMONIMOS: Record<string, string> = {
  RJ: "o “Bebeto” de 2016 a 2019 é da Bahia e fica fora; o de 2024 a 2026 é do Rio.",
  SP: "o único nome paulista que aparece também fora da bancada é “Roberto Freire”, deputado por SP e, na mesma pessoa, suplente de senador por Pernambuco na legislatura 54; as 17 linhas dele, de 2015, ficam."
};

export function ufByCode(code: string | null | undefined): UfInfo | undefined {
  return code ? BY_CODE.get(code.toLowerCase()) : undefined;
}

/** UF de um caminho sem basePath: "/sp/autores" -> SP; "/autores" -> RJ. */
export function ufFromPath(pathname: string | null | undefined): UfInfo {
  const first = (pathname ?? "/").split("/").filter(Boolean)[0];
  const uf = ufByCode(first);
  return uf && uf.code !== DEFAULT_UF.code ? uf : DEFAULT_UF;
}

/** Tela de um caminho, sem o prefixo da UF: "/sp/autores" -> "/autores". */
export function screenFromPath(pathname: string | null | undefined): string {
  const path = pathname ?? "/";
  const uf = ufFromPath(path);
  const rest = uf.code === DEFAULT_UF.code ? path : path.replace(new RegExp(`^/${uf.code.toLowerCase()}(?=/|$)`), "");
  return rest.replace(/\/+$/, "") || "/";
}

/** Prefixo de rota (sem basePath): "" no RJ, "/sp" em SP. */
export function ufPrefix(uf: UfInfo): string {
  return uf.code === DEFAULT_UF.code ? "" : `/${uf.code.toLowerCase()}`;
}

/** Rota de uma tela numa UF, para Link e router.push (o basePath entra sozinho). */
export function ufRoute(uf: UfInfo, screen = "/"): string {
  const path = `${ufPrefix(uf)}${screen === "/" ? "" : screen}`;
  return path ? (path.endsWith("/") ? path : `${path}/`) : "/";
}

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Endereço de um arquivo de dados da UF: <basePath>/data/<uf>/<file>. */
export function dataUrl(uf: UfInfo, file: string): string {
  return `${BASE_PATH}/data/${uf.code.toLowerCase()}/${file}`;
}

/** Endereço do status.json da UF, escrito pelo build no servidor. */
export function statusUrl(uf: UfInfo): string {
  return `${BASE_PATH}${ufPrefix(uf)}/status.json`;
}

/** "Bancada do RJ" / "Bancada de SP": rótulo curto do autor coletivo. */
export function bancadaCurta(uf: UfInfo): string {
  return `Bancada ${uf.preposicao} ${uf.code}`;
}

/** "do Rio de Janeiro" / "de São Paulo" */
export function doEstado(uf: UfInfo): string {
  return `${uf.preposicao} ${uf.nome}`;
}
