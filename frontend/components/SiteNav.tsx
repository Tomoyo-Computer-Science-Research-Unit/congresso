"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { screenFromPath, ufRoute } from "@/lib/uf";
import { useUf } from "@/lib/use-uf";

export const NAV_ITEMS = [
  { href: "/", label: "Panorama", key: "1" },
  { href: "/autores", label: "Autores", key: "2" },
  { href: "/votacoes", label: "Votações", key: "3" },
  { href: "/presenca", label: "Presença", key: "4" },
  { href: "/destinos", label: "Destinos", key: "5" },
  { href: "/funcoes", label: "Funções", key: "6" },
  { href: "/favorecidos", label: "Favorecidos", key: "7" },
  { href: "/metodologia", label: "Método", key: "8" }
];

export function isActivePath(fullPath: string, href: string) {
  const pathname = screenFromPath(fullPath);
  if (href === "/") {
    return pathname === "/";
  }
  if (href === "/metodologia") {
    return pathname.startsWith("/metodologia") || pathname.startsWith("/status");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteNav() {
  const pathname = usePathname();
  const uf = useUf();

  return (
    <nav aria-label="Seções" className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="flex items-center">
        {NAV_ITEMS.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={ufRoute(uf, item.href)}
                aria-current={active ? "page" : undefined}
                className={`flex h-12 items-center px-[7px] text-[10.5px] font-medium uppercase tracking-[0.06em] transition-colors 2xl:px-3 2xl:text-[11px] 2xl:tracking-[0.14em] ${
                  active ? "text-ink shadow-[inset_0_-1px_0_var(--ink)]" : "text-slate hover:text-ink"
                }`}
              >
                <span className="kbd !mr-1">{item.key}</span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
