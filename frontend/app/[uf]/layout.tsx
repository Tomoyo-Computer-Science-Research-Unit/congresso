import type { Metadata } from "next";
import { DEFAULT_UF, UFS, doEstado, ufByCode } from "@/lib/uf";

// As 26 UFs fora do RJ moram em /<uf>/ com as mesmas telas; o RJ fica na raiz.
export const dynamicParams = false;

export function generateStaticParams() {
  return UFS.filter((uf) => uf.code !== DEFAULT_UF.code).map((uf) => ({ uf: uf.code.toLowerCase() }));
}

export async function generateMetadata({ params }: { params: Promise<{ uf: string }> }): Promise<Metadata> {
  const uf = ufByCode((await params).uf) ?? DEFAULT_UF;
  const description = `Emendas parlamentares da bancada federal ${doEstado(uf)} desde 2015: quem enviou, quanto, para onde e em quê, a partir do Portal da Transparência.`;
  return { description, keywords: [uf.nome, "emendas parlamentares", "favorecidos", "orçamento", "Portal da Transparência"], alternates: { canonical: `/${uf.code.toLowerCase()}/` } };
}

export default function UfLayout({ children }: { children: React.ReactNode }) {
  return children;
}
