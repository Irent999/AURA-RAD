import { useState } from "react";
import { Search, Radiation, Clock, Zap, Wind, Info } from "lucide-react";
import { ISOTOPE_LIBRARY } from "../lib/isotopes";
import type { Isotope } from "../lib/types";

export function IsotopeLibrary() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Isotope | null>(null);

  const filtered = ISOTOPE_LIBRARY.filter(
    (iso) =>
      iso.name.toLowerCase().includes(search.toLowerCase()) ||
      iso.symbol.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex-1 overflow-y-auto animate-fadeIn">
      <div className="max-w-7xl mx-auto px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
              Isotope Library
            </h1>
            <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
              Radiological reference data · {ISOTOPE_LIBRARY.length} isotopes
            </p>
          </div>
          <div className="relative">
            <Search
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-tertiary)" }}
            />
            <input
              type="text"
              placeholder="Search isotopes..."
              className="input-field pl-9 w-64"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-1 space-y-2">
            {filtered.map((iso) => (
              <button
                key={iso.symbol}
                onClick={() => setSelected(iso)}
                className="w-full panel p-4 text-left transition-all duration-150 hover:border-opacity-100"
                style={{
                  borderColor:
                    selected?.symbol === iso.symbol ? "var(--accent)" : "var(--border-default)",
                  backgroundColor:
                    selected?.symbol === iso.symbol
                      ? "rgba(6, 182, 212, 0.05)"
                      : "var(--bg-secondary)",
                }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                      {iso.symbol}
                    </div>
                    <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                      {iso.name}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="badge badge-neutral">Lung {iso.lungClass}</span>
                    {iso.alphaEnergy > 0 && <span className="badge badge-danger">α</span>}
                    {iso.betaEnergy > 0 && <span className="badge badge-warning">β</span>}
                    {iso.gammaEnergy > 0 && <span className="badge badge-info">γ</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="col-span-2">
            {selected ? (
              <IsotopeDetail isotope={selected} />
            ) : (
              <div className="panel p-12 flex flex-col items-center justify-center">
                <Radiation className="w-12 h-12 mb-3" style={{ color: "var(--text-tertiary)" }} />
                <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
                  Select an isotope to view detailed properties
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function IsotopeDetail({ isotope }: { isotope: Isotope }) {
  return (
    <div className="panel p-6 animate-fadeIn">
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-12 h-12 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: "rgba(6, 182, 212, 0.1)" }}
        >
          <Radiation className="w-6 h-6" style={{ color: "var(--accent)" }} />
        </div>
        <div>
          <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            {isotope.name}
          </h2>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {isotope.symbol} · Atomic Mass: {isotope.atomicMass} u
          </p>
        </div>
      </div>

      <p
        className="text-sm mb-4 p-3 rounded-md"
        style={{ backgroundColor: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
      >
        {isotope.notes}
      </p>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <DetailCard
          icon={Clock}
          label="Half-Life"
          value={`${isotope.halfLife} ${isotope.halfLifeUnit}`}
          color="var(--info)"
        />
        <DetailCard
          icon={Zap}
          label="Decay Constant"
          value={`${isotope.decayConstant.toExponential(2)} /s`}
          color="var(--accent)"
        />
        <DetailCard
          icon={Radiation}
          label="Gamma Energy"
          value={`${isotope.gammaEnergy} MeV`}
          color="var(--info)"
        />
        <DetailCard
          icon={Radiation}
          label="Beta Energy"
          value={`${isotope.betaEnergy} MeV`}
          color="var(--warning)"
        />
        <DetailCard
          icon={Radiation}
          label="Alpha Energy"
          value={`${isotope.alphaEnergy} MeV`}
          color="var(--danger)"
        />
        <DetailCard
          icon={Wind}
          label="Dose Rate Constant"
          value={`${isotope.doseRateConstant.toExponential(2)} Sv·m²/Bq·s`}
          color="var(--success)"
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Dose Coefficients
        </h3>
        <div className="panel p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                Inhalation (Sv/Bq)
              </div>
              <div
                className="text-sm font-mono font-medium"
                style={{ color: "var(--text-primary)" }}
              >
                {isotope.inhalationCoefficient.toExponential(2)}
              </div>
            </div>
            <div>
              <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                Ingestion (Sv/Bq)
              </div>
              <div
                className="text-sm font-mono font-medium"
                style={{ color: "var(--text-primary)" }}
              >
                {isotope.ingestionCoefficient.toExponential(2)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="mt-4 p-3 rounded-md flex items-start gap-2"
        style={{ backgroundColor: "rgba(59, 130, 246, 0.08)" }}
      >
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "var(--info)" }} />
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Lung class indicates clearance rate: D (days) = rapid, W (weeks) = moderate, Y (years) =
          slow. This affects long-term dose calculations and internal dosimetry models.
        </p>
      </div>
    </div>
  );
}

function DetailCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="panel p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5" style={{ color }} />
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          {label}
        </span>
      </div>
      <div className="text-sm font-medium font-mono" style={{ color: "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}
