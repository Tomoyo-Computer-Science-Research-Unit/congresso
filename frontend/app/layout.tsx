import type { Metadata } from "next";
import { Archivo, Shippori_Mincho_B1 } from "next/font/google";
import Link from "next/link";
import { Fx } from "@/components/Fx";
import { Hotkeys } from "@/components/Hotkeys";
import { Scope } from "@/components/Scope";
import { Shatter } from "@/components/Shatter";
import { SiteNav } from "@/components/SiteNav";
import { StatusBar } from "@/components/StatusBar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MoneyProvider } from "@/lib/money";
import { getMeta } from "@/lib/static-api";
import "./globals.css";

const mincho = Shippori_Mincho_B1({ weight: ["500", "700"], subsets: ["latin"], variable: "--font-mincho", display: "swap" });
const archivo = Archivo({ subsets: ["latin"], weight: "variable", axes: ["wdth"], variable: "--font-archivo", display: "swap" });

export const SITE_NAME = "Emendas";
const DESCRIPTION =
  "Emendas parlamentares da bancada federal do Rio de Janeiro desde 2015: quem enviou, quanto, para onde e em quê, a partir do Portal da Transparência.";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const SITE_URL = `https://g0v.tomoyo.systems${BASE_PATH}`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: "Tomoyo", url: "https://tomoyo.systems" }],
  creator: "Tomoyo",
  publisher: "Tomoyo",
  keywords: ["Rio de Janeiro", "emendas parlamentares", "favorecidos", "orçamento", "Portal da Transparência", "deputados federais", "senadores", "dados públicos"],
  alternates: { canonical: "/" },
  twitter: { card: "summary", title: SITE_NAME, description: DESCRIPTION },
  icons: { icon: `${BASE_PATH}/icon.png`, shortcut: `${BASE_PATH}/icon.png`, apple: `${BASE_PATH}/icon.png` },
  openGraph: { type: "website", locale: "pt_BR", url: SITE_URL, siteName: SITE_NAME, title: SITE_NAME, description: DESCRIPTION, images: [{ url: "/icon.png", width: 512, height: 512, alt: SITE_NAME }] }
};

// O tema segue o sistema e muda junto com ele; T inverte só nesta visita. Aplicado antes da
// primeira pintura para não piscar.
const THEME_SCRIPT = `(() => {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const apply = (dark) => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    window.dispatchEvent(new CustomEvent('pp-theme'));
  };
  apply(media.matches);
  media.addEventListener('change', (e) => apply(e.matches));
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const meta = getMeta();
  const dataDate = meta.snapshot_generated_at ? new Date(meta.snapshot_generated_at) : new Date(meta.generated_at);
  const label = `Portal da Transparência · ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(dataDate)}`;

  return (
    <html
      lang="pt-BR"
      className={`${mincho.variable} ${archivo.variable}`}
      style={{ "--cursor-grab": `url(${BASE_PATH}/cursor-grab.png)`, "--cursor-grabbing": `url(${BASE_PATH}/cursor-grabbing.png)` } as React.CSSProperties}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-paper text-sumi">
        <MoneyProvider>
        <div className="app">
          <header className="app__header">
            <span className="flex shrink-0 items-center gap-3 whitespace-nowrap text-ink" data-brand>
              {/* O mon da Tomoyo leva de volta à home do g0v. */}
              <a href="https://g0v.tomoyo.systems/" aria-label="g0v.tomoyo.systems" data-brand>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${BASE_PATH}/icon-64.png`} alt="" width={30} height={30} className="mon h-[30px] w-[30px] shrink-0 border border-line" data-brand />
              </a>
              <Link href="/" className="wordmark text-[14px] uppercase leading-none" data-brand>
                {SITE_NAME}
              </Link>
            </span>
            <SiteNav />
            <ThemeToggle />
          </header>
          <main className="app__main">{children}</main>
          <StatusBar latestLabel={label} />
        </div>
        </MoneyProvider>
        <Hotkeys />
        <Fx />
        <Scope />
        <Shatter />
      </body>
    </html>
  );
}
