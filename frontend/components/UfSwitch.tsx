"use client";

import { usePathname } from "next/navigation";
import { UF, UF_CODES, ufHref } from "@/lib/uf";

/** RJ | SP no canto direito do cabeçalho. Cada UF é um build próprio, então troca por link comum. */
export function UfSwitch() {
  const pathname = usePathname();
  return (
    <span className="flex shrink-0 items-center">
      <span className="kbd" title="U alterna a UF">
        U
      </span>
      <nav className="segmented" aria-label="UF">
        {UF_CODES.map((code) => (
          <a key={code} href={ufHref(code, pathname || "/")} aria-current={code === UF.code ? "page" : undefined} title={code === UF.code ? undefined : `Ver ${code}`}>
            {code}
          </a>
        ))}
      </nav>
    </span>
  );
}
