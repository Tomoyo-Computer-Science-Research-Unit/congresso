"use client";

import { useEffect, useState } from "react";
import Link from "@/components/UfLink";
import { Panel, Screen } from "@/components/ui";
import {
  BB_CODIGO,
  CASA_LABELS,
  formatBRL,
  formatInt,
  getFavorecidos,
  getIpca,
  getMeta,
  getRosterSemEmendas,
  getSources,
  getStats,
  getTotals,
  loadVotacoesMeta,
  niceName,
  type VotacoesMeta
} from "@/lib/static-api";
import { HOMONIMOS, bancadaCurta, ufByCode, type UfInfo } from "@/lib/uf";
import { useUf } from "@/lib/use-uf";


function sourceLabel(name: string): string {
  const camara = name.match(/^camara deputados ([A-Z]{2}) leg (\d+)$/);
  if (camara) {
    return `Câmara, deputados ${ufByCode(camara[1])?.preposicao ?? "de"} ${camara[1]}, legislatura ${camara[2]}`;
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

function RosterTable({ roster }: { roster: ReturnType<typeof getRosterSemEmendas> }) {
  return (
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
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-t border-line py-2 text-[11.5px] leading-5">
      <span className="serif text-[13px] leading-5 text-ink">{term}</span>
      <span className="text-sumi">{children}</span>
    </div>
  );
}

/** Frase do índice de homônimos: escrita à mão no RJ e em SP, montada da auditoria nas demais UFs. */
function homonimos(uf: UfInfo, stats: { collisions?: Record<string, string[]>; unmatched_collision_names?: Record<string, number> }): string {
  if (HOMONIMOS[uf.code]) {
    return HOMONIMOS[uf.code];
  }
  const nomes = Object.keys(stats.collisions ?? {});
  const fora = Object.entries(stats.unmatched_collision_names ?? {});
  if (nomes.length === 0) {
    return `nenhum nome da bancada ${uf.preposicao} ${uf.code} aparece também fora dela.`;
  }
  const linhas = fora.reduce((sum, [, n]) => sum + n, 0);
  const lista = nomes.map((nome) => `“${nome.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())}”`).join(", ");
  return linhas
    ? `${nomes.length === 1 ? "o nome" : "os nomes"} ${lista} também ${nomes.length === 1 ? "existe" : "existem"} fora da bancada; ${formatInt(linhas)} linhas de anos sem mandato pela UF ficam fora.`
    : `${nomes.length === 1 ? "o nome" : "os nomes"} ${lista} também ${nomes.length === 1 ? "existe" : "existem"} fora da bancada; todas as linhas caem na legislatura certa e ficam.`;
}

function formatDateBr(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function soma(porAno: Record<string, number> | undefined): number {
  return Object.values(porAno ?? {}).reduce((total, value) => total + value, 0);
}

/** Linhas sobre votações e presença; os números vêm de data/votacoes/meta. */
function VotosRows({ meta }: { meta: VotacoesMeta | null }) {
  const cam = meta?.votacoes.camara ?? {};
  const descartadas = meta?.stats?.senado_descartadas;
  const sen = meta?.votacoes.senado ?? {};
  const gerado = meta ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(meta.generated_at)) : "–";
  return (
    <>
      <Row term="Votações">
        Votações nominais de plenário desde 01/02/2015, legislaturas 55 a 57, lidas em {gerado}: {formatInt(soma(cam))} da Câmara e {formatInt(soma(sen))} do Senado. Na
        Câmara entra a votação do Plenário com voto por deputado nos arquivos anuais; simbólicas e de comissões ficam fora. No Senado, votações secretas (autoridades)
        ficam fora da lista e contam para a presença.
      </Row>
      <Row term="Senado, 2015 a 2017">
        Até fevereiro de 2017 o serviço de votações do Senado lista, na maior parte dos registros, senadores de outras décadas no lugar de quem votou (em 01/04/2015, 69 dos
        81 nomes). Registros com mais de três nomes fora das listas de senadores das legislaturas 55 a 57 ficam fora: {formatInt(descartadas?.total)}, o último de{" "}
        {descartadas?.ultima ? formatDateBr(descartadas.ultima) : "–"}. Do Senado sobram {formatInt(sen["2016"] ?? 0)} votações de 2016 e nenhuma de 2015.
      </Row>
      <Row term="Quem é da UF">
        A UF que a Câmara e o Senado registram em cada voto. Quem estava em exercício e não votou entra como ausente, ou presente sem voto se registrou presença na sessão;
        o exercício de cada deputado vem do histórico da API da Câmara (posse, licença, retorno, fim de mandato). A Bancada coletiva não vota.
      </Row>
      <Row term="Maioria, partido">
        Com a maioria: sim ou não igual ao lado mais votado no plenário, qualquer que fosse o quórum exigido. Contra o partido: sim ou não oposto à maioria dos colegas do mesmo
        partido na mesma votação, com o partido da data do voto; empate no partido não conta. Participação: sim, não, abstenção ou obstrução sobre as votações em que estava em
        exercício, descontadas as que presidiu.
      </Row>
      <Row term="Governo">
        Orientação do líder do governo: na Câmara, a bancada “Governo” do arquivo de orientações ({formatInt(meta?.com_orientacao_governo.camara)} votações); no Senado, o
        painel eletrônico, publicado desde outubro de 2018 ({formatInt(meta?.com_orientacao_governo.senado)} votações). Contra o governo é sim ou não oposto a uma orientação
        sim ou não; “liberado” não conta.
      </Row>
      <Row term="Falta">
        Câmara: sessão deliberativa do Plenário, não cancelada, em que o deputado estava em exercício e não tem registro de presença ({formatInt(soma(meta?.sessoes.camara))}{" "}
        sessões). Os dados abertos da Câmara não trazem a justificativa: licença sem afastamento do mandato, como a de gestante, conta como falta. Senado: sem lista de presença aberta, conta cada sessão com votação
        nominal, aberta ou secreta ({formatInt(soma(meta?.sessoes.senado))} sessões); falta é não ter comparecido a nenhuma votação da sessão; licença, missão e atividade
        parlamentar são ausência justificada, entre parênteses nas grades.
      </Row>
      <Row term="Atualização">Os arquivos do ano corrente são baixados de novo a cada rodada diária; os anos anteriores ficam em cache.</Row>
    </>
  );
}

export function MethodScreen() {
  const UF = useUf();
  const [votosMeta, setVotosMeta] = useState<VotacoesMeta | null>(null);
  useEffect(() => {
    let alive = true;
    loadVotacoesMeta().then((data) => alive && setVotosMeta(data));
    return () => {
      alive = false;
    };
  }, []);
  const meta = getMeta();
  const sources = getSources();
  const roster = getRosterSemEmendas();
  const stats = getStats() as { collisions?: Record<string, string[]>; unmatched_collision_names?: Record<string, number>; rows_total?: number; roster_size?: number; roster_matched?: number; favorecidos?: { rows?: number; favorecidos?: number; total_recebido?: number } };
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
    <Screen columns="minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)" rows="minmax(0, 1fr) minmax(0, 1fr)">
      <Panel title={<b>Emendas</b>} aside={<span className="text-[10px] tracking-[0.14em] text-ash">lido em {accessed}</span>} fill style={{ gridRow: "1 / span 2" }}>
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
        <Row term={bancadaCurta(UF)}>
          Emendas de bancada estadual (RP 7, código SIAFI {UF.bancadaSiafi}): propostas em nome do conjunto dos deputados e senadores do estado, decididas pela coordenação da bancada,
          impositivas desde 2019 e voltadas a projetos de maior porte. Autor coletivo, sem atribuição a pessoas.
        </Row>
        <Row term="Autor">
          O SIAFI dá um código de quatro dígitos e um nome. O nome, normalizado, é casado com nome civil, parlamentar ou eleitoral de alguém da bancada com mandato na legislatura
          que fez o orçamento daquele ano. Um índice nacional de homônimos descarta coincidências: {homonimos(UF, stats)}
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

      <Panel title={<b>Votações e presença</b>} fill style={{ gridRow: "1 / span 2" }}>
        <VotosRows meta={votosMeta} />
      </Panel>

      <Panel title={<b>Sem emenda executada</b>} aside={<span className="text-[10px] tracking-[0.14em] text-ash">{roster.length} de {formatInt(stats.roster_size)}</span>} flush fill style={{ gridColumn: 3, gridRow: 2 }}>
        <RosterTable roster={roster} />
      </Panel>

      <Panel title={<b>Arquivos lidos</b>} flush fill style={{ gridColumn: 3, gridRow: 1 }}>
        <table className="ruled">
          <thead>
            <tr>
              <th>Fonte</th>
              <th className="right">Tamanho</th>
              <th className="right">SHA-256</th>
            </tr>
          </thead>
          <tbody>
            {[...sources, ...(votosMeta?.sources ?? [])].map((source) => (
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

    </Screen>
  );
}
