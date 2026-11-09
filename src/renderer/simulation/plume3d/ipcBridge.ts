/**
 * IPC Communication Bridge for AURA-RAD 3D Plume Simulation
 * Provides typed IPC channels for Electron main <-> renderer integration,
 * with seamless in-process fallback for browser preview execution.
 */

import type {
  PlumeSource3D,
  Meteorology3D,
  DispersionPointResult,
  Plume3DModelOutput,
  Isotope3D,
} from "./types";
import { runGaussianPlume3DModel, calculatePointRadiologicalDose } from "./gaussianPlume3D";
import { EXTENDED_ISOTOPE_LIBRARY, getExtendedIsotope } from "./isotopes";

export const PLUME_IPC_CHANNELS = {
  SIMULATE_PLUME: "aura-rad:plume3d:simulate",
  CALCULATE_POINT_DOSE: "aura-rad:plume3d:point-dose",
  CALCULATE_SAFE_TIME: "aura-rad:plume3d:safe-stay-time",
  GET_ISOTOPE_LIBRARY: "aura-rad:plume3d:get-isotopes",
} as const;

export interface SimulatePlumePayload {
  source: PlumeSource3D;
  meteorology: Meteorology3D;
  isotopeSymbol?: string;
}

export interface CalculatePointDosePayload {
  xDownwind: number;
  yCrosswind: number;
  zHeight: number;
  source: PlumeSource3D;
  meteorology: Meteorology3D;
  isotopeSymbol: string;
  doseLimitMsv?: number;
}

export interface SafeStayTimePayload {
  doseRateMsvH: number;
  doseLimitMsv: number;
}

/**
 * Invokes Gaussian 3D Plume calculation via Electron IPC if available (window.electron.ipcRenderer),
 * or directly computes in TypeScript thread.
 */
export async function invokePlumeSimulation(
  payload: SimulatePlumePayload,
): Promise<Plume3DModelOutput> {
  const electron =
    typeof window !== "undefined"
      ? (
          window as unknown as {
            electron?: {
              ipcRenderer?: {
                invoke: (channel: string, ...args: unknown[]) => Promise<Plume3DModelOutput>;
              };
            };
          }
        ).electron
      : undefined;

  if (electron?.ipcRenderer) {
    try {
      return await electron.ipcRenderer.invoke(PLUME_IPC_CHANNELS.SIMULATE_PLUME, payload);
    } catch (err) {
      console.warn(
        "[AURA-RAD IPC] Electron IPC invoke failed, using local simulation engine:",
        err,
      );
    }
  }

  // Direct pure TypeScript calculation
  const isotope = payload.isotopeSymbol
    ? getExtendedIsotope(payload.isotopeSymbol)
    : getExtendedIsotope(payload.source.isotopeSymbol);

  return runGaussianPlume3DModel(payload.source, payload.meteorology, isotope);
}

/**
 * Calculates point dose rate and safe stay time via IPC or local engine.
 */
export async function invokePointDose(
  payload: CalculatePointDosePayload,
): Promise<DispersionPointResult> {
  const electron =
    typeof window !== "undefined"
      ? (
          window as unknown as {
            electron?: {
              ipcRenderer?: {
                invoke: (channel: string, ...args: unknown[]) => Promise<DispersionPointResult>;
              };
            };
          }
        ).electron
      : undefined;

  if (electron?.ipcRenderer) {
    try {
      return await electron.ipcRenderer.invoke(PLUME_IPC_CHANNELS.CALCULATE_POINT_DOSE, payload);
    } catch {
      // Fallback to local
    }
  }

  const isotope = getExtendedIsotope(payload.isotopeSymbol);
  return calculatePointRadiologicalDose(
    payload.xDownwind,
    payload.yCrosswind,
    payload.zHeight,
    payload.source,
    payload.meteorology,
    isotope,
    payload.doseLimitMsv ?? 1.0,
  );
}

/**
 * Fetches isotope library via IPC or directly.
 */
export async function fetchIsotopeLibrary(): Promise<Isotope3D[]> {
  return EXTENDED_ISOTOPE_LIBRARY;
}
