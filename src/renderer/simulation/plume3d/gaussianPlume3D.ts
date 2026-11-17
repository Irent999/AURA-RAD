import type {
  StabilityClass,
  Isotope3D,
  PlumeSource3D,
  Meteorology3D,
  DispersionPointResult,
  ZoneBoundary3D,
  PlumeIsoline3D,
  Plume3DModelOutput,
  NuclideReleaseItem,
  NuclideDoseBreakdown,
  MultiNuclideDispersionResult,
  PhysicalForm,
} from "./types";
import { CURIE_TO_BQ } from "./types";
import { getExtendedIsotope } from "./isotopes";

/**
 * Breathing rate for reference adult during light physical activity (m³/s)
 * 1.2 m³/h = 3.333e-4 m³/s (ICRP Publication 66 / 71)
 */
export const ADULT_BREATHING_RATE_M3_S = 1.2 / 3600;

export interface MultiNuclideCalcOptions {
  /** Effective ground shine exposure duration in hours (default 4h acute phase) */
  groundExposureHours?: number;
  /** Fast closed-form depletion approximation for 60fps 3D particle loop */
  fastMode?: boolean;
  /** Override precipitation rate (mm/h) */
  precipitationRateMmH?: number;
}

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
 * Calculates wet washout scavenging coefficient Λ (s⁻¹) from precipitation intensity R (mm/h)
 * per HotSpot / MACCS empirical parameterization.
 */
export function computeWetWashoutCoefficient(
  precipitationRateMmH: number,
  physicalForm: PhysicalForm,
): number {
  const r = Math.max(0, precipitationRateMmH);
  if (r <= 0 || physicalForm === "noble_gas") return 0;
  const baseLambda = physicalForm === "halogen" ? 3.5e-5 : 8.0e-5;
  return baseLambda * Math.pow(r, 0.8);
}

/**
 * Calculates Chamberlain-Overcamp Gaussian source depletion factor for dry deposition:
 * f_dry(x) = exp( -sqrt(2/pi) * (Vd / u) * ∫_0^x [exp(-H² / (2 σ_z(x')²)) / σ_z(x')] dx' )
 */
export function computeDryDepositionDepletionFactor(
  xDownwind: number,
  effectiveHeight: number,
  windSpeed: number,
  stability: StabilityClass,
  depositionVelocityMs: number,
  fastMode: boolean = false,
): number {
  if (xDownwind <= 0 || depositionVelocityMs <= 0) return 1.0;

  const u = Math.max(0.5, windSpeed);
  const H = Math.max(0, effectiveHeight);
  const coeff = Math.sqrt(2 / Math.PI) * (depositionVelocityMs / u);

  if (fastMode) {
    const { sigmaZ } = calculateDispersionCoefficients(xDownwind * 0.5, stability);
    const integrand = Math.exp(-0.5 * Math.pow(H / sigmaZ, 2)) / sigmaZ;
    const exponent = -coeff * xDownwind * integrand;
    return Math.max(0.01, Math.min(1.0, Math.exp(exponent)));
  }

  // 8-step midpoint numerical quadrature over [0, xDownwind]
  const steps = 8;
  const dx = xDownwind / steps;
  let integral = 0;
  for (let s = 0; s < steps; s++) {
    const xMid = (s + 0.5) * dx;
    const { sigmaZ } = calculateDispersionCoefficients(xMid, stability);
    integral += Math.exp(-0.5 * Math.pow(H / sigmaZ, 2)) / sigmaZ;
  }
  integral *= dx;

  return Math.max(0.005, Math.min(1.0, Math.exp(-coeff * integral)));
}

/**
 * Gaussian plume volumetric concentration C(x, y, z) in Bq/m³
 * in the plume's intrinsic coordinate system:
 * - x: downwind distance from source (m)
 * - y: crosswind horizontal offset from centerline (m)
 * - z: elevation above ground (m, z >= 0)
 * - H: effective release height (m)
 * Includes radioactive decay during transit (t = x / u), dry deposition depletion, and wet washout depletion.
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
  depositionVelocityMs: number = 0,
  washoutCoeffPerSec: number = 0,
  fastMode: boolean = false,
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

  const transitTimeSec = effectiveDownwind / u;

  // Radioactive decay during transit time t = x / u
  if (decayConstant > 0 && effectiveDownwind > 0) {
    concentration *= Math.exp(-decayConstant * transitTimeSec);
  }

  // Dry deposition source depletion
  if (depositionVelocityMs > 0 && effectiveDownwind > 0) {
    concentration *= computeDryDepositionDepletionFactor(
      effectiveDownwind,
      H,
      u,
      stability,
      depositionVelocityMs,
      fastMode,
    );
  }

  // Wet precipitation washout depletion
  if (washoutCoeffPerSec > 0 && effectiveDownwind > 0) {
    concentration *= Math.exp(-washoutCoeffPerSec * transitTimeSec);
  }

  return Math.max(0, isNaN(concentration) ? 0 : concentration);
}

/**
 * Calculates surface deposition density W(x, y) in Bq/m² from dry deposition
 * (W_dry = Vd * ∫C(x,y,0)dt) and wet washout (W_wet = Λ * Q_eff * T_rel / (u * sqrt(2π) * σ_y) * exp(-y²/(2σ_y²))).
 */
export function calculateSurfaceDepositionBqM2(
  xDownwind: number,
  yCrosswind: number,
  effectiveHeight: number,
  emissionRateBqPerSec: number,
  releaseDurationSec: number,
  windSpeed: number,
  stability: StabilityClass,
  decayConstant: number,
  mixingHeight: number,
  depositionVelocityMs: number,
  washoutCoeffPerSec: number,
  fastMode: boolean = false,
): number {
  if (xDownwind < -15 || emissionRateBqPerSec <= 0) return 0;
  if (depositionVelocityMs <= 0 && washoutCoeffPerSec <= 0) return 0;

  const effectiveDownwind = Math.max(0, xDownwind);
  const u = Math.max(0.5, windSpeed);

  // 1. Dry deposition: W_dry(x, y) = Vd * ∫ C(x, y, 0) dt
  let dryDep = 0;
  if (depositionVelocityMs > 0) {
    const groundConc = calculateGaussianConcentration(
      xDownwind,
      yCrosswind,
      0,
      effectiveHeight,
      emissionRateBqPerSec,
      u,
      stability,
      decayConstant,
      mixingHeight,
      depositionVelocityMs,
      washoutCoeffPerSec,
      fastMode,
    );
    dryDep = depositionVelocityMs * groundConc * releaseDurationSec;
  }

  // 2. Wet deposition (column washout)
  let wetDep = 0;
  if (washoutCoeffPerSec > 0 && effectiveDownwind >= 0) {
    const { sigmaY } = calculateDispersionCoefficients(effectiveDownwind, stability);
    const transitTimeSec = effectiveDownwind / u;
    const fDecay = decayConstant > 0 ? Math.exp(-decayConstant * transitTimeSec) : 1.0;
    const fDry =
      depositionVelocityMs > 0
        ? computeDryDepositionDepletionFactor(
            effectiveDownwind,
            effectiveHeight,
            u,
            stability,
            depositionVelocityMs,
            fastMode,
          )
        : 1.0;
    const fWet = Math.exp(-washoutCoeffPerSec * transitTimeSec);
    const qEff = emissionRateBqPerSec * fDecay * fDry * fWet;
    const crosswind = Math.exp(-0.5 * Math.pow(yCrosswind / sigmaY, 2));
    wetDep =
      (washoutCoeffPerSec * qEff * releaseDurationSec * crosswind) /
      (u * Math.sqrt(2 * Math.PI) * sigmaY);
  }

  return Math.max(0, dryDep + wetDep);
}

/**
 * Calculates Ambient Dose Equivalent Rate H*(10) and Inhalation Dose Rate
 * at a given 3D coordinate point (single isotope helper).
 */
export function calculatePointRadiologicalDose(
  xDownwind: number,
  yCrosswind: number,
  zHeight: number,
  source: PlumeSource3D,
  met: Meteorology3D,
  isotope: Isotope3D,
  doseLimitMsv: number = 1.0,
): DispersionPointResult {
  const releaseDuration = Math.max(1, source.releaseDuration);
  const emissionRate = source.totalActivity / releaseDuration;
  const washout = computeWetWashoutCoefficient(met.precipitationRateMmH ?? 0, isotope.physicalForm);

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
    isotope.defaultDepositionVelocityMs,
    washout,
  );

  const depositionBqM2 = calculateSurfaceDepositionBqM2(
    xDownwind,
    yCrosswind,
    source.effectiveHeight,
    emissionRate,
    releaseDuration,
    met.windSpeed,
    met.stabilityClass,
    isotope.decayConstant,
    met.mixingHeight,
    isotope.defaultDepositionVelocityMs,
    washout,
  );

  // 1. Inhalation dose rate: H_dot_inh = C · V_br · e_inh · 3600 · 1000 (mSv/h)
  const inhalationDoseRate =
    concentration * ADULT_BREATHING_RATE_M3_S * isotope.inhalationCoefficient * 3600 * 1000;

  // 2. Cloud immersion external dose rate: e_sub (Sv/s per Bq/m³) -> mSv/h
  const immersionDoseRate = concentration * isotope.externalImmersionCoefficient * 3600 * 1000;

  // 3. Ground shine external dose rate: W * DCF_ground * 3600 * 1000 (mSv/h)
  const groundShineDoseRate = depositionBqM2 * isotope.groundDoseCoefficient * 3600 * 1000;

  // 4. Direct line-of-sight core/stack gamma shine with Taylor/Berger air buildup factor
  const directDistance = Math.hypot(xDownwind, yCrosswind, zHeight - source.effectiveHeight);
  let directShineDoseRate = 0;
  if (directDistance > 0 && isotope.gammaConstant > 0) {
    const activityGbg = source.totalActivity / 1e9;
    const muR = Math.max(0, isotope.buildup.muAir * directDistance);
    const buildupFactor = 1 + isotope.buildup.a * muR * Math.exp(isotope.buildup.b * muR);
    directShineDoseRate =
      (isotope.gammaConstant * activityGbg * buildupFactor * Math.exp(-muR)) /
      Math.pow(Math.max(5, directDistance), 2);
    directShineDoseRate *= 0.1;
  }

  // Ambient Dose Equivalent Rate H*(10) is the sum of external photon fields:
  const ambientDoseEquivalentRateH10 =
    immersionDoseRate + directShineDoseRate + groundShineDoseRate;

  // Total equivalent radiological hazard rate:
  const totalDoseRate = ambientDoseEquivalentRateH10 + inhalationDoseRate;

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
 * Computes effective decayed exposure duration in seconds for ground shine:
 * T_decay_eff = (1 - exp(-lambda * T_sec)) / lambda
 */
export function calculateEffectiveDecaySeconds(
  exposureHours: number,
  decayConstantPerSec: number,
): number {
  const tSec = Math.max(0, exposureHours) * 3600;
  if (tSec <= 0) return 0;
  if (decayConstantPerSec <= 0) return tSec;
  return (1 - Math.exp(-decayConstantPerSec * tSec)) / decayConstantPerSec;
}

/**
 * Calculates protective action emergency boundary zones according to IAEA & Russian NRB-99/2009:
 * - Exclusion Zone (Зона отчуждения): urgent evacuation / immediate life hazard (> 50 mSv)
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
        break;
      }

      const { sigmaY } = calculateDispersionCoefficients(x, met.stabilityClass);

      if (centerlineDose >= th.level) {
        const ratio = Math.max(1.0001, centerlineDose / th.level);
        const yCross = sigmaY * Math.sqrt(2 * Math.log(ratio));

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
        isolineMetric: "dose_rate_msvh",
        label: th.label,
        colorHex: th.color,
        points: allPoints,
      });
    }
  });

  return isolines;
}

/**
 * Computes full centerline profile, protective zones, and isolines (single isotope legacy).
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

  const windTravelAngleRad = (((windDirectionDeg + 180) % 360) * Math.PI) / 180;

  const uX = Math.sin(windTravelAngleRad);
  const uZ = -Math.cos(windTravelAngleRad);

  const cX = Math.cos(windTravelAngleRad);
  const cZ = Math.sin(windTravelAngleRad);

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

/**
 * Calculates additive multi-pathway radiological dose and concentration from a mixture of radionuclides.
 * Pathways integrated per ICRP 72 / NRB-99/2009 / HotSpot:
 *  - D_inhalation = sum( Intake_i * DCF_inh_i )
 *  - D_cloud      = sum( ∫C_i(t)dt * DCF_cloud_i )
 *  - D_ground     = sum( W_i * DCF_ground_i * T_eff_decay_i )
 *  - D_total      = D_inhalation + D_cloud + D_ground  (Sv & mSv)
 *  - H*(10)       = sum( H_cloud_i + H_direct_i + H_ground_i ) (mSv/h)
 */
export function calculateMultiNuclidePointDose(
  xDownwind: number,
  yCrosswind: number,
  zHeight: number,
  source: PlumeSource3D,
  met: Meteorology3D,
  nuclides: NuclideReleaseItem[],
  doseLimitMsv: number = 1.0,
  options?: MultiNuclideCalcOptions,
): MultiNuclideDispersionResult {
  const activeNuclides = nuclides.filter((n) => n.enabled && n.activityBq > 0);
  const groundExposureHours = options?.groundExposureHours ?? 4.0;
  const fastMode = options?.fastMode ?? false;
  const precipRateMmH = options?.precipitationRateMmH ?? met.precipitationRateMmH ?? 0;

  if (activeNuclides.length === 0) {
    return {
      x: xDownwind,
      y: yCrosswind,
      z: zHeight,
      concentration: 0,
      gammaDoseRate: 0,
      ambientDoseEquivalentRateH10: 0,
      inhalationDoseRate: 0,
      totalDoseRate: 0,
      safeStayTimeMinutes: 999999,
      nuclides: [],
      totalActivityBq: 0,
      totalActivityCi: 0,
      primaryDoseContributor: "None",
      surfaceDepositionBqM2: 0,
      groundShineDoseRateMsvH: 0,
      inhalationDoseSv: 0,
      inhalationDoseMsv: 0,
      cloudDoseSv: 0,
      cloudDoseMsv: 0,
      groundDoseSv: 0,
      groundDoseMsv: 0,
      totalEffectiveDoseSv: 0,
      totalEffectiveDoseMsv: 0,
      personnelSafeTimeMin: 999999,
      publicSafeTimeMin: 999999,
      emergencySafeTimeMin: 999999,
    };
  }

  const releaseDuration = Math.max(1, source.releaseDuration);
  const directDistance = Math.hypot(xDownwind, yCrosswind, zHeight - source.effectiveHeight);

  let totalConcentration = 0;
  let totalDepositionBqM2 = 0;
  let totalInhalationRate = 0;
  let totalImmersionRate = 0;
  let totalDirectShineRate = 0;
  let totalGroundShineRate = 0;

  let totalInhalationDoseSv = 0;
  let totalCloudDoseSv = 0;
  let totalGroundDoseSv = 0;

  let totalActivity = 0;

  const breakdowns: NuclideDoseBreakdown[] = [];

  for (const item of activeNuclides) {
    const isotope = getExtendedIsotope(item.isotopeSymbol);
    const itemEmissionRate = item.activityBq / releaseDuration;
    const vd = item.depositionVelocityMs ?? isotope.defaultDepositionVelocityMs;
    const washoutCoeff = computeWetWashoutCoefficient(precipRateMmH, isotope.physicalForm);

    const dcfInh = item.customDcfInhalation ?? isotope.inhalationCoefficient;
    const dcfCloud = item.customDcfCloud ?? isotope.externalImmersionCoefficient;
    const dcfGround = item.customDcfGround ?? isotope.groundDoseCoefficient;

    totalActivity += item.activityBq;

    // 1. Air concentration C_i(x, y, z) [Bq/m³]
    const conc = calculateGaussianConcentration(
      xDownwind,
      yCrosswind,
      zHeight,
      source.effectiveHeight,
      itemEmissionRate,
      met.windSpeed,
      met.stabilityClass,
      isotope.decayConstant,
      met.mixingHeight,
      vd,
      washoutCoeff,
      fastMode,
    );

    // 2. Ground surface deposition W_i(x, y) [Bq/m²] (skip full calculation in fast 3D particle mode when z > 20m)
    const depBqM2 =
      fastMode && zHeight > 25
        ? 0
        : calculateSurfaceDepositionBqM2(
            xDownwind,
            yCrosswind,
            source.effectiveHeight,
            itemEmissionRate,
            releaseDuration,
            met.windSpeed,
            met.stabilityClass,
            isotope.decayConstant,
            met.mixingHeight,
            vd,
            washoutCoeff,
            fastMode,
          );

    // 3. Integrated Multi-Pathway Effective Doses [Sv & mSv]
    const timeIntegratedConc = conc * releaseDuration; // ∫C dt [(Bq·s)/m³]
    const intakeBq = timeIntegratedConc * ADULT_BREATHING_RATE_M3_S; // [Bq]

    const inhDoseSv = intakeBq * dcfInh;
    const cloudDoseSv = timeIntegratedConc * dcfCloud;

    const effDecaySec = calculateEffectiveDecaySeconds(groundExposureHours, isotope.decayConstant);
    const groundDoseSv = depBqM2 * dcfGround * effDecaySec;

    const itemTotalEffDoseSv = inhDoseSv + cloudDoseSv + groundDoseSv;

    // 4. Instantaneous Dose Rates [mSv/h]
    const inhRateMsvH = conc * ADULT_BREATHING_RATE_M3_S * dcfInh * 3600 * 1000;
    const immRateMsvH = conc * dcfCloud * 3600 * 1000;
    const groundShineRateMsvH = depBqM2 * dcfGround * 3600 * 1000;

    let directShineRateMsvH = 0;
    if (directDistance > 0 && isotope.gammaConstant > 0) {
      const activityGbg = item.activityBq / 1e9;
      const muR = Math.max(0, isotope.buildup.muAir * directDistance);
      const buildupFactor = 1 + isotope.buildup.a * muR * Math.exp(isotope.buildup.b * muR);
      directShineRateMsvH =
        (isotope.gammaConstant * activityGbg * buildupFactor * Math.exp(-muR)) /
        Math.pow(Math.max(5, directDistance), 2);
      directShineRateMsvH *= 0.1;
    }

    const itemH10MsvH = immRateMsvH + directShineRateMsvH + groundShineRateMsvH;
    const itemTotalRateMsvH = itemH10MsvH + inhRateMsvH;

    totalConcentration += conc;
    totalDepositionBqM2 += depBqM2;
    totalInhalationRate += inhRateMsvH;
    totalImmersionRate += immRateMsvH;
    totalDirectShineRate += directShineRateMsvH;
    totalGroundShineRate += groundShineRateMsvH;

    totalInhalationDoseSv += inhDoseSv;
    totalCloudDoseSv += cloudDoseSv;
    totalGroundDoseSv += groundDoseSv;

    if (!fastMode) {
      breakdowns.push({
        symbol: isotope.symbol,
        nameRu: isotope.nameRu,
        category: isotope.category,
        physicalForm: isotope.physicalForm,
        activityBq: item.activityBq,
        activityTbq: item.activityBq / 1e12,
        activityCi: item.activityBq / CURIE_TO_BQ,
        depositionVelocityMs: vd,
        concentrationBqM3: conc,
        timeIntegratedConcentrationBqSM3: timeIntegratedConc,
        intakeBq,
        surfaceDepositionBqM2: depBqM2,
        inhalationDoseSv: inhDoseSv,
        inhalationDoseMsv: inhDoseSv * 1000,
        cloudDoseSv,
        cloudDoseMsv: cloudDoseSv * 1000,
        groundDoseSv,
        groundDoseMsv: groundDoseSv * 1000,
        totalEffectiveDoseSv: itemTotalEffDoseSv,
        totalEffectiveDoseMsv: itemTotalEffDoseSv * 1000,
        ambientDoseH10MsvH: itemH10MsvH,
        groundShineRateMsvH,
        inhalationDoseMsvH: inhRateMsvH,
        totalDoseRateMsvH: itemTotalRateMsvH,
        fractionPercent: 0,
        hazardGroup: isotope.hazardGroup,
      });
    }
  }

  const totalH10 = totalImmersionRate + totalDirectShineRate + totalGroundShineRate;
  const totalDoseRate = totalH10 + totalInhalationRate;
  const totalEffectiveDoseSv = totalInhalationDoseSv + totalCloudDoseSv + totalGroundDoseSv;

  let maxDose = -1;
  let primaryContributor = activeNuclides[0]!.isotopeSymbol;

  for (const b of breakdowns) {
    // Rank contribution by total effective dose (fallback to rate if dose is zero)
    const basis = totalEffectiveDoseSv > 1e-12 ? totalEffectiveDoseSv * 1000 : totalDoseRate;
    const itemVal = totalEffectiveDoseSv > 1e-12 ? b.totalEffectiveDoseMsv : b.totalDoseRateMsvH;
    b.fractionPercent = basis > 1e-12 ? (itemVal / basis) * 100 : 0;
    if (itemVal > maxDose) {
      maxDose = itemVal;
      primaryContributor = b.symbol;
    }
  }

  // Sort breakdowns descending by contribution
  breakdowns.sort((a, b) => b.fractionPercent - a.fractionPercent);

  const computeSafeMinutes = (limitMsv: number) =>
    totalDoseRate > 1e-6 ? Math.max(0.1, (limitMsv / totalDoseRate) * 60) : 999999;

  return {
    x: xDownwind,
    y: yCrosswind,
    z: zHeight,
    concentration: totalConcentration,
    gammaDoseRate: totalH10,
    ambientDoseEquivalentRateH10: totalH10,
    inhalationDoseRate: totalInhalationRate,
    totalDoseRate,
    safeStayTimeMinutes: computeSafeMinutes(doseLimitMsv),
    nuclides: breakdowns,
    totalActivityBq: totalActivity,
    totalActivityCi: totalActivity / CURIE_TO_BQ,
    primaryDoseContributor: primaryContributor,
    surfaceDepositionBqM2: totalDepositionBqM2,
    groundShineDoseRateMsvH: totalGroundShineRate,
    inhalationDoseSv: totalInhalationDoseSv,
    inhalationDoseMsv: totalInhalationDoseSv * 1000,
    cloudDoseSv: totalCloudDoseSv,
    cloudDoseMsv: totalCloudDoseSv * 1000,
    groundDoseSv: totalGroundDoseSv,
    groundDoseMsv: totalGroundDoseSv * 1000,
    totalEffectiveDoseSv,
    totalEffectiveDoseMsv: totalEffectiveDoseSv * 1000,
    personnelSafeTimeMin: computeSafeMinutes(20.0),
    publicSafeTimeMin: computeSafeMinutes(1.0),
    emergencySafeTimeMin: computeSafeMinutes(50.0),
  };
}

/**
 * Calculates protective action emergency boundary zones for a multi-nuclide release mixture
 * using full multi-pathway total effective dose D_total (mSv).
 */
export function calculateMultiNuclideProtectiveZones(
  source: PlumeSource3D,
  met: Meteorology3D,
  nuclides: NuclideReleaseItem[],
  options?: MultiNuclideCalcOptions,
): ZoneBoundary3D[] {
  const sampleDistances = [
    50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000,
  ];

  let maxDoseExclusionDist = 100;
  let maxDoseEvacuationDist = 250;
  let maxDoseShelteringDist = 500;
  let maxDoseMonitoringDist = 1000;

  for (const x of sampleDistances) {
    const pt = calculateMultiNuclidePointDose(x, 0, 1.5, source, met, nuclides, 1.0, options);
    // Use comprehensive multi-pathway dose D_total (Inhalation + Cloud + Ground over T_eff)
    const doseMsv = pt.totalEffectiveDoseMsv;

    if (doseMsv >= 50) maxDoseExclusionDist = Math.max(maxDoseExclusionDist, x);
    if (doseMsv >= 10) maxDoseEvacuationDist = Math.max(maxDoseEvacuationDist, x);
    if (doseMsv >= 1.0) maxDoseShelteringDist = Math.max(maxDoseShelteringDist, x);
    if (doseMsv >= 0.1) maxDoseMonitoringDist = Math.max(maxDoseMonitoringDist, x);
  }

  return [
    {
      name: "Exclusion Zone",
      nameRu: "Зона отчуждения (Смесь)",
      doseThresholdMsv: 50,
      radiusMeters: maxDoseExclusionDist,
      colorHex: "#ef4444",
      recommendedAction:
        "Немедленная эвакуация населения, запрет пребывания без спецзащиты ОЗК/КИП.",
    },
    {
      name: "Evacuation Zone",
      nameRu: "Зона эвакуации (Смесь)",
      doseThresholdMsv: 10,
      radiusMeters: maxDoseEvacuationDist,
      colorHex: "#f97316",
      recommendedAction:
        "Обязательная эвакуация в течение 12-24 часов, йодная профилактика при наличии I-131.",
    },
    {
      name: "Sheltering Zone",
      nameRu: "Зона укрытия (Смесь)",
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
 * Generates ground-level Dose Rate H*(10) OR Total Effective Dose Isolines
 * for Three.js 3D map visualization.
 */
export function generateMultiNuclideIsolines(
  source: PlumeSource3D,
  met: Meteorology3D,
  nuclides: NuclideReleaseItem[],
  options?: MultiNuclideCalcOptions & { metric?: "dose_rate_msvh" | "total_dose_msv" },
): PlumeIsoline3D[] {
  const metric = options?.metric ?? "dose_rate_msvh";
  const thresholds =
    metric === "total_dose_msv"
      ? [
          { level: 100.0, label: "100 мЗв (Критическая)", color: "#dc2626" },
          { level: 50.0, label: "50 мЗв (Отчуждение)", color: "#ef4444" },
          { level: 10.0, label: "10 мЗв (Эвакуация)", color: "#f97316" },
          { level: 1.0, label: "1.0 мЗв (Предел населения)", color: "#eab308" },
        ]
      : [
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

    for (let x = 10; x <= maxSearchDist; x += 100) {
      const pt = calculateMultiNuclidePointDose(x, 0, 1.5, source, met, nuclides, 1.0, options);
      const centerlineVal =
        metric === "total_dose_msv" ? pt.totalEffectiveDoseMsv : pt.totalDoseRate;

      if (centerlineVal < th.level * 0.95 && x > 200) {
        break;
      }

      const { sigmaY } = calculateDispersionCoefficients(x, met.stabilityClass);

      if (centerlineVal >= th.level) {
        const ratio = Math.max(1.0001, centerlineVal / th.level);
        const yCross = sigmaY * Math.sqrt(2 * Math.log(ratio));

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
        doseThresholdMsv: metric === "total_dose_msv" ? th.level : undefined,
        isolineMetric: metric,
        label: th.label,
        colorHex: th.color,
        points: allPoints,
      });
    }
  });

  return isolines;
}

/**
 * Full multi-nuclide additive Gaussian plume simulation run.
 */
export function runMultiNuclideGaussianPlume3DModel(
  source: PlumeSource3D,
  met: Meteorology3D,
  nuclides: NuclideReleaseItem[],
  options?: MultiNuclideCalcOptions,
): Plume3DModelOutput {
  const activeNuclides = nuclides.filter((n) => n.enabled && n.activityBq > 0);
  const primarySymbol = activeNuclides[0]?.isotopeSymbol ?? source.isotopeSymbol ?? "Cs-137";
  const primaryIsotope = getExtendedIsotope(primarySymbol);

  const totalActivityBq = activeNuclides.reduce((sum, n) => sum + n.activityBq, 0);
  const emissionRateBqPerSec = totalActivityBq / Math.max(1, source.releaseDuration);

  const testDistances = [
    50, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000,
  ];

  let peakGroundDoseDistanceM = 100;
  let peakGroundDoseRateMsvH = 0;
  let nuclideBreakdownAtPeak: NuclideDoseBreakdown[] = [];

  const centerlineValues = testDistances.map((dist) => {
    const { sigmaY, sigmaZ } = calculateDispersionCoefficients(dist, met.stabilityClass);
    const pt = calculateMultiNuclidePointDose(
      dist,
      0,
      1.5,
      source,
      met,
      activeNuclides,
      1.0,
      options,
    );

    if (pt.totalDoseRate > peakGroundDoseRateMsvH) {
      peakGroundDoseRateMsvH = pt.totalDoseRate;
      peakGroundDoseDistanceM = dist;
      nuclideBreakdownAtPeak = pt.nuclides;
    }

    return {
      distance: dist,
      sigmaY,
      sigmaZ,
      groundConcentration: pt.concentration,
      groundDepositionBqM2: pt.surfaceDepositionBqM2,
      groundDoseRateMsvH: pt.totalDoseRate,
      ambientDoseEquivalentRateH10: pt.ambientDoseEquivalentRateH10,
      inhalationDoseRateMsvH: pt.inhalationDoseRate,
      groundShineDoseRateMsvH: pt.groundShineDoseRateMsvH,
      accumulatedDoseMsv: pt.totalEffectiveDoseMsv,
      totalEffectiveDoseMsv: pt.totalEffectiveDoseMsv,
      safeStayTimeMin: pt.safeStayTimeMinutes,
    };
  });

  const zones = calculateMultiNuclideProtectiveZones(source, met, activeNuclides, options);
  const isolines = generateMultiNuclideIsolines(source, met, activeNuclides, {
    ...options,
    metric: "dose_rate_msvh",
  });

  return {
    source: {
      ...source,
      totalActivity: totalActivityBq,
    },
    meteorology: met,
    isotope: primaryIsotope,
    nuclides: activeNuclides,
    totalActivityBq,
    nuclideBreakdownAtPeak,
    emissionRateBqPerSec,
    centerlineValues,
    peakGroundDoseDistanceM,
    peakGroundDoseRateMsvH,
    zones,
    isolines,
  };
}
