/**
 * AURA-RAD Multi-Nuclide Source Term & Dose Assessment Engine (HotSpot / MACCS Methodology)
 *
 * Implements:
 * 1. Source Term Inventory Mix (Bq / Ci, categories, AMAD = 1 μm ICRP 72 / NRB-99/2009 DCFs)
 * 2. Gaussian Plume Dispersion with Pasquill-Gifford (A-F), Radioactive Decay (t = x/u),
 *    and Dry + Wet Deposition Depletion & Ground Surface Contamination W(x, y)
 * 3. Multi-Pathway Dose Integration: Inhalation + Cloud Immersion + Ground Shine -> D_total (Sv/mSv) & H*(10)
 * 4. Structured HotSpot-style Assessment Report (per-nuclide & total peaks, X_max/Y_max, isolines, safe stay t_max)
 */

import {
  CURIE_TO_BQ,
  DEFAULT_AMAD_MICRONS,
  NUCLIDE_CATEGORY_LABELS,
  type Meteorology3D,
  type MultiNuclideAssessmentReport,
  type MultiNuclideCenterlinePoint,
  type NuclideReleaseItem,
  type PeakCoordinate,
  type PerNuclidePeakReport,
  type PlumeSource3D,
  type SourceTermInventoryMix,
  type GridDoseSample,
} from "./types";
import { bqToCi, getExtendedIsotope } from "./isotopes";
import {
  ADULT_BREATHING_RATE_M3_S,
  calculateDispersionCoefficients,
  calculateEffectiveDecaySeconds,
  calculateGaussianConcentration,
  calculateMultiNuclidePointDose,
  calculateMultiNuclideProtectiveZones,
  calculateSurfaceDepositionBqM2,
  computeWetWashoutCoefficient,
  generateMultiNuclideIsolines,
  plumeToWorldCoordinates,
} from "./gaussianPlume3D";

export interface AssessmentOptions {
  /** Mix title for report metadata */
  mixName?: string;
  /** Effective ground shine exposure duration in hours (default 4h early phase, configurable 4h..8760h) */
  groundExposureHours?: number;
  /** Receptor breathing height in meters (default 1.5m) */
  receptorHeightM?: number;
  /** Personnel annual/occupational dose limit in mSv (default 20 mSv per NRB-99/2009) */
  personnelDoseLimitMsv?: number;
  /** Public annual dose limit in mSv (default 1 mSv per NRB-99/2009) */
  publicDoseLimitMsv?: number;
  /** Emergency intervention dose limit in mSv (default 50 mSv) */
  emergencyDoseLimitMsv?: number;
  /** Include 2D spatial grid field for heatmap/export (default true) */
  includeSpatialGrid?: boolean;
}

const CENTERLINE_DISTANCES_M = [
  25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000,
  6000, 7500, 10000, 12000,
];

/**
 * Formats half-life into a concise readable string
 */
function formatHalfLife(val: number, unit: string): string {
  const unitMap: Record<string, string> = {
    seconds: "с",
    minutes: "мин",
    hours: "ч",
    days: "сут",
    years: "лет",
  };
  const label = unitMap[unit] ?? unit;
  return val >= 10000 ? `${val.toExponential(2)} ${label}` : `${val} ${label}`;
}

/**
 * Normalizes a list of radionuclide items into a formal SourceTermInventoryMix container
 * with fractional shares (%) and Bq/Ci parity.
 */
export function createSourceTermInventoryMix(
  items: NuclideReleaseItem[],
  source: PlumeSource3D,
  mixName: string = "Аварийная многонуклидная смесь",
): SourceTermInventoryMix {
  const active = items.filter((n) => n.enabled && n.activityBq > 0);
  const totalActivityBq = active.reduce((sum, n) => sum + n.activityBq, 0);

  const normalizedItems: NuclideReleaseItem[] = items.map((item) => {
    const iso = getExtendedIsotope(item.isotopeSymbol);
    const share =
      item.enabled && totalActivityBq > 0 ? (item.activityBq / totalActivityBq) * 100 : 0;

    return {
      ...item,
      nameRu: item.nameRu ?? iso.nameRu,
      category: item.category ?? iso.category,
      activityCi: bqToCi(item.activityBq),
      fractionPercent: share,
      depositionVelocityMs: item.depositionVelocityMs ?? iso.defaultDepositionVelocityMs,
    };
  });

  return {
    id: `mix-${Date.now()}`,
    name: mixName,
    amadMicrons: DEFAULT_AMAD_MICRONS,
    items: normalizedItems,
    totalActivityBq,
    totalActivityCi: totalActivityBq / CURIE_TO_BQ,
    releaseDurationSec: Math.max(1, source.releaseDuration),
    effectiveHeightM: source.effectiveHeight,
    latitude: source.latitude,
    longitude: source.longitude,
  };
}

/**
 * Runs a comprehensive HotSpot / MACCS Multi-Nuclide Dose Assessment across downwind centerline & 2D spatial grid.
 */
export function runMultiNuclideDoseAssessment(
  source: PlumeSource3D,
  met: Meteorology3D,
  nuclides: NuclideReleaseItem[],
  options: AssessmentOptions = {},
): MultiNuclideAssessmentReport {
  const groundExposureHours = options.groundExposureHours ?? 4.0;
  const receptorHeightM = options.receptorHeightM ?? 1.5;
  const personnelLimit = options.personnelDoseLimitMsv ?? 20.0;
  const publicLimit = options.publicDoseLimitMsv ?? 1.0;
  const emergencyLimit = options.emergencyDoseLimitMsv ?? 50.0;
  const precipitationRateMmH = met.precipitationRateMmH ?? 0;

  const sourceMix = createSourceTermInventoryMix(nuclides, source, options.mixName);
  const activeItems = sourceMix.items.filter((n) => n.enabled && n.activityBq > 0);
  const releaseDuration = Math.max(1, source.releaseDuration);
  const u = Math.max(0.5, met.windSpeed);

  // Fine search distances to pinpoint exact downwind peak (X_max, Y_max=0)
  // Dense near stack (10m..1000m) where elevated plumes touch down, plus far field out to 12km
  const peakSearchDistances: number[] = [];
  for (let d = 10; d <= 300; d += 15) peakSearchDistances.push(d);
  for (let d = 350; d <= 1500; d += 50) peakSearchDistances.push(d);
  for (let d = 1750; d <= 5000; d += 250) peakSearchDistances.push(d);
  for (let d = 6000; d <= 12000; d += 1000) peakSearchDistances.push(d);

  // 1. Per-Nuclide Individual Peak Assessment
  const perNuclidePeaks: PerNuclidePeakReport[] = activeItems.map((item) => {
    const iso = getExtendedIsotope(item.isotopeSymbol);
    const q0 = item.activityBq / releaseDuration;
    const vd = item.depositionVelocityMs ?? iso.defaultDepositionVelocityMs;
    const washout = computeWetWashoutCoefficient(precipitationRateMmH, iso.physicalForm);
    const dcfInh = item.customDcfInhalation ?? iso.inhalationCoefficient;
    const dcfCloud = item.customDcfCloud ?? iso.externalImmersionCoefficient;
    const dcfGround = item.customDcfGround ?? iso.groundDoseCoefficient;
    const effDecaySec = calculateEffectiveDecaySeconds(groundExposureHours, iso.decayConstant);

    let maxConc = 0;
    let concPeakX = 10;
    let maxDep = 0;
    let maxInhSv = 0;
    let maxCloudSv = 0;
    let maxGroundSv = 0;
    let maxTotalDoseSv = 0;
    let dosePeakX = 10;
    let maxH10MsvH = 0;

    for (const x of peakSearchDistances) {
      const conc = calculateGaussianConcentration(
        x,
        0,
        receptorHeightM,
        source.effectiveHeight,
        q0,
        u,
        met.stabilityClass,
        iso.decayConstant,
        met.mixingHeight,
        vd,
        washout,
        false,
      );

      const dep = calculateSurfaceDepositionBqM2(
        x,
        0,
        source.effectiveHeight,
        q0,
        releaseDuration,
        u,
        met.stabilityClass,
        iso.decayConstant,
        met.mixingHeight,
        vd,
        washout,
        false,
      );

      const tic = conc * releaseDuration;
      const inhSv = tic * ADULT_BREATHING_RATE_M3_S * dcfInh;
      const cloudSv = tic * dcfCloud;
      const groundSv = dep * dcfGround * effDecaySec;
      const totalSv = inhSv + cloudSv + groundSv;

      const immRate = conc * dcfCloud * 3600 * 1000;
      const grdRate = dep * dcfGround * 3600 * 1000;
      const directDist = Math.hypot(x, 0, receptorHeightM - source.effectiveHeight);
      let directRate = 0;
      if (directDist > 0 && iso.gammaConstant > 0) {
        const actGbq = item.activityBq / 1e9;
        const muR = Math.max(0, iso.buildup.muAir * directDist);
        const bf = 1 + iso.buildup.a * muR * Math.exp(iso.buildup.b * muR);
        directRate =
          ((iso.gammaConstant * actGbq * bf * Math.exp(-muR)) /
            Math.pow(Math.max(5, directDist), 2)) *
          0.1;
      }
      const h10 = immRate + grdRate + directRate;

      if (conc > maxConc) {
        maxConc = conc;
        concPeakX = x;
      }
      if (dep > maxDep) maxDep = dep;
      if (h10 > maxH10MsvH) maxH10MsvH = h10;

      if (totalSv > maxTotalDoseSv) {
        maxTotalDoseSv = totalSv;
        maxInhSv = inhSv;
        maxCloudSv = cloudSv;
        maxGroundSv = groundSv;
        dosePeakX = x;
      }
    }

    const concWorld = plumeToWorldCoordinates(concPeakX, 0, source.position, met.windDirectionDeg);
    const doseWorld = plumeToWorldCoordinates(dosePeakX, 0, source.position, met.windDirectionDeg);

    return {
      symbol: iso.symbol,
      nameRu: iso.nameRu,
      category: iso.category,
      hazardGroup: iso.hazardGroup,
      halfLifeFormatted: formatHalfLife(iso.halfLife, iso.halfLifeUnit),
      activityBq: item.activityBq,
      activityCi: item.activityBq / CURIE_TO_BQ,
      activitySharePercent: item.fractionPercent ?? 0,
      depositionVelocityMs: vd,
      maxConcentrationBqM3: maxConc,
      concentrationPeakCoords: {
        xDownwindM: concPeakX,
        yCrosswindM: 0,
        worldX: concWorld.worldX,
        worldZ: concWorld.worldZ,
      },
      maxDepositionBqM2: maxDep,
      maxInhalationDoseSv: maxInhSv,
      maxInhalationDoseMsv: maxInhSv * 1000,
      maxCloudDoseSv: maxCloudSv,
      maxCloudDoseMsv: maxCloudSv * 1000,
      maxGroundDoseSv: maxGroundSv,
      maxGroundDoseMsv: maxGroundSv * 1000,
      maxTotalDoseSv,
      maxTotalDoseMsv: maxTotalDoseSv * 1000,
      dosePeakCoords: {
        xDownwindM: dosePeakX,
        yCrosswindM: 0,
        worldX: doseWorld.worldX,
        worldZ: doseWorld.worldZ,
      },
      maxDoseRateH10MsvH: maxH10MsvH,
      contributionToPeakTotalDosePercent: 0, // Filled once mixture peak is located
    };
  });

  // 2. Combined Mixture Peak Search
  let mixMaxConc = 0;
  let mixConcPeakX = 10;
  let mixMaxDep = 0;
  let mixMaxH10 = 0;
  let mixMaxTotalRate = 0;
  let mixMaxTotalDoseSv = 0;
  let mixDosePeakX = 10;
  let mixPathwayAtPeak = { inhalationMsv: 0, cloudMsv: 0, groundMsv: 0, totalMsv: 0 };
  let mixDominantAtPeak = activeItems[0]?.isotopeSymbol ?? "None";
  let breakdownAtMixPeak: { symbol: string; pct: number }[] = [];

  for (const x of peakSearchDistances) {
    const pt = calculateMultiNuclidePointDose(
      x,
      0,
      receptorHeightM,
      source,
      met,
      activeItems,
      personnelLimit,
      { groundExposureHours, precipitationRateMmH },
    );

    if (pt.concentration > mixMaxConc) {
      mixMaxConc = pt.concentration;
      mixConcPeakX = x;
    }
    if (pt.surfaceDepositionBqM2 > mixMaxDep) {
      mixMaxDep = pt.surfaceDepositionBqM2;
    }
    if (pt.ambientDoseEquivalentRateH10 > mixMaxH10) {
      mixMaxH10 = pt.ambientDoseEquivalentRateH10;
    }
    if (pt.totalDoseRate > mixMaxTotalRate) {
      mixMaxTotalRate = pt.totalDoseRate;
    }
    if (pt.totalEffectiveDoseSv > mixMaxTotalDoseSv) {
      mixMaxTotalDoseSv = pt.totalEffectiveDoseSv;
      mixDosePeakX = x;
      mixPathwayAtPeak = {
        inhalationMsv: pt.inhalationDoseMsv,
        cloudMsv: pt.cloudDoseMsv,
        groundMsv: pt.groundDoseMsv,
        totalMsv: pt.totalEffectiveDoseMsv,
      };
      mixDominantAtPeak = pt.primaryDoseContributor;
      breakdownAtMixPeak = pt.nuclides.map((n) => ({
        symbol: n.symbol,
        pct: n.fractionPercent,
      }));
    }
  }

  for (const p of perNuclidePeaks) {
    const match = breakdownAtMixPeak.find((b) => b.symbol === p.symbol);
    p.contributionToPeakTotalDosePercent = match?.pct ?? 0;
  }
  perNuclidePeaks.sort((a, b) => b.maxTotalDoseMsv - a.maxTotalDoseMsv);

  const mixConcCoords: PeakCoordinate = {
    xDownwindM: mixConcPeakX,
    yCrosswindM: 0,
    ...plumeToWorldCoordinates(mixConcPeakX, 0, source.position, met.windDirectionDeg),
  };

  const mixDoseCoords: PeakCoordinate = {
    xDownwindM: mixDosePeakX,
    yCrosswindM: 0,
    ...plumeToWorldCoordinates(mixDosePeakX, 0, source.position, met.windDirectionDeg),
  };

  // 3. Centerline Profile
  const centerlineProfile: MultiNuclideCenterlinePoint[] = CENTERLINE_DISTANCES_M.map((dist) => {
    const { sigmaY, sigmaZ } = calculateDispersionCoefficients(dist, met.stabilityClass);
    const pt = calculateMultiNuclidePointDose(
      dist,
      0,
      receptorHeightM,
      source,
      met,
      activeItems,
      personnelLimit,
      { groundExposureHours, precipitationRateMmH },
    );

    return {
      distanceM: dist,
      sigmaY,
      sigmaZ,
      transitTimeSec: dist / u,
      concentrationBqM3: pt.concentration,
      depositionBqM2: pt.surfaceDepositionBqM2,
      doseRateH10MsvH: pt.ambientDoseEquivalentRateH10,
      groundShineRateMsvH: pt.groundShineDoseRateMsvH,
      inhalationRateMsvH: pt.inhalationDoseRate,
      totalDoseRateMsvH: pt.totalDoseRate,
      inhalationDoseMsv: pt.inhalationDoseMsv,
      cloudDoseMsv: pt.cloudDoseMsv,
      groundDoseMsv: pt.groundDoseMsv,
      totalEffectiveDoseMsv: pt.totalEffectiveDoseMsv,
      totalEffectiveDoseSv: pt.totalEffectiveDoseSv,
      personnelSafeTimeMin: pt.personnelSafeTimeMin,
      publicSafeTimeMin: pt.publicSafeTimeMin,
    };
  });

  // 4. 2D Spatial Grid Field (compact plume-aligned mesh mapped to world coords)
  const gridField: GridDoseSample[] = [];
  if (options.includeSpatialGrid !== false && activeItems.length > 0) {
    const xGrid = [100, 250, 500, 1000, 2000, 3500, 5000, 8000, 10000];
    const yFactors = [-2.0, -1.0, -0.5, 0, 0.5, 1.0, 2.0];

    for (const x of xGrid) {
      const { sigmaY } = calculateDispersionCoefficients(x, met.stabilityClass);
      for (const yf of yFactors) {
        const y = yf * sigmaY;
        const pt = calculateMultiNuclidePointDose(
          x,
          y,
          receptorHeightM,
          source,
          met,
          activeItems,
          personnelLimit,
          { groundExposureHours, precipitationRateMmH, fastMode: false },
        );
        const world = plumeToWorldCoordinates(x, y, source.position, met.windDirectionDeg);
        gridField.push({
          xDownwindM: x,
          yCrosswindM: y,
          worldX: world.worldX,
          worldZ: world.worldZ,
          concentrationBqM3: pt.concentration,
          depositionBqM2: pt.surfaceDepositionBqM2,
          doseRateH10MsvH: pt.ambientDoseEquivalentRateH10,
          inhalationDoseMsv: pt.inhalationDoseMsv,
          cloudDoseMsv: pt.cloudDoseMsv,
          groundDoseMsv: pt.groundDoseMsv,
          totalDoseMsv: pt.totalEffectiveDoseMsv,
          totalDoseSv: pt.totalEffectiveDoseSv,
        });
      }
    }
  }

  // 5. Isolines & Protective Zones
  const isolines = generateMultiNuclideIsolines(source, met, activeItems, {
    groundExposureHours,
    precipitationRateMmH,
    metric: "dose_rate_msvh",
  });
  const totalDoseIsolines = generateMultiNuclideIsolines(source, met, activeItems, {
    groundExposureHours,
    precipitationRateMmH,
    metric: "total_dose_msv",
  });
  const zones = calculateMultiNuclideProtectiveZones(source, met, activeItems, {
    groundExposureHours,
    precipitationRateMmH,
  });

  const safeTimeAtPeak = (limitMsv: number) =>
    mixMaxTotalRate > 1e-6 ? Math.max(0.1, (limitMsv / mixMaxTotalRate) * 60) : 999999;

  return {
    generatedAtIso: new Date().toISOString(),
    methodology:
      "Гауссова модель рассеяния (Паскуилл-Джидфорд) + Сухое/влажное осаждение + Распад + ICRP 72 / НРБ-99/2009 (AMAD = 1 мкм)",
    amadMicrons: DEFAULT_AMAD_MICRONS,
    groundExposureHours,
    precipitationRateMmH,
    sourceMix,
    meteorology: met,
    perNuclidePeaks,
    totalMixturePeak: {
      maxConcentrationBqM3: mixMaxConc,
      concentrationPeakCoords: mixConcCoords,
      maxDepositionBqM2: mixMaxDep,
      maxDoseRateH10MsvH: mixMaxH10,
      maxTotalDoseRateMsvH: mixMaxTotalRate,
      maxTotalEffectiveDoseSv: mixMaxTotalDoseSv,
      maxTotalEffectiveDoseMsv: mixMaxTotalDoseSv * 1000,
      dosePeakCoords: mixDoseCoords,
      dominantNuclideSymbol: mixDominantAtPeak,
      pathwayTotalsMsv: mixPathwayAtPeak,
    },
    safeStayAssessment: {
      personnelLimitMsv: personnelLimit,
      personnelSafeTimeAtPeakMin: safeTimeAtPeak(personnelLimit),
      publicLimitMsv: publicLimit,
      publicSafeTimeAtPeakMin: safeTimeAtPeak(publicLimit),
      emergencyLimitMsv: emergencyLimit,
      emergencySafeTimeAtPeakMin: safeTimeAtPeak(emergencyLimit),
    },
    centerlineProfile,
    gridField,
    isolines,
    totalDoseIsolines,
    zones,
  };
}

/**
 * Generates a structured CSV export in HotSpot report format.
 */
export function formatHotSpotReportCsv(report: MultiNuclideAssessmentReport): string {
  const lines: string[] = [];
  lines.push("AURA-RAD MULTI-NUCLIDE RADIOLOGICAL DOSE ASSESSMENT REPORT");
  lines.push(`Generated,${report.generatedAtIso}`);
  lines.push(`Methodology,"${report.methodology}"`);
  lines.push(`AMAD (um),${report.amadMicrons}`);
  lines.push(`Ground Exposure T_eff (h),${report.groundExposureHours}`);
  lines.push(`Precipitation (mm/h),${report.precipitationRateMmH}`);
  lines.push(
    `Wind Speed (m/s),${report.meteorology.windSpeed},Wind Direction (deg),${report.meteorology.windDirectionDeg},Stability,${report.meteorology.stabilityClass}`,
  );
  lines.push(
    `Total Release Activity (Bq),${report.sourceMix.totalActivityBq.toExponential(3)},Total Activity (Ci),${report.sourceMix.totalActivityCi.toFixed(2)}`,
  );
  lines.push("");
  lines.push("MIXTURE PEAK SUMMARY");
  lines.push(
    `Max Total Effective Dose (mSv),${report.totalMixturePeak.maxTotalEffectiveDoseMsv.toFixed(4)},Max Total Dose (Sv),${report.totalMixturePeak.maxTotalEffectiveDoseSv.toExponential(4)},Peak X_max (m),${report.totalMixturePeak.dosePeakCoords.xDownwindM},Peak Y_max (m),${report.totalMixturePeak.dosePeakCoords.yCrosswindM}`,
  );
  lines.push(
    `Max H*(10) Rate (mSv/h),${report.totalMixturePeak.maxDoseRateH10MsvH.toFixed(4)},Max Concentration (Bq/m3),${report.totalMixturePeak.maxConcentrationBqM3.toExponential(3)},Max Deposition W (Bq/m2),${report.totalMixturePeak.maxDepositionBqM2.toExponential(3)}`,
  );
  lines.push(
    `Safe Stay Personnel (${report.safeStayAssessment.personnelLimitMsv} mSv) [min],${report.safeStayAssessment.personnelSafeTimeAtPeakMin.toFixed(2)},Safe Stay Public (${report.safeStayAssessment.publicLimitMsv} mSv) [min],${report.safeStayAssessment.publicSafeTimeAtPeakMin.toFixed(2)}`,
  );
  lines.push("");
  lines.push("PER-NUCLIDE PEAK BREAKDOWN");
  lines.push(
    "Nuclide,Name,Category,Activity (Bq),Activity (Ci),Share (%),Vd (m/s),C_max (Bq/m3),W_max (Bq/m2),D_inh (mSv),D_cloud (mSv),D_ground (mSv),D_total (mSv),D_total (Sv),H*(10)_max (mSv/h),Peak X_max (m),Peak Y_max (m),Peak Contribution (%)",
  );
  for (const n of report.perNuclidePeaks) {
    lines.push(
      [
        n.symbol,
        `"${n.nameRu}"`,
        `"${NUCLIDE_CATEGORY_LABELS[n.category]}"`,
        n.activityBq.toExponential(3),
        n.activityCi.toFixed(2),
        n.activitySharePercent.toFixed(2),
        n.depositionVelocityMs.toFixed(4),
        n.maxConcentrationBqM3.toExponential(3),
        n.maxDepositionBqM2.toExponential(3),
        n.maxInhalationDoseMsv.toFixed(4),
        n.maxCloudDoseMsv.toFixed(4),
        n.maxGroundDoseMsv.toFixed(4),
        n.maxTotalDoseMsv.toFixed(4),
        n.maxTotalDoseSv.toExponential(4),
        n.maxDoseRateH10MsvH.toFixed(4),
        n.dosePeakCoords.xDownwindM,
        n.dosePeakCoords.yCrosswindM,
        n.contributionToPeakTotalDosePercent.toFixed(2),
      ].join(","),
    );
  }
  lines.push("");
  lines.push("DOWNWIND CENTERLINE PROFILE");
  lines.push(
    "Distance (m),SigmaY (m),SigmaZ (m),C (Bq/m3),W (Bq/m2),H*(10) (mSv/h),D_inh (mSv),D_cloud (mSv),D_ground (mSv),D_total (mSv),t_max Personnel (min),t_max Public (min)",
  );
  for (const row of report.centerlineProfile) {
    lines.push(
      [
        row.distanceM,
        row.sigmaY.toFixed(1),
        row.sigmaZ.toFixed(1),
        row.concentrationBqM3.toExponential(3),
        row.depositionBqM2.toExponential(3),
        row.doseRateH10MsvH.toFixed(4),
        row.inhalationDoseMsv.toFixed(4),
        row.cloudDoseMsv.toFixed(4),
        row.groundDoseMsv.toFixed(4),
        row.totalEffectiveDoseMsv.toFixed(4),
        row.personnelSafeTimeMin.toFixed(1),
        row.publicSafeTimeMin.toFixed(1),
      ].join(","),
    );
  }
  return lines.join("\n");
}

/**
 * Generates a structured JSON export of the assessment report.
 */
export function formatHotSpotReportJson(report: MultiNuclideAssessmentReport): string {
  return JSON.stringify(report, null, 2);
}
