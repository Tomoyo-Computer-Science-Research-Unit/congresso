const path = require("path");

// Um código, uma UF por build. NEXT_PUBLIC_UF escolhe a pasta de dados (data/rj, data/sp) e o
// endereço: o RJ mora em g0v.tomoyo.systems/emendas, SP em /emendas/sp.
// NEXT_PUBLIC_BASE_PATH="" serve na raiz (testes).
const uf = (process.env.NEXT_PUBLIC_UF || "RJ").toUpperCase();
if (!["RJ", "SP"].includes(uf)) {
  throw new Error(`NEXT_PUBLIC_UF desconhecida: ${uf}`);
}
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? (uf === "RJ" ? "/emendas" : `/emendas/${uf.toLowerCase()}`);
const dataDir = path.join(__dirname, "data", uf.toLowerCase());

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_UF: uf
  },
  webpack(config) {
    // "@uf-data/..." aponta para os arquivos gerados da UF deste build. Fica fora do tsconfig de
    // propósito: lá ele venceria o alias. Os tipos são os de lib/static-api.ts (types/uf-data.d.ts).
    config.resolve.alias = { ...config.resolve.alias, "@uf-data": dataDir };
    // O cache em disco do webpack não vê a troca do alias: sem um nome por UF, um build de SP logo
    // depois de um do RJ reaproveitava os módulos do RJ.
    if (config.cache && typeof config.cache === "object" && config.cache.type === "filesystem") {
      config.cache.name = `${config.cache.name || config.name || "build"}-${uf.toLowerCase()}`;
    }
    return config;
  }
};

module.exports = nextConfig;
