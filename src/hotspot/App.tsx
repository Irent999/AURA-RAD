import { useState, useCallback, useMemo } from "react";
import { calculateDispersion, formatMixSummary, getTotalMixActivityBq } from "./lib/dispersion";
import type { DispersionInput, CalculationHistoryEntry } from "./lib/types";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./components/Dashboard";
import { PlumeModeler } from "./components/PlumeModeler";
import { IsotopeLibrary } from "./components/IsotopeLibrary";
import { HistoryView } from "./components/HistoryView";
import { Plume3DView } from "../renderer/simulation/plume3d";

import {
  JIZZAKH_NPP_LAT,
  JIZZAKH_NPP_LON,
} from "../renderer/simulation/plume3d/mapTextureGenerator";
import { DEFAULT_PLANT_BEARING_DEG, DEFAULT_PLANT_MODEL_SCALE } from "../3d/generateVVER1200Plant";

export type ViewName = "dashboard" | "modeler" | "plume3d" | "isotopes" | "history";

function App() {
  const [activeView, setActiveView] = useState<ViewName>("dashboard");
  const [history, setHistory] = useState<CalculationHistoryEntry[]>([]);
  const [input, setInput] = useState<DispersionInput>({
    sourceTerm: {
      isotope: "Cs-137",
      activity: 1.5e14,
      sourceMix: [
        { id: "mix-1", isotope: "Cs-137", activity: 100, unit: "TBq" },
        { id: "mix-2", isotope: "I-131", activity: 50, unit: "TBq" },
      ],
      releaseDuration: 1,
      releaseHeight: 30,
      releaseType: "stack",
      physicalForm: "aerosol",
      particleSize: 1,
      latitude: JIZZAKH_NPP_LAT,
      longitude: JIZZAKH_NPP_LON,
      plantModelScale: DEFAULT_PLANT_MODEL_SCALE,
      plantBearingDeg: DEFAULT_PLANT_BEARING_DEG,
    },
    meteorology: {
      windSpeed: 5,
      windDirection: 90,
      stabilityClass: "D",
      mixingHeight: 1000,
      airTemperature: 20,
      precipitationRate: 0,
      inversionHeight: 0,
    },
    terrain: {
      surfaceRoughness: 0.1,
      terrainType: "rural",
      buildingWake: false,
      complexTerrain: false,
    },
    distances: [30, 50, 100, 150, 200, 300, 500, 750, 1000, 1500],
    receptorHeight: 1.5,
    calculationType: "plume",
    averagingTime: 3600,
  });

  const result = useMemo(() => calculateDispersion(input), [input]);

  const runCalculation = useCallback(() => {
    const res = calculateDispersion(input);
    setActiveView("modeler");
    const mixLabel = formatMixSummary(input.sourceTerm);
    const totalBq = getTotalMixActivityBq(input.sourceTerm);
    const entry: CalculationHistoryEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      scenarioName: `${mixLabel} release`,
      isotope: mixLabel,
      activity: totalBq,
      windSpeed: input.meteorology.windSpeed,
      stabilityClass: input.meteorology.stabilityClass,
      maxDose: res.maxDoseDistance.value,
      exclusionZone: res.zoneSummary.exclusionZone,
    };
    setHistory((prev) => [entry, ...prev].slice(0, 50));
  }, [input]);

  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ backgroundColor: "var(--bg-primary)" }}
    >
      <Sidebar activeView={activeView} onNavigate={setActiveView} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeView === "dashboard" && (
          <Dashboard
            input={input}
            result={result}
            onRunCalculation={runCalculation}
            onNavigate={setActiveView}
            history={history}
          />
        )}
        {activeView === "modeler" && (
          <PlumeModeler
            input={input}
            setInput={setInput}
            result={result}
            onRunCalculation={runCalculation}
          />
        )}
        {activeView === "plume3d" && (
          <Plume3DView syncedInput={input} onSyncedInputChange={setInput} />
        )}
        {activeView === "isotopes" && <IsotopeLibrary />}
        {activeView === "history" && (
          <HistoryView history={history} onClear={() => setHistory([])} />
        )}
      </div>
    </div>
  );
}

export default App;
