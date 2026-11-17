import type {
  ActivityUnit,
  DispersionInput,
  DispersionResult,
  DoseResult,
  IsodoseContour2D,
  NuclideDistanceContribution,
  ProtectiveAction,
  SourceMixItem,
  SourceTerm,
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

export function convertActivityToBq(activity: number, unit: ActivityUnit): number {
  const safe = Number.isFinite(activity) ? Math.max(activity, 0) : 0;
  if (unit === "TBq") return safe * 1e12;
  if (unit === "Ci") return safe * 3.7e10;
  return safe;
}

export interface NormalizedMixItem extends SourceMixItem {
  activityBq: number;
}

export function getNormalizedSourceMix(sourceTerm: SourceTerm): NormalizedMixItem[] {
  if (sourceTerm.sourceMix && sourceTerm.sourceMix.length > 0) {
    return sourceTerm.sourceMix.map((item) => ({
      ...item,
      activityBq: convertActivityToBq(item.activity, item.unit),
    }));
  }
  return [
    {
      id: "primary",
      isotope: sourceTerm.isotope,
      activity: sourceTerm.activity,
      unit: "Bq",
      activityBq: Math.max(sourceTerm.activity, 0),
    },
  ];
}

export function getTotalMixActivityBq(sourceTerm: SourceTerm): number {
  return getNormalizedSourceMix(sourceTerm).reduce((sum, item) => sum + item.activityBq, 0);
}

export function formatMixSummary(sourceTerm: SourceTerm): string {
  const mix = getNormalizedSourceMix(sourceTerm);
  if (mix.length === 0) return sourceTerm.isotope;
  if (mix.length === 1) return mix[0].isotope;
  if (mix.length === 2) return `${mix[0].isotope} + ${mix[1].isotope}`;
  return `${mix[0].isotope} + ${mix.length - 1} more`;
}

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

function computeIsotopeCenterlineConcentration(
  input: DispersionInput,
  distance: number,
  isotopeSymbol: string,
  activityBq: number,
  sy: number,
  sz: number,
  effHeight: number,
): number {
  const { sourceTerm, meteorology, terrain } = input;
  const isotope = getIsotope(isotopeSymbol);
  if (!isotope || activityBq <= 0) return 0;

  const isCalm = meteorology.windSpeed < 0.5;
  const durationSec = Math.max(sourceTerm.releaseDuration, 1e-6) * 3600;
  const Q0 = activityBq / durationSec;

  if (isCalm) {
    const R = Math.max(distance, 1);
    const volume = (4 / 3) * Math.PI * Math.pow(R, 3);
    const concentration = (activityBq / volume) * Math.exp(-isotope.decayConstant * (R / 0.5));
    return Math.max(concentration, 0);
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

  return Math.max(concentration, 0);
}

function depositionVelocity(form: string): number {
  if (form === "gas") return 0.001;
  if (form === "particle") return 0.02;
  return 0.01;
}

function isIodine(symbol: string): boolean {
  return /^I-\d+/i.test(symbol);
}

interface PathwayDoses {
  plumeDeposition: number;
  externalDose: number;
  cloudDose: number;
  groundDose: number;
  inhalationDose: number;
  skinDose: number;
  ingestionEquivalentDose: number;
  totalEffectiveDose: number;
  thyroidDose: number;
}

function computeIsotopeDoses(
  concentration: number,
  input: DispersionInput,
  isotopeSymbol: string,
): PathwayDoses {
  const { sourceTerm } = input;
  const isotope = getIsotope(isotopeSymbol);
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

  // Доза от подстилающей поверхности
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

export function computeMixtureAtDistance(
  input: DispersionInput,
  distance: number,
): {
  concentration: number;
  sy: number;
  sz: number;
  doses: PathwayDoses;
  nuclideBreakdown: NuclideDistanceContribution[];
} {
  const { meteorology, terrain, sourceTerm } = input;
  const isCalm = meteorology.windSpeed < 0.5;
  const effHeight = calculateEffectiveReleaseHeight(input);

  const { sy, sz } = isCalm
    ? { sy: Math.max(distance, 1), sz: Math.max(distance, 1) }
    : dispersionCoefficients(meteorology.stabilityClass, distance, terrain.terrainType);

  const mix = getNormalizedSourceMix(sourceTerm);

  const totalDoses: PathwayDoses = {
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
  let totalConcentration = 0;
  const nuclideBreakdown: NuclideDistanceContribution[] = [];

  for (const item of mix) {
    const conc = computeIsotopeCenterlineConcentration(
      input,
      distance,
      item.isotope,
      item.activityBq,
      sy,
      sz,
      effHeight,
    );
    const isoDoses = computeIsotopeDoses(conc, input, item.isotope);
    const isoMeta = getIsotope(item.isotope);

    totalConcentration += conc;
    totalDoses.plumeDeposition += isoDoses.plumeDeposition;
    totalDoses.externalDose += isoDoses.externalDose;
    totalDoses.cloudDose += isoDoses.cloudDose;
    totalDoses.groundDose += isoDoses.groundDose;
    totalDoses.inhalationDose += isoDoses.inhalationDose;
    totalDoses.skinDose += isoDoses.skinDose;
    totalDoses.ingestionEquivalentDose += isoDoses.ingestionEquivalentDose;
    totalDoses.totalEffectiveDose += isoDoses.totalEffectiveDose;
    totalDoses.thyroidDose += isoDoses.thyroidDose;

    nuclideBreakdown.push({
      id: item.id,
      isotope: item.isotope,
      name: isoMeta?.name ?? item.isotope,
      activityBq: item.activityBq,
      concentration: conc,
      ...isoDoses,
    });
  }

  return {
    concentration: totalConcentration,
    sy,
    sz,
    doses: totalDoses,
    nuclideBreakdown,
  };
}

export function computeCenterlineConcentration(
  input: DispersionInput,
  distance: number,
): { concentration: number; sy: number; sz: number } {
  const { concentration, sy, sz } = computeMixtureAtDistance(input, distance);
  return { concentration, sy, sz };
}

function determineProtectiveActions(
  results: DoseResult[],
  sourceTerm: SourceTerm,
): ProtectiveAction[] {
  const iodineRelease = getNormalizedSourceMix(sourceTerm).some(
    (item) => item.activityBq > 0 && isIodine(item.isotope),
  );
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
  // Standard compass azimuth: 0° = North (+Y), 90° = East (+X), 180° = South (-Y), 270° = West (-X)
  const windRad = (meteorology.windDirection * Math.PI) / 180;
  const dwX = Math.sin(windRad);
  const dwY = Math.cos(windRad);
  const cwX = Math.cos(windRad);
  const cwY = -Math.sin(windRad);

  const fineSet = new Set<number>(distances);
  const maxD = Math.max(...distances, 5000);
  for (const step of [
    50, 100, 150, 250, 400, 600, 800, 1000, 1500, 2000, 3000, 5000, 8000, 12000, 20000, 35000,
    50000,
  ]) {
    if (step <= maxD * 1.05) fineSet.add(step);
  }
  const sampleDistances = Array.from(fineSet).sort((a, b) => a - b);

  for (const d of sampleDistances) {
    const { concentration, sy, doses } = computeMixtureAtDistance(input, d);

    if (isCalm) {
      const numPoints = 16;
      for (let a = 0; a < numPoints; a++) {
        const angle = (a / numPoints) * 2 * Math.PI;
        footprint.push({
          x: d * Math.cos(angle),
          y: d * Math.sin(angle),
          concentration,
          dose: doses.totalEffectiveDose,
        });
      }
    } else {
      const offsets = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];
      for (const off of offsets) {
        const crosswind = off * sy;
        const concFactor = Math.exp(-(crosswind * crosswind) / (2 * sy * sy));
        const conc = concentration * concFactor;
        const pointDose = doses.totalEffectiveDose * concFactor;

        const x = d * dwX + crosswind * cwX;
        const y = d * dwY + crosswind * cwY;

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

function generateGeoIsodoseContours(input: DispersionInput): {
  contours: IsodoseContour2D[];
  zoneSummary: {
    exclusionZone: number;
    contaminationZone: number;
    ingestionZone: number;
  };
} {
  const lat0 = input.sourceTerm.latitude;
  const lon0 = input.sourceTerm.longitude;
  const isCalm = input.meteorology.windSpeed < 0.5;
  const windRad = (input.meteorology.windDirection * Math.PI) / 180;
  const dwX = Math.sin(windRad);
  const dwY = Math.cos(windRad);
  const cwX = Math.cos(windRad);
  const cwY = -Math.sin(windRad);

  const scanDistances: number[] = [];
  for (let d = 25; d <= 300; d += 25) scanDistances.push(d);
  for (let d = 350; d <= 1500; d += 50) scanDistances.push(d);
  for (let d = 1750; d <= 5000; d += 250) scanDistances.push(d);
  for (let d = 6000; d <= 15000; d += 1000) scanDistances.push(d);
  for (let d = 20000; d <= 50000; d += 2500) scanDistances.push(d);

  let exclusionZone = 0;
  let contaminationZone = 0;
  let ingestionZone = 0;

  const sampled = scanDistances.map((d) => {
    const { sy, doses } = computeMixtureAtDistance(input, d);
    const doseMsv = doses.totalEffectiveDose * 1000;
    if (doseMsv >= 100 && d > exclusionZone) exclusionZone = d;
    if (doseMsv >= 10 && d > contaminationZone) contaminationZone = d;
    if (doseMsv >= 1 && d > ingestionZone) ingestionZone = d;
    return { d, sy, doseMsv };
  });

  const thresholds = [
    { thresholdMsv: 0.1, label: "0.1 мЗв (Зона наблюдения)", color: "#06b6d4" },
    { thresholdMsv: 1, label: "1 мЗв (Ограничение потребления)", color: "#eab308" },
    { thresholdMsv: 10, label: "10 мЗв (Зона контроля)", color: "#f97316" },
    { thresholdMsv: 100, label: "100 мЗв (Экстренная эвакуация)", color: "#ef4444" },
  ];

  const contours: IsodoseContour2D[] = [];

  for (const th of thresholds) {
    if (isCalm) {
      let maxR = 0;
      for (const s of sampled) {
        if (s.doseMsv >= th.thresholdMsv) maxR = s.d;
      }
      if (maxR > 0) {
        const pts: { lat: number; lon: number }[] = [];
        const N = 36;
        for (let i = 0; i < N; i++) {
          const angle = (i / N) * 2 * Math.PI;
          pts.push(metersToLatLon(lat0, lon0, maxR * Math.cos(angle), maxR * Math.sin(angle)));
        }
        contours.push({
          thresholdMsv: th.thresholdMsv,
          label: th.label,
          color: th.color,
          points: pts,
        });
      }
      continue;
    }

    const forward: { lat: number; lon: number }[] = [];
    const backward: { lat: number; lon: number }[] = [];

    for (const s of sampled) {
      if (s.doseMsv >= th.thresholdMsv) {
        const ratio = Math.max(1.0001, s.doseMsv / th.thresholdMsv);
        const yCross = s.sy * Math.sqrt(2 * Math.log(ratio));

        const right = metersToLatLon(
          lat0,
          lon0,
          s.d * dwX + yCross * cwX,
          s.d * dwY + yCross * cwY,
        );
        const left = metersToLatLon(lat0, lon0, s.d * dwX - yCross * cwX, s.d * dwY - yCross * cwY);
        forward.push(right);
        backward.unshift(left);
      }
    }

    if (forward.length >= 2) {
      contours.push({
        thresholdMsv: th.thresholdMsv,
        label: th.label,
        color: th.color,
        points: [...forward, ...backward],
      });
    }
  }

  return {
    contours,
    zoneSummary: { exclusionZone, contaminationZone, ingestionZone },
  };
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
    const { concentration, sy, sz, doses, nuclideBreakdown } = computeMixtureAtDistance(
      input,
      distance,
    );
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
      nuclideBreakdown,
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

  const { contours: isodoseContours, zoneSummary: fineZones } = generateGeoIsodoseContours(input);

  let exclusionZone = fineZones.exclusionZone;
  let contaminationZone = fineZones.contaminationZone;
  let ingestionZone = fineZones.ingestionZone;
  for (const r of results) {
    if (r.totalEffectiveDose >= 0.1 && r.distance > exclusionZone) exclusionZone = r.distance;
    if (r.totalEffectiveDose >= 0.01 && r.distance > contaminationZone)
      contaminationZone = r.distance;
    if (r.totalEffectiveDose >= 0.001 && r.distance > ingestionZone) ingestionZone = r.distance;
  }

  const protectiveActions = determineProtectiveActions(results, input.sourceTerm);
  const plumeFootprint = generatePlumeFootprint(input, input.distances);
  const geoFootprint = generateGeoFootprint(input, plumeFootprint);

  const normalizedMix = getNormalizedSourceMix(input.sourceTerm);
  const dominantItem = normalizedMix.reduce(
    (best, cur) => (cur.activityBq > best.activityBq ? cur : best),
    normalizedMix[0],
  );

  const releaseDurationSec = input.sourceTerm.releaseDuration * 3600;
  const decayChain = solveDecayChain(dominantItem.isotope, {
    totalTime: releaseDurationSec,
    initialActivity: dominantItem.activityBq,
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
    isodoseContours,
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
