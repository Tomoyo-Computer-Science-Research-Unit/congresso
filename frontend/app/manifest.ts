import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Emendas RJ",
    short_name: "Emendas RJ",
    description: "Emendas parlamentares da bancada federal do Rio de Janeiro, a partir do Portal da Transparência.",
    start_url: "/",
    display: "standalone",
    background_color: "#050505",
    theme_color: "#050505",
    icons: [{ src: "/mon.svg", sizes: "any", type: "image/svg+xml" }]
  };
}
