import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Emendas",
    short_name: "Emendas",
    description: "Emendas parlamentares da bancada federal do Rio de Janeiro, a partir do Portal da Transparência.",
    start_url: "/",
    display: "standalone",
    background_color: "#050505",
    theme_color: "#050505",
    icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }]
  };
}
