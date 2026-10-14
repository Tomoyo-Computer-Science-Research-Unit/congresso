// Copia os dados gerados pelo ETL (data/<uf>/ e data/votacoes/) para public/data/, de onde o site os busca com
// fetch. public/data não vai para o git; data/ vai. Roda antes de `next dev` e `next build`.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const src = join(root, "data");
const dest = join(root, "public", "data");
rmSync(dest, { recursive: true, force: true });
for (const entry of readdirSync(join(root, "public"))) {
  if (/^[a-z]{2}$/.test(entry)) {
    rmSync(join(root, "public", entry), { recursive: true, force: true });
  }
}
let n = 0;
for (const uf of readdirSync(src)) {
  const dir = join(src, uf);
  if (!statSync(dir).isDirectory() || !existsSync(join(dir, "static-data.generated.json"))) {
    continue;
  }
  cpSync(dir, join(dest, uf), { recursive: true });
  n += 1;
  // status.json vazio por UF (o RJ usa public/status.json); no servidor o build escreve o de verdade
  // e o rsync não o sobrescreve.
  if (uf !== "rj") {
    mkdirSync(join(root, "public", uf), { recursive: true });
    cpSync(join(root, "public", "status.json"), join(root, "public", uf, "status.json"));
  }
}
// Votações e ementas comuns às 27 UFs (data/votacoes, escrito por app.etl.export_votos).
if (existsSync(join(src, "votacoes"))) {
  cpSync(join(src, "votacoes"), join(dest, "votacoes"), { recursive: true });
}
console.log(`stage-data: ${n} UFs em public/data`);
