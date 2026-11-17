import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Wind,
  RefreshCw,
  Compass,
  Thermometer,
  Droplets,
  Gauge,
  CloudRain,
  Check,
  AlertCircle,
} from "lucide-react";
import type { DispersionInput } from "../lib/types";
import {
  fetchCurrentMeteo,
  fetchWindHistory,
  calculateTransportVector,
  computeWindRose,
  estimatePasquillStability,
  WIND_SPEED_BINS,
  type LiveMeteoObservation,
  type WindHistorySample,
} from "../lib/meteoService";

interface WindRoseViewProps {
  input: DispersionInput;
  setInput: (input: DispersionInput) => void;
}

export function WindRoseView({ input, setInput }: WindRoseViewProps) {
  const lat = input.sourceTerm.latitude;
  const lon = input.sourceTerm.longitude;

  const [liveMeteo, setLiveMeteo] = useState<LiveMeteoObservation | null>(null);
  const [meteoLoading, setMeteoLoading] = useState(false);
  const [meteoError, setMeteoError] = useState<string | null>(null);
  const [appliedFlash, setAppliedFlash] = useState(false);

  const [periodDays, setPeriodDays] = useState<7 | 30 | 90>(30);
  const [historySamples, setHistorySamples] = useState<WindHistorySample[]>([]);
  const [historySource, setHistorySource] = useState<string>("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [hoveredSector, setHoveredSector] = useState<string | null>(null);

  const loadLive = useCallback(
    async (forceRefresh = false) => {
      setMeteoLoading(true);
      setMeteoError(null);
      try {
        const obs = await fetchCurrentMeteo(lat, lon, forceRefresh);
        setLiveMeteo(obs);
      } catch (err) {
        setMeteoError(err instanceof Error ? err.message : "Ошибка загрузки метеоданных");
      } finally {
        setMeteoLoading(false);
      }
    },
    [lat, lon],
  );

  const loadHistory = useCallback(
    async (forceRefresh = false) => {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const res = await fetchWindHistory(lat, lon, periodDays, forceRefresh);
        setHistorySamples(res.samples);
        setHistorySource(res.source);
      } catch (err) {
        setHistoryError(err instanceof Error ? err.message : "Ошибка загрузки архива ветра");
      } finally {
        setHistoryLoading(false);
      }
    },
    [lat, lon, periodDays],
  );

  useEffect(() => {
    void loadLive(false);
  }, [loadLive]);

  useEffect(() => {
    void loadHistory(false);
  }, [loadHistory]);

  const modelVector = useMemo(
    () =>
      calculateTransportVector(input.meteorology.windSpeed, input.meteorology.windDirection, "to"),
    [input.meteorology.windSpeed, input.meteorology.windDirection],
  );

  const liveVector = useMemo(
    () =>
      liveMeteo
        ? calculateTransportVector(liveMeteo.windSpeedMs, liveMeteo.windDirectionDeg, "from")
        : null,
    [liveMeteo],
  );

  const windRose = useMemo(
    () => (historySamples.length > 0 ? computeWindRose(historySamples, 16) : null),
    [historySamples],
  );

  const applyLiveMeteo = () => {
    if (!liveMeteo || !liveVector) return;
    const hourUtc = new Date().getUTCHours();
    const localHour = (hourUtc + 5) % 24;
    const isDay = localHour >= 7 && localHour <= 19;
    const estStability = estimatePasquillStability(liveMeteo.windSpeedMs, isDay);

    setInput({
      ...input,
      meteorology: {
        ...input.meteorology,
        windSpeed: Math.max(0.5, Number(liveMeteo.windSpeedMs.toFixed(1))),
        windDirection: Math.round(liveVector.transportAzimuthDeg),
        airTemperature: Math.round(liveMeteo.temperatureC * 10) / 10,
        precipitationRate: Math.round(liveMeteo.precipitationMmh * 10) / 10,
        stabilityClass: estStability,
      },
    });
    setAppliedFlash(true);
    setTimeout(() => setAppliedFlash(false), 1800);
  };

  const applySectorWind = (meteoCenterDeg: number, meanSpeedMs: number) => {
    const vec = calculateTransportVector(Math.max(0.5, meanSpeedMs), meteoCenterDeg, "from");
    setInput({
      ...input,
      meteorology: {
        ...input.meteorology,
        windSpeed: Number(Math.max(0.5, meanSpeedMs).toFixed(1)),
        windDirection: Math.round(vec.transportAzimuthDeg),
      },
    });
  };

  // Max frequency across sectors to scale polar radius nicely
  const maxSectorFreq = useMemo(() => {
    if (!windRose) return 20;
    const maxVal = Math.max(...windRose.sectors.map((s) => s.totalFreqPct), 5);
    return Math.ceil(maxVal / 5) * 5;
  }, [windRose]);

  const hoveredStat = useMemo(
    () => windRose?.sectors.find((s) => s.sector === hoveredSector) ?? null,
    [windRose, hoveredSector],
  );

  return (
    <div className="p-6 space-y-5">
      {/* Top Row: Live Meteo Telemetry & Transport Vector */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Live Weather Client Card */}
        <div className="panel p-4 xl:col-span-2 flex flex-col justify-between gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Wind className="w-4 h-4" style={{ color: "var(--accent)" }} />
                <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Оперативные метеоданные (Узгидромет / Open-Meteo)
                </h3>
              </div>
              <p
                className="text-xs mt-0.5 font-mono tabular-nums"
                style={{ color: "var(--text-tertiary)" }}
              >
                Площадка: {lat.toFixed(4)}° N, {lon.toFixed(4)}° E
                {liveMeteo && ` · Источник: ${liveMeteo.source}`}
                {liveMeteo?.cached && " · TTL-кэш"}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => void loadLive(true)}
                disabled={meteoLoading}
                className="btn btn-secondary text-xs py-1.5 px-3"
                title="Принудительно обновить (сбросить TTL-кэш)"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${meteoLoading ? "animate-spin" : ""}`} />
                Обновить
              </button>
              <button
                onClick={applyLiveMeteo}
                disabled={!liveMeteo}
                className="btn btn-primary text-xs py-1.5 px-3"
              >
                {appliedFlash ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Wind className="w-3.5 h-3.5" />
                )}
                {appliedFlash ? "Применено" : "Применить к шлейфу"}
              </button>
            </div>
          </div>

          {meteoError && (
            <div
              className="flex items-center gap-2 p-2.5 rounded-lg text-xs"
              style={{
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                color: "var(--danger)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
              }}
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{meteoError}</span>
            </div>
          )}

          {liveMeteo ? (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono tabular-nums">
              <div
                className="p-2.5 rounded-lg border"
                style={{
                  backgroundColor: "var(--bg-tertiary)",
                  borderColor: "var(--border-default)",
                }}
              >
                <div
                  className="text-[11px] flex items-center gap-1"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  <Wind className="w-3 h-3 text-cyan-400" />
                  Ветер (10 м)
                </div>
                <div className="text-base font-bold mt-1" style={{ color: "var(--text-primary)" }}>
                  {liveMeteo.windSpeedMs.toFixed(1)} м/с
                </div>
                <div className="text-[11px]" style={{ color: "var(--accent)" }}>
                  Откуда: {liveMeteo.windDirectionDeg.toFixed(0)}° → Снос:{" "}
                  {liveVector?.transportAzimuthDeg.toFixed(0)}°
                </div>
              </div>

              <div
                className="p-2.5 rounded-lg border"
                style={{
                  backgroundColor: "var(--bg-tertiary)",
                  borderColor: "var(--border-default)",
                }}
              >
                <div
                  className="text-[11px] flex items-center gap-1"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  <Thermometer className="w-3 h-3 text-amber-400" />
                  Температура
                </div>
                <div className="text-base font-bold mt-1" style={{ color: "var(--text-primary)" }}>
                  {liveMeteo.temperatureC.toFixed(1)} °C
                </div>
                <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  Класс: {estimatePasquillStability(liveMeteo.windSpeedMs)}
                </div>
              </div>

              <div
                className="p-2.5 rounded-lg border"
                style={{
                  backgroundColor: "var(--bg-tertiary)",
                  borderColor: "var(--border-default)",
                }}
              >
                <div
                  className="text-[11px] flex items-center gap-1"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  <Gauge className="w-3 h-3 text-emerald-400" />
                  Давление
                </div>
                <div className="text-base font-bold mt-1" style={{ color: "var(--text-primary)" }}>
                  {liveMeteo.pressureHpa.toFixed(0)} гПа
                </div>
                <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {(liveMeteo.pressureHpa * 0.75006).toFixed(0)} мм рт.ст.
                </div>
              </div>

              <div
                className="p-2.5 rounded-lg border"
                style={{
                  backgroundColor: "var(--bg-tertiary)",
                  borderColor: "var(--border-default)",
                }}
              >
                <div
                  className="text-[11px] flex items-center gap-1"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  <Droplets className="w-3 h-3 text-sky-400" />
                  Влажность
                </div>
                <div className="text-base font-bold mt-1" style={{ color: "var(--text-primary)" }}>
                  {liveMeteo.humidityPct.toFixed(0)} %
                </div>
                <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  RH воздуха
                </div>
              </div>

              <div
                className="p-2.5 rounded-lg border"
                style={{
                  backgroundColor: "var(--bg-tertiary)",
                  borderColor: "var(--border-default)",
                }}
              >
                <div
                  className="text-[11px] flex items-center gap-1"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  <CloudRain className="w-3 h-3 text-blue-400" />
                  Осадки
                </div>
                <div className="text-base font-bold mt-1" style={{ color: "var(--text-primary)" }}>
                  {liveMeteo.precipitationMmh.toFixed(1)} мм/ч
                </div>
                <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {liveMeteo.precipitationMmh > 0 ? "Вымывание Λ>0" : "Сухо"}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-xs" style={{ color: "var(--text-tertiary)" }}>
              Загрузка актуальной сводки для {lat.toFixed(3)}° N, {lon.toFixed(3)}° E…
            </div>
          )}
        </div>

        {/* Transport Vector Decomposition Card */}
        <div className="panel p-4 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Compass className="w-4 h-4" style={{ color: "var(--accent)" }} />
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Вектор переноса сетки
              </h3>
            </div>
            <span className="text-xs font-mono tabular-nums" style={{ color: "var(--accent)" }}>
              θ = {modelVector.transportAzimuthDeg.toFixed(0)}°
            </span>
          </div>

          <div className="flex items-center gap-4">
            <svg width="108" height="108" viewBox="0 0 108 108" className="shrink-0">
              <circle
                cx="54"
                cy="54"
                r="42"
                fill="none"
                stroke="var(--border-default)"
                strokeWidth="1"
              />
              <line
                x1="12"
                y1="54"
                x2="96"
                y2="54"
                stroke="var(--border-default)"
                strokeDasharray="2 2"
              />
              <line
                x1="54"
                y1="12"
                x2="54"
                y2="96"
                stroke="var(--border-default)"
                strokeDasharray="2 2"
              />
              {/* Downwind Transport Vector (kx, ky) */}
              <line
                x1="54"
                y1="54"
                x2={54 + modelVector.kx * 36}
                y2={54 - modelVector.ky * 36}
                stroke="#06b6d4"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <circle
                cx={54 + modelVector.kx * 36}
                cy={54 - modelVector.ky * 36}
                r="3.5"
                fill="#06b6d4"
              />
              {/* Orthogonal Crosswind Axis (cx, cy) */}
              <line
                x1={54 - modelVector.cx * 22}
                y1={54 + modelVector.cy * 22}
                x2={54 + modelVector.cx * 22}
                y2={54 - modelVector.cy * 22}
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeDasharray="3 2"
              />
              <text x="54" y="10" fill="var(--text-tertiary)" fontSize="9" textAnchor="middle">
                С (+Y)
              </text>
              <text x="100" y="57" fill="var(--text-tertiary)" fontSize="9" textAnchor="middle">
                В (+X)
              </text>
            </svg>

            <div className="flex-1 space-y-1.5 text-xs font-mono tabular-nums">
              <div className="flex justify-between">
                <span style={{ color: "var(--text-tertiary)" }}>k_x (sin θ):</span>
                <span className="font-semibold text-cyan-300">{modelVector.kx.toFixed(3)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--text-tertiary)" }}>k_y (cos θ):</span>
                <span className="font-semibold text-cyan-300">{modelVector.ky.toFixed(3)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--text-tertiary)" }}>u_x / u_y:</span>
                <span style={{ color: "var(--text-primary)" }}>
                  {modelVector.uxMs.toFixed(2)} / {modelVector.uyMs.toFixed(2)} м/с
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--text-tertiary)" }}>Попер. (c_x, c_y):</span>
                <span className="text-amber-300">
                  ({modelVector.cx.toFixed(2)}, {modelVector.cy.toFixed(2)})
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Wind Rose Analysis Panel */}
      <div className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Классическая роза ветров (16 румбов) — статистика сноса примесей
            </h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              Клик по сектору розы ветров задаёт преобладающий вектор переноса и среднюю скорость в
              модели шлейфа
              {historySource ? ` · Архив: ${historySource}` : ""}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            {([7, 30, 90] as const).map((days) => (
              <button
                key={days}
                onClick={() => setPeriodDays(days)}
                className="px-2.5 py-1 rounded text-xs font-mono transition-colors"
                style={{
                  backgroundColor:
                    periodDays === days ? "rgba(6, 182, 212, 0.15)" : "var(--bg-tertiary)",
                  color: periodDays === days ? "var(--accent)" : "var(--text-secondary)",
                  border:
                    periodDays === days
                      ? "1px solid rgba(6, 182, 212, 0.4)"
                      : "1px solid var(--border-default)",
                }}
              >
                {days} сут
              </button>
            ))}
          </div>
        </div>

        {historyError && (
          <div className="text-xs py-3 px-3 rounded mb-3" style={{ color: "var(--danger)" }}>
            {historyError}
          </div>
        )}

        {historyLoading && !windRose ? (
          <div className="py-16 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>
            Загрузка архива наблюдений за {periodDays} суток…
          </div>
        ) : windRose ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            {/* Polar Wind Rose SVG */}
            <div className="lg:col-span-6 flex flex-col items-center">
              <svg viewBox="0 0 380 380" className="w-full max-w-[380px] select-none">
                {/* Concentric Frequency Rings */}
                {[0.25, 0.5, 0.75, 1].map((frac) => {
                  const r = 24 + frac * 136;
                  const pct = (frac * maxSectorFreq).toFixed(0);
                  return (
                    <g key={frac}>
                      <circle
                        cx="190"
                        cy="190"
                        r={r}
                        fill="none"
                        stroke="var(--border-default)"
                        strokeDasharray="3 3"
                      />
                      <text
                        x="194"
                        y={190 - r + 10}
                        fill="var(--text-tertiary)"
                        fontSize="9"
                        fontFamily="monospace"
                      >
                        {pct}%
                      </text>
                    </g>
                  );
                })}

                {/* Inner Calm Circle */}
                <circle
                  cx="190"
                  cy="190"
                  r="24"
                  fill="var(--bg-tertiary)"
                  stroke="var(--border-default)"
                />
                <text
                  x="190"
                  y="188"
                  textAnchor="middle"
                  fill="var(--text-secondary)"
                  fontSize="8"
                  fontFamily="monospace"
                >
                  Штиль
                </text>
                <text
                  x="190"
                  y="199"
                  textAnchor="middle"
                  fill="var(--accent)"
                  fontSize="9"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {windRose.calmPct.toFixed(1)}%
                </text>

                {/* Stacked Sector Petals */}
                {windRose.sectors.map((sec) => {
                  const halfAngle = (Math.PI / 16) * 0.82;
                  const azRad = ((sec.centerDeg - 90) * Math.PI) / 180;
                  let rInner = 24;

                  return (
                    <g
                      key={sec.sector}
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredSector(sec.sector)}
                      onMouseLeave={() => setHoveredSector(null)}
                      onClick={() => applySectorWind(sec.centerDeg, sec.meanSpeedMs)}
                    >
                      {WIND_SPEED_BINS.map((bin, bIdx) => {
                        const freq = sec.binFreqPct[bIdx] ?? 0;
                        if (freq <= 0.05) return null;
                        const deltaR = (freq / maxSectorFreq) * 136;
                        const rOuter = rInner + deltaR;
                        const d = describePolarAnnularSector(
                          190,
                          190,
                          rInner,
                          rOuter,
                          azRad - halfAngle,
                          azRad + halfAngle,
                        );
                        rInner = rOuter;
                        return (
                          <path
                            key={bin.label}
                            d={d}
                            fill={bin.color}
                            fillOpacity={hoveredSector === sec.sector ? 1 : 0.86}
                            stroke="#0f172a"
                            strokeWidth="0.7"
                          />
                        );
                      })}

                      {/* Sector Cardinal Label */}
                      <text
                        x={190 + Math.cos(azRad) * 172}
                        y={190 + Math.sin(azRad) * 172 + 3}
                        textAnchor="middle"
                        fill={
                          hoveredSector === sec.sector ||
                          sec.sector === windRose.dominantMeteoSector
                            ? "#06b6d4"
                            : "var(--text-secondary)"
                        }
                        fontSize={sec.centerDeg % 90 === 0 ? "11" : "9"}
                        fontWeight={sec.centerDeg % 90 === 0 ? "bold" : "normal"}
                        fontFamily="monospace"
                      >
                        {sec.sector}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Speed Bins Legend */}
              <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
                {WIND_SPEED_BINS.map((b) => (
                  <div key={b.label} className="flex items-center gap-1.5 text-xs font-mono">
                    <span
                      className="w-2.5 h-2.5 rounded-sm inline-block"
                      style={{ backgroundColor: b.color }}
                    />
                    <span style={{ color: "var(--text-tertiary)" }}>{b.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Sector Summary & Statistics Table */}
            <div className="lg:col-span-6 space-y-4">
              <div className="grid grid-cols-3 gap-3 font-mono tabular-nums">
                <div
                  className="p-3 rounded-lg border"
                  style={{
                    backgroundColor: "var(--bg-tertiary)",
                    borderColor: "var(--border-default)",
                  }}
                >
                  <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    Преобладает (откуда)
                  </div>
                  <div className="text-lg font-bold text-cyan-300 mt-0.5">
                    {windRose.dominantMeteoSector} ({windRose.dominantMeteoDeg}°)
                  </div>
                </div>
                <div
                  className="p-3 rounded-lg border"
                  style={{
                    backgroundColor: "var(--bg-tertiary)",
                    borderColor: "var(--border-default)",
                  }}
                >
                  <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    Основной снос шлейфа
                  </div>
                  <div className="text-lg font-bold text-amber-300 mt-0.5">
                    → {windRose.dominantTransportSector} ({windRose.dominantTransportDeg}°)
                  </div>
                </div>
                <div
                  className="p-3 rounded-lg border"
                  style={{
                    backgroundColor: "var(--bg-tertiary)",
                    borderColor: "var(--border-default)",
                  }}
                >
                  <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    Средняя скорость
                  </div>
                  <div
                    className="text-lg font-bold mt-0.5"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {windRose.meanWindSpeedMs.toFixed(1)} м/с
                  </div>
                </div>
              </div>

              {hoveredStat && (
                <div
                  className="p-2.5 rounded-lg border text-xs font-mono tabular-nums flex items-center justify-between"
                  style={{
                    backgroundColor: "rgba(6, 182, 212, 0.08)",
                    borderColor: "rgba(6, 182, 212, 0.3)",
                  }}
                >
                  <span className="font-bold text-cyan-300">
                    Румб {hoveredStat.sector} ({hoveredStat.centerDeg}°)
                  </span>
                  <span>Повторяемость: {hoveredStat.totalFreqPct.toFixed(1)}%</span>
                  <span>Ср. скорость: {hoveredStat.meanSpeedMs.toFixed(1)} м/с</span>
                </div>
              )}

              <div
                className="max-h-60 overflow-y-auto rounded-lg border"
                style={{ borderColor: "var(--border-default)" }}
              >
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead style={{ backgroundColor: "var(--bg-tertiary)" }}>
                    <tr>
                      <th className="py-2 px-3 text-left">Румб</th>
                      <th className="py-2 px-3 text-right">Азимут</th>
                      <th className="py-2 px-3 text-right">Повторяемость</th>
                      <th className="py-2 px-3 text-right">Ср. скорость</th>
                      <th className="py-2 px-3 text-right">Наблюд.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {windRose.sectors.map((sec) => (
                      <tr
                        key={sec.sector}
                        onClick={() => applySectorWind(sec.centerDeg, sec.meanSpeedMs)}
                        className="cursor-pointer transition-colors hover:bg-slate-800/40"
                        style={{ borderTop: "1px solid var(--border-default)" }}
                      >
                        <td
                          className="py-1.5 px-3 font-bold"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {sec.sector}
                        </td>
                        <td
                          className="py-1.5 px-3 text-right"
                          style={{ color: "var(--text-tertiary)" }}
                        >
                          {sec.centerDeg}°
                        </td>
                        <td className="py-1.5 px-3 text-right text-cyan-300 font-semibold">
                          {sec.totalFreqPct.toFixed(1)}%
                        </td>
                        <td
                          className="py-1.5 px-3 text-right"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {sec.meanSpeedMs.toFixed(1)} м/с
                        </td>
                        <td
                          className="py-1.5 px-3 text-right"
                          style={{ color: "var(--text-tertiary)" }}
                        >
                          {sec.sampleCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function describePolarAnnularSector(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startAngle: number,
  endAngle: number,
): string {
  const x1 = cx + rOuter * Math.cos(startAngle);
  const y1 = cy + rOuter * Math.sin(startAngle);
  const x2 = cx + rOuter * Math.cos(endAngle);
  const y2 = cy + rOuter * Math.sin(endAngle);
  const x3 = cx + rInner * Math.cos(endAngle);
  const y3 = cy + rInner * Math.sin(endAngle);
  const x4 = cx + rInner * Math.cos(startAngle);
  const y4 = cy + rInner * Math.sin(startAngle);

  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${rOuter.toFixed(2)} ${rOuter.toFixed(2)} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${rInner.toFixed(2)} ${rInner.toFixed(2)} 0 0 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    "Z",
  ].join(" ");
}
