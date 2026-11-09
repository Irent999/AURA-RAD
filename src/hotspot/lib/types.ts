export type StabilityClass = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type ReleaseType = 'ground' | 'elevated' | 'stack';
export type DoseUnit = 'Sv' | 'rem' | 'Gy' | 'rad';
export type DistanceUnit = 'm' | 'km';

export interface DecayDaughter {
  symbol: string;
  branchingRatio: number;
}

export interface Isotope {
  name: string;
  symbol: string;
  atomicMass: number;
  halfLife: number;
  halfLifeUnit: string;
  decayConstant: number;
  gammaEnergy: number;
  betaEnergy: number;
  alphaEnergy: number;
  doseRateConstant: number;
  inhalationCoefficient: number;
  ingestionCoefficient: number;
  externalDoseCoefficient: number;
  lungClass: 'D' | 'W' | 'Y';
  icrpSource: string;
  decayMode: 'alpha' | 'beta-' | 'beta+' | 'EC' | 'IT' | 'SF' | 'stable';
  daughters: DecayDaughter[];
  notes: string;
}

export interface SourceTerm {
  isotope: string;
  activity: number;
  releaseDuration: number;
  releaseHeight: number;
  releaseType: ReleaseType;
  physicalForm: 'gas' | 'particle' | 'liquid' | 'aerosol';
  particleSize: number;
  latitude: number;
  longitude: number;
  stackTemperature?: number; // Температура выброса газов из трубы (°C)
}

export interface Meteorology {
  windSpeed: number;
  windDirection: number;
  stabilityClass: StabilityClass;
  mixingHeight: number;
  airTemperature?: number;   // Температура окружающего воздуха (°C)
  precipitationRate: number;
  inversionHeight: number;
}

export interface TerrainData {
  surfaceRoughness: number;
  terrainType: 'urban' | 'rural' | 'forest' | 'water' | 'desert';
  buildingWake: boolean;
  complexTerrain: boolean;
}

export interface DispersionInput {
  sourceTerm: SourceTerm;
  meteorology: Meteorology;
  terrain: TerrainData;
  distances: number[];
  receptorHeight: number;
  calculationType: 'plume' | 'puff' | 'shortTerm' | 'longTerm';
  averagingTime: number;
}

export interface DoseResult {
  distance: number;
  centerlineConcentration: number;
  crosswindSpread: number;
  verticalSpread: number;
  plumeWidth: number;
  arrivalTime: number;             // Время в секундах
  arrivalTimeFormatted?: string;    // Форматированная строка (напр. "2.8 ч")
  exposureDuration: number;
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

export interface DispersionResult {
  results: DoseResult[];
  input: DispersionInput;
  maxConcentration: { distance: number; value: number };
  maxDoseDistance: { distance: number; value: number };
  plumeFootprint: { x: number; y: number; concentration: number }[];
  geoFootprint: { lat: number; lon: number; concentration: number }[];
  decayChainResult: { time: number; activities: { symbol: string; activity: number }[] }[];
  rk45Stats: { steps: number; accepted: number; rejected: number; finalTime: number };
  zoneSummary: {
    exclusionZone: number;
    contaminationZone: number;
    ingestionZone: number;
    totalAffected: number;
  };
  protectiveActions: ProtectiveAction[];
  warnings: string[];
}

export interface ProtectiveAction {
  distance: number;
  action: string;
  zone: string;
  criteria: string;
  level: 'advisory' | 'caution' | 'alert' | 'emergency';
}

export interface CalculationHistoryEntry {
  id: string;
  timestamp: string;
  scenarioName: string;
  isotope: string;
  activity: number;
  windSpeed: number;
  stabilityClass: StabilityClass;
  maxDose: number;
  exclusionZone: number;
}