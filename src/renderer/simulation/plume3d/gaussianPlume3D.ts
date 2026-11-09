import type {
  StabilityClass,
  Isotope3D,
  PlumeSource3D,
  Meteorology3D,
  DispersionPointResult,
  ZoneBoundary3D,
  Plume3DModelOutput,
} from "./types";
import { getExtendedIsotope } from "./isotopes";

/**
 * Breathing rate for reference adult during light activity (m³/s)
 * 1.2 m³/h = 3.333e-4 m³/s (ICRP Publication 66)
 */
export const ADULT_BREATHING_RATE_M3_S = 1.2 / 3600;

/**
 * Calculates Briggs dispersion coefficients σ_y and σ_z (meters)
 * as a function of downwind distance x (meters) and Pasquill stability class A-F.
 */
export function calculateDispersionCoefficients(
  xMeters: number,
  stability: StabilityClass,
): { sigmaY: number; sigmaZ: number } {
  const x = Math.max(1, xMeters);

  let sigmaY = 0;
  let sigmaZ = 0;

  switch (stability) {
    case "A":
      sigmaY = 0.22 * x * Math.pow(1 + 0.0001 * x, -0.5);
      sigmaZ = 0.2 * x;
      break;
    case "B":
      sigmaY = 0.16 * x * Math.pow(1 + 0.0001 * x, -0.5);
      sigmaZ = 0.12 * x;
      break;
    case "C":
      sigmaY = 0.11 * x * Math.pow(1 + 0.0001 * x, -0.5);
      sigmaZ = 0.08 * x * Math.pow(1 + 0.0002 * x, -0.5);
      break;
    case "D":
      sigmaY = 0.08 * x * Math.pow(1 + 0.0001 * x, -0.5);
      sigmaZ = 0.06 * x * Math.pow(1 + 0.0015 * x, -0.5);
      break;
    case "E":
      sigmaY = 0.06 * x * Math.pow(1 + 0.0001 * x, -0.5);
      sigmaZ = 0.03 * x * Math.pow(1 + 0.0003 * x, -1.0);
      break;
    case "F":
    default:
      sigmaY = 0.04 * x * Math.pow(1 + 0.0001 * x, -0.5);
      sigmaZ = 0.016 * x * Math.pow(1 + 0.0003 * x, -1.0);
      break;
  }

  return {
    sigmaY: Math.max(0.5, sigmaY),
    sigmaZ: Math.max(0.5, sigmaZ),
  };
}

/**
 * Gaussian plume volumetric concentration C(x, y, z) in Bq/m³
 * in the plume's intrinsic coordinate system:
 * - x: downwind distance from source (m, x >= 0)
 * - y: crosswind horizontal offset from centerline (m)
 * - z: elevation above ground (m, z >= 0)
 * - H: effective release height (m)
 */
export function calculateGaussianConcentration(
  xDownwind: number,
  yCrosswind: number,
  zHeight: number,
  effectiveHeight: number,
  emissionRateBqPerSec: number,
  windSpeed: number,
  stability: StabilityClass,
  decayConstant: number = 0,
  mixingHeight: number = 1000,
): number {
  if (xDownwind <= 0) return 0;

  const u = Math.max(0.5, windSpeed);
  const { sigmaY, sigmaZ } = calculateDispersionCoefficients(xDownwind, stability);

  // Crosswind horizontal Gaussian component
  const crosswindTerm = Math.exp(-0.5 * Math.pow(yCrosswind / sigmaY, 2));

  // Vertical Gaussian component with ground reflection and optional mixing lid reflections
  let verticalTerm = 0;
  const H = effectiveHeight;
  const z = Math.max(0, zHeight);

  if (mixingHeight > 0 && sigmaZ > 0.6 * mixingHeight) {
    // Uniform vertical mixing between ground and inversion lid
    verticalTerm = (Math.sqrt(2 * Math.PI) * sigmaZ) / mixingHeight;
  } else {
    // Ground reflection + lid reflection sum
    const maxN = mixingHeight > 0 ? 2 : 0;
    for (let n = -maxN; n <= maxN; n++) {
      const zShift = 2 * n * mixingHeight;
      const term1 = Math.exp(-0.5 * Math.pow((z - H + zShift) / sigmaZ, 2));
      const term2 = Math.exp(-0.5 * Math.pow((z + H + zShift) / sigmaZ, 2));
      verticalTerm += term1 + term2;
    }
  }

  // Pre-exponential factor: Q / (2 * pi * u * sigma_y * sigma_z)
  const normFactor = emissionRateBqPerSec / (2 * Math.PI * u * sigmaY * sigmaZ);
  let concentration = normFactor * crosswindTerm * verticalTerm;

  // Radioactive decay during transit time t = x / u
  if (decayConstant > 0) {
    const transitTimeSec = xDownwind / u;
    concentration *= Math.exp(-decayConstant * transitTimeSec);
  }

  return Math.max(0, isNaN(concentration) ? 0 : concentration);
}

/**
 * Calculates dose rates and safe stay time at a given 3D coordinate point.
 */
export function calculatePointRadiologicalDose(
  xDownwind: number,
  yCrosswind: number,
  zHeight: number,
  source: PlumeSource3D,
  met: Meteorology3D,
  isotope: Isotope3D,
  doseLimitMsv: number = 1.0, // Default public annual / intervention limit
): DispersionPointResult {
  const emissionRate = source.totalActivity / Math.max(1, source.releaseDuration);
  const concentration = calculateGaussianConcentration(
    xDownwind,
    yCrosswind,
    zHeight,
    source.effectiveHeight,
    emissionRate,
    met.windSpeed,
    met.stabilityClass,
    isotope.decayConstant,
    met.mixingHeight,
  );

  // 1. Inhalation dose rate: H_dot_inh = C · V_br · e_inh · 1000 (mSv/h)
  // (3600 converts per-second to per-hour)
  const inhalationDoseRate =
    concentration * ADULT_BREATHING_RATE_M3_S * isotope.inhalationCoefficient * 3600 * 1000;

  // 2. Cloud immersion / external gamma dose rate
  // Submersion dose coefficient e_sub is in (Sv/s) / (Bq/m³)
  let gammaDoseRate = concentration * isotope.externalImmersionCoefficient * 3600 * 1000;

  // Plus direct line-of-sight core shine with Taylor/Berger air buildup factor if within 500m of source
  const directDistance = Math.hypot(xDownwind, yCrosswind, zHeight - source.effectiveHeight);
  if (directDistance > 0 && isotope.gammaConstant > 0) {
    const activityGbg = source.totalActivity / 1e9;
    // Air attenuation mu * r
    const muR = isotope.buildup.muAir * directDistance;
    const buildupFactor = 1 + isotope.buildup.a * muR * Math.exp(isotope.buildup.b * muR);
    const directShine =
      (isotope.gammaConstant * activityGbg * buildupFactor * Math.exp(-muR)) /
      Math.pow(Math.max(5, directDistance), 2);
    gammaDoseRate += directShine * 0.1; // geometric source volume weighting
  }

  const totalDoseRate = inhalationDoseRate + gammaDoseRate;

  // 3. Safe stay time: t_max = D_limit / H_dot (hours -> minutes)
  let safeStayTimeMinutes = 999999;
  if (totalDoseRate > 1e-6) {
    safeStayTimeMinutes = (doseLimitMsv / totalDoseRate) * 60;
  }

  return {
    x: xDownwind,
    y: yCrosswind,
    z: zHeight,
    concentration,
    gammaDoseRate,
    inhalationDoseRate,
    totalDoseRate,
    safeStayTimeMinutes: Math.max(0.1, safeStayTimeMinutes),
  };
}

/**
 * Calculates accumulated dose over exposure duration T (hours).
 * D = integral(H_dot(t) dt) = H_dot * (1 - exp(-lambda * T)) / lambda
 */
export function calculateAccumulatedDoseMsv(
  instantDoseRateMsvH: number,
  exposureHours: number,
  decayConstantPerSec: number = 0,
): number {
  if (exposureHours <= 0 || instantDoseRateMsvH <= 0) return 0;
  if (decayConstantPerSec <= 0) {
    return instantDoseRateMsvH * exposureHours;
  }
  const lambdaHour = decayConstantPerSec * 3600;
  return instantDoseRateMsvH * ((1 - Math.exp(-lambdaHour * exposureHours)) / lambdaHour);
}

/**
 * Calculates protective action emergency boundary zones according to IAEA & Russian NRB-99/2009:
 * - Exclusion Zone (Зона отчуждения): urgent evacuation / immediate life hazard (> 50 mSv / > 100 mSv/h)
 * - Evacuation Zone (Зона эвакуации): mandatory evacuation within 24h (> 10 mSv)
 * - Sheltering Zone (Зона укрытия): stay indoors, seal ventilation, stable iodine prophylaxis (> 1 mSv)
 * - Monitoring Zone (Зона радиационного контроля): enhanced radiometric observation (> 0.1 mSv)
 */
export function calculateProtectiveZones(
  source: PlumeSource3D,
  met: Meteorology3D,
  isotope: Isotope3D,
): ZoneBoundary3D[] {
  const emissionRate = source.totalActivity / Math.max(1, source.releaseDuration);
  const sampleDistances = [
    50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000,
  ];

  let maxDoseExclusionDist = 100;
  let maxDoseEvacuationDist = 250;
  let maxDoseShelteringDist = 500;
  let maxDoseMonitoringDist = 1000;

  for (const x of sampleDistances) {
    const pt = calculatePointRadiologicalDose(x, 0, 1.5, source, met, isotope, 1.0);
    // Estimated 4-hour acute emergency dose
    const dose4h = pt.totalDoseRate * 4;

    if (dose4h >= 50) maxDoseExclusionDist = Math.max(maxDoseExclusionDist, x);
    if (dose4h >= 10) maxDoseEvacuationDist = Math.max(maxDoseEvacuationDist, x);
    if (dose4h >= 1.0) maxDoseShelteringDist = Math.max(maxDoseShelteringDist, x);
    if (dose4h >= 0.1) maxDoseMonitoringDist = Math.max(maxDoseMonitoringDist, x);
  }

  return [
    {
      name: "Exclusion Zone",
      nameRu: "Зона отчуждения",
      doseThresholdMsv: 50,
      radiusMeters: maxDoseExclusionDist,
      colorHex: "#ef4444",
      recommendedAction:
        "Немедленная эвакуация населения, запрет пребывания без спецзащиты ОЗК/КИП.",
    },
    {
      name: "Evacuation Zone",
      nameRu: "Зона эвакуации",
      doseThresholdMsv: 10,
      radiusMeters: maxDoseEvacuationDist,
      colorHex: "#f97316",
      recommendedAction:
        "Обязательная эвакуация в течение 12-24 часов, йодная профилактика при наличии I-131.",
    },
    {
      name: "Sheltering Zone",
      nameRu: "Зона укрытия",
      doseThresholdMsv: 1.0,
      radiusMeters: maxDoseShelteringDist,
      colorHex: "#eab308",
      recommendedAction:
        "Укрытие в капитальных строениях, герметизация окон, респираторы 'Лепесток'.",
    },
    {
      name: "Radiation Control Zone",
      nameRu: "Зона радиационного контроля",
      doseThresholdMsv: 0.1,
      radiusMeters: maxDoseMonitoringDist,
      colorHex: "#06b6d4",
      recommendedAction:
        "Непрерывный дозиметрический мониторинг, радиационный контроль продуктов и воды.",
    },
  ];
}

/**
 * Computes full centerline profile and summary model output for the 3D visualizer and IPC bridge.
 */
export function runGaussianPlume3DModel(
  source: PlumeSource3D,
  met: Meteorology3D,
  customIsotope?: Isotope3D,
): Plume3DModelOutput {
  const isotope = customIsotope ?? getExtendedIsotope(source.isotopeSymbol);
  const emissionRateBqPerSec = source.totalActivity / Math.max(1, source.releaseDuration);

  const testDistances = [
    50, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000,
  ];

  let peakGroundDoseDistanceM = 100;
  let peakGroundDoseRateMsvH = 0;

  const centerlineValues = testDistances.map((dist) => {
    const { sigmaY, sigmaZ } = calculateDispersionCoefficients(dist, met.stabilityClass);
    const pt = calculatePointRadiologicalDose(dist, 0, 1.5, source, met, isotope, 1.0);
    const accumulated = calculateAccumulatedDoseMsv(pt.totalDoseRate, 4, isotope.decayConstant);

    if (pt.totalDoseRate > peakGroundDoseRateMsvH) {
      peakGroundDoseRateMsvH = pt.totalDoseRate;
      peakGroundDoseDistanceM = dist;
    }

    return {
      distance: dist,
      sigmaY,
      sigmaZ,
      groundConcentration: pt.concentration,
      groundDoseRateMsvH: pt.totalDoseRate,
      inhalationDoseRateMsvH: pt.inhalationDoseRate,
      accumulatedDoseMsv: accumulated,
      safeStayTimeMin: pt.safeStayTimeMinutes,
    };
  });

  const zones = calculateProtectiveZones(source, met, isotope);

  return {
    source,
    meteorology: met,
    isotope,
    emissionRateBqPerSec,
    centerlineValues,
    peakGroundDoseDistanceM,
    peakGroundDoseRateMsvH,
    zones,
  };
}

/**
 * Transforms world coordinates (X, Y, Z in Three.js space) to
 * downwind plume coordinates (x_dw, y_cw, z_height) according to wind direction angle.
 * Wind direction in meteorology: direction the wind is blowing FROM.
 * In Three.js space:
 * - X is horizontal (East positive)
 * - Y is elevation/height (Up positive)
 * - Z is horizontal (North positive or standard WebGL depth)
 */
export function worldToPlumeCoordinates(
  worldX: number,
  worldY: number,
  worldZ: number,
  sourcePos: { x: number; y: number; z: number },
  windDirectionDeg: number,
): { xDownwind: number; yCrosswind: number; zHeight: number } {
  const dx = worldX - sourcePos.x;
  const dz = worldZ - sourcePos.z;
  const zHeight = Math.max(0, worldY);

  // Plume travels TOWARDS angle (windDirectionDeg + 180) degrees
  // Wind vector angle in radians
  const windTravelAngleRad = (((windDirectionDeg + 180) % 360) * Math.PI) / 180;

  // Unit vector of downwind travel:
  const uX = Math.sin(windTravelAngleRad);
  const uZ = -Math.cos(windTravelAngleRad);

  // Unit vector of crosswind (orthogonal):
  const cX = Math.cos(windTravelAngleRad);
  const cZ = Math.sin(windTravelAngleRad);

  // Projection
  const xDownwind = dx * uX + dz * uZ;
  const yCrosswind = dx * cX + dz * cZ;

  return { xDownwind, yCrosswind, zHeight };
}
