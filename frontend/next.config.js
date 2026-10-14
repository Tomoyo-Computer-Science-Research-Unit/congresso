// O site mora em g0v.tomoyo.systems/emendas: um build só com as 27 UFs (RJ na raiz, as demais em
// /<uf>/). Os dados não entram no bundle: scripts/stage-data.mjs copia data/<uf>/ para
// public/data/<uf>/ e as telas buscam o JSON com fetch. NEXT_PUBLIC_BASE_PATH="" serve na raiz.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/emendas";

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
    NEXT_PUBLIC_BASE_PATH: basePath
  }
};

module.exports = nextConfig;
