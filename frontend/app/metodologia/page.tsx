import type { Metadata } from "next";
import { MethodScreen } from "@/components/MethodScreen";

export const metadata: Metadata = { title: "Método" };

export default function MethodPage() {
  return <MethodScreen />;
}
