import type { Metadata } from "next";
import { DestinosExplorer } from "@/components/DestinosExplorer";

export const metadata: Metadata = { title: "Destinos" };

export default function DestinosPage() {
  return <DestinosExplorer />;
}
