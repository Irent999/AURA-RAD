import { useState, useCallback, useEffect } from 'react';
import { ISOTOPE_LIBRARY } from './lib/isotopes';
import { calculateDispersion, formatDose, formatActivity, formatDistance } from './lib/dispersion';
import type { DispersionInput, DispersionResult, StabilityClass, CalculationHistoryEntry } from './lib/types';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { PlumeModeler } from './components/PlumeModeler';
import { IsotopeLibrary } from './components/IsotopeLibrary';
import { HistoryView } from './components/HistoryView';

export type ViewName = 'dashboard' | 'modeler' | 'isotopes' | 'history';

function App() {
  const [activeView, setActiveView] = useState<ViewName>('dashboard');
  const [result, setResult] = useState<DispersionResult | null>(null);
  const [history, setHistory] = useState<CalculationHistoryEntry[]>([]);
  const [input, setInput] = useState<DispersionInput>({
    sourceTerm: {
      isotope: 'Cs-137',
      activity: 1e14,
      releaseDuration: 1,
      releaseHeight: 30,
      releaseType: 'stack',
      physicalForm: 'aerosol',
      particleSize: 1,
      latitude: 40.212,
      longitude: 68.865,
    },
    meteorology: {
      windSpeed: 5,
      windDirection: 90,
      stabilityClass: 'D',
      mixingHeight: 1000,
      temperature: 20,
      precipitationRate: 0,
      inversionHeight: 0,
    },
    terrain: {
      surfaceRoughness: 0.1,
      terrainType: 'rural',
      buildingWake: false,
      complexTerrain: false,
    },
    distances: [100, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000],
    receptorHeight: 1.5,
    calculationType: 'plume',
    averagingTime: 3600,
  });

  const runCalculation = useCallback(() => {
    const res = calculateDispersion(input);
    setResult(res);
    setActiveView('modeler');
    const entry: CalculationHistoryEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      scenarioName: `${input.sourceTerm.isotope} release`,
      isotope: input.sourceTerm.isotope,
      activity: input.sourceTerm.activity,
      windSpeed: input.meteorology.windSpeed,
      stabilityClass: input.meteorology.stabilityClass,
      maxDose: res.maxDoseDistance.value,
      exclusionZone: res.zoneSummary.exclusionZone,
    };
    setHistory((prev) => [entry, ...prev].slice(0, 50));
  }, [input]);

  useEffect(() => {
  if (!result) runCalculation();
}, [result, runCalculation]);

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <Sidebar activeView={activeView} onNavigate={setActiveView} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeView === 'dashboard' && (
          <Dashboard
            input={input}
            result={result}
            onRunCalculation={runCalculation}
            onNavigate={setActiveView}
            history={history}
          />
        )}
        {activeView === 'modeler' && (
          <PlumeModeler
            input={input}
            setInput={setInput}
            result={result}
            onRunCalculation={runCalculation}
          />
        )}
        {activeView === 'isotopes' && <IsotopeLibrary />}
        {activeView === 'history' && (
          <HistoryView history={history} onClear={() => setHistory([])} />
        )}
      </div>
    </div>
  );
}

export default App;
