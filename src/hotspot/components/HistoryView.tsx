import { History, Trash2, Clock, Wind, Radiation } from 'lucide-react';
import type { CalculationHistoryEntry } from '../lib/types';
import { formatDose, formatActivity, formatDistance } from '../lib/dispersion';

interface HistoryViewProps {
  history: CalculationHistoryEntry[];
  onClear: () => void;
}

export function HistoryView({ history, onClear }: HistoryViewProps) {
  return (
    <div className="flex-1 overflow-y-auto animate-fadeIn">
      <div className="max-w-5xl mx-auto px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Calculation History
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              {history.length} {history.length === 1 ? 'entry' : 'entries'}
            </p>
          </div>
          {history.length > 0 && (
            <button onClick={onClear} className="btn btn-secondary">
              <Trash2 className="w-4 h-4" />
              Clear History
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="panel p-16 flex flex-col items-center justify-center">
            <History className="w-12 h-12 mb-3" style={{ color: 'var(--text-tertiary)' }} />
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              No calculations have been performed yet
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((entry) => {
              const date = new Date(entry.timestamp);
              return (
                <div key={entry.id} className="panel p-4 animate-fadeIn">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: 'rgba(6, 182, 212, 0.08)' }}
                      >
                        <Radiation className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                      </div>
                      <div>
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          {entry.scenarioName}
                        </div>
                        <div className="flex items-center gap-3 text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {date.toLocaleString()}
                          </span>
                          <span className="flex items-center gap-1">
                            <Wind className="w-3 h-3" />
                            {entry.windSpeed} m/s · {entry.stabilityClass}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          Activity
                        </div>
                        <div className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                          {formatActivity(entry.activity)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          Max Dose
                        </div>
                        <div className="text-sm font-bold" style={{ color: 'var(--danger)' }}>
                          {formatDose(entry.maxDose)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          Exclusion Zone
                        </div>
                        <div className="text-sm font-medium" style={{ color: 'var(--warning)' }}>
                          {entry.exclusionZone > 0 ? formatDistance(entry.exclusionZone) : 'N/A'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
