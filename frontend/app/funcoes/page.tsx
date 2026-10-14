import type { Metadata } from "next";
import { FuncoesExplorer } from "@/components/FuncoesExplorer";

export const metadata: Metadata = { title: "Funções" };

export default function FuncoesPage() {
  return <FuncoesExplorer />;
}
