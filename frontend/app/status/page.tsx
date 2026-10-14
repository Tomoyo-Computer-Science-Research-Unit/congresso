import type { Metadata } from "next";
import { StatusScreen } from "@/components/StatusScreen";

export const metadata: Metadata = { title: "Status" };

export default function StatusPage() {
  return <StatusScreen />;
}
