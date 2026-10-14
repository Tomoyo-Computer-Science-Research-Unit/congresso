"use client";

import type { Geometry } from "geojson";
import { useEffect, useMemo, useState } from "react";
import { BarList } from "@/components/BarList";
import { useScreenHotkeys } from "@/components/Hotkeys";
import { Panel, Screen, Segmented, Stat } from "@/components/ui";
import { YearBars } from "@/components/YearBars";
import { YearSelect, stepYear, type YearSel } from "@/components/YearSelect";
import {
  CASA_LABELS,
  METRICS,
  formatBRL,
  formatInt,
  getDestinos,
  getYears,
  loadGeo,
  niceName,
  valueFor,
  yearPoints,
  type Destino,
  type GeoFeatureCollection,
  type Metric
} from "@/lib/static-api";

type Mode = "total" | "per_capita";
const MAP_WIDTH = 1000;
const MAP_HEIGHT = 640;
const MAP_PADDING = 12;

function projectPoint(lon: number, lat: number, bbox: [number, number, number, number]) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const centerLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const lonScale = Math.max(0.2, Math.cos(centerLat));
  const rawWidth = Math.max((maxLon - minLon) * lonScale, 0.000001);
  const rawHeight = Math.max(maxLat - minLat, 0.000001);
  const scale = Math.min((MAP_WIDTH - MAP_PADDING * 2) / rawWidth, (MAP_HEIGHT - MAP_PADDING * 2) / rawHeight);
  const offsetX = (MAP_WIDTH - rawWidth * scale) / 2;
  const offsetY = (MAP_HEIGHT - rawHeight * scale) / 2;
  return { x: offsetX + (lon - minLon) * lonScale * scale, y: offsetY + (maxLat - lat) * scale };
}

function ringPath(ring: number[][], bbox: [number, number, number, number]) {
  const points = ring.map(([lon, lat]) => {
    const { x, y } = projectPoint(lon, lat, bbox);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return points.length ? `M${points.join("L")}Z` : "";
}

function geometryPath(geometry: Geometry, bbox: [number, number, number, number]) {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.map((ring) => ringPath(ring as number[][], bbox)).join("");
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flatMap((polygon) => polygon.map((ring) => ringPath(ring as number[][], bbox))).join("");
  }
  return "";
}

function coordinates(geometry: Geometry): number[][] {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.flat() as number[][];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flat(2) as number[][];
  }
  return [];
}

export function DestinosExplorer() {
  const years = getYears();
  const all = getDestinos();
  const [metric, setMetric] = useState<Metric>("empenhado");
  const [mode, setMode] = useState<Mode>("total");
  const [year, setYear] = useState<YearSel>("all");
  const [selectedIbge, setSelectedIbge] = useState<string>(all[0]?.ibge ?? "");
  const [geo, setGeo] = useState<GeoFeatureCollection | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const ibge = new URLSearchParams(window.location.search).get("m");
    if (ibge && all.some((item) => item.ibge === ibge)) {
      setSelectedIbge(ibge);
    }
    setHydrated(true);
    loadGeo().then(setGeo);
  }, [all]);
  useEffect(() => {
    if (hydrated) {
      window.history.replaceState(null, "", `${window.location.pathname}?m=${selectedIbge}`);
    }
  }, [hydrated, selectedIbge]);

  const valueOf = useMemo(
    () => (destino: Destino) => {
      const raw = valueFor(destino.por_ano, destino.totais, year, metric);
      return mode === "per_capita" && destino.populacao_2022 ? raw / destino.populacao_2022 : raw;
    },
    [metric, mode, year]
  );
  const list = useMemo(
    () =>
      all
        .map((destino) => ({ destino, value: valueOf(destino) }))
        .filter((row) => row.value > 0 || row.destino.ibge === selectedIbge)
        .sort((a, b) => b.value - a.value),
    [all, selectedIbge, valueOf]
  );
  const rankByIbge = useMemo(() => new Map(list.map((row, position) => [row.destino.ibge, { position, value: row.value }])), [list]);
  const selected = all.find((item) => item.ibge === selectedIbge) ?? all[0];
  const index = Math.max(0, list.findIndex((row) => row.destino.ibge === selected?.ibge));
  const bbox = useMemo<[number, number, number, number]>(() => {
    if (!geo) {
      return [0, 0, 1, 1];
    }
    const points = geo.features.flatMap((feature) => coordinates(feature.geometry as Geometry));
    const lons = points.map(([lon]) => lon);
    const lats = points.map(([, lat]) => lat);
    return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  }, [geo]);
  const points = useMemo(() => (selected ? yearPoints(selected.por_ano, years) : []), [selected, years]);

  const hotkeys = useMemo(
    () => ({
      ArrowUp: () => setSelectedIbge(list[(index - 1 + list.length) % list.length]?.destino.ibge ?? selectedIbge),
      ArrowDown: () => setSelectedIbge(list[(index + 1) % list.length]?.destino.ibge ?? selectedIbge),
      ArrowLeft: () => setYear(stepYear(years, year, -1)),
      ArrowRight: () => setYear(stepYear(years, year, 1)),
      m: () => setMetric((current) => (current === "empenhado" ? "pago_total" : "empenhado")),
      p: () => setMode((current) => (current === "total" ? "per_capita" : "total"))
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, list, selectedIbge, year]
  );
  useScreenHotkeys(hotkeys);

  const format = (value: number) => (mode === "per_capita" ? `${formatBRL(value, value >= 1000 ? 1 : 0)}/hab.` : formatBRL(value));
  const yearLabel = year === "all" ? `${years[0]}–${years[years.length - 1]}` : String(year);
  const selectedValue = selected ? rankByIbge.get(selected.ibge) : undefined;

  return (
    <Screen columns="minmax(0, 1fr) 380px" rows="minmax(0, 1fr) 236px">
      <Panel
        title={
          <span>
            <b>Municípios</b> · {yearLabel}
          </span>
        }
        aside={
          <>
            <YearSelect years={years} value={year} onChange={setYear} />
            <Segmented label="Métrica" value={metric} options={METRICS.map((item) => ({ value: item.key, label: item.label }))} onChange={setMetric} />
            <Segmented
              label="Escala"
              value={mode}
              options={[
                { value: "total", label: "Total" },
                { value: "per_capita", label: "Por hab." }
              ]}
              onChange={setMode}
            />
          </>
        }
        fill
        flush
        style={{ gridColumn: 1, gridRow: 1 }}
        foot={
          <span className="flex items-center gap-2 uppercase tracking-[0.18em]">
            menor
            <span className="h-2 w-16 border border-line" style={{ background: "linear-gradient(90deg, var(--haze), var(--ink))" }} aria-hidden="true" />
            maior · claro: sem emenda
          </span>
        }
      >
        <div className="relative min-h-0 flex-1">
          {geo ? (
            <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa do estado do Rio de Janeiro por municípios" className="block h-full w-full">
              {geo.features.map((feature) => {
                const ibge = feature.properties.ibge;
                const rank = rankByIbge.get(ibge);
                const has = rank !== undefined && rank.value > 0;
                const isSelected = selected?.ibge === ibge;
                const opacity = has ? 0.14 + 0.86 * (1 - rank.position / Math.max(1, list.length - 1)) : 1;
                return (
                  <path
                    key={ibge}
                    d={geometryPath(feature.geometry as Geometry, bbox)}
                    fill={has ? "var(--ink)" : "var(--haze)"}
                    fillOpacity={opacity}
                    stroke={isSelected ? "var(--ink)" : "var(--paper)"}
                    strokeWidth={isSelected ? 2.4 : 0.8}
                    className="map-shape cursor-pointer"
                    onClick={() => setSelectedIbge(ibge)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedIbge(ibge);
                      }
                    }}
                  >
                    <title>{`${feature.properties.nome}${rank ? ` · ${format(rank.value)}` : ""}`}</title>
                  </path>
                );
              })}
            </svg>
          ) : (
            <div className="grid h-full place-items-center text-[11px] tracking-[0.22em] text-ash">CARREGANDO</div>
          )}
        </div>
      </Panel>

      <Panel title={<b>Ranking</b>} flush fill style={{ gridColumn: 2, gridRow: "1 / span 2" }}>
        <BarList
          rows={list.map(({ destino, value }) => ({
            key: destino.ibge,
            label: destino.nome,
            sub: destino.populacao_2022 ? `${formatInt(destino.populacao_2022)} hab.` : undefined,
            value,
            selected: destino.ibge === selected?.ibge,
            onClick: () => setSelectedIbge(destino.ibge)
          }))}
        />
      </Panel>

      {selected ? (
        <Panel title={<b>{selected.nome}</b>} aside={<span className="text-[10px] tracking-[0.14em] text-ash">{selectedValue ? `${selectedValue.position + 1}º de ${list.length}` : ""}</span>} style={{ gridColumn: 1, gridRow: 2 }}>
          <div className="grid grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)] gap-6">
            <div>
              <Stat label="Empenhado" value={formatBRL(valueFor(selected.por_ano, selected.totais, year, "empenhado"))} />
              <Stat label="Pago, incl. restos a pagar" value={formatBRL(valueFor(selected.por_ano, selected.totais, year, "pago_total"))} />
              <Stat label="Por habitante (2022)" value={selected.populacao_2022 ? `${formatBRL(valueFor(selected.por_ano, selected.totais, year, metric) / selected.populacao_2022, 0)}` : "–"} />
              <Stat label="População 2022" value={formatInt(selected.populacao_2022)} />
            </div>
            <YearBars points={points} metric={metric} selectedYear={year} onSelectYear={(item) => setYear(item === year ? "all" : item)} height={150} />
            <div className="-my-1 overflow-auto">
              <BarList
                rows={selected.autores.slice(0, 6).map((row) => ({
                  key: row.id,
                  label: niceName(row.nome ?? row.id),
                  sub: [row.partido, CASA_LABELS[row.casa ?? ""] ?? row.casa].filter(Boolean).join(" · "),
                  value: row[metric],
                  href: `/autores?autor=${encodeURIComponent(row.id)}`
                }))}
              />
            </div>
          </div>
        </Panel>
      ) : null}
    </Screen>
  );
}
