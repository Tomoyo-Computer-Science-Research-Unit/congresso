"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { ufPrefix } from "@/lib/uf";
import { useUf } from "@/lib/use-uf";

/** next/link que mantém a UF da página: "/autores?autor=x" vira "/sp/autores?autor=x" em SP. */
export default function UfLink({ href, ...rest }: ComponentProps<typeof Link>) {
  const uf = useUf();
  const target = typeof href === "string" && href.startsWith("/") ? `${ufPrefix(uf)}${href === "/" && ufPrefix(uf) ? "/" : href}` : href;
  return <Link href={target} {...rest} />;
}
