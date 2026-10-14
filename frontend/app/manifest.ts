import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Congresso",
    short_name: "Congresso",
    description: "Deputados federais e senadores das 27 UFs: emendas parlamentares, votações nominais e faltas em plenário, a partir do Portal da Transparência, da Câmara e do Senado.",
    start_url: "/",
    display: "standalone",
    background_color: "#050505",
    theme_color: "#050505",
    icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }]
  };
}
