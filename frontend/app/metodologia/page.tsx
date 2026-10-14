import type { Metadata } from "next";
import { Panel, Screen } from "@/components/ui";
import { CASA_LABELS, formatBRL, formatInt, getFavorecidos, getIpca, getMeta, getRosterSemEmendas, getSources, getStats, getTotals, niceName } from "@/lib/static-api";

function sourceLabel(name: string): string {
  const camara = name.match(/^camara deputados RJ leg (\d+)$/);
  if (camara) {
    return `Câmara, deputados do RJ, legislatura ${camara[1]}`;
  }
  const senado = name.match(/^senado lista legislatura (\d+)$/);
  if (senado) {
    return `Senado, lista da legislatura ${senado[1]}`;
  }
  return name.replace("Portal da Transparencia - Emendas parlamentares (bulk zip)", "Portal da Transparência, emendas parlamentares");
}

export const metadata: Metadata = { title: "Método" };

function formatBytes(value?: number): string {
  return value ? `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value / 1024 / 1024)} MB` : "–";
}

export default function MethodPage() {
  const meta = getMeta();
  const sources = getSources();
  const roster = getRosterSemEmendas();
  const stats = getStats() as { rows_total?: number; rows_kept?: number };
  const zip = sources[0];
  const ipca = getIpca();
  const ipcaBase = `${ipca.base_month.slice(5, 7)}/${ipca.base_month.slice(0, 4)}`;
  const favStats = ((getStats() as { favorecidos?: { rows_matched?: number; favorecidos?: number; total_recebido?: number } }).favorecidos ?? {}) as { rows_matched?: number; favorecidos?: number; total_recebido?: number };
  const favTotal = formatBRL(favStats.total_recebido ?? getFavorecidos().reduce((sum, item) => sum + item.total, 0));
  const pagoTotal = formatBRL(getTotals().pago_total);
  const accessed = zip?.accessed_at ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(zip.accessed_at)) : "–";

  return (
    <Screen columns="minmax(0, 1fr) 440px" rows="minmax(0, 1fr) minmax(0, 1fr)">
      <Panel title={<b>Método</b>} fill style={{ gridRow: "1 / span 2" }}>
        <div className="max-w-[72ch] space-y-5 text-[12.5px] leading-6 text-sumi">
          <section>
            <h3 className="serif text-[15px] text-ink">Fonte</h3>
            <p>
              Portal da Transparência da Controladoria-Geral da União, download de dados “Emendas parlamentares”, arquivo único regenerado a partir do SIAFI. Esta
              versão foi lida em {accessed}: {formatInt(stats.rows_total)} linhas, orçamentos de {meta.years[0] - 1} a {meta.latest_year}. Cada linha é uma
              emenda numa ação orçamentária e numa localidade de gasto; a mesma emenda pode ocupar mais de uma linha.
            </p>
          </section>
          <section>
            <h3 className="serif text-[15px] text-ink">Valores</h3>
            <p>
              Os valores são a execução da emenda no seu ano orçamentário, em reais nominais, sem correção pela inflação. <em>Empenhado</em> é o que o governo
              reservou para a emenda. <em>Pago</em>, aqui, soma o pago no próprio ano com os restos a pagar pagos em anos seguintes: é o que de fato saiu do
              Tesouro até a data do arquivo. Por isso o ano corrente tem pouco pago, e anos antigos mostram pagamentos que só ocorreram depois.
            </p>
          </section>
          <section>
            <h3 className="serif text-[15px] text-ink">Reais de hoje</h3>
            <p>
              Por padrão os valores aparecem corrigidos pelo IPCA para {ipcaBase}, no modelo do gwern.net: o número grande é o corrigido, e o nominal com o ano
              fica em corpo menor ao lado. O fator de cada ano é o índice de {ipcaBase} dividido pela média mensal do índice naquele ano, porque a execução se
              espalha pelo ano. Somas de vários anos corrigem ano a ano antes de somar. A tecla N mostra tudo em reais nominais. Série: IBGE, SIDRA 1737.
            </p>
          </section>
          <section>
            <h3 className="serif text-[15px] text-ink">Favorecidos</h3>
            <p>
              O arquivo “por favorecido” do mesmo download diz a quem cada ordem bancária foi paga: {formatInt(favStats.rows_matched)} pagamentos a{" "}
              {formatInt(favStats.favorecidos)} CNPJs e CPFs (estes já vêm mascarados pelo Portal), somando {favTotal} contra {pagoTotal} de pago mais restos a pagar
              no arquivo principal; a diferença são devoluções, retenções e emendas pagas sem linha de favorecido. O maior “favorecido” é o Banco do Brasil, com
              36% do total: nos repasses fundo a fundo do SUS a ordem bancária sai em nome do banco, e o fundo municipal que recebeu não aparece nessas linhas. A
              partir de 2025 os fundos municipais passam a constar diretamente.
            </p>
          </section>
          <section>
            <h3 className="serif text-[15px] text-ink">Bancada</h3>
            <p>
              Bancada fluminense é quem exerceu mandato federal pelo Rio de Janeiro, como titular ou suplente em exercício, nas legislaturas 54 a 57 (2011 a 2027).
              A lista vem das APIs de dados abertos da Câmara dos Deputados e do Senado Federal: 158 pessoas, 130 delas com alguma emenda executada. As emendas
              de bancada (código SIAFI 7120, “Bancada do Rio de Janeiro”) entram como um autor coletivo, sem atribuição a pessoas.
            </p>
          </section>
          <section>
            <h3 className="serif text-[15px] text-ink">Autor</h3>
            <p>
              O SIAFI registra o autor por um código de quatro dígitos e um nome, sem o identificador da Câmara ou do Senado. O nome é normalizado (sem acentos,
              pontuação ou diferença de caixa) e casado com o nome civil, parlamentar ou eleitoral de alguém da bancada com mandato na legislatura que fez o
              orçamento daquele ano. Um índice nacional de homônimos descarta coincidências: o código 3028 “Bebeto” (2016 a 2019) é um deputado da Bahia e fica de
              fora; o código 4312 (2024 a 2026) é o deputado do Rio e entra. A mesma pessoa pode ter dois códigos, um por casa ou por mandato; os dois são somados.
            </p>
          </section>
          <section>
            <h3 className="serif text-[15px] text-ink">O que fica de fora</h3>
            <p>
              O orçamento de 2014 não traz autor e não aparece. Emendas de relator (RP 9, o chamado orçamento secreto de 2020 a 2022) e de comissão (RP 8) não têm
              autor individual e ficam de fora mesmo quando gastas no estado. Menos da metade das linhas nomeia um município; o resto é destinado ao estado, a
              vários municípios ou à União, e aparece na soma “fora de município”, não no mapa.
            </p>
          </section>
          <section>
            <h3 className="serif text-[15px] text-ink">Código</h3>
            <p>
              ETL em Python e site estático em Next.js, no repositório da Tomoyo. Os arquivos oficiais usados têm o checksum publicado ao lado.
            </p>
          </section>
        </div>
      </Panel>

      <Panel title={<b>Arquivos</b>} flush fill>
        <table className="ruled">
          <thead>
            <tr>
              <th>Fonte</th>
              <th className="right">Tamanho</th>
              <th>SHA-256</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.name}>
                <td className="max-w-[220px] truncate">
                  <a href={source.url} target="_blank" rel="noreferrer" className="text-ink underline decoration-fog underline-offset-4 hover:decoration-ink" title={source.url}>
                    {sourceLabel(source.name)}
                  </a>
                </td>
                <td className="num right faint">{formatBytes(source.size_bytes)}</td>
                <td className="font-mono text-[10.5px] text-ash">{source.checksum ? source.checksum.replace("sha256:", "").slice(0, 16) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title={<b>Sem emenda executada</b>} flush fill foot={`${roster.length} dos 158 da bancada; quase todos suplentes de passagem curta ou só da legislatura 54.`}>
        <table className="ruled">
          <tbody>
            {roster.map((person) => (
              <tr key={`${person.nome}-${person.casa}`}>
                <td>{niceName(person.nome_parlamentar || person.nome)}</td>
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
