"use client";

import { usePathname, useRouter } from "next/navigation";
import { UFS, screenFromPath, ufByCode, ufRoute } from "@/lib/uf";
import { useUf } from "@/lib/use-uf";

/** Seletor de UF no canto direito do cabeçalho, à esquerda do tema. Troca de UF na mesma tela. */
export function UfSwitch() {
  const router = useRouter();
  const pathname = usePathname();
  const uf = useUf();
  return (
    <span className="flex shrink-0 items-center">
      <span className="kbd" title="U passa para a próxima UF">
        U
      </span>
      <select
        className="yearselect"
        aria-label="UF"
        value={uf.code}
        onChange={(event) => {
          const next = ufByCode(event.target.value);
          event.currentTarget.blur(); // as teclas da tela voltam a valer depois da troca
          if (next) {
            router.push(ufRoute(next, screenFromPath(pathname)));
          }
        }}
      >
        {UFS.map((item) => (
          <option key={item.code} value={item.code}>
            {item.nome}
          </option>
        ))}
      </select>
    </span>
  );
}
