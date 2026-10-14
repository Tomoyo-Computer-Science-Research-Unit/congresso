import type { MetadataRoute } from "next";
import { ufRoute, UFS } from "@/lib/uf";

export const dynamic = "force-static";

const baseUrl = `https://g0v.tomoyo.systems${process.env.NEXT_PUBLIC_BASE_PATH ?? "/congresso"}`;
const screens = ["/", "/autores", "/votacoes", "/presenca", "/destinos", "/funcoes", "/favorecidos", "/metodologia", "/status"];

export default function sitemap(): MetadataRoute.Sitemap {
  return UFS.flatMap((uf) =>
    screens.map((screen) => ({ url: `${baseUrl}${ufRoute(uf, screen)}`, changeFrequency: "weekly" as const, priority: screen === "/" ? 1 : 0.8 }))
  );
}
