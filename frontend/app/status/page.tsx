import type { Metadata } from "next";
import { StatusScreen } from "@/components/StatusScreen";
import { getMeta, getSources } from "@/lib/static-api";

export const metadata: Metadata = { title: "Status" };

export default function StatusPage() {
  const meta = getMeta();
  return <StatusScreen generatedAt={meta.generated_at} latestYear={meta.latest_year} sources={getSources()} />;
}
