import type {
  StabilityClass,
  Isotope3D,
  PlumeSource3D,
  Meteorology3D,
  DispersionPointResult,
  ZoneBoundary3D,
  PlumeIsoline3D,
  Plume3DModelOutput,
} from "./types";
import { getExtendedIsotope } from "./isotopes";

/**
 * Breathing rate for reference adult during light physical activity (m³/s)
 * 1.2 m³/h = 3.333e-4 m³/s (ICRP Publication 66 / 71)
 */
export const ADULT_BREATHING_RATE_M3_S = 1.2 / 3600;

/**
 * Calculates Briggs dispersion coefficients σ_y and σ_z (meters)
 * with virtual source diameter regularization (eliminates division by zero at x -> 0).
 */
export function calculateDispersionCoefficients(
  xMeters: number,
  stability: StabilityClass,
): { sigmaY: number; sigmaZ: number } {
  const x = Math.max(0, xMeters);

  let rawSigmaY = 0;
  let rawSigmaZ = 0;

  switch (stability) {
    case "A":
      rawSigmaY = 0.22 * x * Math.pow(1 + 0.0001 * x, -0.5);
      rawSigmaZ = 0.2 * x;
      break;
    case "B":
      rawSigmaY = 0.16 * x * Math.pow(1 + 0.0001 * x, -0.5);
      rawSigmaZ = 0.12 * x;
      break;
    case "C":
      rawSigmaY = 0.11 * x * Math.pow(1 + 0.0001 * x, -0.5);
      rawSigmaZ = 0.08 * x * Math.pow(1 + 0.0002 * x, -0.5);
      break;
    case "D":
      rawSigmaY = 0.08 * x * Math.pow(1 + 0.0001 * x, -0.5);
      rawSigmaZ = 0.06 * x * Math.pow(1 + 0.0015 * x, -0.5);
      break;
    case "E":
      rawSigmaY = 0.06 * x * Math.pow(1 + 0.0001 * x, -0.5);
      rawSigmaZ = 0.03 * x * Math.pow(1 + 0.0003 * x, -1.0);
      break;
    case "F":
    default:
      rawSigmaY = 0.04 * x * Math.pow(1 + 0.0001 * x, -0.5);
      rawSigmaZ = 0.016 * x * Math.pow(1 + 0.0003 * x, -1.0);
      break;
  }

  // Physical stack orifice size added in quadrature:
  // σ_y0 ≈ 2.5m, σ_z0 ≈ 1.5m prevents mathematical singularity at x=0
  const sigmaY0 = 2.5;
  const sigmaZ0 = 1.5;

  return {
    sigmaY: Math.sqrt(rawSigmaY * rawSigmaY + sigmaY0 * sigmaY0),
    sigmaZ: Math.sqrt(rawSigmaZ * rawSigmaZ + sigmaZ0 * sigmaZ0),
  };
}

/**
 * Gaussian plume volumetric concentration C(x, y, z) in Bq/m³
 * in the plume's intrinsic coordinate system:
 * - x: downwind distance from source (m)
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
  if (emissionRateBqPerSec <= 0) return 0;

  // Upwind turbulent back-diffusion cutoff
  if (xDownwind < -30) return 0;
  const upwindFactor = xDownwind < 0 ? Math.exp(-Math.pow(Math.abs(xDownwind) / 8.0, 2)) : 1.0;

  const effectiveDownwind = Math.max(0, xDownwind);
  const u = Math.max(0.5, windSpeed);
  const { sigmaY, sigmaZ } = calculateDispersionCoefficients(effectiveDownwind, stability);

  // Crosswind horizontal Gaussian component
  const crosswindTerm = Math.exp(-0.5 * Math.pow(yCrosswind / sigmaY, 2));

  // Vertical Gaussian component with ground reflection and optional mixing lid reflections
  let verticalTerm = 0;
  const H = Math.max(0, effectiveHeight);
  const z = Math.max(0, zHeight);

  if (mixingHeight > 0 && sigmaZ > 0.6 * mixingHeight) {
    // Uniform vertical mixing between ground and planetary boundary layer lid
    verticalTerm = (Math.sqrt(2 * Math.PI) * sigmaZ) / mixingHeight;
  } else {
    // Ground reflection + boundary lid reflections
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
  let concentration = normFactor * crosswindTerm * verticalTerm * upwindFactor;

  // Radioactive decay during transit time t = x / u
  if (decayConstant > 0 && effectiveDownwind > 0) {
    const transitTimeSec = effectiveDownwind / u;
    concentration *= Math.exp(-decayConstant * transitTimeSec);
  }

  return Math.max(0, isNaN(concentration) ? 0 : concentration);
}

/**
 * Calculates Ambient Dose Equivalent Rate H*(10) and Inhalation Dose Rate
 * at a given 3D coordinate point.
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

  // 1. Inhalation dose rate: H_dot_inh = C · V_br · e_inh · 3600 · 1000 (mSv/h)
  const inhalationDoseRate =
    concentration * ADULT_BREATHING_RATE_M3_S * isotope.inhalationCoefficient * 3600 * 1000;

  // 2. Cloud immersion external dose rate: e_sub (Sv/s per Bq/m³) -> mSv/h
  const immersionDoseRate = concentration * isotope.externalImmersionCoefficient * 3600 * 1000;

  // 3. Direct line-of-sight core/stack gamma shine with Taylor/Berger air buildup factor
  const directDistance = Math.hypot(xDownwind, yCrosswind, zHeight - source.effectiveHeight);
  let directShineDoseRate = 0;
  if (directDistance > 0 && isotope.gammaConstant > 0) {
    const activityGbg = source.totalActivity / 1e9;
    const muR = Math.max(0, isotope.buildup.muAir * directDistance);
    const buildupFactor = 1 + isotope.buildup.a * muR * Math.exp(isotope.buildup.b * muR);
    directShineDoseRate =
      (isotope.gammaConstant * activityGbg * buildupFactor * Math.exp(-muR)) /
      Math.pow(Math.max(5, directDistance), 2);
    directShineDoseRate *= 0.1; // Geometric source volume weighting
  }

  // Ambient Dose Equivalent Rate H*(10) is the sum of external photon fields:
  const ambientDoseEquivalentRateH10 = immersionDoseRate + directShineDoseRate;

  // Total equivalent radiological hazard rate:
  const totalDoseRate = ambientDoseEquivalentRateH10 + inhalationDoseRate;

  // 4. Safe stay time: t_max = D_limit / H_dot (hours -> minutes)
  let safeStayTimeMinutes = 999999;
  if (totalDoseRate > 1e-6) {
    safeStayTimeMinutes = (doseLimitMsv / totalDoseRate) * 60;
  }

  return {
    x: xDownwind,
    y: yCrosswind,
    z: zHeight,
    concentration,
    gammaDoseRate: ambientDoseEquivalentRateH10,
    ambientDoseEquivalentRateH10,
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
 * Generates ground-level Dose Rate Isolines (Изолинии H*(10))
 * for 0.1, 1.0, 10.0, 50.0 mSv/h in geographic world coordinates (x, z).
 */
export function generatePlumeIsolines(
  source: PlumeSource3D,
  met: Meteorology3D,
  isotope: Isotope3D,
): PlumeIsoline3D[] {
  const thresholds = [
    { level: 50.0, label: "50 мЗв/ч (Опасность)", color: "#ef4444" },
    { level: 10.0, label: "10 мЗв/ч (Эвакуация)", color: "#f97316" },
    { level: 1.0, label: "1.0 мЗв/ч (Укрытие)", color: "#eab308" },
    { level: 0.1, label: "0.1 мЗв/ч (Контроль)", color: "#06b6d4" },
  ];

  const isolines: PlumeIsoline3D[] = [];
  const maxSearchDist = 12000;

  thresholds.forEach((th) => {
    const forwardPoints: { x: number; z: number }[] = [];
    const backwardPoints: { x: number; z: number }[] = [];

    // Sample along downwind axis
    for (let x = 10; x <= maxSearchDist; x += 100) {
      const centerlineDose = calculatePointRadiologicalDose(
        x,
        0,
        1.5,
        source,
        met,
        isotope,
        1.0,
      ).totalDoseRate;

      if (centerlineDose < th.level * 0.95 && x > 200) {
        // Drop below threshold at distance
        break;
      }

      const { sigmaY } = calculateDispersionCoefficients(x, met.stabilityClass);

      // Solve for crosswind width y where dose = th.level:
      // dose(y) = dose(0) * exp(-0.5 * (y / sigmaY)^2) = th.level
      // y = sigmaY * sqrt(2 * ln(dose(0) / th.level))
      if (centerlineDose >= th.level) {
        const ratio = Math.max(1.0001, centerlineDose / th.level);
        const yCross = sigmaY * Math.sqrt(2 * Math.log(ratio));

        // Transform downwind (x, +y) and (x, -y) to world coordinates (X, Z)
        const ptRight = plumeToWorldCoordinates(x, yCross, source.position, met.windDirectionDeg);
        const ptLeft = plumeToWorldCoordinates(x, -yCross, source.position, met.windDirectionDeg);

        forwardPoints.push({ x: ptRight.worldX, z: ptRight.worldZ });
        backwardPoints.unshift({ x: ptLeft.worldX, z: ptLeft.worldZ });
      }
    }

    if (forwardPoints.length >= 2) {
      const allPoints = [...forwardPoints, ...backwardPoints];
      isolines.push({
        doseThresholdMsvH: th.level,
        label: th.label,
        colorHex: th.color,
        points: allPoints,
      });
    }
  });

  return isolines;
}

/**
 * Computes full centerline profile, protective zones, and isolines.
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
      ambientDoseEquivalentRateH10: pt.ambientDoseEquivalentRateH10,
      inhalationDoseRateMsvH: pt.inhalationDoseRate,
      accumulatedDoseMsv: accumulated,
      safeStayTimeMin: pt.safeStayTimeMinutes,
    };
  });

  const zones = calculateProtectiveZones(source, met, isotope);
  const isolines = generatePlumeIsolines(source, met, isotope);

  return {
    source,
    meteorology: met,
    isotope,
    emissionRateBqPerSec,
    centerlineValues,
    peakGroundDoseDistanceM,
    peakGroundDoseRateMsvH,
    zones,
    isolines,
  };
}

/**
 * Transforms world coordinates (X, Y, Z in Three.js space) to
 * downwind plume coordinates (x_dw, y_cw, z_height) according to wind direction angle.
 * In Three.js space:
 * - X is horizontal (East positive)
 * - Y is elevation/height (Up positive)
 * - Z is horizontal (-Z is North, +Z is South)
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

  // Wind blows FROM windDirectionDeg.
  // The plume travels TOWARDS (windDirectionDeg + 180) degrees.
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

/**
 * Transforms downwind plume coordinates (xDownwind, yCrosswind)
 * back to world coordinates (worldX, worldZ)
 */
export function plumeToWorldCoordinates(
  xDownwind: number,
  yCrosswind: number,
  sourcePos: { x: number; y: number; z: number },
  windDirectionDeg: number,
): { worldX: number; worldZ: number } {
  const windTravelAngleRad = (((windDirectionDeg + 180) % 360) * Math.PI) / 180;

  const uX = Math.sin(windTravelAngleRad);
  const uZ = -Math.cos(windTravelAngleRad);

  const cX = Math.cos(windTravelAngleRad);
  const cZ = Math.sin(windTravelAngleRad);

  const worldX = sourcePos.x + xDownwind * uX + yCrosswind * cX;
  const worldZ = sourcePos.z + xDownwind * uZ + yCrosswind * cZ;

  return { worldX, worldZ };
}
