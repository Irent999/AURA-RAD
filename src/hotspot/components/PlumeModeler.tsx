import { useState } from "react";
import { formatArrivalTime } from "../lib/dispersion";
import {
  Wind,
  Thermometer,
  Cloud,
  Mountain,
  Building2,
  Activity,
  Play,
  Download,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  MapPin,
  Shield,
  Zap,
  Boxes,
} from "lucide-react";
import type { DispersionInput, DispersionResult, StabilityClass, ReleaseType } from "../lib/types";
import { STABILITY_CLASS_DATA, ISOTOPE_LIBRARY } from "../lib/isotopes";
import { formatDose, formatActivity, formatDistance } from "../lib/dispersion";
import { PlumeVisualization } from "./PlumeVisualization";
import { Plume3DView } from "../../renderer/simulation/plume3d";

interface PlumeModelerProps {
  input: DispersionInput;
  setInput: (input: DispersionInput) => void;
  result: DispersionResult | null;
  onRunCalculation: () => void;
}

export function PlumeModeler({ input, setInput, result, onRunCalculation }: PlumeModelerProps) {
  const [activeSection, setActiveSection] = useState<string>("source");
  const [showResults, setShowResults] = useState(true);

  const update = (section: keyof DispersionInput, field: string, value: unknown) => {
    setInput({
      ...input,
      [section]: {
        ...(input[section] as unknown as Record<string, unknown>),
        [field]: value,
      },
    });
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
            Gaussian dispersion · dose assessment
          </p>
        </div>

        <div className="p-4 space-y-3">
          <Section
            id="source"
            label="Source Term"
            icon={Activity}
            isActive={activeSection === "source"}
            onToggle={() => toggleSection("source")}
          >
            <Field label="Isotope">
              <select
                className="input-field"
                value={input.sourceTerm.isotope}
                onChange={(e) => update("sourceTerm", "isotope", e.target.value)}
              >
                {ISOTOPE_LIBRARY.map((iso) => (
                  <option key={iso.symbol} value={iso.symbol}>
                    {iso.name} ({iso.symbol})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Activity (Bq)">
              <input
                type="number"
                className="input-field"
                value={input.sourceTerm.activity}
                onChange={(e) => update("sourceTerm", "activity", parseFloat(e.target.value) || 0)}
                step="1e12"
              />
              <UnitHint text={formatActivity(input.sourceTerm.activity)} />
            </Field>
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
          <ResultsPanel result={result} />
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

function ResultsPanel({ result }: { result: DispersionResult }) {
  const [activeTab, setActiveTab] = useState<"table" | "chart" | "map" | "3d" | "actions">("table");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div
        className="flex items-center gap-1 px-4 py-2 border-b"
        style={{ borderColor: "var(--border-default)" }}
      >
        {(
          [
            { id: "table", label: "Results Table", icon: Activity },
            { id: "chart", label: "Dose Chart", icon: Zap },
            { id: "map", label: "Plume Footprint", icon: MapPin },
            { id: "3d", label: "3D Plume (WebGL)", icon: Boxes },
            { id: "actions", label: "Protective Actions", icon: Shield },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors"
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

      <div className="flex-1 overflow-y-auto">
        {activeTab === "table" && <ResultsTable result={result} />}
        {activeTab === "chart" && <DoseChartView result={result} />}
        {activeTab === "map" && <PlumeVisualization result={result} />}
        {activeTab === "3d" && <Plume3DView />}
        {activeTab === "actions" && <ProtectiveActionsView result={result} />}
      </div>
    </div>
  );
}

function ResultsTable({ result }: { result: DispersionResult }) {
  return (
    <div className="p-4">
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
            {result.results.map((r, i) => (
              <tr
                key={i}
                className="border-t transition-colors hover:bg-opacity-50"
                style={{ borderColor: "var(--border-default)" }}
              >
                <td
                  className="px-3 py-2 whitespace-nowrap font-medium"
                  style={{ color: "var(--text-primary)" }}
                >
                  {formatDistance(r.distance)}
                </td>
                <td
                  className="px-3 py-2 whitespace-nowrap font-mono text-xs"
                  style={{ color: "var(--accent)" }}
                >
                  {r.centerlineConcentration > 0 ? r.centerlineConcentration.toExponential(2) : "—"}
                </td>
                <td
                  className="px-3 py-2 whitespace-nowrap"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {r.crosswindSpread.toFixed(0)}
                </td>
                <td
                  className="px-3 py-2 whitespace-nowrap"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {r.verticalSpread.toFixed(0)}
                </td>
                <td
                  className="px-3 py-2 whitespace-nowrap"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {formatDose(r.cloudDose)}
                </td>
                <td
                  className="px-3 py-2 whitespace-nowrap"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {formatDose(r.inhalationDose)}
                </td>
                <td
                  className="px-3 py-2 whitespace-nowrap font-bold"
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
                  className="px-3 py-2 whitespace-nowrap"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {formatDose(r.thyroidDose)}
                </td>
                <td
                  className="px-3 py-2 whitespace-nowrap text-xs"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {r.arrivalTimeFormatted ?? formatArrivalTime(r.arrivalTime)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DoseChartView({ result }: { result: DispersionResult }) {
  const w = 900;
  const h = 400;
  const pad = 60;
  const maxDose = Math.max(...result.results.map((r) => r.totalEffectiveDose), 1e-10);
  const maxDist = Math.max(...result.results.map((r) => r.distance));

  const xScale = (d: number) => pad + (d / maxDist) * (w - pad * 2);
  const yScale = (dose: number) => h - pad - (dose / maxDose) * (h - pad * 2);

  const doseLine = result.results
    .map((r) => `${xScale(r.distance)},${yScale(r.totalEffectiveDose)}`)
    .join(" ");
  const cloudLine = result.results
    .map((r) => `${xScale(r.distance)},${yScale(r.cloudDose)}`)
    .join(" ");
  const inhaleLine = result.results
    .map((r) => `${xScale(r.distance)},${yScale(r.inhalationDose)}`)
    .join(" ");

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="p-4">
      <div className="panel p-4">
        <div className="flex items-center gap-4 mb-3">
          <LegendItem color="var(--danger)" label="Total Effective Dose" />
          <LegendItem color="var(--accent)" label="Cloud Dose" />
          <LegendItem color="var(--warning)" label="Inhalation Dose" />
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
          {gridLines.map((g) => (
            <line
              key={g}
              x1={pad}
              y1={pad + g * (h - pad * 2)}
              x2={w - pad}
              y2={pad + g * (h - pad * 2)}
              stroke="var(--border-default)"
              strokeWidth="0.5"
              strokeDasharray="4 4"
            />
          ))}
          <line
            x1={pad}
            y1={h - pad}
            x2={w - pad}
            y2={h - pad}
            stroke="var(--border-light)"
            strokeWidth="1"
          />
          <line
            x1={pad}
            y1={pad}
            x2={pad}
            y2={h - pad}
            stroke="var(--border-light)"
            strokeWidth="1"
          />

          <polyline points={doseLine} fill="none" stroke="var(--danger)" strokeWidth="2.5" />
          <polyline points={cloudLine} fill="none" stroke="var(--accent)" strokeWidth="2" />
          <polyline points={inhaleLine} fill="none" stroke="var(--warning)" strokeWidth="2" />

          {result.results.map((r, i) => (
            <g key={i}>
              <circle
                cx={xScale(r.distance)}
                cy={yScale(r.totalEffectiveDose)}
                r="3"
                fill="var(--danger)"
              />
            </g>
          ))}

          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <text
              key={g}
              x={pad - 8}
              y={pad + g * (h - pad * 2) + 4}
              fill="var(--text-tertiary)"
              fontSize="10"
              textAnchor="end"
            >
              {formatDose(maxDose * (1 - g))}
            </text>
          ))}

          <text
            x={w / 2}
            y={h - pad + 30}
            fill="var(--text-tertiary)"
            fontSize="11"
            textAnchor="middle"
          >
            Downwind Distance (m)
          </text>
          <text
            x={20}
            y={h / 2}
            fill="var(--text-tertiary)"
            fontSize="11"
            textAnchor="middle"
            transform={`rotate(-90 20 ${h / 2})`}
          >
            Dose (Sv)
          </text>
        </svg>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
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
