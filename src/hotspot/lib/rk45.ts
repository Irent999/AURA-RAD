import { getIsotope } from "./isotopes";
import type { Isotope } from "./types";

export interface ODEState {
  t: number;
  y: number[];
}

export type DerivativeFn = (t: number, y: number[]) => number[];

export interface RK45Result {
  states: { t: number; y: number[] }[];
  steps: number;
  accepted: number;
  rejected: number;
  finalTime: number;
}

const C2 = 1 / 5;
const C3 = 3 / 10;
const C4 = 4 / 5;
const C5 = 8 / 9;

const A21 = 1 / 5;
const A31 = 3 / 40;
const A32 = 9 / 40;
const A41 = 44 / 45;
const A42 = -56 / 15;
const A43 = 32 / 9;
const A51 = 19372 / 6561;
const A52 = -25360 / 2187;
const A53 = 64448 / 6561;
const A54 = -212 / 729;
const A61 = 9017 / 3168;
const A62 = -355 / 33;
const A63 = 46732 / 5247;
const A64 = 49 / 176;
const A65 = -5103 / 18656;
const A71 = 35 / 384;
const A72 = 0;
const A73 = 500 / 1113;
const A74 = 125 / 192;
const A75 = -2187 / 6784;
const A76 = 11 / 84;

const E1 = 71 / 57600;
const E3 = -71 / 16695;
const E4 = 71 / 1920;
const E5 = -17253 / 339200;
const E6 = 22 / 525;
const E7 = -1 / 40;

export function rk45(
  f: DerivativeFn,
  t0: number,
  y0: number[],
  tEnd: number,
  options?: {
    initialStep?: number;
    minStep?: number;
    maxStep?: number;
    rtol?: number;
    atol?: number;
    maxIterations?: number;
    recordInterval?: number;
  },
): RK45Result {
  const initialStep = options?.initialStep ?? Math.min(0.01 * (tEnd - t0), 1);
  const minStep = options?.minStep ?? 1e-12;
  const maxStep = options?.maxStep ?? Math.abs(tEnd - t0);
  const rtol = options?.rtol ?? 1e-8;
  const atol = options?.atol ?? 1e-12;
  const maxIter = options?.maxIterations ?? 100000;
  const recordInterval = options?.recordInterval ?? 1;

  let t = t0;
  let y = [...y0];
  let h = initialStep;
  let steps = 0;
  let accepted = 0;
  let rejected = 0;

  const states: { t: number; y: number[] }[] = [{ t, y: [...y] }];
  let recordCount = 0;

  const n = y0.length;

  while (t < tEnd && steps < maxIter) {
    if (t + h > tEnd) h = tEnd - t;
    if (h < minStep) h = minStep;

    const k1 = f(t, y);
    const y2 = new Array(n);
    for (let i = 0; i < n; i++) y2[i] = y[i] + h * A21 * k1[i];
    const k2 = f(t + C2 * h, y2);

    const y3 = new Array(n);
    for (let i = 0; i < n; i++) y3[i] = y[i] + h * (A31 * k1[i] + A32 * k2[i]);
    const k3 = f(t + C3 * h, y3);

    const y4 = new Array(n);
    for (let i = 0; i < n; i++) y4[i] = y[i] + h * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i]);
    const k4 = f(t + C4 * h, y4);

    const y5 = new Array(n);
    for (let i = 0; i < n; i++)
      y5[i] = y[i] + h * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i]);
    const k5 = f(t + C5 * h, y5);

    const y6 = new Array(n);
    for (let i = 0; i < n; i++)
      y6[i] = y[i] + h * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i]);
    const k6 = f(t + h, y6);

    const yNew = new Array(n);
    for (let i = 0; i < n; i++) {
      yNew[i] = y[i] + h * (A71 * k1[i] + A73 * k3[i] + A74 * k4[i] + A75 * k5[i] + A76 * k6[i]);
    }

    const err = new Array(n);
    for (let i = 0; i < n; i++) {
      err[i] = Math.abs(
        h *
          (E1 * k1[i] +
            E3 * k3[i] +
            E4 * k4[i] +
            E5 * k5[i] +
            E6 * k6[i] +
            (E7 * (yNew[i] - y[i])) / h),
      );
    }

    const sc = new Array(n);
    for (let i = 0; i < n; i++) {
      sc[i] = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(yNew[i]));
    }

    let maxErr = 0;
    for (let i = 0; i < n; i++) {
      const ratio = err[i] / sc[i];
      if (ratio > maxErr) maxErr = ratio;
    }

    steps++;

    if (maxErr <= 1) {
      t += h;
      y = yNew;
      accepted++;
      recordCount++;
      if (recordCount >= recordInterval) {
        states.push({ t, y: [...y] });
        recordCount = 0;
      }

      const factor = 0.9 * Math.pow(1 / Math.max(maxErr, 1e-20), 1 / 5);
      h = Math.min(maxStep, Math.max(minStep, h * Math.min(factor, 5)));
    } else {
      rejected++;
      const factor = 0.9 * Math.pow(1 / maxErr, 1 / 5);
      h = Math.max(minStep, h * Math.max(factor, 0.2));
    }
  }

  states.push({ t, y: [...y] });

  return { states, steps, accepted, rejected, finalTime: t };
}

export interface DecayChainResult {
  time: number;
  activities: { symbol: string; activity: number }[];
}

export interface DecayChainOptions {
  totalTime: number;
  initialActivity: number;
  maxGenerations?: number;
}

export function solveDecayChain(
  rootSymbol: string,
  options: DecayChainOptions,
): { chain: DecayChainResult[]; isotopes: Isotope[]; rk45: RK45Result } {
  const { totalTime, initialActivity, maxGenerations = 5 } = options;

  const chainIsotopes: Isotope[] = [];
  const visited = new Set<string>();

  function collectChain(symbol: string, depth: number) {
    if (depth >= maxGenerations || visited.has(symbol)) return;
    const iso = getIsotope(symbol);
    if (!iso) return;
    visited.add(symbol);
    chainIsotopes.push(iso);
    for (const daughter of iso.daughters) {
      collectChain(daughter.symbol, depth + 1);
    }
  }

  collectChain(rootSymbol, 0);

  if (chainIsotopes.length === 0) {
    return {
      chain: [],
      isotopes: [],
      rk45: { states: [], steps: 0, accepted: 0, rejected: 0, finalTime: 0 },
    };
  }

  const n = chainIsotopes.length;
  const decayConstants = chainIsotopes.map((iso) => iso.decayConstant);
  const branchingRatios = chainIsotopes.map((iso) => {
    return iso.daughters.length > 0 ? iso.daughters[0].branchingRatio : 0;
  });

  const parentIndices: number[][] = [];
  for (let i = 0; i < n; i++) {
    const parents: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const parentIso = chainIsotopes[j];
      const isParent = parentIso.daughters.some((d) => d.symbol === chainIsotopes[i].symbol);
      if (isParent) parents.push(j);
    }
    parentIndices.push(parents);
  }

  const y0 = new Array(n).fill(0);
  y0[0] = initialActivity;

  const deriv: DerivativeFn = (_t: number, y: number[]) => {
    const dydt = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let production = 0;
      for (const pIdx of parentIndices[i]) {
        const parent = chainIsotopes[pIdx];
        const daughterEntry = parent.daughters.find((d) => d.symbol === chainIsotopes[i].symbol);
        const branch = daughterEntry ? daughterEntry.branchingRatio : 0;
        production += branch * decayConstants[pIdx] * y[pIdx];
      }
      const decay = decayConstants[i] * y[i];
      dydt[i] = production - decay;
    }
    return dydt;
  };

  const result = rk45(deriv, 0, y0, totalTime, {
    rtol: 1e-10,
    atol: 1e-15,
    maxIterations: 50000,
    recordInterval: Math.max(1, Math.floor(totalTime / 100)),
  });

  const chain: DecayChainResult[] = result.states.map((s) => ({
    time: s.t,
    activities: s.y.map((activity, idx) => ({
      symbol: chainIsotopes[idx].symbol,
      activity,
    })),
  }));

  return { chain, isotopes: chainIsotopes, rk45: result };
}

export function integrateDoseOverTime(
  concentrationFn: (t: number) => number,
  doseCoefficients: { cloud: number; inhalation: number; external: number },
  totalTime: number,
  exposureDuration: number,
): {
  cloudDose: number;
  inhalationDose: number;
  externalDose: number;
  total: number;
  rk45: RK45Result;
} {
  const effDuration = Math.min(totalTime, exposureDuration);
  const y0 = [0, 0, 0];

  const deriv: DerivativeFn = (t: number, y: number[]) => {
    const conc = concentrationFn(t);
    return [
      doseCoefficients.cloud * conc,
      doseCoefficients.inhalation * conc,
      doseCoefficients.external * conc,
    ];
  };

  const result = rk45(deriv, 0, y0, effDuration, {
    rtol: 1e-8,
    atol: 1e-12,
    recordInterval: 999999,
  });

  const finalState = result.states[result.states.length - 1];
  const cloudDose = finalState.y[0];
  const inhalationDose = finalState.y[1];
  const externalDose = finalState.y[2];

  return {
    cloudDose,
    inhalationDose,
    externalDose,
    total: cloudDose + inhalationDose + externalDose,
    rk45: result,
  };
}
