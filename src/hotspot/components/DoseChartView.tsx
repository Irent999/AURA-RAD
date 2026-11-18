import { useCallback, useMemo, useRef, useState } from "react";
import type { DispersionResult, DoseResult } from "../lib/types";
import { formatArrivalTime, formatDistance, formatDose } from "../lib/dispersion";

type ChartMode = "pathways" | "nuclides";
type YScaleMode = "log" | "linear" | "dual";
type XScaleMode = "log" | "linear";
type NuclideMetric = "totalEffectiveDose" | "inhalationDose" | "cloudDose" | "thyroidDose";

interface SeriesConfig {
  id: string;
  label: string;
  color: string;
  axis: "left" | "right";
  dashed?: boolean;
  areaFill?: boolean;
  values: number[];
}

const PATHWAY_PALETTE = {
  total: "#ef4444",
  inhalation: "#f59e0b",
  cloud: "#06b6d4",
  ground: "#a855f7",
  thyroid: "#ec4899",
};

const NUCLIDE_PALETTE = [
  "#06b6d4",
  "#f59e0b",
  "#ef4444",
  "#10b981",
  "#8b5cf6",
  "#ec4899",
  "#3b82f6",
  "#84cc16",
];

const NUCLIDE_METRIC_LABELS: Record<NuclideMetric, string> = {
  totalEffectiveDose: "Total Effective",
  inhalationDose: "Inhalation",
  cloudDose: "Cloud Dose",
  thyroidDose: "Thyroid",
};

function formatAxisDose(doseSv: number): string {
  if (!Number.isFinite(doseSv) || doseSv <= 0) return "0 мкЗв";
  if (doseSv >= 1) {
    const decimals = doseSv >= 10 ? 0 : doseSv >= 1 ? 1 : 2;
    return `${Number(doseSv.toFixed(decimals))} Зв`;
  }
  if (doseSv >= 1e-3) {
    const mSv = doseSv * 1e3;
    const decimals = mSv >= 10 ? 0 : 1;
    return `${Number(mSv.toFixed(decimals))} мЗв`;
  }
  if (doseSv >= 1e-6) {
    const uSv = doseSv * 1e6;
    const decimals = uSv >= 10 ? 0 : 1;
    return `${Number(uSv.toFixed(decimals))} мкЗв`;
  }
  if (doseSv >= 1e-9) {
    const nSv = doseSv * 1e9;
    const decimals = nSv >= 10 ? 0 : 1;
    return `${Number(nSv.toFixed(decimals))} нЗв`;
  }
  const pSv = doseSv * 1e12;
  return `${Number(pSv.toFixed(1))} пЗв`;
}

function niceLinearTicks(maxVal: number, count = 5): { max: number; ticks: number[] } {
  if (!Number.isFinite(maxVal) || maxVal <= 0) {
    return { max: 1e-6, ticks: [0, 2.5e-7, 5e-7, 7.5e-7, 1e-6] };
  }
  const rawStep = maxVal / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = niceNorm * mag;
  const niceMax = Math.ceil(maxVal / step) * step;
  const ticks: number[] = [];
  const totalSteps = Math.max(1, Math.round(niceMax / step));
  for (let i = 0; i <= totalSteps; i++) {
    ticks.push(i * step);
  }
  return { max: niceMax, ticks };
}

function buildLogDomain(values: number[]): { minExp: number; maxExp: number; ticks: number[] } {
  const positives = values.filter((v) => Number.isFinite(v) && v > 0);
  if (positives.length === 0) {
    return { minExp: -9, maxExp: -3, ticks: [1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3] };
  }
  const minVal = Math.min(...positives);
  const maxVal = Math.max(...positives);
  const minExp = Math.floor(Math.log10(minVal));
  let maxExp = Math.ceil(Math.log10(maxVal));
  if (maxExp <= minExp) maxExp = minExp + 2;
  const clampedMinExp = Math.max(minExp, maxExp - 8);
  const ticks: number[] = [];
  const span = maxExp - clampedMinExp;
  const step = span > 6 ? 2 : 1;
  for (let e = clampedMinExp; e <= maxExp; e += step) {
    ticks.push(Math.pow(10, e));
  }
  if (ticks[ticks.length - 1] !== Math.pow(10, maxExp)) {
    ticks.push(Math.pow(10, maxExp));
  }
  return { minExp: clampedMinExp, maxExp, ticks };
}

/**
 * Monotone cubic Hermite spline (Fritsch-Carlson) for smooth, overshoot-free SVG curves.
 */
function buildSmoothCurvePaths(
  points: { x: number; y: number }[],
  baselineY: number,
): { linePath: string; areaPath: string } {
  if (points.length === 0) return { linePath: "", areaPath: "" };
  if (points.length === 1) {
    const p = points[0];
    return {
      linePath: `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}`,
      areaPath: "",
    };
  }

  const n = points.length;
  const dxs: number[] = [];
  const dys: number[] = [];
  const ms: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    dxs.push(dx);
    dys.push(dy);
    ms.push(dx !== 0 ? dy / dx : 0);
  }

  const tangents: number[] = new Array(n).fill(0);
  tangents[0] = ms[0];
  tangents[n - 1] = ms[n - 2];

  for (let i = 1; i < n - 1; i++) {
    if (ms[i - 1] * ms[i] <= 0) {
      tangents[i] = 0;
    } else {
      const w1 = 2 * dxs[i] + dxs[i - 1];
      const w2 = dxs[i] + 2 * dxs[i - 1];
      tangents[i] = (w1 + w2) / (w1 / ms[i - 1] + w2 / ms[i]);
    }
  }

  let linePath = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const h = dxs[i] / 3;
    const cp1x = p0.x + h;
    const cp1y = p0.y + tangents[i] * h;
    const cp2x = p1.x - h;
    const cp2y = p1.y - tangents[i + 1] * h;
    linePath += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
  }

  const areaPath = `${linePath} L ${points[n - 1].x.toFixed(2)} ${baselineY.toFixed(2)} L ${points[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`;

  return { linePath, areaPath };
}

export function DoseChartView({ result }: { result: DispersionResult }) {
  const [chartMode, setChartMode] = useState<ChartMode>("pathways");
  const [yScaleMode, setYScaleMode] = useState<YScaleMode>("log");
  const [xScaleMode, setXScaleMode] = useState<XScaleMode>("log");
  const [nuclideMetric, setNuclideMetric] = useState<NuclideMetric>("totalEffectiveDose");
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const sortedResults: DoseResult[] = useMemo(
    () => [...result.results].sort((a, b) => a.distance - b.distance),
    [result.results],
  );

  const seriesList: SeriesConfig[] = useMemo(() => {
    if (chartMode === "pathways") {
      return [
        {
          id: "total",
          label: "Total Effective",
          color: PATHWAY_PALETTE.total,
          axis: "left",
          areaFill: true,
          values: sortedResults.map((r) => r.totalEffectiveDose),
        },
        {
          id: "inhalation",
          label: "Inhalation",
          color: PATHWAY_PALETTE.inhalation,
          axis: "left",
          areaFill: true,
          values: sortedResults.map((r) => r.inhalationDose),
        },
        {
          id: "thyroid",
          label: "Thyroid",
          color: PATHWAY_PALETTE.thyroid,
          axis: "left",
          dashed: true,
          values: sortedResults.map((r) => r.thyroidDose),
        },
        {
          id: "cloud",
          label: "Cloud Dose",
          color: PATHWAY_PALETTE.cloud,
          axis: yScaleMode === "dual" ? "right" : "left",
          areaFill: true,
          values: sortedResults.map((r) => r.cloudDose),
        },
        {
          id: "ground",
          label: "Ground Dose",
          color: PATHWAY_PALETTE.ground,
          axis: yScaleMode === "dual" ? "right" : "left",
          dashed: true,
          values: sortedResults.map((r) => r.groundDose),
        },
      ];
    }

    const firstBreakdown = sortedResults[0]?.nuclideBreakdown ?? [];
    const nuclideSeries: SeriesConfig[] = firstBreakdown.map((item, idx) => ({
      id: `nuc-${item.id}`,
      label: item.isotope,
      color: NUCLIDE_PALETTE[idx % NUCLIDE_PALETTE.length],
      axis: "left",
      areaFill: true,
      values: sortedResults.map((r) => {
        const match = r.nuclideBreakdown?.find((b) => b.id === item.id);
        return match ? match[nuclideMetric] : 0;
      }),
    }));

    if (nuclideSeries.length > 1) {
      nuclideSeries.unshift({
        id: "nuc-total-sum",
        label: "Σ Сумма смеси",
        color: "#e2e8f0",
        axis: "left",
        dashed: true,
        areaFill: false,
        values: sortedResults.map((r) => r[nuclideMetric]),
      });
    }

    return nuclideSeries;
  }, [chartMode, nuclideMetric, sortedResults, yScaleMode]);

  const visibleSeries = useMemo(
    () => seriesList.filter((s) => !hiddenSeries[s.id]),
    [seriesList, hiddenSeries],
  );

  const effectiveYMode: YScaleMode =
    chartMode === "nuclides" && yScaleMode === "dual" ? "log" : yScaleMode;

  const w = 960;
  const h = 440;
  const padLeft = 78;
  const padRight = effectiveYMode === "dual" ? 78 : 28;
  const padTop = 24;
  const padBottom = 56;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;

  const minDist = Math.max(sortedResults[0]?.distance ?? 100, 1);
  const maxDist = Math.max(sortedResults[sortedResults.length - 1]?.distance ?? 50000, minDist + 1);

  const xScale = useCallback(
    (d: number) => {
      const safeD = Math.max(d, 1);
      if (xScaleMode === "log") {
        const logMin = Math.log10(minDist);
        const logMax = Math.log10(maxDist);
        const span = Math.max(logMax - logMin, 1e-6);
        return padLeft + ((Math.log10(safeD) - logMin) / span) * plotW;
      }
      return padLeft + ((safeD - minDist) / Math.max(maxDist - minDist, 1)) * plotW;
    },
    [xScaleMode, minDist, maxDist, padLeft, plotW],
  );

  const leftValues = useMemo(() => {
    const leftSeries = visibleSeries.filter((s) => s.axis === "left");
    return (leftSeries.length > 0 ? leftSeries : visibleSeries).flatMap((s) => s.values);
  }, [visibleSeries]);

  const rightValues = useMemo(
    () => visibleSeries.filter((s) => s.axis === "right").flatMap((s) => s.values),
    [visibleSeries],
  );

  const leftLogDomain = useMemo(() => buildLogDomain(leftValues), [leftValues]);
  const leftLinearDomain = useMemo(() => niceLinearTicks(Math.max(...leftValues, 0)), [leftValues]);
  const rightLinearDomain = useMemo(
    () => niceLinearTicks(Math.max(...rightValues, 0)),
    [rightValues],
  );

  const yScaleLeft = useCallback(
    (val: number) => {
      const baseline = padTop + plotH;
      if (effectiveYMode === "log") {
        const clamped = Math.max(val, Math.pow(10, leftLogDomain.minExp));
        const logVal = Math.log10(clamped);
        const frac =
          (logVal - leftLogDomain.minExp) /
          Math.max(leftLogDomain.maxExp - leftLogDomain.minExp, 1);
        return baseline - Math.min(Math.max(frac, 0), 1) * plotH;
      }
      const frac = Math.max(val, 0) / Math.max(leftLinearDomain.max, 1e-18);
      return baseline - Math.min(Math.max(frac, 0), 1) * plotH;
    },
    [padTop, plotH, effectiveYMode, leftLogDomain, leftLinearDomain],
  );

  const yScaleRight = (val: number) => {
    const baseline = padTop + plotH;
    const frac = Math.max(val, 0) / Math.max(rightLinearDomain.max, 1e-18);
    return baseline - Math.min(Math.max(frac, 0), 1) * plotH;
  };

  const yScaleForAxis = (axis: "left" | "right") =>
    axis === "right" && effectiveYMode === "dual" ? yScaleRight : yScaleLeft;

  const leftTicks = effectiveYMode === "log" ? leftLogDomain.ticks : leftLinearDomain.ticks;

  const xAxisTicks = useMemo(() => {
    const ticks: { distance: number; x: number; label: string }[] = [];
    let lastX = -Infinity;
    for (const r of sortedResults) {
      const x = xScale(r.distance);
      if (x - lastX >= 56 || r === sortedResults[sortedResults.length - 1]) {
        if (x - lastX < 46 && ticks.length > 0) {
          ticks.pop();
        }
        ticks.push({ distance: r.distance, x, label: formatDistance(r.distance) });
        lastX = x;
      }
    }
    return ticks;
  }, [sortedResults, xScale]);

  const pagThresholds = useMemo(() => {
    if (effectiveYMode === "dual") return [];
    const thresholds = [
      { value: 0.1, label: "100 мЗв · Эвакуация", color: "rgba(239, 68, 68, 0.45)" },
      { value: 0.01, label: "10 мЗв · Контроль", color: "rgba(245, 158, 11, 0.4)" },
      { value: 0.001, label: "1 мЗв · Наблюдение", color: "rgba(6, 182, 212, 0.35)" },
    ];
    const minVisible = effectiveYMode === "log" ? Math.pow(10, leftLogDomain.minExp) : 0;
    const maxVisible =
      effectiveYMode === "log" ? Math.pow(10, leftLogDomain.maxExp) : leftLinearDomain.max;
    return thresholds
      .filter((t) => t.value > minVisible && t.value < maxVisible)
      .map((t) => ({ ...t, y: yScaleLeft(t.value) }));
  }, [effectiveYMode, leftLogDomain, leftLinearDomain, yScaleLeft]);

  const toggleSeries = (id: string) => {
    setHiddenSeries((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || sortedResults.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * w;
    if (svgX < padLeft - 16 || svgX > w - padRight + 16) {
      setHoveredIndex(null);
      return;
    }
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < sortedResults.length; i++) {
      const px = xScale(sortedResults[i].distance);
      const dist = Math.abs(px - svgX);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    setHoveredIndex(bestIdx);
  };

  const hoveredRow = hoveredIndex !== null ? sortedResults[hoveredIndex] : null;
  const hoveredX = hoveredRow ? xScale(hoveredRow.distance) : 0;
  const tooltipOnLeft = hoveredX > w * 0.56;

  if (sortedResults.length === 0) {
    return (
      <div className="p-4">
        <div className="panel p-8 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>
          Нет данных расчёта для отображения графика
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="panel p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="inline-flex items-center p-0.5 rounded-lg border"
            style={{
              backgroundColor: "var(--bg-tertiary)",
              borderColor: "var(--border-default)",
            }}
          >
            <button
              type="button"
              onClick={() => setChartMode("pathways")}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
              style={{
                backgroundColor:
                  chartMode === "pathways" ? "rgba(6, 182, 212, 0.14)" : "transparent",
                color: chartMode === "pathways" ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              По путям воздействия
            </button>
            <button
              type="button"
              onClick={() => setChartMode("nuclides")}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
              style={{
                backgroundColor:
                  chartMode === "nuclides" ? "rgba(6, 182, 212, 0.14)" : "transparent",
                color: chartMode === "nuclides" ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              По нуклидам в смеси
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {chartMode === "nuclides" && (
              <div
                className="inline-flex items-center p-0.5 rounded-lg border"
                style={{
                  backgroundColor: "var(--bg-tertiary)",
                  borderColor: "var(--border-default)",
                }}
              >
                {(Object.keys(NUCLIDE_METRIC_LABELS) as NuclideMetric[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setNuclideMetric(m)}
                    className="px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap shrink-0"
                    style={{
                      backgroundColor:
                        nuclideMetric === m ? "rgba(6, 182, 212, 0.14)" : "transparent",
                      color: nuclideMetric === m ? "var(--accent)" : "var(--text-secondary)",
                    }}
                  >
                    {NUCLIDE_METRIC_LABELS[m]}
                  </button>
                ))}
              </div>
            )}

            <div
              className="inline-flex items-center p-0.5 rounded-lg border"
              style={{
                backgroundColor: "var(--bg-tertiary)",
                borderColor: "var(--border-default)",
              }}
            >
              {(
                [
                  { id: "log", label: "Log Y" },
                  { id: "linear", label: "Linear Y" },
                  ...(chartMode === "pathways" ? [{ id: "dual", label: "Dual Axis" }] : []),
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setYScaleMode(opt.id)}
                  className="px-2.5 py-1 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0"
                  style={{
                    backgroundColor:
                      effectiveYMode === opt.id ? "rgba(6, 182, 212, 0.14)" : "transparent",
                    color: effectiveYMode === opt.id ? "var(--accent)" : "var(--text-secondary)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div
              className="inline-flex items-center p-0.5 rounded-lg border"
              style={{
                backgroundColor: "var(--bg-tertiary)",
                borderColor: "var(--border-default)",
              }}
            >
              {(
                [
                  { id: "log", label: "Log X" },
                  { id: "linear", label: "Linear X" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setXScaleMode(opt.id)}
                  className="px-2.5 py-1 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0"
                  style={{
                    backgroundColor:
                      xScaleMode === opt.id ? "rgba(6, 182, 212, 0.14)" : "transparent",
                    color: xScaleMode === opt.id ? "var(--accent)" : "var(--text-secondary)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            {seriesList.map((s) => {
              const isHidden = Boolean(hiddenSeries[s.id]);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleSeries(s.id)}
                  className="inline-flex items-center gap-2 px-2.5 py-1 rounded border text-xs transition-opacity whitespace-nowrap shrink-0"
                  style={{
                    borderColor: isHidden ? "var(--border-default)" : `${s.color}55`,
                    backgroundColor: isHidden ? "transparent" : `${s.color}12`,
                    opacity: isHidden ? 0.45 : 1,
                    color: "var(--text-primary)",
                  }}
                >
                  <span
                    className="w-3.5 h-0.5 inline-block"
                    style={{
                      backgroundColor: s.color,
                      borderTop: s.dashed ? `2px dashed ${s.color}` : undefined,
                    }}
                  />
                  <span>{s.label}</span>
                  {effectiveYMode === "dual" && (
                    <span
                      className="text-[10px] font-mono"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      {s.axis === "right" ? "(R)" : "(L)"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <span className="text-xs font-mono" style={{ color: "var(--text-tertiary)" }}>
            Наведите на график для детальной разбивки
          </span>
        </div>

        <div className="relative select-none">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${w} ${h}`}
            className="w-full cursor-crosshair"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <defs>
              {visibleSeries.map((s) => (
                <linearGradient
                  key={`grad-${s.id}`}
                  id={`grad-${s.id}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.01} />
                </linearGradient>
              ))}
              <clipPath id="dose-chart-plot-clip">
                <rect x={padLeft} y={padTop} width={plotW} height={plotH} />
              </clipPath>
            </defs>

            {leftTicks.map((tickVal, idx) => {
              const y = yScaleLeft(tickVal);
              return (
                <g key={`yl-${idx}`}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={w - padRight}
                    y2={y}
                    stroke="var(--border-default)"
                    strokeWidth="0.75"
                    strokeDasharray="3 4"
                  />
                  <text
                    x={padLeft - 10}
                    y={y + 3.5}
                    fill="var(--text-tertiary)"
                    fontSize="10.5"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    textAnchor="end"
                  >
                    {formatAxisDose(tickVal)}
                  </text>
                </g>
              );
            })}

            {effectiveYMode === "dual" &&
              rightLinearDomain.ticks.map((tickVal, idx) => {
                const y = yScaleRight(tickVal);
                return (
                  <g key={`yr-${idx}`}>
                    <text
                      x={w - padRight + 10}
                      y={y + 3.5}
                      fill={PATHWAY_PALETTE.cloud}
                      fontSize="10.5"
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      textAnchor="start"
                    >
                      {formatAxisDose(tickVal)}
                    </text>
                  </g>
                );
              })}

            {xAxisTicks.map((t, idx) => (
              <g key={`xt-${t.distance}-${idx}`}>
                <line
                  x1={t.x}
                  y1={padTop}
                  x2={t.x}
                  y2={padTop + plotH}
                  stroke="var(--border-default)"
                  strokeWidth="0.6"
                  strokeDasharray="2 4"
                />
                <text
                  x={t.x}
                  y={padTop + plotH + 18}
                  fill="var(--text-tertiary)"
                  fontSize="10.5"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  textAnchor="middle"
                >
                  {t.label}
                </text>
              </g>
            ))}

            {pagThresholds.map((t) => (
              <g key={t.label}>
                <line
                  x1={padLeft}
                  y1={t.y}
                  x2={w - padRight}
                  y2={t.y}
                  stroke={t.color}
                  strokeWidth="1"
                  strokeDasharray="6 4"
                />
                <text
                  x={w - padRight - 6}
                  y={t.y - 4}
                  fill={t.color}
                  fontSize="9.5"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  textAnchor="end"
                >
                  {t.label}
                </text>
              </g>
            ))}

            <line
              x1={padLeft}
              y1={padTop + plotH}
              x2={w - padRight}
              y2={padTop + plotH}
              stroke="var(--border-light)"
              strokeWidth="1"
            />
            <line
              x1={padLeft}
              y1={padTop}
              x2={padLeft}
              y2={padTop + plotH}
              stroke="var(--border-light)"
              strokeWidth="1"
            />
            {effectiveYMode === "dual" && (
              <line
                x1={w - padRight}
                y1={padTop}
                x2={w - padRight}
                y2={padTop + plotH}
                stroke={PATHWAY_PALETTE.cloud}
                strokeOpacity="0.5"
                strokeWidth="1"
              />
            )}

            <g clipPath="url(#dose-chart-plot-clip)">
              {visibleSeries.map((s) => {
                const scaleFn = yScaleForAxis(s.axis);
                const pts = sortedResults.map((r, idx) => ({
                  x: xScale(r.distance),
                  y: scaleFn(s.values[idx] ?? 0),
                }));
                const { linePath, areaPath } = buildSmoothCurvePaths(pts, padTop + plotH);

                return (
                  <g key={`series-${s.id}`}>
                    {s.areaFill && areaPath && <path d={areaPath} fill={`url(#grad-${s.id})`} />}
                    <path
                      d={linePath}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={s.id === "total" || s.id === "nuc-total-sum" ? 2.1 : 1.75}
                      strokeDasharray={s.dashed ? "5 4" : undefined}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                );
              })}
            </g>

            {hoveredRow && (
              <line
                x1={hoveredX}
                y1={padTop}
                x2={hoveredX}
                y2={padTop + plotH}
                stroke="var(--accent)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            )}

            {visibleSeries.map((s) => {
              const scaleFn = yScaleForAxis(s.axis);
              return sortedResults.map((r, idx) => {
                const cx = xScale(r.distance);
                const cy = scaleFn(s.values[idx] ?? 0);
                const isHovered = hoveredIndex === idx;
                return (
                  <circle
                    key={`pt-${s.id}-${idx}`}
                    cx={cx}
                    cy={cy}
                    r={isHovered ? 4.5 : 2.3}
                    fill={isHovered ? "#0b1120" : s.color}
                    stroke={s.color}
                    strokeWidth={isHovered ? 2 : 0}
                  />
                );
              });
            })}

            <text
              x={padLeft + plotW / 2}
              y={h - 10}
              fill="var(--text-tertiary)"
              fontSize="11"
              textAnchor="middle"
            >
              Дистанция по ветру ({xScaleMode === "log" ? "логарифмическая" : "линейная"} шкала)
            </text>

            <text
              x={16}
              y={padTop + plotH / 2}
              fill="var(--text-tertiary)"
              fontSize="11"
              textAnchor="middle"
              transform={`rotate(-90 16 ${padTop + plotH / 2})`}
            >
              {effectiveYMode === "dual"
                ? "Внутренние и суммарная доза"
                : "Поглощённая / эффективная доза"}
            </text>

            {effectiveYMode === "dual" && (
              <text
                x={w - 14}
                y={padTop + plotH / 2}
                fill={PATHWAY_PALETTE.cloud}
                fontSize="11"
                textAnchor="middle"
                transform={`rotate(90 ${w - 14} ${padTop + plotH / 2})`}
              >
                Внешнее облучение (Cloud / Ground)
              </text>
            )}
          </svg>

          {hoveredRow && (
            <div
              className="pointer-events-none absolute top-3 z-20 w-72 rounded-lg border p-3 shadow-xl backdrop-blur-md"
              style={{
                left: tooltipOnLeft ? "14px" : undefined,
                right: tooltipOnLeft ? undefined : "14px",
                backgroundColor: "rgba(11, 15, 25, 0.94)",
                borderColor: "rgba(6, 182, 212, 0.35)",
              }}
            >
              <div
                className="flex items-center justify-between pb-2 mb-2 border-b text-xs"
                style={{ borderColor: "var(--border-default)" }}
              >
                <span
                  className="font-semibold font-mono tabular-nums"
                  style={{ color: "var(--text-primary)" }}
                >
                  {formatDistance(hoveredRow.distance)}
                </span>
                <span className="font-mono tabular-nums" style={{ color: "var(--accent)" }}>
                  t = {hoveredRow.arrivalTimeFormatted ?? formatArrivalTime(hoveredRow.arrivalTime)}
                </span>
              </div>

              <div className="space-y-1 text-xs">
                {[
                  {
                    label: "Total Effective",
                    value: hoveredRow.totalEffectiveDose,
                    color: PATHWAY_PALETTE.total,
                  },
                  {
                    label: "Inhalation",
                    value: hoveredRow.inhalationDose,
                    color: PATHWAY_PALETTE.inhalation,
                  },
                  {
                    label: "Cloud Dose",
                    value: hoveredRow.cloudDose,
                    color: PATHWAY_PALETTE.cloud,
                  },
                  {
                    label: "Ground Dose",
                    value: hoveredRow.groundDose,
                    color: PATHWAY_PALETTE.ground,
                  },
                  {
                    label: "Thyroid",
                    value: hoveredRow.thyroidDose,
                    color: PATHWAY_PALETTE.thyroid,
                  },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span
                      className="flex items-center gap-1.5"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <span
                        className="w-2 h-2 rounded-full inline-block"
                        style={{ backgroundColor: row.color }}
                      />
                      {row.label}
                    </span>
                    <span
                      className="font-mono tabular-nums font-medium"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {formatDose(row.value)}
                    </span>
                  </div>
                ))}
              </div>

              {hoveredRow.nuclideBreakdown && hoveredRow.nuclideBreakdown.length > 0 && (
                <div
                  className="mt-2.5 pt-2 border-t space-y-1 text-xs"
                  style={{ borderColor: "var(--border-default)" }}
                >
                  <div
                    className="text-[11px] font-medium"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    Вклад изотопов ({NUCLIDE_METRIC_LABELS[nuclideMetric]}):
                  </div>
                  {hoveredRow.nuclideBreakdown.map((b, idx) => {
                    const totalMetric = hoveredRow[nuclideMetric];
                    const share = totalMetric > 0 ? (b[nuclideMetric] / totalMetric) * 100 : 0;
                    const color = NUCLIDE_PALETTE[idx % NUCLIDE_PALETTE.length];
                    return (
                      <div key={b.id} className="flex items-center justify-between">
                        <span
                          className="flex items-center gap-1.5 font-mono"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          <span
                            className="w-2 h-2 rounded-sm inline-block"
                            style={{ backgroundColor: color }}
                          />
                          {b.isotope}
                          <span style={{ color: "var(--text-tertiary)" }}>
                            ({share.toFixed(0)}%)
                          </span>
                        </span>
                        <span
                          className="font-mono tabular-nums"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {formatDose(b[nuclideMetric])}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
