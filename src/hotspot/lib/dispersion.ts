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
import { getVVER1200StackGeoLocation } from "../../3d/geoPlantAdapter";
import {
  DEFAULT_PLANT_BEARING_DEG,
  DEFAULT_PLANT_MODEL_SCALE,
} from "../../3d/generateVVER1200Plant";

/*
 * All physics uses strict SI base units:
 *   Q       [Bq]        total released activity
 *   u       [m/s]       wind speed
 *   x       [m]         downwind distance
 *   sy, sz  [m]         Briggs Pasquill-Gifford dispersion coefficients
 *   Psi     [Bq*s/m^3]  time-integrated air concentration
 *   dose    [Sv]        all dose quantities
 */

const BREATHING_RATE = 3.33e-4; // m^3/s (1.2 m^3/h, ICRP 60 / 119 adult light activity)
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

// Calibrated Briggs / Pasquill-Gifford dispersion coefficients for Open Country (rural)
function sigmaRural(stability: StabilityClass, distance: number): { sy: number; sz: number } {
  const x = Math.max(distance, 1);
  let sy = 0;
  let sz = 0;

  switch (stability) {
    case "A":
      sy = 0.22 * x * Math.pow(1 + 0.0001 * x, -0.5);
      sz = 0.2 * x * Math.sqrt(1 + 0.0003 * x);
      break;
    case "B":
      sy = 0.16 * x * Math.pow(1 + 0.0001 * x, -0.5);
      sz = 0.12 * x * Math.sqrt(1 + 0.0001 * x);
      break;
    case "C":
      sy = 0.11 * x * Math.pow(1 + 0.0001 * x, -0.5);
      sz = 0.08 * x * Math.pow(1 + 0.0002 * x, -0.5);
      break;
    case "D":
      sy = 0.08 * x * Math.pow(1 + 0.0001 * x, -0.5);
      sz = 0.06 * x * Math.pow(1 + 0.001 * x, -0.5);
      break;
    case "E":
      sy = 0.06 * x * Math.pow(1 + 0.0001 * x, -0.5);
      sz = 0.03 * x * Math.pow(1 + 0.0003 * x, -0.5);
      break;
    case "F":
    default:
      sy = 0.04 * x * Math.pow(1 + 0.0001 * x, -0.5);
      sz = 0.02 * x * Math.pow(1 + 0.0003 * x, -0.5);
      break;
  }

  return {
    sy: Math.max(sy, 0.1),
    sz: Math.max(sz, 0.1),
  };
}

// Briggs / McElroy-Pooler dispersion coefficients for Urban terrain
function sigmaUrban(stability: StabilityClass, distance: number): { sy: number; sz: number } {
  const x = Math.max(distance, 1);
  switch (stability) {
    case "A":
    case "B":
      return {
        sy: Math.max((0.32 * x) / Math.sqrt(1 + 0.0004 * x), 0.1),
        sz: Math.max(0.24 * x * Math.sqrt(1 + 0.001 * x), 0.1),
      };
    case "C":
      return {
        sy: Math.max((0.22 * x) / Math.sqrt(1 + 0.0004 * x), 0.1),
        sz: Math.max(0.2 * x, 0.1),
      };
    case "D":
      return {
        sy: Math.max((0.16 * x) / Math.sqrt(1 + 0.0004 * x), 0.1),
        sz: Math.max((0.14 * x) / Math.sqrt(1 + 0.0003 * x), 0.1),
      };
    default:
      return {
        sy: Math.max((0.11 * x) / Math.sqrt(1 + 0.0004 * x), 0.1),
        sz: Math.max((0.08 * x) / Math.sqrt(1 + 0.0015 * x), 0.1),
      };
  }
}

export function dispersionCoefficients(
  stability: StabilityClass,
  distance: number,
  terrainType: string,
): { sy: number; sz: number } {
  if (terrainType === "urban") return sigmaUrban(stability, distance);
  return sigmaRural(stability, distance);
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

function isNobleGas(symbol: string): boolean {
  return /^(Kr|Xe|Rn|Ar|He|Ne)-\d+/i.test(symbol);
}

function isIodine(symbol: string): boolean {
  return /^I-\d+/i.test(symbol);
}

/**
 * Computes gravitational & turbulent dry deposition velocity v_d [m/s]
 * based on physical form and aerodynamic particle size (um).
 * - Gas / noble gases: v_d = 0 (no dry deposition, no plume depletion)
 * - Aerosol / Liquid: 0.01–0.10 m/s depending on particle size
 * - Particle: 0.03–0.12 m/s depending on particle size
 */
export function computeDepositionVelocity(
  symbol: string,
  form: SourceTerm["physicalForm"] | string,
  particleSizeUm: number = 1,
): number {
  if (isNobleGas(symbol) || form === "gas") {
    return 0;
  }
  const dp = Number.isFinite(particleSizeUm) ? Math.max(particleSizeUm, 0.1) : 1;
  if (form === "particle") {
    return Math.min(0.12, Math.max(0.01, 0.03 * Math.pow(dp, 0.45)));
  }
  if (isIodine(symbol)) {
    return Math.min(0.1, Math.max(0.01, 0.01 * Math.pow(dp, 0.35)));
  }
  return Math.min(0.1, Math.max(0.005, 0.01 * Math.pow(dp, 0.45)));
}

/**
 * Clarke / Chamberlain-Overcamp Gaussian source depletion factor f_dep(x) in (0, 1]
 * accounting for cumulative dry deposition removal of aerosol/particulate activity upwind of x.
 */
export function computeDryDepositionDepletionFactor(
  distance: number,
  effHeight: number,
  windSpeed: number,
  stability: StabilityClass,
  terrainType: string,
  vd: number,
): number {
  if (vd <= 0 || distance <= 0) return 1.0;

  const u = Math.max(windSpeed, 0.5);
  const H = Math.max(effHeight, 0);
  const coeff = Math.sqrt(2 / Math.PI) * (vd / u);

  const steps = 24;
  const dx = distance / steps;
  let integral = 0;

  for (let i = 0; i < steps; i++) {
    const xMid = (i + 0.5) * dx;
    const { sz } = dispersionCoefficients(stability, xMid, terrainType);
    integral += Math.exp(-0.5 * Math.pow(H / sz, 2)) / sz;
  }
  integral *= dx;

  return Math.max(0.005, Math.min(1.0, Math.exp(-coeff * integral)));
}

function wetWashoutCoefficient(
  precipRateMmH: number,
  symbol: string,
  form: SourceTerm["physicalForm"] | string,
): number {
  const r = Math.max(0, precipRateMmH || 0);
  if (r <= 0 || isNobleGas(symbol) || form === "gas") return 0;
  const baseLambda = isIodine(symbol) ? 3.5e-5 : 8.0e-5;
  return baseLambda * Math.pow(r, 0.8);
}

/**
 * Computes time-integrated centerline Gaussian plume concentration Ψ(x, 0, z) [Bq*s/m^3]
 * with ground reflection at height z above ground, effective release height H_eff,
 * and source depletion correction when physicalForm is Aerosol / Particle / Liquid.
 */
function computeIsotopeIntegratedConcentration(
  input: DispersionInput,
  distance: number,
  isotopeSymbol: string,
  activityBq: number,
  sy: number,
  sz: number,
  effHeight: number,
  zHeight: number,
): number {
  const { meteorology, sourceTerm, terrain } = input;
  const isotope = getIsotope(isotopeSymbol);
  if (!isotope || activityBq <= 0) return 0;

  const isCalm = meteorology.windSpeed < 0.5;
  if (isCalm) {
    const R = Math.max(distance, 1);
    const volume = (4 / 3) * Math.PI * Math.pow(R, 3);
    const transitSec = R / 0.5;
    const psiCalm =
      (activityBq / volume) * transitSec * Math.exp(-isotope.decayConstant * transitSec);
    return Math.max(psiCalm, 0);
  }

  const u = Math.max(meteorology.windSpeed, 0.5);
  const travelTimeSec = distance / u;
  const Q = activityBq * Math.exp(-isotope.decayConstant * travelTimeSec);

  const z = Math.max(zHeight, 0);
  const L = meteorology.mixingHeight;

  let psi: number;
  if (L > 0 && sz > 0.8 * L) {
    psi = Q / (Math.sqrt(2 * Math.PI) * u * sy * L);
  } else {
    const vertical =
      Math.exp(-Math.pow(z - effHeight, 2) / (2 * sz * sz)) +
      Math.exp(-Math.pow(z + effHeight, 2) / (2 * sz * sz));
    psi = (Q / (2 * Math.PI * u * sy * sz)) * vertical;
  }

  // Dry deposition plume depletion (source depletion for Aerosol / Particle / Liquid; 1.0 for Gas)
  const vd = computeDepositionVelocity(
    isotopeSymbol,
    sourceTerm.physicalForm,
    sourceTerm.particleSize,
  );
  if (vd > 0 && distance > 0) {
    psi *= computeDryDepositionDepletionFactor(
      distance,
      effHeight,
      u,
      meteorology.stabilityClass,
      terrain.terrainType,
      vd,
    );
  }

  // Wet precipitation washout depletion during transit
  const washoutLambda = wetWashoutCoefficient(
    meteorology.precipitationRate,
    isotopeSymbol,
    sourceTerm.physicalForm,
  );
  if (washoutLambda > 0 && distance > 0) {
    psi *= Math.exp(-washoutLambda * travelTimeSec);
  }

  return Math.max(psi, 0);
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
  psiBreathing: number,
  psiGround: number,
  input: DispersionInput,
  isotopeSymbol: string,
  distance: number,
): PathwayDoses {
  const { sourceTerm, meteorology } = input;
  const isotope = getIsotope(isotopeSymbol);
  if (!isotope || (psiBreathing <= 0 && psiGround <= 0)) {
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

  // Cloud immersion dose [Sv]: Psi [Bq*s/m^3] * DCF_cloud [Sv*m^3/(Bq*s)]
  const cloudDoseSv = psiBreathing * isotope.doseRateConstant;

  // Inhalation committed effective dose [Sv]: Psi [Bq*s/m^3] * BR [m^3/s] * DCF_inh [Sv/Bq]
  const inhalationDoseSv = psiBreathing * BREATHING_RATE * isotope.inhalationCoefficient;

  // Ground surface deposition W [Bq/m^2]: dry deposition Vd * Psi(z=0) + wet washout
  const vd = computeDepositionVelocity(
    isotope.symbol,
    sourceTerm.physicalForm,
    sourceTerm.particleSize,
  );
  const dryDeposition = psiGround * vd;

  const u = Math.max(meteorology.windSpeed, 0.5);
  const washoutLambda = wetWashoutCoefficient(
    meteorology.precipitationRate,
    isotope.symbol,
    sourceTerm.physicalForm,
  );
  let wetDeposition = 0;
  if (washoutLambda > 0 && distance > 0) {
    const { sy } = dispersionCoefficients(
      meteorology.stabilityClass,
      distance,
      input.terrain.terrainType,
    );
    const mixItem = getNormalizedSourceMix(sourceTerm).find((m) => m.isotope === isotopeSymbol);
    const activityBq = mixItem?.activityBq ?? 0;
    const transitSec = distance / u;
    const fDry =
      vd > 0
        ? computeDryDepositionDepletionFactor(
            distance,
            calculateEffectiveReleaseHeight(input),
            u,
            meteorology.stabilityClass,
            input.terrain.terrainType,
            vd,
          )
        : 1.0;
    const qEff =
      activityBq * fDry * Math.exp(-(isotope.decayConstant + washoutLambda) * transitSec);
    wetDeposition = (washoutLambda * qEff) / (u * Math.sqrt(2 * Math.PI) * sy);
  }
  const plumeDeposition = dryDeposition + wetDeposition;

  // Ground shine dose [Sv] integrated over acute exposure duration (default 4h = 14400 s)
  const groundExpSec = input.averagingTime > 0 ? input.averagingTime : 14400;
  const effGroundTimeSec =
    isotope.decayConstant > 0
      ? (1 - Math.exp(-isotope.decayConstant * groundExpSec)) / isotope.decayConstant
      : groundExpSec;
  const groundShineDoseSv = plumeDeposition * isotope.externalDoseCoefficient * effGroundTimeSec;

  // Skin equivalent dose [Sv] & secondary ingestion indicator [Sv]
  const skinDoseSv = cloudDoseSv * 1.5 + groundShineDoseSv * 1.2;
  const ingestionEquivalentSv = plumeDeposition * 1e-4 * isotope.ingestionCoefficient;

  // Total Effective Dose Equivalent (TEDE) [Sv]
  const totalDoseSv = cloudDoseSv + inhalationDoseSv + groundShineDoseSv;

  // Thyroid dose [Sv] (ICRP tissue weighting factor w_T = 0.05 for radioiodine inhalation)
  const thyroidDose = isIodine(isotope.symbol)
    ? inhalationDoseSv / 0.05 + cloudDoseSv + groundShineDoseSv
    : totalDoseSv;

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
  const receptorZ = Math.max(input.receptorHeight ?? 1.5, 0);

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
  let totalPsi = 0;
  const nuclideBreakdown: NuclideDistanceContribution[] = [];

  for (const item of mix) {
    const psiBreathing = computeIsotopeIntegratedConcentration(
      input,
      distance,
      item.isotope,
      item.activityBq,
      sy,
      sz,
      effHeight,
      receptorZ,
    );
    const psiGround = computeIsotopeIntegratedConcentration(
      input,
      distance,
      item.isotope,
      item.activityBq,
      sy,
      sz,
      effHeight,
      0,
    );
    const isoDoses = computeIsotopeDoses(psiBreathing, psiGround, input, item.isotope, distance);
    const isoMeta = getIsotope(item.isotope);

    totalPsi += psiBreathing;
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
      concentration: psiBreathing,
      ...isoDoses,
    });
  }

  return {
    concentration: totalPsi,
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

function getStackReleaseOrigin(input: DispersionInput): { lat: number; lon: number } {
  const stackGeo = getVVER1200StackGeoLocation(
    input.sourceTerm.latitude,
    input.sourceTerm.longitude,
    input.sourceTerm.plantBearingDeg ?? DEFAULT_PLANT_BEARING_DEG,
    input.sourceTerm.plantModelScale ?? DEFAULT_PLANT_MODEL_SCALE,
  );
  return { lat: stackGeo.lat, lon: stackGeo.lon };
}

function generateGeoFootprint(
  input: DispersionInput,
  localFootprint: { x: number; y: number; concentration: number; dose: number }[],
  origin: { lat: number; lon: number },
): { lat: number; lon: number; concentration: number; dose: number }[] {
  const mapped = localFootprint.map((p) => {
    const geo = metersToLatLon(origin.lat, origin.lon, p.x, p.y);
    return { lat: geo.lat, lon: geo.lon, concentration: p.concentration, dose: p.dose };
  });
  // Anchor plume heatmap origin right at the ventilation stack mouth
  if (mapped.length > 0) {
    return [
      {
        lat: origin.lat,
        lon: origin.lon,
        concentration: mapped[0].concentration,
        dose: mapped[0].dose,
      },
      ...mapped,
    ];
  }
  return mapped;
}

function generateGeoIsodoseContours(
  input: DispersionInput,
  origin: { lat: number; lon: number },
): {
  contours: IsodoseContour2D[];
  zoneSummary: {
    exclusionZone: number;
    contaminationZone: number;
    ingestionZone: number;
  };
} {
  const lat0 = origin.lat;
  const lon0 = origin.lon;
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

  const releaseOrigin = getStackReleaseOrigin(input);
  const { contours: isodoseContours, zoneSummary: fineZones } = generateGeoIsodoseContours(
    input,
    releaseOrigin,
  );

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
  const geoFootprint = generateGeoFootprint(input, plumeFootprint, releaseOrigin);

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
    releaseOrigin,
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
