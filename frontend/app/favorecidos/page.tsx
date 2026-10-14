import type { Metadata } from "next";
import { FavorecidosExplorer } from "@/components/FavorecidosExplorer";

export const metadata: Metadata = { title: "Favorecidos" };

export default function FavorecidosPage() {
  return <FavorecidosExplorer />;
}
