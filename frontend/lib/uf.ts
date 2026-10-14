/**
 * O que muda de uma UF para outra: nomes, a bancada estadual e os textos que citam o estado.
 * Um build serve uma UF só, escolhida por NEXT_PUBLIC_UF ("RJ" padrão, "SP"); os dados vêm de
 * data/<uf> pelo alias "@uf-data" (next.config.js). Telas e painéis são os mesmos nas duas.
 */

export type UfCode = "RJ" | "SP";

type UfInfo = {
  code: UfCode;
  /** "Rio de Janeiro" */
  nome: string;
  /** "do" / "de": "Estado do Rio de Janeiro", "Bancada de São Paulo" */
  preposicao: string;
  /** "pelo" / "por": "mandato pelo Rio de Janeiro" */
  pelo: string;
  /** autor coletivo das emendas de bancada (RP 7) */
  bancadaId: string;
  bancadaSiafi: string;
  /** Exemplo real do índice nacional de homônimos, para a página Método. */
  homonimos: string;
};

const UFS: Record<UfCode, UfInfo> = {
  RJ: {
    code: "RJ",
    nome: "Rio de Janeiro",
    preposicao: "do",
    pelo: "pelo",
    bancadaId: "bancada-rj",
    bancadaSiafi: "7120",
    homonimos: "o “Bebeto” de 2016 a 2019 é da Bahia e fica fora; o de 2024 a 2026 é do Rio."
  },
  SP: {
    code: "SP",
    nome: "São Paulo",
    preposicao: "de",
    pelo: "por",
    bancadaId: "bancada-sp",
    bancadaSiafi: "7125",
    homonimos:
      "o único nome paulista que aparece também fora da bancada é “Roberto Freire”, deputado por SP e, na mesma pessoa, suplente de senador por Pernambuco na legislatura 54; as 17 linhas dele, de 2015, ficam."
  }
};

const raw = (process.env.NEXT_PUBLIC_UF ?? "RJ").toUpperCase();
export const UF: UfInfo = UFS[(raw in UFS ? raw : "RJ") as UfCode];
export const UF_CODES: UfCode[] = ["RJ", "SP"];

/** "Bancada do RJ" / "Bancada de SP": rótulo curto do autor coletivo. */
export const BANCADA_CURTA = `Bancada ${UF.preposicao} ${UF.code}`;
/** "Bancada do Rio de Janeiro" */
export const BANCADA_NOME = `Bancada ${UF.preposicao} ${UF.nome}`;
/** "do Rio de Janeiro" / "de São Paulo" */
export const DO_ESTADO = `${UF.preposicao} ${UF.nome}`;

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
/** Raiz do projeto, comum às UFs: o RJ mora nela, as outras em <raiz>/<uf>. */
export const PROJECT_ROOT = UF.code === "RJ" ? BASE_PATH : BASE_PATH.replace(new RegExp(`/${UF.code.toLowerCase()}$`), "");

/** Endereço absoluto (com basePath) de uma tela noutra UF; `path` começa com "/". */
export function ufHref(code: UfCode, path = "/"): string {
  const base = code === "RJ" ? PROJECT_ROOT : `${PROJECT_ROOT}/${code.toLowerCase()}`;
  return `${base}${path.endsWith("/") ? path : `${path}/`}`;
}
