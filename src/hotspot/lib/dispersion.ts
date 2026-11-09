import type {
  DispersionInput,
  DispersionResult,
  DoseResult,
  ProtectiveAction,
  StabilityClass,
} from "./types";
import { getIsotope } from "./isotopes";
import { solveDecayChain, type DecayChainResult } from "./rk45";

/*
 * All physics uses strict SI base units:
 *   Q       [Bq/s]      source release rate
 *   u       [m/s]       wind speed
 *   x       [m]         downwind distance
 *   sy, sz  [m]         Pasquill-Gifford dispersion coefficients
 *   C       [Bq/m^3]    air concentration
 *   dose    [Sv]        all dose quantities
 */

const BREATHING_RATE = 3.3e-4; // m^3/s (ICRP adult, light activity)
const EARTH_RADIUS_M = 6371000;

// Martin (1976) Pasquill-Gifford power-law fits
type PGCoefficients = {
  c: number;
  d: number;
  f: number;
};

const SIGMA_Y_A: Record<StabilityClass, number> = {
  A: 213,
  B: 156,
  C: 104,
  D: 68,
  E: 50.5,
  F: 34,
};

const SIGMA_Z_NEAR: Record<StabilityClass, PGCoefficients> = {
  A: { c: 440.8, d: 1.941, f: 9.27 },
  B: { c: 106.6, d: 1.149, f: 3.3 },
  C: { c: 61.0, d: 0.911, f: 0 },
  D: { c: 33.2, d: 0.725, f: -1.7 },
  E: { c: 22.8, d: 0.678, f: -1.3 },
  F: { c: 14.35, d: 0.74, f: -0.35 },
};

const SIGMA_Z_FAR: Record<StabilityClass, PGCoefficients> = {
  A: { c: 459.7, d: 2.094, f: -9.6 },
  B: { c: 108.2, d: 1.098, f: 2.0 },
  C: { c: 61.0, d: 0.911, f: 0 },
  D: { c: 44.5, d: 0.516, f: -13.0 },
  E: { c: 55.4, d: 0.305, f: -34.0 },
  F: { c: 62.6, d: 0.18, f: -48.6 },
};

function sigmaYRural(stability: StabilityClass, distance: number): number {
  const xKm = Math.max(distance, 1) / 1000;
  return Math.max(SIGMA_Y_A[stability] * Math.pow(xKm, 0.894), 0.1);
}

function sigmaZRural(stability: StabilityClass, distance: number): number {
  const xKm = Math.max(distance, 1) / 1000;
  const k = xKm < 1 ? SIGMA_Z_NEAR[stability] : SIGMA_Z_FAR[stability];
  return Math.max(k.c * Math.pow(xKm, k.d) + k.f, 0.1);
}

function sigmaUrban(stability: StabilityClass, distance: number): { sy: number; sz: number } {
  const x = Math.max(distance, 1);
  switch (stability) {
    case "A":
    case "B":
      return {
        sy: (0.32 * x) / Math.sqrt(1 + 0.0004 * x),
        sz: 0.24 * x * Math.sqrt(1 + 0.001 * x),
      };
    case "C":
      return { sy: (0.22 * x) / Math.sqrt(1 + 0.0004 * x), sz: 0.2 * x };
    case "D":
      return {
        sy: (0.16 * x) / Math.sqrt(1 + 0.0004 * x),
        sz: (0.14 * x) / Math.sqrt(1 + 0.0003 * x),
      };
    default:
      return {
        sy: (0.11 * x) / Math.sqrt(1 + 0.0004 * x),
        sz: (0.08 * x) / Math.sqrt(1 + 0.0015 * x),
      };
  }
}

export function dispersionCoefficients(
  stability: StabilityClass,
  distance: number,
  terrainType: string,
): { sy: number; sz: number } {
  if (terrainType === "urban") return sigmaUrban(stability, distance);
  return { sy: sigmaYRural(stability, distance), sz: sigmaZRural(stability, distance) };
}

function effectiveWindSpeed(windSpeed: number, height: number, roughness: number): number {
  const refHeight = 10;
  const z0 = Math.max(roughness, 0.01);
  const z = Math.max(height, 10 * z0, 2);
  return windSpeed * (Math.log(z / z0) / Math.log(refHeight / z0));
}

function calculateEffectiveReleaseHeight(input: DispersionInput): number {
  const { sourceTerm, meteorology } = input;
  const h0 = Math.max(sourceTerm.releaseHeight, 0);

  const stackTemp = sourceTerm.stackTemperature ?? meteorology.airTemperature ?? 20;
  const airTemp = meteorology.airTemperature ?? 20;
  const deltaT = stackTemp - airTemp;

  if (Math.abs(deltaT) < 0.1 || meteorology.windSpeed < 0.1) return h0;

  const deltaH =
    deltaT > 0 ? 1.5 * Math.pow(Math.abs(deltaT), 0.5) : -1.0 * Math.pow(Math.abs(deltaT), 0.4);

  return Math.max(h0 + deltaH, 0);
}

export function computeCenterlineConcentration(
  input: DispersionInput,
  distance: number,
): { concentration: number; sy: number; sz: number } {
  const { sourceTerm, meteorology, terrain } = input;
  const isCalm = meteorology.windSpeed < 0.5;

  const effHeight = calculateEffectiveReleaseHeight(input);
  const isotope = getIsotope(sourceTerm.isotope);

  const { sy, sz } = isCalm
    ? { sy: Math.max(distance * 0.35, 15), sz: Math.max(distance * 0.25, 10) }
    : dispersionCoefficients(meteorology.stabilityClass, distance, terrain.terrainType);

  if (!isotope || sourceTerm.activity <= 0) return { concentration: 0, sy, sz };

  const durationSec = Math.max(sourceTerm.releaseDuration, 1e-6) * 3600;
  const Q0 = sourceTerm.activity / durationSec;

  if (isCalm) {
    const R = Math.max(distance, 1);
    const volume = (4 / 3) * Math.PI * Math.pow(R, 3);
    const concentration =
      (sourceTerm.activity / volume) * Math.exp(-isotope.decayConstant * (R / 0.5));
    return { concentration: Math.max(concentration, 0), sy: R, sz: R };
  }

  const wind = Math.max(
    effectiveWindSpeed(meteorology.windSpeed, effHeight, terrain.surfaceRoughness),
    0.5,
  );

  const travelTimeSec = distance / wind;
  const Q = Q0 * Math.exp(-isotope.decayConstant * travelTimeSec);

  const z = Math.max(input.receptorHeight, 0);
  const L = meteorology.mixingHeight;

  let concentration: number;
  if (L > 0 && sz > 1.2 * L) {
    concentration = Q / (Math.sqrt(2 * Math.PI) * sy * L * wind);
  } else {
    const vertical =
      Math.exp(-Math.pow(z - effHeight, 2) / (2 * sz * sz)) +
      Math.exp(-Math.pow(z + effHeight, 2) / (2 * sz * sz));
    concentration = (Q / (2 * Math.PI * sy * sz * wind)) * vertical;
  }

  return { concentration: Math.max(concentration, 0), sy, sz };
}

function depositionVelocity(form: string): number {
  if (form === "gas") return 0.001;
  if (form === "particle") return 0.02;
  return 0.01;
}

function isIodine(symbol: string): boolean {
  return /^I-\d+/i.test(symbol);
}

function computeDoses(
  concentration: number,
  input: DispersionInput,
): {
  plumeDeposition: number;
  externalDose: number;
  cloudDose: number;
  groundDose: number;
  inhalationDose: number;
  skinDose: number;
  ingestionEquivalentDose: number;
  totalEffectiveDose: number;
  thyroidDose: number;
} {
  const { sourceTerm } = input;
  const isotope = getIsotope(sourceTerm.isotope);
  if (!isotope || concentration <= 0) {
    return {
      plumeDeposition: 0,
      externalDose: 0,
      cloudDose: 0,
      groundDose: 0,
      inhalationDose: 0,
      skinDose: 0,
      ingestionEquivalentDose: 0,
      totalEffectiveDose: 0,
      thyroidDose: 0,
    };
  }

  const exposureDuration = Math.min(
    input.averagingTime || 3600,
    Math.max(sourceTerm.releaseDuration, 1e-6) * 3600,
  );

  const cloudDoseSv = concentration * isotope.doseRateConstant * exposureDuration;
  const inhalationDoseSv =
    concentration * BREATHING_RATE * exposureDuration * isotope.inhalationCoefficient;

  // Плотность поверхностного загрязнения [Bq/m^2]
  const plumeDeposition =
    concentration * depositionVelocity(sourceTerm.physicalForm) * exposureDuration;

  // Доза от подстилающей поверхности (исправлено умножение на время)
  const groundShineDoseSv = plumeDeposition * isotope.externalDoseCoefficient;

  // Эквивалентная доза на кожу
  const skinDoseSv = cloudDoseSv * 1.5 + plumeDeposition * 2.2;
  const ingestionEquivalentSv = plumeDeposition * 0.8 * (isotope.inhalationCoefficient * 0.5);

  // Эффективная доза (классическое суммирование основных путей облучения)
  const totalDoseSv = cloudDoseSv + inhalationDoseSv + groundShineDoseSv;

  const thyroidDose = isIodine(isotope.symbol) ? inhalationDoseSv / 0.05 : totalDoseSv;

  return {
    plumeDeposition,
    externalDose: groundShineDoseSv + cloudDoseSv,
    cloudDose: cloudDoseSv,
    groundDose: groundShineDoseSv,
    inhalationDose: inhalationDoseSv,
    skinDose: skinDoseSv,
    ingestionEquivalentDose: ingestionEquivalentSv,
    totalEffectiveDose: totalDoseSv,
    thyroidDose,
  };
}

function determineProtectiveActions(
  results: DoseResult[],
  isotopeSymbol: string,
): ProtectiveAction[] {
  const iodineRelease = isIodine(isotopeSymbol);
  const actions: ProtectiveAction[] = [];

  for (const r of results) {
    const doseSv = r.totalEffectiveDose;

    if (doseSv >= 0.1) {
      actions.push({
        distance: r.distance,
        action: "Эвакуация населения / Укрытие в защитных сооружениях",
        zone: "Зона экстренных мероприятий (Exclusion Zone)",
        criteria: "Эффективная доза >= 100 мЗв",
        level: "emergency",
      });
    } else if (doseSv >= 0.05) {
      actions.push({
        distance: r.distance,
        action: "Укрытие населения / Подготовка к эвакуации",
        zone: "Зона предупредительных действий",
        criteria: "Эффективная доза >= 50 мЗв",
        level: "alert",
      });
    } else if (doseSv >= 0.01) {
      actions.push({
        distance: r.distance,
        action: "Радиационный контроль / Ограничение въезда",
        zone: "Зона радиационного контроля",
        criteria: "Эффективная доза >= 10 мЗв",
        level: "caution",
      });
    } else if (doseSv >= 0.001) {
      actions.push({
        distance: r.distance,
        action: "Мониторинг параметров среды",
        zone: "Зона наблюдения",
        criteria: "Эффективная доза >= 1 мЗв",
        level: "advisory",
      });
    }

    if (
      iodineRelease &&
      r.thyroidDose >= 0.05 &&
      !actions.some((a) => a.distance === r.distance && a.action.includes("Йодная"))
    ) {
      actions.push({
        distance: r.distance,
        action: "Проведение йодной профилактики (калия йодид)",
        zone: "Зона йодной профилактики",
        criteria: "Доза на щитовидную железу >= 50 мЗв",
        level: "alert",
      });
    }
  }

  return actions;
}

export function generatePlumeFootprint(
  input: DispersionInput,
  distances: number[],
): { x: number; y: number; concentration: number; dose: number }[] {
  const footprint: { x: number; y: number; concentration: number; dose: number }[] = [];
  const { meteorology } = input;
  const isCalm = meteorology.windSpeed < 0.5;
  const windRad = (meteorology.windDirection * Math.PI) / 180;

  for (const d of distances) {
    const { concentration, sy } = computeCenterlineConcentration(input, d);
    const dummyDoses = computeDoses(concentration, input);

    if (isCalm) {
      const numPoints = 16;
      for (let a = 0; a < numPoints; a++) {
        const angle = (a / numPoints) * 2 * Math.PI;
        footprint.push({
          x: d * Math.cos(angle),
          y: d * Math.sin(angle),
          concentration,
          dose: dummyDoses.totalEffectiveDose,
        });
      }
    } else {
      const offsets = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];
      for (const off of offsets) {
        const crosswind = off * sy;
        const concFactor = Math.exp(-(crosswind * crosswind) / (2 * sy * sy));
        const conc = concentration * concFactor;
        const pointDose = dummyDoses.totalEffectiveDose * concFactor;

        const x = d * Math.cos(windRad) - crosswind * Math.sin(windRad);
        const y = d * Math.sin(windRad) + crosswind * Math.cos(windRad);

        footprint.push({ x, y, concentration: conc, dose: pointDose });
      }
    }
  }

  return footprint;
}

function metersToLatLon(
  lat0: number,
  lon0: number,
  xMeters: number,
  yMeters: number,
): { lat: number; lon: number } {
  const dLat = (yMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLon = (xMeters / (EARTH_RADIUS_M * Math.cos((lat0 * Math.PI) / 180))) * (180 / Math.PI);
  return { lat: lat0 + dLat, lon: lon0 + dLon };
}

function generateGeoFootprint(
  input: DispersionInput,
  localFootprint: { x: number; y: number; concentration: number; dose: number }[],
): { lat: number; lon: number; concentration: number; dose: number }[] {
  const lat0 = input.sourceTerm.latitude;
  const lon0 = input.sourceTerm.longitude;
  return localFootprint.map((p) => {
    const geo = metersToLatLon(lat0, lon0, p.x, p.y);
    return { lat: geo.lat, lon: geo.lon, concentration: p.concentration, dose: p.dose };
  });
}

export function calculateDispersion(input: DispersionInput): DispersionResult {
  const results: DoseResult[] = [];
  const warnings: string[] = [];

  if (input.meteorology.windSpeed < 0.5) {
    warnings.push(
      "Режим штиля (< 0.5 м/с): активирована 3D-модель изотропного рассеивания облака.",
    );
  }
  const stackTemp = input.sourceTerm.stackTemperature ?? input.meteorology.airTemperature ?? 20;
  const airTemp = input.meteorology.airTemperature ?? 20;
  if (Math.abs(stackTemp - airTemp) > 5) {
    warnings.push(
      `Учтен градиент температур (ΔT = ${(stackTemp - airTemp).toFixed(1)} °C) для плавучести факела.`,
    );
  }

  for (const distance of input.distances) {
    const { concentration, sy, sz } = computeCenterlineConcentration(input, distance);
    const doses = computeDoses(concentration, input);
    const wind = Math.max(input.meteorology.windSpeed, 0.5);
    const arrivalSeconds = distance / wind;

    results.push({
      distance,
      centerlineConcentration: concentration,
      crosswindSpread: sy,
      verticalSpread: sz,
      plumeWidth: sy * 4,
      arrivalTime: arrivalSeconds,
      arrivalTimeFormatted: formatArrivalTime(arrivalSeconds),
      exposureDuration: Math.min(
        input.averagingTime || 3600,
        input.sourceTerm.releaseDuration * 3600,
      ),
      ...doses,
    });
  }

  const maxConc = results.reduce(
    (max, r) =>
      r.centerlineConcentration > max.value
        ? { distance: r.distance, value: r.centerlineConcentration }
        : max,
    { distance: 0, value: 0 },
  );

  const maxDose = results.reduce(
    (max, r) =>
      r.totalEffectiveDose > max.value
        ? { distance: r.distance, value: r.totalEffectiveDose }
        : max,
    { distance: 0, value: 0 },
  );

  let exclusionZone = 0;
  let contaminationZone = 0;
  let ingestionZone = 0;
  for (const r of results) {
    if (r.totalEffectiveDose >= 0.1 && r.distance > exclusionZone) exclusionZone = r.distance;
    if (r.totalEffectiveDose >= 0.01 && r.distance > contaminationZone)
      contaminationZone = r.distance;
    if (r.totalEffectiveDose >= 0.001 && r.distance > ingestionZone) ingestionZone = r.distance;
  }

  const protectiveActions = determineProtectiveActions(results, input.sourceTerm.isotope);
  const plumeFootprint = generatePlumeFootprint(input, input.distances);
  const geoFootprint = generateGeoFootprint(input, plumeFootprint);

  const releaseDurationSec = input.sourceTerm.releaseDuration * 3600;
  const decayChain = solveDecayChain(input.sourceTerm.isotope, {
    totalTime: releaseDurationSec,
    initialActivity: input.sourceTerm.activity,
    maxGenerations: 5,
  });
  const decayChainResult: DecayChainResult[] = decayChain.chain;

  const rk45Stats = {
    steps: decayChain.rk45.steps,
    accepted: decayChain.rk45.accepted,
    rejected: decayChain.rk45.rejected,
    finalTime: decayChain.rk45.finalTime,
  };

  return {
    results,
    input,
    maxConcentration: maxConc,
    maxDoseDistance: maxDose,
    plumeFootprint,
    geoFootprint,
    decayChainResult,
    rk45Stats,
    zoneSummary: {
      exclusionZone,
      contaminationZone,
      ingestionZone,
      totalAffected: ingestionZone,
    },
    protectiveActions,
    warnings,
  };
}

export function formatDose(doseSv: number): string {
  if (doseSv >= 1) return `${doseSv.toFixed(2)} Зв`;
  if (doseSv >= 0.001) return `${(doseSv * 1000).toFixed(2)} мЗв`;
  if (doseSv >= 1e-6) return `${(doseSv * 1e6).toFixed(2)} мкЗв`;
  return `${doseSv.toExponential(2)} Зв`;
}

export function formatActivity(activityBq: number): string {
  if (activityBq >= 1e15) return `${(activityBq / 1e15).toFixed(2)} ПБк`;
  if (activityBq >= 1e12) return `${(activityBq / 1e12).toFixed(2)} ТБк`;
  if (activityBq >= 1e9) return `${(activityBq / 1e9).toFixed(2)} ГБк`;
  if (activityBq >= 1e6) return `${(activityBq / 1e6).toFixed(2)} МБк`;
  if (activityBq >= 1e3) return `${(activityBq / 1e3).toFixed(2)} кБк`;
  return `${activityBq.toFixed(2)} Бк`;
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} км`;
  return `${meters.toFixed(0)} м`;
}

export function formatArrivalTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)} с`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} мин`;
  return `${(seconds / 3600).toFixed(1)} ч`;
}
