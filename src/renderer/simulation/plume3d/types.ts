/**
 * AURA-RAD 3D Plume Simulation & Multi-Nuclide Dose Assessment Module
 * Types & Data Contracts for Gaussian Dispersion, Deposition & Multi-Pathway Radiological Safety
 * Standards: ICRP Publication 66 / 71 / 72, NRB-99/2009, EPA PAGs, HotSpot / MACCS Methodology
 */

export type StabilityClass = "A" | "B" | "C" | "D" | "E" | "F";

export type NuclideCategory = "fission_product" | "actinide" | "activation_product" | "natural";

export type PhysicalForm = "noble_gas" | "halogen" | "aerosol";

export type ActivityUnit = "Bq" | "TBq" | "Ci";

export type LungAbsorptionType = "F" | "M" | "S" | "V";

export const CURIE_TO_BQ = 3.7e10;
export const DEFAULT_AMAD_MICRONS = 1.0;

export const NUCLIDE_CATEGORY_LABELS: Record<NuclideCategory, string> = {
  fission_product: "Продукт деления",
  actinide: "Актинид",
  activation_product: "Активационный продукт",
  natural: "Естественный / РИ",
};

export interface BuildupParameters {
  /** Taylor or Berger buildup factor parameters in air: B(μr) = 1 + a·(μr)·exp(b·μr) */
  a: number;
  b: number;
  /** Linear attenuation coefficient in air at normal conditions (1/m) */
  muAir: number;
}

export interface Isotope3D {
  name: string;
  nameRu: string;
  symbol: string;
  category: NuclideCategory;
  physicalForm: PhysicalForm;
  /** Default dry deposition velocity Vd in m/s (0 for noble gases, ~0.01 halogens, ~0.003 aerosols AMAD=1um) */
  defaultDepositionVelocityMs: number;
  /** ICRP 66/72 lung clearance / absorption type */
  lungAbsorptionType: LungAbsorptionType;
  /** Standard reference for Dose Conversion Factors (e.g. "ICRP 72 / НРБ-99/2009 (AMAD = 1 мкм)") */
  dcfReference: string;
  atomicMass: number;
  atomicNumber: number;
  halfLife: number;
  halfLifeUnit: "seconds" | "minutes" | "hours" | "days" | "years";
  decayConstant: number; // s^-1
  decayMode: "alpha" | "beta-" | "beta+" | "EC" | "IT" | "SF";
  /** Dominant gamma energy lines in MeV */
  gammaEnergies: number[];
  /** Average gamma energy per decay (MeV/disintegration) */
  avgGammaEnergy: number;
  /** Average beta energy (MeV) */
  avgBetaEnergy: number;
  /**
   * Gamma ray constant Γ (Гамма-постоянная радионуклида)
   * Unit: (mSv · m²) / (GBq · h)
   */
  gammaConstant: number;
  /** Buildup factor coefficients in air */
  buildup: BuildupParameters;
  /** Inhalation committed effective dose coefficient e_inh (Sv / Bq), AMAD = 1 μm */
  inhalationCoefficient: number;
  /** External cloud immersion dose coefficient DCF_cloud ((Sv/s) / (Bq/m³)) */
  externalImmersionCoefficient: number;
  /** Ground surface deposition dose coefficient DCF_ground ((Sv/s) / (Bq/m²)) */
  groundDoseCoefficient: number;
  /** Radiological toxicity group according to NRB-99/2009: Group A (very high), B, C, D */
  hazardGroup: "A" | "B" | "C" | "D";
  description: string;
}

export type MapStyleType = "satellite" | "topographic" | "tactical" | "osm";

export interface PlumeSource3D {
  isotopeSymbol: string;
  /** Total release activity in Becquerels (Bq) */
  totalActivity: number;
  /** Release duration in seconds */
  releaseDuration: number;
  /** Release point coordinates in world space (meters: x, y, z) */
  position: { x: number; y: number; z: number };
  /** Effective release height (physical stack height + plume rise Δh) in meters */
  effectiveHeight: number;
  /** Geographic latitude of release site */
  latitude?: number;
  /** Geographic longitude of release site */
  longitude?: number;
  /** Plume rise Δh (m) from buoyancy/momentum */
  plumeRise?: number;
}

export interface Meteorology3D {
  /** Wind speed at release height in m/s (minimum 0.5 m/s) */
  windSpeed: number;
  /** Wind direction blowing FROM in meteorological degrees (0 = North, 90 = East, 180 = South, 270 = West) */
  windDirectionDeg: number;
  /** Atmospheric stability category according to Pasquill-Gifford (A-F) */
  stabilityClass: StabilityClass;
  /** Planetary boundary mixing layer height in meters (e.g. 500 - 2000m) */
  mixingHeight: number;
  /** Ambient air temperature in °C */
  airTemperature: number;
  /** Precipitation intensity in mm/h for wet deposition washout (0 = dry weather) */
  precipitationRateMmH?: number;
}

export interface DispersionPointResult {
  /** Coordinate in meters relative to release point */
  x: number;
  y: number;
  z: number;
  /** Radionuclide volumetric concentration in Bq/m³ */
  concentration: number;
  /** External cloudshine gamma dose rate in mSv/h */
  gammaDoseRate: number;
  /** Inhalation dose rate in mSv/h */
  inhalationDoseRate: number;
  /**
   * Ambient Dose Equivalent Rate H*(10) in mSv/h
   * (Мощность амбиентного эквивалента дозы H*(10))
   */
  ambientDoseEquivalentRateH10: number;
  /** Total equivalent dose rate H_dot in mSv/h (H*(10) + Inhalation) */
  totalDoseRate: number;
  /** Safe stay time in minutes until reaching dose limit */
  safeStayTimeMinutes: number;
}

export interface PlumeIsoline3D {
  doseThresholdMsvH: number;
  /** Optional dose threshold in mSv if isoline represents integrated effective dose D_total */
  doseThresholdMsv?: number;
  isolineMetric?: "dose_rate_msvh" | "total_dose_msv";
  label: string;
  colorHex: string;
  points: { x: number; z: number }[];
}

export interface Plume3DGridSlice {
  points: { x: number; y: number; z: number; concentration: number; doseRate: number }[];
  maxConcentration: number;
  maxDoseRate: number;
}

export interface ZoneBoundary3D {
  name: string;
  nameRu: string;
  doseThresholdMsv: number;
  radiusMeters: number;
  colorHex: string;
  recommendedAction: string;
}

export interface NuclideReleaseItem {
  id: string;
  isotopeSymbol: string;
  /** Activity in Becquerels (Bq) - canonical physical unit */
  activityBq: number;
  /** Optional display/input activity in Curies (Ci) = activityBq / 3.7e10 */
  activityCi?: number;
  /** Preferred input unit in UI ("Bq" | "TBq" | "Ci") */
  inputUnit?: ActivityUnit;
  enabled: boolean;
  nameRu?: string;
  category?: NuclideCategory;
  /** Fractional activity share in the active mixture (0 - 100%) */
  fractionPercent?: number;
  /** Optional custom dry deposition velocity Vd (m/s); defaults to isotope.defaultDepositionVelocityMs */
  depositionVelocityMs?: number;
  /** Optional override for DCF inhalation (Sv/Bq) */
  customDcfInhalation?: number;
  /** Optional override for DCF cloud immersion ((Sv/s)/(Bq/m³)) */
  customDcfCloud?: number;
  /** Optional override for DCF ground shine ((Sv/s)/(Bq/m²)) */
  customDcfGround?: number;
}

export interface SourceTermInventoryMix {
  id: string;
  name: string;
  /** Aerosol Activity Median Aerodynamic Diameter (default 1.0 μm per ICRP 66/72) */
  amadMicrons: number;
  items: NuclideReleaseItem[];
  totalActivityBq: number;
  totalActivityCi: number;
  releaseDurationSec: number;
  effectiveHeightM: number;
  latitude?: number;
  longitude?: number;
}

export interface NuclideDoseBreakdown {
  symbol: string;
  nameRu: string;
  category: NuclideCategory;
  physicalForm: PhysicalForm;
  activityBq: number;
  activityTbq: number;
  activityCi: number;
  depositionVelocityMs: number;
  concentrationBqM3: number;
  /** Time-integrated air concentration ∫C(t)dt in (Bq·s)/m³ */
  timeIntegratedConcentrationBqSM3: number;
  /** Inhaled activity Intake_i = ∫C dt · BR in Bq */
  intakeBq: number;
  /** Surface contamination density W_i(x, y) in Bq/m² */
  surfaceDepositionBqM2: number;
  /** Integrated inhalation committed effective dose in Sv and mSv */
  inhalationDoseSv: number;
  inhalationDoseMsv: number;
  /** Integrated cloud immersion external dose in Sv and mSv */
  cloudDoseSv: number;
  cloudDoseMsv: number;
  /** Integrated ground shine dose over effective exposure time in Sv and mSv */
  groundDoseSv: number;
  groundDoseMsv: number;
  /** Total effective dose D_total,i = D_inh + D_cloud + D_ground in Sv and mSv */
  totalEffectiveDoseSv: number;
  totalEffectiveDoseMsv: number;
  /** Instantaneous external H*(10) rate in mSv/h (Cloud + Direct + Ground Shine) */
  ambientDoseH10MsvH: number;
  /** Instantaneous ground shine dose rate in mSv/h */
  groundShineRateMsvH: number;
  /** Instantaneous inhalation hazard rate in mSv/h */
  inhalationDoseMsvH: number;
  /** Combined instantaneous rate in mSv/h */
  totalDoseRateMsvH: number;
  /** Percentage contribution to total effective dose / hazard at this point */
  fractionPercent: number;
  hazardGroup: "A" | "B" | "C" | "D";
}

export interface MultiNuclideDispersionResult extends DispersionPointResult {
  nuclides: NuclideDoseBreakdown[];
  totalActivityBq: number;
  totalActivityCi: number;
  primaryDoseContributor: string;
  /** Total ground surface deposition W_total(x, y) in Bq/m² */
  surfaceDepositionBqM2: number;
  /** Instantaneous ground shine dose rate in mSv/h */
  groundShineDoseRateMsvH: number;
  /** Multi-pathway integrated effective doses across the full mixture */
  inhalationDoseSv: number;
  inhalationDoseMsv: number;
  cloudDoseSv: number;
  cloudDoseMsv: number;
  groundDoseSv: number;
  groundDoseMsv: number;
  totalEffectiveDoseSv: number;
  totalEffectiveDoseMsv: number;
  /** Safe stay times t_max (minutes) for specific regulatory limits */
  personnelSafeTimeMin: number; // 20 mSv annual/occupational limit (NRB-99/2009)
  publicSafeTimeMin: number; // 1 mSv annual public limit (NRB-99/2009)
  emergencySafeTimeMin: number; // 50 mSv emergency intervention limit
}

export interface PeakCoordinate {
  xDownwindM: number;
  yCrosswindM: number;
  worldX: number;
  worldZ: number;
}

export interface PerNuclidePeakReport {
  symbol: string;
  nameRu: string;
  category: NuclideCategory;
  hazardGroup: "A" | "B" | "C" | "D";
  halfLifeFormatted: string;
  activityBq: number;
  activityCi: number;
  activitySharePercent: number;
  depositionVelocityMs: number;
  maxConcentrationBqM3: number;
  concentrationPeakCoords: PeakCoordinate;
  maxDepositionBqM2: number;
  maxInhalationDoseSv: number;
  maxInhalationDoseMsv: number;
  maxCloudDoseSv: number;
  maxCloudDoseMsv: number;
  maxGroundDoseSv: number;
  maxGroundDoseMsv: number;
  maxTotalDoseSv: number;
  maxTotalDoseMsv: number;
  dosePeakCoords: PeakCoordinate;
  maxDoseRateH10MsvH: number;
  contributionToPeakTotalDosePercent: number;
}

export interface GridDoseSample {
  xDownwindM: number;
  yCrosswindM: number;
  worldX: number;
  worldZ: number;
  concentrationBqM3: number;
  depositionBqM2: number;
  doseRateH10MsvH: number;
  inhalationDoseMsv: number;
  cloudDoseMsv: number;
  groundDoseMsv: number;
  totalDoseMsv: number;
  totalDoseSv: number;
}

export interface MultiNuclideCenterlinePoint {
  distanceM: number;
  sigmaY: number;
  sigmaZ: number;
  transitTimeSec: number;
  concentrationBqM3: number;
  depositionBqM2: number;
  doseRateH10MsvH: number;
  groundShineRateMsvH: number;
  inhalationRateMsvH: number;
  totalDoseRateMsvH: number;
  inhalationDoseMsv: number;
  cloudDoseMsv: number;
  groundDoseMsv: number;
  totalEffectiveDoseMsv: number;
  totalEffectiveDoseSv: number;
  personnelSafeTimeMin: number;
  publicSafeTimeMin: number;
}

export interface MultiNuclideAssessmentReport {
  generatedAtIso: string;
  methodology: string;
  amadMicrons: number;
  groundExposureHours: number;
  precipitationRateMmH: number;
  sourceMix: SourceTermInventoryMix;
  meteorology: Meteorology3D;
  /** Peak values & exact coordinates for every single radionuclide in the mixture */
  perNuclidePeaks: PerNuclidePeakReport[];
  /** Combined additive peak metrics for the full mixture */
  totalMixturePeak: {
    maxConcentrationBqM3: number;
    concentrationPeakCoords: PeakCoordinate;
    maxDepositionBqM2: number;
    maxDoseRateH10MsvH: number;
    maxTotalDoseRateMsvH: number;
    maxTotalEffectiveDoseSv: number;
    maxTotalEffectiveDoseMsv: number;
    dosePeakCoords: PeakCoordinate;
    dominantNuclideSymbol: string;
    pathwayTotalsMsv: {
      inhalationMsv: number;
      cloudMsv: number;
      groundMsv: number;
      totalMsv: number;
    };
  };
  /** Safe stay duration assessments at peak and along plume */
  safeStayAssessment: {
    personnelLimitMsv: number;
    personnelSafeTimeAtPeakMin: number;
    publicLimitMsv: number;
    publicSafeTimeAtPeakMin: number;
    emergencyLimitMsv: number;
    emergencySafeTimeAtPeakMin: number;
  };
  centerlineProfile: MultiNuclideCenterlinePoint[];
  /** 2D spatial grid field across map area */
  gridField: GridDoseSample[];
  /** Dose rate H*(10) and Total Dose isolines for Three.js visualization */
  isolines: PlumeIsoline3D[];
  totalDoseIsolines: PlumeIsoline3D[];
  zones: ZoneBoundary3D[];
}

export interface Plume3DModelOutput {
  source: PlumeSource3D;
  meteorology: Meteorology3D;
  isotope: Isotope3D;
  nuclides?: NuclideReleaseItem[];
  totalActivityBq?: number;
  nuclideBreakdownAtPeak?: NuclideDoseBreakdown[];
  emissionRateBqPerSec: number;
  centerlineValues: {
    distance: number;
    sigmaY: number;
    sigmaZ: number;
    groundConcentration: number;
    groundDepositionBqM2?: number;
    groundDoseRateMsvH: number;
    ambientDoseEquivalentRateH10: number;
    inhalationDoseRateMsvH: number;
    groundShineDoseRateMsvH?: number;
    accumulatedDoseMsv: number;
    totalEffectiveDoseMsv?: number;
    safeStayTimeMin: number;
  }[];
  peakGroundDoseDistanceM: number;
  peakGroundDoseRateMsvH: number;
  zones: ZoneBoundary3D[];
  isolines: PlumeIsoline3D[];
  assessmentReport?: MultiNuclideAssessmentReport;
}

export interface DosimeterProbe {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface AccidentScenarioPreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  items: { symbol: string; activityTbq: number }[];
}

export const ACCIDENT_PRESETS: AccidentScenarioPreset[] = [
  {
    id: "chernobyl",
    name: "Чернобыль (РБМК-1000)",
    badge: "Авария IV категории",
    description:
      "Разрушение активной зоны, выброс йода-131, цезия-137, цезия-134, стронция-90 и инертных газов",
    items: [
      { symbol: "I-131", activityTbq: 150 },
      { symbol: "Cs-137", activityTbq: 85 },
      { symbol: "Cs-134", activityTbq: 45 },
      { symbol: "Sr-90", activityTbq: 10 },
      { symbol: "Xe-133", activityTbq: 600 },
      { symbol: "Te-132", activityTbq: 80 },
    ],
  },
  {
    id: "fukushima",
    name: "Фукусима-1 (BWR)",
    badge: "Паровой сброс",
    description:
      "Декомпрессия контейнмента с преобладанием летучих радионуклидов I-131, Cs-137, Xe-133",
    items: [
      { symbol: "I-131", activityTbq: 120 },
      { symbol: "Cs-137", activityTbq: 40 },
      { symbol: "Cs-134", activityTbq: 35 },
      { symbol: "Xe-133", activityTbq: 800 },
      { symbol: "Kr-85", activityTbq: 60 },
    ],
  },
  {
    id: "rdd",
    name: "Грязная бомба (RDD)",
    badge: "Радиологическое рассеяние",
    description:
      "Взрывное диспергирование высокотоксичных промышленных источников Co-60, Cs-137, Am-241",
    items: [
      { symbol: "Co-60", activityTbq: 60 },
      { symbol: "Cs-137", activityTbq: 50 },
      { symbol: "Am-241", activityTbq: 15 },
    ],
  },
  {
    id: "industrial",
    name: "Дефектоскопия / Пром",
    badge: "Техногенный инцидент",
    description: "Потеря контроля над мощными гамма-дефектоскопами на базе Ir-192, Co-60, Se-75",
    items: [
      { symbol: "Ir-192", activityTbq: 30 },
      { symbol: "Co-60", activityTbq: 12 },
      { symbol: "Se-75", activityTbq: 15 },
    ],
  },
  {
    id: "medical",
    name: "Медицинский комплекс",
    badge: "Изотопная лаборатория",
    description: "Аварийный выброс радиофармпрепаратов циклотрона Tc-99m, I-131, F-18",
    items: [
      { symbol: "Tc-99m", activityTbq: 25 },
      { symbol: "I-131", activityTbq: 10 },
      { symbol: "F-18", activityTbq: 15 },
    ],
  },
];
