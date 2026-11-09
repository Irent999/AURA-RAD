import {
  Radiation,
  Wind,
  Activity,
  AlertTriangle,
  TrendingUp,
  MapPin,
  Clock,
  ArrowRight,
  Gauge,
  Boxes,
} from "lucide-react";
import type { DispersionInput, DispersionResult, CalculationHistoryEntry } from "../lib/types";
import type { ViewName } from "../App";
import { formatDose, formatActivity, formatDistance } from "../lib/dispersion";
import { getIsotope } from "../lib/isotopes";

interface DashboardProps {
  input: DispersionInput;
  result: DispersionResult | null;
  onRunCalculation: () => void;
  onNavigate: (view: ViewName) => void;
  history: CalculationHistoryEntry[];
}

export function Dashboard({
  input,
  result,
  onRunCalculation,
  onNavigate,
  history,
}: DashboardProps) {
  const isotope = getIsotope(input.sourceTerm.isotope);

  const stats = [
    {
      label: "Source Activity",
      value: formatActivity(input.sourceTerm.activity),
      icon: Activity,
      color: "var(--accent)",
    },
    {
      label: "Wind Speed",
      value: `${input.meteorology.windSpeed} m/s`,
      icon: Wind,
      color: "var(--info)",
    },
    {
      label: "Stability",
      value: input.meteorology.stabilityClass,
      icon: Gauge,
      color: "var(--success)",
    },
    {
      label: "Isotope",
      value: input.sourceTerm.isotope,
      icon: Radiation,
      color: "var(--warning)",
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto animate-fadeIn">
      <div className="max-w-7xl mx-auto px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
              Mission Dashboard
            </h1>
            <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
              Atmospheric dispersion modeling · radiological emergency response
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate("plume3d")}
              className="btn btn-secondary flex items-center gap-2"
              title="Open Three.js 3D Atmospheric Dispersion Simulator"
            >
              <Boxes className="w-4 h-4 text-cyan-400" />
              3D Plume Simulator
            </button>
            <button onClick={onRunCalculation} className="btn btn-primary pulse-glow">
              <Activity className="w-4 h-4" />
              Run Calculation
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="panel p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium" style={{ color: "var(--text-tertiary)" }}>
                    {stat.label}
                  </span>
                  <Icon className="w-4 h-4" style={{ color: stat.color }} />
                </div>
                <div className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                  {stat.value}
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="panel p-5 col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Protective Action Zones
              </h2>
              <span className="badge badge-info">
                <MapPin className="w-3 h-3" />
                EPA PAGs
              </span>
            </div>
            {result ? (
              <div className="space-y-3">
                <ZoneBar
                  label="Exclusion Zone"
                  detail="Evacuation required (>= 100 mSv)"
                  distance={result.zoneSummary.exclusionZone}
                  maxDist={50000}
                  color="var(--danger)"
                  formatDist={formatDistance}
                />
                <ZoneBar
                  label="Contamination Zone"
                  detail="Access restricted (>= 10 mSv)"
                  distance={result.zoneSummary.contaminationZone}
                  maxDist={50000}
                  color="var(--warning)"
                  formatDist={formatDistance}
                />
                <ZoneBar
                  label="Ingestion Zone"
                  detail="Advisory (>= 1 mSv)"
                  distance={result.zoneSummary.ingestionZone}
                  maxDist={50000}
                  color="var(--info)"
                  formatDist={formatDistance}
                />
              </div>
            ) : (
              <div className="text-sm py-8 text-center" style={{ color: "var(--text-tertiary)" }}>
                Run a calculation to see protective action zones
              </div>
            )}
          </div>

          <div className="panel p-5">
            <h2 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
              Key Results
            </h2>
            {result ? (
              <div className="space-y-4">
                <div>
                  <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    Maximum Dose
                  </div>
                  <div className="text-lg font-bold" style={{ color: "var(--danger)" }}>
                    {formatDose(result.maxDoseDistance.value)}
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    at {formatDistance(result.maxDoseDistance.distance)}
                  </div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    Peak Concentration
                  </div>
                  <div className="text-lg font-bold" style={{ color: "var(--accent)" }}>
                    {result.maxConcentration.value.toExponential(2)} Bq/m³
                  </div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    Protective Actions
                  </div>
                  <div className="text-lg font-bold" style={{ color: "var(--warning)" }}>
                    {result.protectiveActions.length}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm py-8 text-center" style={{ color: "var(--text-tertiary)" }}>
                No results yet
              </div>
            )}
          </div>
        </div>

        {result && result.warnings.length > 0 && (
          <div className="panel p-4 mb-6" style={{ borderColor: "rgba(245, 158, 11, 0.3)" }}>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4" style={{ color: "var(--warning)" }} />
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Calculation Warnings
              </span>
            </div>
            <ul className="space-y-1">
              {result.warnings.map((w, i) => (
                <li key={i} className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  • {w}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="panel p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Dose vs. Distance
              </h2>
              <TrendingUp className="w-4 h-4" style={{ color: "var(--text-tertiary)" }} />
            </div>
            {result ? (
              <DoseChart results={result.results} />
            ) : (
              <div className="text-sm py-12 text-center" style={{ color: "var(--text-tertiary)" }}>
                No data
              </div>
            )}
          </div>

          <div className="panel p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Recent Calculations
              </h2>
              <button
                onClick={() => onNavigate("history")}
                className="text-xs flex items-center gap-1 transition-colors"
                style={{ color: "var(--accent)" }}
              >
                View all <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            {history.length > 0 ? (
              <div className="space-y-2">
                {history.slice(0, 5).map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between px-3 py-2 rounded-md"
                    style={{ backgroundColor: "var(--bg-tertiary)" }}
                  >
                    <div>
                      <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        {entry.isotope}
                      </div>
                      <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                        {formatActivity(entry.activity)} · {entry.stabilityClass} ·{" "}
                        {entry.windSpeed} m/s
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold" style={{ color: "var(--danger)" }}>
                        {formatDose(entry.maxDose)}
                      </div>
                      <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                        EZ: {formatDistance(entry.exclusionZone)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm py-12 text-center" style={{ color: "var(--text-tertiary)" }}>
                No calculations yet
              </div>
            )}
          </div>
        </div>

        {isotope && (
          <div className="panel p-5 mt-4">
            <div className="flex items-center gap-2 mb-3">
              <Radiation className="w-4 h-4" style={{ color: "var(--accent)" }} />
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Active Isotope: {isotope.name}
              </h2>
            </div>
            <div className="grid grid-cols-5 gap-4">
              <InfoCell label="Half-life" value={`${isotope.halfLife} ${isotope.halfLifeUnit}`} />
              <InfoCell label="Gamma Energy" value={`${isotope.gammaEnergy} MeV`} />
              <InfoCell label="Beta Energy" value={`${isotope.betaEnergy} MeV`} />
              <InfoCell label="Alpha Energy" value={`${isotope.alphaEnergy} MeV`} />
              <InfoCell label="Lung Class" value={isotope.lungClass} />
            </div>
            <p className="text-xs mt-3" style={{ color: "var(--text-tertiary)" }}>
              {isotope.notes}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ZoneBar({
  label,
  detail,
  distance,
  maxDist,
  color,
  formatDist,
}: {
  label: string;
  detail: string;
  distance: number;
  maxDist: number;
  color: string;
  formatDist: (m: number) => string;
}) {
  const pct = Math.min((distance / maxDist) * 100, 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {label}
        </span>
        <span className="text-sm font-bold" style={{ color }}>
          {distance > 0 ? formatDist(distance) : "N/A"}
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ backgroundColor: "var(--bg-tertiary)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
        {detail}
      </div>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
        {label}
      </div>
      <div className="text-sm font-medium mt-0.5" style={{ color: "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}

function DoseChart({ results }: { results: { distance: number; totalEffectiveDose: number }[] }) {
  if (results.length === 0) return null;
  const maxDose = Math.max(...results.map((r) => r.totalEffectiveDose), 1e-10);
  const maxDist = Math.max(...results.map((r) => r.distance));
  const w = 480;
  const h = 200;
  const pad = 40;
  const points = results.map((r) => {
    const x = pad + (r.distance / maxDist) * (w - pad * 2);
    const y = h - pad - (r.totalEffectiveDose / maxDose) * (h - pad * 2);
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 200 }}>
      <line
        x1={pad}
        y1={h - pad}
        x2={w - pad}
        y2={h - pad}
        stroke="var(--border-light)"
        strokeWidth="1"
      />
      <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="var(--border-light)" strokeWidth="1" />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {results.map((r, i) => {
        const x = pad + (r.distance / maxDist) * (w - pad * 2);
        const y = h - pad - (r.totalEffectiveDose / maxDose) * (h - pad * 2);
        return <circle key={i} cx={x} cy={y} r="3" fill="var(--accent)" />;
      })}
      <text x={pad} y={h - pad + 18} fill="var(--text-tertiary)" fontSize="10">
        0
      </text>
      <text x={w - pad - 30} y={h - pad + 18} fill="var(--text-tertiary)" fontSize="10">
        {formatDistance(maxDist)}
      </text>
      <text x={pad - 8} y={pad + 8} fill="var(--text-tertiary)" fontSize="10" textAnchor="end">
        {formatDose(maxDose)}
      </text>
    </svg>
  );
}
