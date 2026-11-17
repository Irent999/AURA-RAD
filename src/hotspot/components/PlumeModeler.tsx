import { useState, Fragment } from "react";
import {
  formatArrivalTime,
  convertActivityToBq,
  getNormalizedSourceMix,
  getTotalMixActivityBq,
} from "../lib/dispersion";
import {
  Wind,
  Mountain,
  Activity,
  Play,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  MapPin,
  Shield,
  Zap,
  Boxes,
  Plus,
  Trash2,
  Layers,
  RefreshCw,
  Compass,
} from "lucide-react";
import type {
  ActivityUnit,
  DispersionInput,
  DispersionResult,
  StabilityClass,
  ReleaseType,
  SourceMixItem,
} from "../lib/types";
import { STABILITY_CLASS_DATA, ISOTOPE_LIBRARY } from "../lib/isotopes";
import { formatDose, formatActivity, formatDistance } from "../lib/dispersion";
import {
  fetchCurrentMeteo,
  calculateTransportVector,
  estimatePasquillStability,
} from "../lib/meteoService";
import { PlumeVisualization } from "./PlumeVisualization";
import { DoseChartView } from "./DoseChartView";
import { WindRoseView } from "./WindRoseView";
import { Plume3DView } from "../../renderer/simulation/plume3d";

interface PlumeModelerProps {
  input: DispersionInput;
  setInput: (input: DispersionInput) => void;
  result: DispersionResult | null;
  onRunCalculation: () => void;
}

const ACTIVITY_UNIT_LABELS: Record<ActivityUnit, string> = {
  TBq: "ТБк",
  Bq: "Бк",
  Ci: "Ки",
};

export function PlumeModeler({ input, setInput, result, onRunCalculation }: PlumeModelerProps) {
  const [activeSection, setActiveSection] = useState<string>("source");
  const [showResults, setShowResults] = useState(true);
  const [meteoSyncing, setMeteoSyncing] = useState(false);
  const [meteoSyncNote, setMeteoSyncNote] = useState<string | null>(null);

  const update = (section: keyof DispersionInput, field: string, value: unknown) => {
    setInput({
      ...input,
      [section]: {
        ...(input[section] as unknown as Record<string, unknown>),
        [field]: value,
      },
    });
  };

  const activeMix: SourceMixItem[] =
    input.sourceTerm.sourceMix && input.sourceTerm.sourceMix.length > 0
      ? input.sourceTerm.sourceMix
      : [
          {
            id: "mix-primary",
            isotope: input.sourceTerm.isotope,
            activity: input.sourceTerm.activity,
            unit: "Bq",
          },
        ];

  const syncSourceMix = (nextMix: SourceMixItem[]) => {
    const normalized = nextMix.map((item) => ({
      ...item,
      activityBq: convertActivityToBq(item.activity, item.unit),
    }));
    const totalBq = normalized.reduce((sum, item) => sum + item.activityBq, 0);
    const dominant = normalized.reduce(
      (best, cur) => (cur.activityBq > best.activityBq ? cur : best),
      normalized[0],
    );

    setInput({
      ...input,
      sourceTerm: {
        ...input.sourceTerm,
        sourceMix: nextMix,
        isotope: dominant?.isotope ?? input.sourceTerm.isotope,
        activity: totalBq,
      },
    });
  };

  const handleAddNuclide = () => {
    const usedSymbols = new Set(activeMix.map((item) => item.isotope));
    const nextIsotope =
      ISOTOPE_LIBRARY.find((iso) => !usedSymbols.has(iso.symbol))?.symbol ??
      ISOTOPE_LIBRARY[0].symbol;
    const newItem: SourceMixItem = {
      id: `mix-${crypto.randomUUID()}`,
      isotope: nextIsotope,
      activity: 10,
      unit: "TBq",
    };
    syncSourceMix([...activeMix, newItem]);
  };

  const handleUpdateMixItem = (id: string, patch: Partial<SourceMixItem>) => {
    const nextMix = activeMix.map((item) => (item.id === id ? { ...item, ...patch } : item));
    syncSourceMix(nextMix);
  };

  const handleRemoveMixItem = (id: string) => {
    if (activeMix.length <= 1) return;
    syncSourceMix(activeMix.filter((item) => item.id !== id));
  };

  const totalMixBq = getTotalMixActivityBq({
    ...input.sourceTerm,
    sourceMix: activeMix,
  });

  const modelVector = calculateTransportVector(
    input.meteorology.windSpeed,
    input.meteorology.windDirection,
    "to",
  );

  const handleSyncLiveMeteo = async () => {
    setMeteoSyncing(true);
    setMeteoSyncNote(null);
    try {
      const obs = await fetchCurrentMeteo(
        input.sourceTerm.latitude,
        input.sourceTerm.longitude,
        true,
      );
      const vec = calculateTransportVector(obs.windSpeedMs, obs.windDirectionDeg, "from");
      const stability = estimatePasquillStability(obs.windSpeedMs);
      setInput({
        ...input,
        meteorology: {
          ...input.meteorology,
          windSpeed: Number(obs.windSpeedMs.toFixed(1)),
          windDirection: Math.round(vec.transportAzimuthDeg),
          airTemperature: Number(obs.temperatureC.toFixed(1)),
          precipitationRate: Number(obs.precipitationMmh.toFixed(1)),
          stabilityClass: stability,
        },
      });
      setMeteoSyncNote(
        `${obs.stationName}: ${obs.windSpeedMs.toFixed(1)} м/с, перенос ${Math.round(vec.transportAzimuthDeg)}°`,
      );
    } catch (err) {
      setMeteoSyncNote(
        err instanceof Error ? `Ошибка: ${err.message}` : "Не удалось загрузить метеоданные",
      );
    } finally {
      setMeteoSyncing(false);
    }
  };

  const toggleSection = (section: string) => {
    setActiveSection(activeSection === section ? "" : section);
  };

  return (
    <div className="flex-1 flex overflow-hidden animate-fadeIn">
      <div
        className="w-96 flex-shrink-0 overflow-y-auto border-r"
        style={{ borderColor: "var(--border-default)", backgroundColor: "var(--bg-secondary)" }}
      >
        <div
          className="px-5 py-4 border-b sticky top-0 z-10"
          style={{ borderColor: "var(--border-default)", backgroundColor: "var(--bg-secondary)" }}
        >
          <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            Plume Modeler
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            Gaussian dispersion · multi-nuclide dose assessment
          </p>
        </div>

        <div className="p-4 space-y-3">
          <Section
            id="source"
            label="Source Term (Inventory Mix)"
            icon={Activity}
            isActive={activeSection === "source"}
            onToggle={() => toggleSection("source")}
          >
            <div
              className="rounded-lg p-2.5 border space-y-2"
              style={{
                backgroundColor: "var(--bg-tertiary)",
                borderColor: "var(--border-default)",
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
                  <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                    Смесь радионуклидов ({activeMix.length})
                  </span>
                </div>
                <span
                  className="text-xs font-mono tabular-nums font-medium"
                  style={{ color: "var(--accent)" }}
                >
                  Σ {formatActivity(totalMixBq)}
                </span>
              </div>

              <div className="space-y-2">
                {activeMix.map((item) => {
                  const itemBq = convertActivityToBq(item.activity, item.unit);
                  const sharePct = totalMixBq > 0 ? (itemBq / totalMixBq) * 100 : 0;

                  return (
                    <div
                      key={item.id}
                      className="rounded-md p-2 border space-y-1.5"
                      style={{
                        backgroundColor: "var(--bg-secondary)",
                        borderColor: "var(--border-default)",
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <select
                          aria-label="Радионуклид"
                          className="input-field flex-1 text-xs py-1.5"
                          value={item.isotope}
                          onChange={(e) =>
                            handleUpdateMixItem(item.id, { isotope: e.target.value })
                          }
                        >
                          {ISOTOPE_LIBRARY.map((iso) => (
                            <option key={iso.symbol} value={iso.symbol}>
                              {iso.symbol} — {iso.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleRemoveMixItem(item.id)}
                          disabled={activeMix.length <= 1}
                          title={
                            activeMix.length <= 1
                              ? "В смеси должен остаться минимум один нуклид"
                              : "Удалить нуклид из смеси"
                          }
                          className="p-1.5 rounded border transition-colors disabled:opacity-35 disabled:cursor-not-allowed hover:border-red-500/50 hover:text-red-400"
                          style={{
                            borderColor: "var(--border-default)",
                            color: "var(--text-tertiary)",
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-5 gap-1.5">
                        <input
                          type="number"
                          aria-label="Активность нуклида"
                          className="input-field col-span-3 font-mono tabular-nums text-xs py-1.5"
                          value={item.activity}
                          min="0"
                          step="any"
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            handleUpdateMixItem(item.id, {
                              activity: Number.isFinite(val) && val >= 0 ? val : 0,
                            });
                          }}
                        />
                        <select
                          aria-label="Единица активности"
                          className="input-field col-span-2 text-xs py-1.5"
                          value={item.unit}
                          onChange={(e) =>
                            handleUpdateMixItem(item.id, {
                              unit: e.target.value as ActivityUnit,
                            })
                          }
                        >
                          {(Object.keys(ACTIVITY_UNIT_LABELS) as ActivityUnit[]).map((u) => (
                            <option key={u} value={u}>
                              {ACTIVITY_UNIT_LABELS[u]}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                        <span style={{ color: "var(--text-tertiary)" }}>
                          = {formatActivity(itemBq)}
                        </span>
                        <span style={{ color: "var(--accent)" }}>{sharePct.toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleAddNuclide}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors hover:bg-cyan-500/10"
                style={{
                  borderColor: "rgba(6, 182, 212, 0.35)",
                  color: "var(--accent)",
                  backgroundColor: "rgba(6, 182, 212, 0.05)",
                }}
              >
                <Plus className="w-3.5 h-3.5" />+ Добавить нуклид
              </button>
            </div>
            <Field label="Release Duration (hours)">
              <input
                type="number"
                className="input-field"
                value={input.sourceTerm.releaseDuration}
                onChange={(e) =>
                  update("sourceTerm", "releaseDuration", parseFloat(e.target.value) || 0)
                }
                step="0.5"
              />
            </Field>
            <Field label="Release Height (m)">
              <input
                type="number"
                className="input-field"
                value={input.sourceTerm.releaseHeight}
                onChange={(e) =>
                  update("sourceTerm", "releaseHeight", parseFloat(e.target.value) || 0)
                }
              />
            </Field>
            <Field label="Release Type">
              <select
                className="input-field"
                value={input.sourceTerm.releaseType}
                onChange={(e) => update("sourceTerm", "releaseType", e.target.value as ReleaseType)}
              >
                <option value="ground">Ground-level</option>
                <option value="elevated">Elevated</option>
                <option value="stack">Stack</option>
              </select>
            </Field>
            <Field label="Physical Form">
              <select
                className="input-field"
                value={input.sourceTerm.physicalForm}
                onChange={(e) => update("sourceTerm", "physicalForm", e.target.value)}
              >
                <option value="gas">Gas</option>
                <option value="particle">Particle</option>
                <option value="liquid">Liquid</option>
                <option value="aerosol">Aerosol</option>
              </select>
            </Field>
            <Field label="Particle Size (µm)">
              <input
                type="number"
                className="input-field"
                value={input.sourceTerm.particleSize}
                onChange={(e) =>
                  update("sourceTerm", "particleSize", parseFloat(e.target.value) || 0)
                }
                step="0.1"
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Latitude (°)">
                <input
                  type="number"
                  className="input-field"
                  value={input.sourceTerm.latitude}
                  onChange={(e) =>
                    update("sourceTerm", "latitude", parseFloat(e.target.value) || 0)
                  }
                  step="0.0001"
                  min="-90"
                  max="90"
                />
              </Field>
              <Field label="Longitude (°)">
                <input
                  type="number"
                  className="input-field"
                  value={input.sourceTerm.longitude}
                  onChange={(e) =>
                    update("sourceTerm", "longitude", parseFloat(e.target.value) || 0)
                  }
                  step="0.0001"
                  min="-180"
                  max="180"
                />
              </Field>
            </div>
          </Section>

          <Section
            id="met"
            label="Meteorology"
            icon={Wind}
            isActive={activeSection === "met"}
            onToggle={() => toggleSection("met")}
          >
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={handleSyncLiveMeteo}
                disabled={meteoSyncing}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors hover:bg-cyan-500/10 disabled:opacity-50"
                style={{
                  borderColor: "rgba(6, 182, 212, 0.35)",
                  color: "var(--accent)",
                  backgroundColor: "rgba(6, 182, 212, 0.06)",
                }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${meteoSyncing ? "animate-spin" : ""}`} />
                {meteoSyncing ? "Загрузка погоды..." : "Синхр. погоду (Узгидромет / API)"}
              </button>
              {meteoSyncNote && (
                <div
                  className="text-[11px] font-mono px-2 py-1 rounded border"
                  style={{
                    backgroundColor: "var(--bg-tertiary)",
                    borderColor: "var(--border-default)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {meteoSyncNote}
                </div>
              )}
            </div>
            <Field label="Wind Speed (m/s)">
              <input
                type="number"
                className="input-field"
                value={input.meteorology.windSpeed}
                onChange={(e) =>
                  update("meteorology", "windSpeed", parseFloat(e.target.value) || 0)
                }
                step="0.5"
              />
            </Field>
            <Field label="Wind Direction (°)">
              <input
                type="number"
                className="input-field"
                value={input.meteorology.windDirection}
                onChange={(e) =>
                  update("meteorology", "windDirection", parseFloat(e.target.value) || 0)
                }
                min="0"
                max="360"
              />
              <CompassRose direction={input.meteorology.windDirection} />
              <div
                className="grid grid-cols-2 gap-1.5 mt-1.5 px-2 py-1.5 rounded text-[11px] font-mono tabular-nums border"
                style={{
                  backgroundColor: "var(--bg-tertiary)",
                  borderColor: "var(--border-default)",
                  color: "var(--text-secondary)",
                }}
              >
                <span>
                  kₓ (E):{" "}
                  <strong style={{ color: "var(--accent)" }}>{modelVector.kx.toFixed(3)}</strong>
                </span>
                <span>
                  kᵧ (N):{" "}
                  <strong style={{ color: "var(--accent)" }}>{modelVector.ky.toFixed(3)}</strong>
                </span>
                <span>uₓ: {modelVector.uxMs.toFixed(2)} м/с</span>
                <span>uᵧ: {modelVector.uyMs.toFixed(2)} м/с</span>
              </div>
            </Field>
            <Field label="Stability Class">
              <select
                className="input-field"
                value={input.meteorology.stabilityClass}
                onChange={(e) =>
                  update("meteorology", "stabilityClass", e.target.value as StabilityClass)
                }
              >
                {(Object.keys(STABILITY_CLASS_DATA) as StabilityClass[]).map((key) => (
                  <option key={key} value={key}>
                    {STABILITY_CLASS_DATA[key].name}
                  </option>
                ))}
              </select>
              <div
                className="text-xs mt-1 p-2 rounded"
                style={{ backgroundColor: "var(--bg-tertiary)", color: "var(--text-tertiary)" }}
              >
                {STABILITY_CLASS_DATA[input.meteorology.stabilityClass].description}
              </div>
            </Field>
            <Field label="Mixing Height (m)">
              <input
                type="number"
                className="input-field"
                value={input.meteorology.mixingHeight}
                onChange={(e) =>
                  update("meteorology", "mixingHeight", parseFloat(e.target.value) || 0)
                }
                step="100"
              />
            </Field>
            <Field label="Temperature (°C)">
              <input
                type="number"
                className="input-field"
                value={input.meteorology.airTemperature}
                onChange={(e) =>
                  update("meteorology", "airTemperature", parseFloat(e.target.value) || 0)
                }
              />
            </Field>
            <Field label="Precipitation (mm/hr)">
              <input
                type="number"
                className="input-field"
                value={input.meteorology.precipitationRate}
                onChange={(e) =>
                  update("meteorology", "precipitationRate", parseFloat(e.target.value) || 0)
                }
                step="0.5"
              />
            </Field>
          </Section>

          <Section
            id="terrain"
            label="Terrain & Receptor"
            icon={Mountain}
            isActive={activeSection === "terrain"}
            onToggle={() => toggleSection("terrain")}
          >
            <Field label="Terrain Type">
              <select
                className="input-field"
                value={input.terrain.terrainType}
                onChange={(e) => update("terrain", "terrainType", e.target.value)}
              >
                <option value="urban">Urban</option>
                <option value="rural">Rural</option>
                <option value="forest">Forest</option>
                <option value="water">Water</option>
                <option value="desert">Desert</option>
              </select>
            </Field>
            <Field label="Surface Roughness (m)">
              <input
                type="number"
                className="input-field"
                value={input.terrain.surfaceRoughness}
                onChange={(e) =>
                  update("terrain", "surfaceRoughness", parseFloat(e.target.value) || 0)
                }
                step="0.01"
              />
            </Field>
            <Field label="Receptor Height (m)">
              <input
                type="number"
                className="input-field"
                value={input.receptorHeight}
                onChange={(e) =>
                  setInput({ ...input, receptorHeight: parseFloat(e.target.value) || 0 })
                }
                step="0.5"
              />
            </Field>
            <div className="flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                id="buildingWake"
                checked={input.terrain.buildingWake}
                onChange={(e) => update("terrain", "buildingWake", e.target.checked)}
                className="rounded"
              />
              <label
                htmlFor="buildingWake"
                className="text-sm"
                style={{ color: "var(--text-secondary)" }}
              >
                Building wake effects
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="complexTerrain"
                checked={input.terrain.complexTerrain}
                onChange={(e) => update("terrain", "complexTerrain", e.target.checked)}
                className="rounded"
              />
              <label
                htmlFor="complexTerrain"
                className="text-sm"
                style={{ color: "var(--text-secondary)" }}
              >
                Complex terrain
              </label>
            </div>
          </Section>

          <Section
            id="distances"
            label="Receptor Distances"
            icon={MapPin}
            isActive={activeSection === "distances"}
            onToggle={() => toggleSection("distances")}
          >
            <Field label="Calculation Type">
              <select
                className="input-field"
                value={input.calculationType}
                onChange={(e) =>
                  setInput({
                    ...input,
                    calculationType: e.target.value as DispersionInput["calculationType"],
                  })
                }
              >
                <option value="plume">Continuous Plume</option>
                <option value="puff">Puff Release</option>
                <option value="shortTerm">Short-term (acute)</option>
                <option value="longTerm">Long-term (chronic)</option>
              </select>
            </Field>
            <Field label="Averaging Time (seconds)">
              <input
                type="number"
                className="input-field"
                value={input.averagingTime}
                onChange={(e) =>
                  setInput({ ...input, averagingTime: parseFloat(e.target.value) || 0 })
                }
                step="60"
              />
            </Field>
            <Field label="Distances (m, comma-separated)">
              <input
                type="text"
                className="input-field font-mono text-xs"
                value={input.distances.join(", ")}
                onChange={(e) =>
                  setInput({
                    ...input,
                    distances: e.target.value
                      .split(",")
                      .map((d) => parseFloat(d.trim()))
                      .filter((d) => !isNaN(d) && d > 0),
                  })
                }
              />
            </Field>
          </Section>

          <div className="flex gap-2 pt-2">
            <button onClick={onRunCalculation} className="btn btn-primary flex-1">
              <Play className="w-4 h-4" />
              Calculate
            </button>
            <button
              onClick={() => setShowResults(!showResults)}
              className="btn btn-secondary"
              title="Toggle results panel"
            >
              {showResults ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {result && showResults ? (
          <ResultsPanel result={result} input={input} setInput={setInput} />
        ) : (
          <div
            className="flex-1 flex items-center justify-center"
            style={{ backgroundColor: "var(--bg-primary)" }}
          >
            <div className="text-center">
              <Activity
                className="w-12 h-12 mx-auto mb-3"
                style={{ color: "var(--text-tertiary)" }}
              />
              <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
                Configure parameters and run a calculation
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  id,
  label,
  icon: Icon,
  isActive,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  icon: typeof Wind;
  isActive: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="panel overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 transition-colors hover:bg-opacity-50"
        style={{ backgroundColor: isActive ? "rgba(6, 182, 212, 0.05)" : "transparent" }}
      >
        <Icon className="w-4 h-4" style={{ color: "var(--accent)" }} />
        <span
          className="text-sm font-medium flex-1 text-left"
          style={{ color: "var(--text-primary)" }}
        >
          {label}
        </span>
        {isActive ? (
          <ChevronDown className="w-4 h-4" style={{ color: "var(--text-tertiary)" }} />
        ) : (
          <ChevronRight className="w-4 h-4" style={{ color: "var(--text-tertiary)" }} />
        )}
      </button>
      {isActive && <div className="px-4 pb-4 space-y-3 animate-fadeIn">{children}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function UnitHint({ text }: { text: string }) {
  return (
    <div className="text-xs mt-1" style={{ color: "var(--accent)" }}>
      = {text}
    </div>
  );
}

function CompassRose({ direction }: { direction: number }) {
  const rad = ((direction - 90) * Math.PI) / 180;
  const cx = 50;
  const cy = 50;
  const r = 30;
  const x = cx + r * Math.cos(rad);
  const y = cy + r * Math.sin(rad);
  return (
    <div className="flex justify-center mt-1">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="35" fill="none" stroke="var(--border-default)" strokeWidth="1" />
        <circle cx="50" cy="50" r="3" fill="var(--accent)" />
        <line x1={cx} y1={cy} x2={x} y2={y} stroke="var(--accent)" strokeWidth="2" />
        <text x="50" y="12" fill="var(--text-tertiary)" fontSize="9" textAnchor="middle">
          N
        </text>
        <text x="50" y="95" fill="var(--text-tertiary)" fontSize="9" textAnchor="middle">
          S
        </text>
        <text x="90" y="54" fill="var(--text-tertiary)" fontSize="9" textAnchor="middle">
          E
        </text>
        <text x="10" y="54" fill="var(--text-tertiary)" fontSize="9" textAnchor="middle">
          W
        </text>
      </svg>
    </div>
  );
}

function ResultsPanel({
  result,
  input,
  setInput,
}: {
  result: DispersionResult;
  input: DispersionInput;
  setInput: (input: DispersionInput) => void;
}) {
  const [activeTab, setActiveTab] = useState<
    "table" | "chart" | "map" | "3d" | "windrose" | "actions"
  >("table");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div
        className="flex items-center gap-1 px-4 py-2 border-b overflow-x-auto"
        style={{ borderColor: "var(--border-default)" }}
      >
        {(
          [
            { id: "table", label: "Results Table", icon: Activity },
            { id: "chart", label: "Dose Chart", icon: Zap },
            { id: "map", label: "Plume Footprint", icon: MapPin },
            { id: "3d", label: "3D Plume (WebGL)", icon: Boxes },
            { id: "windrose", label: "Wind Rose", icon: Compass },
            { id: "actions", label: "Protective Actions", icon: Shield },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors whitespace-nowrap"
              style={{
                backgroundColor: activeTab === tab.id ? "rgba(6, 182, 212, 0.1)" : "transparent",
                color: activeTab === tab.id ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {result.warnings.length > 0 && (
        <div
          className="px-4 py-2 border-b"
          style={{
            borderColor: "rgba(245, 158, 11, 0.2)",
            backgroundColor: "rgba(245, 158, 11, 0.05)",
          }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "var(--warning)" }} />
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {result.warnings[0]}
              {result.warnings.length > 1 && ` (+${result.warnings.length - 1} more)`}
            </span>
          </div>
        </div>
      )}

      <div
        className={activeTab === "3d" ? "flex-1 min-h-0 overflow-hidden" : "flex-1 overflow-y-auto"}
      >
        {activeTab === "table" && <ResultsTable result={result} />}
        {activeTab === "chart" && <DoseChartView result={result} />}
        {activeTab === "map" && <PlumeVisualization result={result} />}
        {activeTab === "3d" && (
          <Plume3DView syncedInput={input} onSyncedInputChange={setInput} embedded />
        )}
        {activeTab === "windrose" && <WindRoseView input={input} setInput={setInput} />}
        {activeTab === "actions" && <ProtectiveActionsView result={result} />}
      </div>
    </div>
  );
}

function ResultsTable({ result }: { result: DispersionResult }) {
  const [expandedDistances, setExpandedDistances] = useState<Record<number, boolean>>({});
  const mix = getNormalizedSourceMix(result.input.sourceTerm);
  const totalMixBq = getTotalMixActivityBq(result.input.sourceTerm);
  const hasMultipleNuclides = mix.length > 1;
  const allExpanded =
    result.results.length > 0 &&
    result.results.every((r) => Boolean(expandedDistances[r.distance]));

  const toggleRow = (distance: number) => {
    setExpandedDistances((prev) => ({ ...prev, [distance]: !prev[distance] }));
  };

  const toggleAllRows = () => {
    if (allExpanded) {
      setExpandedDistances({});
    } else {
      const next: Record<number, boolean> = {};
      for (const r of result.results) next[r.distance] = true;
      setExpandedDistances(next);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div
        className="panel px-4 py-2.5 flex flex-wrap items-center justify-between gap-2"
        style={{ backgroundColor: "var(--bg-secondary)" }}
      >
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
            Активная смесь ({mix.length}):
          </span>
          {mix.map((m) => (
            <span
              key={m.id}
              className="px-2 py-0.5 rounded font-mono tabular-nums"
              style={{
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-default)",
              }}
            >
              {m.isotope}: {formatActivity(m.activityBq)}
            </span>
          ))}
          <span className="font-mono tabular-nums font-semibold" style={{ color: "var(--accent)" }}>
            Σ {formatActivity(totalMixBq)}
          </span>
        </div>

        <button
          type="button"
          onClick={toggleAllRows}
          className="text-xs px-2.5 py-1 rounded border transition-colors"
          style={{
            borderColor: "var(--border-default)",
            color: allExpanded ? "var(--accent)" : "var(--text-secondary)",
            backgroundColor: allExpanded ? "rgba(6, 182, 212, 0.08)" : "var(--bg-tertiary)",
          }}
        >
          {allExpanded ? "Скрыть вклад нуклидов" : "Разбивка по нуклидам"}
        </button>
      </div>

      <div className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: "var(--bg-tertiary)" }}>
              {[
                "Distance",
                "Concentration",
                "σy",
                "σz",
                "Cloud Dose",
                "Inhalation",
                "Total Dose",
                "Thyroid",
                "Arrival",
              ].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left text-xs font-medium whitespace-nowrap"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.results.map((r) => {
              const breakdown = r.nuclideBreakdown ?? [];
              const isExpanded = Boolean(expandedDistances[r.distance]);
              const canExpand = breakdown.length > 0;

              return (
                <Fragment key={r.distance}>
                  <tr
                    onClick={() => canExpand && toggleRow(r.distance)}
                    className={`border-t transition-colors ${canExpand ? "cursor-pointer hover:bg-white/[0.02]" : ""}`}
                    style={{ borderColor: "var(--border-default)" }}
                  >
                    <td
                      className="px-3 py-2 whitespace-nowrap font-medium font-mono tabular-nums"
                      style={{ color: "var(--text-primary)" }}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {canExpand &&
                          (isExpanded ? (
                            <ChevronDown
                              className="w-3.5 h-3.5"
                              style={{ color: "var(--accent)" }}
                            />
                          ) : (
                            <ChevronRight
                              className="w-3.5 h-3.5"
                              style={{ color: "var(--text-tertiary)" }}
                            />
                          ))}
                        {formatDistance(r.distance)}
                      </span>
                    </td>
                    <td
                      className="px-3 py-2 whitespace-nowrap font-mono tabular-nums text-xs"
                      style={{ color: "var(--accent)" }}
                    >
                      {r.centerlineConcentration > 0
                        ? r.centerlineConcentration.toExponential(2)
                        : "—"}
                    </td>
                    <td
                      className="px-3 py-2 whitespace-nowrap font-mono tabular-nums"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {r.crosswindSpread.toFixed(0)}
                    </td>
                    <td
                      className="px-3 py-2 whitespace-nowrap font-mono tabular-nums"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {r.verticalSpread.toFixed(0)}
                    </td>
                    <td
                      className="px-3 py-2 whitespace-nowrap font-mono tabular-nums"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {formatDose(r.cloudDose)}
                    </td>
                    <td
                      className="px-3 py-2 whitespace-nowrap font-mono tabular-nums"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {formatDose(r.inhalationDose)}
                    </td>
                    <td
                      className="px-3 py-2 whitespace-nowrap font-bold font-mono tabular-nums"
                      style={{
                        color:
                          r.totalEffectiveDose >= 0.1
                            ? "var(--danger)"
                            : r.totalEffectiveDose >= 0.01
                              ? "var(--warning)"
                              : "var(--text-primary)",
                      }}
                    >
                      {formatDose(r.totalEffectiveDose)}
                    </td>
                    <td
                      className="px-3 py-2 whitespace-nowrap font-mono tabular-nums"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {formatDose(r.thyroidDose)}
                    </td>
                    <td
                      className="px-3 py-2 whitespace-nowrap text-xs font-mono tabular-nums"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      {r.arrivalTimeFormatted ?? formatArrivalTime(r.arrivalTime)}
                    </td>
                  </tr>

                  {isExpanded &&
                    breakdown.map((b) => {
                      const doseSharePct =
                        r.totalEffectiveDose > 0
                          ? (b.totalEffectiveDose / r.totalEffectiveDose) * 100
                          : 0;
                      return (
                        <tr
                          key={`${r.distance}-${b.id}`}
                          className="border-t text-xs"
                          style={{
                            borderColor: "var(--border-default)",
                            backgroundColor: "rgba(6, 182, 212, 0.03)",
                          }}
                        >
                          <td
                            className="pl-8 pr-3 py-1.5 whitespace-nowrap font-mono tabular-nums"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            <span className="font-semibold" style={{ color: "var(--accent)" }}>
                              {b.isotope}
                            </span>
                            {hasMultipleNuclides && (
                              <span
                                className="ml-1.5 text-[11px]"
                                style={{ color: "var(--text-tertiary)" }}
                              >
                                ({doseSharePct.toFixed(1)}%)
                              </span>
                            )}
                          </td>
                          <td
                            className="px-3 py-1.5 whitespace-nowrap font-mono tabular-nums"
                            style={{ color: "var(--text-tertiary)" }}
                          >
                            {b.concentration > 0 ? b.concentration.toExponential(2) : "—"}
                          </td>
                          <td
                            className="px-3 py-1.5 whitespace-nowrap font-mono"
                            style={{ color: "var(--text-tertiary)" }}
                          >
                            —
                          </td>
                          <td
                            className="px-3 py-1.5 whitespace-nowrap font-mono"
                            style={{ color: "var(--text-tertiary)" }}
                          >
                            —
                          </td>
                          <td
                            className="px-3 py-1.5 whitespace-nowrap font-mono tabular-nums"
                            style={{ color: "var(--text-tertiary)" }}
                          >
                            {formatDose(b.cloudDose)}
                          </td>
                          <td
                            className="px-3 py-1.5 whitespace-nowrap font-mono tabular-nums"
                            style={{ color: "var(--text-tertiary)" }}
                          >
                            {formatDose(b.inhalationDose)}
                          </td>
                          <td
                            className="px-3 py-1.5 whitespace-nowrap font-mono tabular-nums font-semibold"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {formatDose(b.totalEffectiveDose)}
                          </td>
                          <td
                            className="px-3 py-1.5 whitespace-nowrap font-mono tabular-nums"
                            style={{ color: "var(--text-tertiary)" }}
                          >
                            {formatDose(b.thyroidDose)}
                          </td>
                          <td
                            className="px-3 py-1.5 whitespace-nowrap font-mono"
                            style={{ color: "var(--text-tertiary)" }}
                          >
                            —
                          </td>
                        </tr>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProtectiveActionsView({ result }: { result: DispersionResult }) {
  const levelColors: Record<string, string> = {
    emergency: "var(--danger)",
    alert: "var(--warning)",
    caution: "var(--info)",
    advisory: "var(--success)",
  };

  const levelLabels: Record<string, string> = {
    emergency: "EMERGENCY",
    alert: "ALERT",
    caution: "CAUTION",
    advisory: "ADVISORY",
  };

  const uniqueActions = result.protectiveActions.filter(
    (a, i, self) => i === self.findIndex((s) => s.action === a.action && s.distance === a.distance),
  );

  return (
    <div className="p-4 space-y-2">
      {uniqueActions.length === 0 ? (
        <div className="text-center py-12" style={{ color: "var(--text-tertiary)" }}>
          No protective actions required for this scenario
        </div>
      ) : (
        uniqueActions
          .sort((a, b) => a.distance - b.distance)
          .map((action, i) => (
            <div
              key={i}
              className="panel p-4 animate-slideInRight"
              style={{ borderLeft: `3px solid ${levelColors[action.level]}` }}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="badge"
                      style={{
                        backgroundColor: `${levelColors[action.level]}20`,
                        color: levelColors[action.level],
                      }}
                    >
                      {levelLabels[action.level]}
                    </span>
                    <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                      {formatDistance(action.distance)}
                    </span>
                  </div>
                  <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {action.action}
                  </div>
                  <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
                    {action.criteria}
                  </div>
                </div>
                <Shield
                  className="w-5 h-5 flex-shrink-0"
                  style={{ color: levelColors[action.level] }}
                />
              </div>
            </div>
          ))
      )}
    </div>
  );
}
