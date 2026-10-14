import type { Metadata } from "next";
import { AutoresExplorer } from "@/components/AutoresExplorer";

export const metadata: Metadata = { title: "Autores" };

export default function AutoresPage() {
  return <AutoresExplorer />;
}
