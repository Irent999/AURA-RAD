/**
 * AURA-RAD 3D Plume Simulation & Dose Assessment Module
 * Types & Data Contracts for Gaussian Dispersion and Radiological Safety
 */

export type StabilityClass = "A" | "B" | "C" | "D" | "E" | "F";

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
  /** Inhalation dose coefficient e_inh (Sv / Bq) */
  inhalationCoefficient: number;
  /** External immersion dose coefficient e_sub ( (Sv/s) / (Bq/m³) ) */
  externalImmersionCoefficient: number;
  /** Ground surface deposition dose coefficient e_grd ( (Sv/s) / (Bq/m²) ) */
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
  /** Atmospheric stability category according to Pasquill */
  stabilityClass: StabilityClass;
  /** Planetary boundary mixing layer height in meters (e.g. 500 - 2000m) */
  mixingHeight: number;
  /** Ambient air temperature in °C */
  airTemperature: number;
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

export interface Plume3DModelOutput {
  source: PlumeSource3D;
  meteorology: Meteorology3D;
  isotope: Isotope3D;
  emissionRateBqPerSec: number;
  centerlineValues: {
    distance: number;
    sigmaY: number;
    sigmaZ: number;
    groundConcentration: number;
    groundDoseRateMsvH: number;
    ambientDoseEquivalentRateH10: number;
    inhalationDoseRateMsvH: number;
    accumulatedDoseMsv: number;
    safeStayTimeMin: number;
  }[];
  peakGroundDoseDistanceM: number;
  peakGroundDoseRateMsvH: number;
  zones: ZoneBoundary3D[];
  isolines: PlumeIsoline3D[];
}

export interface DosimeterProbe {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
}
