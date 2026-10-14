import type { Metadata } from "next";
import Link from "next/link";
import { Panel, Screen } from "@/components/ui";
import { BB_CODIGO, CASA_LABELS, formatBRL, formatInt, getFavorecidos, getIpca, getMeta, getRosterSemEmendas, getSources, getStats, getTotals, niceName } from "@/lib/static-api";
import { BANCADA_CURTA, UF } from "@/lib/uf";

export const metadata: Metadata = { title: "Método" };

function sourceLabel(name: string): string {
  const camara = name.match(/^camara deputados ([A-Z]{2}) leg (\d+)$/);
  if (camara) {
    return `Câmara, deputados ${UF.preposicao} ${camara[1]}, legislatura ${camara[2]}`;
  }
  const senado = name.match(/^senado lista legislatura (\d+)$/);
  if (senado) {
    return `Senado, legislatura ${senado[1]}`;
  }
  if (name.includes("favorecido")) {
    return "Portal da Transparência, pagamentos por favorecido";
  }
  return name.replace("Portal da Transparencia - Emendas parlamentares (bulk zip)", "Portal da Transparência, emendas parlamentares");
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-4 border-t border-line py-2.5 text-[11.5px] leading-5">
      <span className="serif text-[13px] leading-5 text-ink">{term}</span>
      <span className="text-sumi">{children}</span>
    </div>
  );
}

export default function MethodPage() {
  const meta = getMeta();
  const sources = getSources();
  const roster = getRosterSemEmendas();
  const stats = getStats() as { rows_total?: number; roster_size?: number; roster_matched?: number; favorecidos?: { rows?: number; favorecidos?: number; total_recebido?: number } };
  const ipca = getIpca();
  const ipcaBase = `${ipca.base_month.slice(5, 7)}/${ipca.base_month.slice(0, 4)}`;
  const zip = sources[0];
  const accessed = zip?.accessed_at ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(zip.accessed_at)) : "–";
  const favStats = stats.favorecidos ?? {};
  const favTotal = formatBRL(favStats.total_recebido ?? getFavorecidos().reduce((sum, item) => sum + item.total, 0));
  const pagoTotal = formatBRL(getTotals().pago_total);
  const bb = getFavorecidos().find((item) => item.codigo === BB_CODIGO);
  const bbShare = bb && favStats.total_recebido ? Math.round((bb.total / favStats.total_recebido) * 100) : null;

  return (
    <Screen columns="minmax(0, 1.2fr) minmax(0, 0.9fr) minmax(0, 1fr)" rows="minmax(0, 1fr)">
      <Panel title={<b>Como os números chegam aqui</b>} aside={<span className="text-[10px] tracking-[0.14em] text-ash">lido em {accessed}</span>} fill>
        <Row term="Fonte">
          Portal da Transparência (CGU), download “Emendas parlamentares”, regenerado a partir do SIAFI: {formatInt(stats.rows_total)} linhas, orçamentos de {meta.years[0] - 1} a{" "}
          {meta.latest_year}. Uma linha é uma emenda numa ação orçamentária e numa localidade; a mesma emenda pode ter várias.
        </Row>
        <Row term="Valores">
          Execução no ano orçamentário da emenda, em reais. Empenhado é o que foi reservado. Pago soma o pago no ano com os restos a pagar pagos depois: o que saiu do Tesouro até a
          data do arquivo. O ano corrente tem pouco pago; anos antigos mostram pagamentos posteriores.
        </Row>
        <Row term="Reais de hoje">
          Corrigidos pelo IPCA (IBGE, SIDRA 1737) para {ipcaBase}: fator do ano = índice de {ipcaBase} ÷ média mensal do índice no ano. Somas de vários anos corrigem ano a ano. O
          corrigido vem em primeiro plano, o nominal e o ano ao lado; a tecla N mostra nominal.
        </Row>
        <Row term="Bancada">
          Quem exerceu mandato federal {UF.pelo} {UF.nome} nas legislaturas 54 a 57 (2011 a 2027), titular ou suplente em exercício, pelas APIs da Câmara e do Senado:{" "}
          {formatInt(stats.roster_size)} pessoas, {formatInt(stats.roster_matched)} com emenda executada.
        </Row>
        <Row term={BANCADA_CURTA}>
          Emendas de bancada estadual (RP 7, código SIAFI {UF.bancadaSiafi}): propostas em nome do conjunto dos deputados e senadores do estado, decididas pela coordenação da bancada,
          impositivas desde 2019 e voltadas a projetos de maior porte. Autor coletivo, sem atribuição a pessoas.
        </Row>
        <Row term="Autor">
          O SIAFI dá um código de quatro dígitos e um nome. O nome, normalizado, é casado com nome civil, parlamentar ou eleitoral de alguém da bancada com mandato na legislatura
          que fez o orçamento daquele ano. Um índice nacional de homônimos descarta coincidências: {UF.homonimos}
        </Row>
        <Row term="Favorecidos">
          O arquivo “por favorecido” do mesmo download: {formatInt(favStats.rows)} pagamentos a {formatInt(favStats.favorecidos)} CNPJs e CPFs (mascarados pelo Portal),
          somando {favTotal} contra {pagoTotal} de pago. A diferença são devoluções, retenções e emendas sem linha de favorecido. O Banco do Brasil é o caixa dos repasses fundo a
          fundo do SUS: {bbShare ?? "–"}% do total aparece em nome dele, não do fundo municipal que recebeu.
        </Row>
        <Row term="Fora">
          O orçamento de 2014, sem autor. Emendas de relator (RP 9) e de comissão (RP 8), sem autor individual. Menos da metade das linhas nomeia município; o resto vai para o
          estado, vários municípios ou a União, e aparece em Destinos como “sem município”.
        </Row>
        <Row term="Código">
          ETL em Python e site estático em Next.js, no repositório{" "}
          <Link href="https://github.com/Tomoyo-Computer-Science-Research-Unit/emendas-rj" className="text-ink underline decoration-fog underline-offset-4 hover:decoration-ink">
            emendas-rj
          </Link>{" "}
          da Tomoyo. Estado da última rodada em <Link href="/status" className="text-ink underline decoration-fog underline-offset-4 hover:decoration-ink">status</Link>.
        </Row>
      </Panel>

      <Panel title={<b>Arquivos lidos</b>} flush fill>
        <table className="ruled">
          <thead>
            <tr>
              <th>Fonte</th>
              <th className="right">Tamanho</th>
              <th className="right">SHA-256</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.name}>
                <td className="whitespace-normal break-words">
                  <a href={source.url} target="_blank" rel="noreferrer" className="text-ink underline decoration-fog underline-offset-4 hover:decoration-ink" title={source.url}>
                    {sourceLabel(source.name)}
                  </a>
                </td>
                <td className="num right faint">{source.size_bytes ? `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(source.size_bytes / 1024 / 1024)} MB` : "–"}</td>
                <td className="right font-mono text-[10px] text-ash">{source.checksum ? source.checksum.replace("sha256:", "").slice(0, 12) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title={<b>Sem emenda executada</b>} aside={<span className="text-[10px] tracking-[0.14em] text-ash">{roster.length} de {formatInt(stats.roster_size)}</span>} flush fill>
        <table className="ruled">
          <tbody>
            {roster.map((person) => (
              <tr key={`${person.nome}-${person.casa}`}>
                <td className="whitespace-normal break-words">{niceName(person.nome_parlamentar || person.nome)}</td>
                <td className="faint">{person.partido}</td>
                <td className="faint">{CASA_LABELS[person.casa ?? ""] ?? person.casa}</td>
                <td className="num faint right">{person.legislaturas.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </Screen>
  );
}
