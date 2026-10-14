import { usePathname } from "next/navigation";
import { ufFromPath, type UfInfo } from "@/lib/uf";

/** UF da página atual (só em componentes cliente). */
export function useUf(): UfInfo {
  return ufFromPath(usePathname());
}
