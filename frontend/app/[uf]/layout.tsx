import type { Metadata } from "next";
import { DEFAULT_UF, UFS, doEstado, ufByCode } from "@/lib/uf";

// As 26 UFs fora do RJ moram em /<uf>/ com as mesmas telas; o RJ fica na raiz.
export const dynamicParams = false;

export function generateStaticParams() {
  return UFS.filter((uf) => uf.code !== DEFAULT_UF.code).map((uf) => ({ uf: uf.code.toLowerCase() }));
}

export async function generateMetadata({ params }: { params: Promise<{ uf: string }> }): Promise<Metadata> {
  const uf = ufByCode((await params).uf) ?? DEFAULT_UF;
  const description = `A bancada federal ${doEstado(uf)} desde 2015: emendas parlamentares (quem enviou, quanto, para onde e em quê), votações nominais e faltas em plenário, a partir do Portal da Transparência, da Câmara e do Senado.`;
  return { description, keywords: [uf.nome, "emendas parlamentares", "votações nominais", "presença", "favorecidos", "orçamento", "Portal da Transparência"], alternates: { canonical: `/${uf.code.toLowerCase()}/` } };
}

export default function UfLayout({ children }: { children: React.ReactNode }) {
  return children;
}
