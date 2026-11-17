import { useState, useMemo, useEffect, useRef } from "react";
import {
  Wind,
  Activity,
  Map as MapIcon,
  Play,
  Pause,
  RotateCcw,
  ShieldAlert,
  Clock,
  MapPin,
  ChevronUp,
  ChevronDown,
  Flame,
  Radio,
  Plus,
  Trash2,
  PieChart,
  Radiation,
  FileSpreadsheet,
  Download,
  CloudRain,
  Eye,
  EyeOff,
  X,
  Compass,
  RefreshCw,
} from "lucide-react";
import { Plume3DCanvas } from "./Plume3DCanvas";
import { JIZZAKH_NPP_LAT, JIZZAKH_NPP_LON } from "./mapTextureGenerator";
import { getExtendedIsotope, filterIsotopesByCategory, bqToCi, ciToBq } from "./isotopes";
import { calculateMultiNuclidePointDose, worldToPlumeCoordinates } from "./gaussianPlume3D";
import {
  runMultiNuclideDoseAssessment,
  formatHotSpotReportCsv,
  formatHotSpotReportJson,
} from "./multiNuclideAssessment";
import { getNormalizedSourceMix } from "../../../hotspot/lib/dispersion";
import {
  fetchCurrentMeteo,
  calculateTransportVector,
  estimatePasquillStability,
} from "../../../hotspot/lib/meteoService";
import type { DispersionInput, SourceMixItem } from "../../../hotspot/lib/types";
import {
  ACCIDENT_PRESETS,
  NUCLIDE_CATEGORY_LABELS,
  type PlumeSource3D,
  type Meteorology3D,
  type StabilityClass,
  type DosimeterProbe,
  type MapStyleType,
  type NuclideReleaseItem,
  type AccidentScenarioPreset,
  type NuclideCategory,
  type ActivityUnit,
} from "./types";

export interface Plume3DViewProps {
  syncedInput?: DispersionInput;
  onSyncedInputChange?: (next: DispersionInput) => void;
  embedded?: boolean;
}

function mapDispersionInputToNuclides(input: DispersionInput): NuclideReleaseItem[] {
  return getNormalizedSourceMix(input.sourceTerm).map((item) => {
    const iso = getExtendedIsotope(item.isotope);
    return {
      id: item.id,
      isotopeSymbol: iso.symbol,
      activityBq: item.activityBq,
      enabled: true,
      nameRu: iso.nameRu,
      category: iso.category,
    };
  });
}

function mapNuclidesToSourceMix(
  items: NuclideReleaseItem[],
  displayUnit: Extract<ActivityUnit, "TBq" | "Ci">,
): SourceMixItem[] {
  const active = items.filter((n) => n.enabled);
  const sourceList = active.length > 0 ? active : items.slice(0, 1);
  return sourceList.map((n) => {
    if (displayUnit === "Ci") {
      return {
        id: n.id,
        isotope: n.isotopeSymbol,
        activity: Number(bqToCi(n.activityBq).toPrecision(4)),
        unit: "Ci",
      };
    }
    if (n.activityBq >= 1e9) {
      return {
        id: n.id,
        isotope: n.isotopeSymbol,
        activity: Number((n.activityBq / 1e12).toPrecision(4)),
        unit: "TBq",
      };
    }
    return {
      id: n.id,
      isotope: n.isotopeSymbol,
      activity: n.activityBq,
      unit: "Bq",
    };
  });
}

const DEFAULT_NUCLIDES: NuclideReleaseItem[] = [
  {
    id: "nuc-1",
    isotopeSymbol: "I-131",
    activityBq: 150e12,
    enabled: true,
    nameRu: "Йод-131",
    category: "fission_product",
  },
  {
    id: "nuc-2",
    isotopeSymbol: "Cs-137",
    activityBq: 85e12,
    enabled: true,
    nameRu: "Цезий-137",
    category: "fission_product",
  },
  {
    id: "nuc-3",
    isotopeSymbol: "Cs-134",
    activityBq: 45e12,
    enabled: true,
    nameRu: "Цезий-134",
    category: "fission_product",
  },
  {
    id: "nuc-4",
    isotopeSymbol: "Sr-90",
    activityBq: 10e12,
    enabled: true,
    nameRu: "Стронций-90",
    category: "fission_product",
  },
  {
    id: "nuc-5",
    isotopeSymbol: "Xe-133",
    activityBq: 600e12,
    enabled: true,
    nameRu: "Ксенон-133",
    category: "fission_product",
  },
  {
    id: "nuc-6",
    isotopeSymbol: "Te-132",
    activityBq: 80e12,
    enabled: true,
    nameRu: "Теллур-132",
    category: "fission_product",
  },
];

export function Plume3DView({
  syncedInput,
  onSyncedInputChange,
  embedded = false,
}: Plume3DViewProps = {}) {
  // 1. Multi-Nuclide Mixture State (Source Term Mix)
  const [nuclides, setNuclides] = useState<NuclideReleaseItem[]>(() =>
    syncedInput ? mapDispersionInputToNuclides(syncedInput) : DEFAULT_NUCLIDES,
  );

  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    syncedInput ? "custom" : "chernobyl",
  );
  const [categoryFilter, setCategoryFilter] = useState<NuclideCategory | "all">("all");
  const [activityDisplayUnit, setActivityDisplayUnit] =
    useState<Extract<ActivityUnit, "TBq" | "Ci">>("TBq");
  const [newNuclideSymbol, setNewNuclideSymbol] = useState<string>("Co-60");
  const [newNuclideActivityVal, setNewNuclideActivityVal] = useState<number>(20);
  const [showNuclideBreakdown, setShowNuclideBreakdown] = useState<boolean>(!embedded);

  // Source, Ground Exposure & Meteorology Settings (default: Uzbekistan Jizzakh NPP / Lake Tuzkan)
  const [releaseDurationHours, setReleaseDurationHours] = useState<number>(
    syncedInput?.sourceTerm.releaseDuration ?? 1.0,
  );
  const [groundExposureHours, setGroundExposureHours] = useState<number>(4.0);
  const [releaseHeight, setReleaseHeight] = useState<number>(
    syncedInput?.sourceTerm.releaseHeight ?? 45,
  );
  const [siteLat, setSiteLat] = useState<number>(
    syncedInput?.sourceTerm.latitude ?? JIZZAKH_NPP_LAT,
  );
  const [siteLon, setSiteLon] = useState<number>(
    syncedInput?.sourceTerm.longitude ?? JIZZAKH_NPP_LON,
  );

  const [windSpeed, setWindSpeed] = useState<number>(syncedInput?.meteorology.windSpeed ?? 5.5);
  const [windDirection, setWindDirection] = useState<number>(
    syncedInput?.meteorology.windDirection ?? 90,
  );
  const [stabilityClass, setStabilityClass] = useState<StabilityClass>(
    syncedInput?.meteorology.stabilityClass ?? "D",
  );
  const [mixingHeight, setMixingHeight] = useState<number>(
    syncedInput?.meteorology.mixingHeight ?? 1200,
  );
  const [precipitationRateMmH, setPrecipitationRateMmH] = useState<number>(
    syncedInput?.meteorology.precipitationRate ?? 0,
  );

  // Dose limit for safe stay time calculation: 1 mSv (public), 20 mSv (personnel), 50 mSv (emergency)
  const [doseLimitMsv, setDoseLimitMsv] = useState<number>(20.0);

  // 2. Interactive Dosimeter Probe Position in World Space
  const [probePos, setProbePos] = useState<DosimeterProbe>({
    id: "probe-alpha",
    name: "Датчик-1 (Разведка)",
    x: 600,
    y: 0,
    z: 1.5,
  });

  // 3. Visual Controls, Map & Camera
  const [mapStyle, setMapStyle] = useState<MapStyleType>("satellite");
  const [isSimulating, setIsSimulating] = useState<boolean>(true);
  const [showZones, setShowZones] = useState<boolean>(true);
  const [showIsolines, setShowIsolines] = useState<boolean>(true);
  const [isolineMetric, setIsolineMetric] = useState<"dose_rate_msvh" | "total_dose_msv">(
    "dose_rate_msvh",
  );
  const [showCenterline, setShowCenterline] = useState<boolean>(true);
  const [particleDensity, setParticleDensity] = useState<"low" | "medium" | "high">("medium");
  const [cameraPreset, setCameraPreset] = useState<
    "perspective" | "top" | "side" | "downwind" | "source"
  >("perspective");

  // HUD Visibility & Collapsible States (Clean viewport mode)
  const [hideAllPanels, setHideAllPanels] = useState<boolean>(false);
  const [isProbeVisible, setIsProbeVisible] = useState<boolean>(!embedded);
  const [isProbeMinimized, setIsProbeMinimized] = useState<boolean>(false);
  const [isViewportBarOpen, setIsViewportBarOpen] = useState<boolean>(true);
  const [isDockOpen, setIsDockOpen] = useState<boolean>(!embedded);
  const [activeTab, setActiveTab] = useState<
    "source" | "meteo" | "map" | "zones" | "report" | "probe"
  >("source");
  const [meteoSyncLoading, setMeteoSyncLoading] = useState<boolean>(false);
  const [meteoApiMeta, setMeteoApiMeta] = useState<string | null>(null);

  // Two-way synchronization with App / PlumeModeler shared DispersionInput
  const lastPushedInputRef = useRef<DispersionInput | null>(null);
  const syncedInputRef = useRef<DispersionInput | undefined>(syncedInput);
  syncedInputRef.current = syncedInput;

  useEffect(() => {
    if (!syncedInput || syncedInput === lastPushedInputRef.current) return;
    setNuclides(mapDispersionInputToNuclides(syncedInput));
    setReleaseDurationHours(syncedInput.sourceTerm.releaseDuration);
    setReleaseHeight(syncedInput.sourceTerm.releaseHeight);
    setSiteLat(syncedInput.sourceTerm.latitude);
    setSiteLon(syncedInput.sourceTerm.longitude);
    setWindSpeed(syncedInput.meteorology.windSpeed);
    setWindDirection(syncedInput.meteorology.windDirection);
    setStabilityClass(syncedInput.meteorology.stabilityClass);
    setMixingHeight(syncedInput.meteorology.mixingHeight);
    setPrecipitationRateMmH(syncedInput.meteorology.precipitationRate);
    setSelectedPresetId("custom");
  }, [syncedInput]);

  const pushToSyncedInput = (overrides?: {
    nuclides?: NuclideReleaseItem[];
    releaseDuration?: number;
    releaseHeight?: number;
    latitude?: number;
    longitude?: number;
    windSpeed?: number;
    windDirection?: number;
    stabilityClass?: StabilityClass;
    mixingHeight?: number;
    precipitationRate?: number;
  }) => {
    const base = syncedInputRef.current;
    if (!base || !onSyncedInputChange) return;

    const nextNuclides = overrides?.nuclides ?? nuclides;
    const activeItems = nextNuclides.filter((n) => n.enabled);
    const totalBq = activeItems.reduce((sum, n) => sum + n.activityBq, 0);
    const dominant = activeItems.reduce<NuclideReleaseItem | undefined>(
      (best, cur) => (!best || cur.activityBq > best.activityBq ? cur : best),
      activeItems[0],
    );
    const sourceMix = mapNuclidesToSourceMix(nextNuclides, activityDisplayUnit);

    const nextInput: DispersionInput = {
      ...base,
      sourceTerm: {
        ...base.sourceTerm,
        sourceMix,
        isotope: dominant?.isotopeSymbol ?? base.sourceTerm.isotope,
        activity: Math.max(0, totalBq),
        releaseDuration: overrides?.releaseDuration ?? releaseDurationHours,
        releaseHeight: overrides?.releaseHeight ?? releaseHeight,
        latitude: overrides?.latitude ?? siteLat,
        longitude: overrides?.longitude ?? siteLon,
      },
      meteorology: {
        ...base.meteorology,
        windSpeed: overrides?.windSpeed ?? windSpeed,
        windDirection: overrides?.windDirection ?? windDirection,
        stabilityClass: overrides?.stabilityClass ?? stabilityClass,
        mixingHeight: overrides?.mixingHeight ?? mixingHeight,
        precipitationRate: overrides?.precipitationRate ?? precipitationRateMmH,
      },
    };

    lastPushedInputRef.current = nextInput;
    onSyncedInputChange(nextInput);
  };

  const transportVec3D = useMemo(
    () => calculateTransportVector(windSpeed, windDirection, "from"),
    [windSpeed, windDirection],
  );

  const handleFetchLiveMeteo = async () => {
    setMeteoSyncLoading(true);
    setMeteoApiMeta(null);
    try {
      const obs = await fetchCurrentMeteo(siteLat, siteLon, true);
      const nextSpeed = Number(obs.windSpeedMs.toFixed(1));
      const nextDir = Math.round(obs.windDirectionDeg);
      const nextPrecip = Number(obs.precipitationMmh.toFixed(1));
      const nextStab = estimatePasquillStability(obs.windSpeedMs);
      setWindSpeed(nextSpeed);
      setWindDirection(nextDir);
      setPrecipitationRateMmH(nextPrecip);
      setStabilityClass(nextStab);
      pushToSyncedInput({
        windSpeed: nextSpeed,
        windDirection: nextDir,
        precipitationRate: nextPrecip,
        stabilityClass: nextStab,
      });
      setMeteoApiMeta(
        `${obs.stationName} · ${obs.temperatureC.toFixed(1)}°C · ${Math.round(obs.pressureHpa)} гПа · ${Math.round(obs.humidityPct)}%`,
      );
    } catch (err) {
      setMeteoApiMeta(err instanceof Error ? `Ошибка API: ${err.message}` : "Ошибка загрузки API");
    } finally {
      setMeteoSyncLoading(false);
    }
  };

  // Filtered isotope list for selector
  const filteredIsotopes = useMemo(
    () => filterIsotopesByCategory(categoryFilter),
    [categoryFilter],
  );

  // 4. Derived Multi-Nuclide Mixture Metrics
  const totalMixtureActivityBq = useMemo(() => {
    return nuclides.filter((n) => n.enabled).reduce((sum, n) => sum + n.activityBq, 0);
  }, [nuclides]);

  const activeNuclidesCount = useMemo(() => {
    return nuclides.filter((n) => n.enabled).length;
  }, [nuclides]);

  const primaryIsotope = useMemo(() => {
    const firstActive = nuclides.find((n) => n.enabled)?.isotopeSymbol ?? "Cs-137";
    return getExtendedIsotope(firstActive);
  }, [nuclides]);

  const sourceData: PlumeSource3D = useMemo(() => {
    return {
      isotopeSymbol: primaryIsotope.symbol,
      totalActivity: Math.max(1e6, totalMixtureActivityBq),
      releaseDuration: releaseDurationHours * 3600,
      position: { x: 0, y: 0, z: 0 },
      effectiveHeight: releaseHeight,
      latitude: siteLat,
      longitude: siteLon,
    };
  }, [
    primaryIsotope.symbol,
    totalMixtureActivityBq,
    releaseDurationHours,
    releaseHeight,
    siteLat,
    siteLon,
  ]);

  const meteoData: Meteorology3D = useMemo(() => {
    return {
      windSpeed,
      windDirectionDeg: windDirection,
      stabilityClass,
      mixingHeight,
      airTemperature: 20,
      precipitationRateMmH,
    };
  }, [windSpeed, windDirection, stabilityClass, mixingHeight, precipitationRateMmH]);

  // Full Multi-Nuclide HotSpot Dose Assessment Report
  const assessmentReport = useMemo(() => {
    const presetName =
      ACCIDENT_PRESETS.find((p) => p.id === selectedPresetId)?.name ?? "Пользовательская смесь";
    return runMultiNuclideDoseAssessment(sourceData, meteoData, nuclides, {
      mixName: presetName,
      groundExposureHours,
      personnelDoseLimitMsv: 20.0,
      publicDoseLimitMsv: 1.0,
      emergencyDoseLimitMsv: 50.0,
      includeSpatialGrid: true,
    });
  }, [sourceData, meteoData, nuclides, selectedPresetId, groundExposureHours]);

  // Multi-Nuclide Dosimeter Sensor Live Readout with 3-pathway breakdown
  const probeReading = useMemo(() => {
    const { xDownwind, yCrosswind, zHeight } = worldToPlumeCoordinates(
      probePos.x,
      probePos.z,
      probePos.y,
      sourceData.position,
      meteoData.windDirectionDeg,
    );

    return calculateMultiNuclidePointDose(
      xDownwind,
      yCrosswind,
      zHeight,
      sourceData,
      meteoData,
      nuclides,
      doseLimitMsv,
      {
        groundExposureHours,
        precipitationRateMmH,
        fastMode: false,
      },
    );
  }, [
    probePos,
    sourceData,
    meteoData,
    nuclides,
    doseLimitMsv,
    groundExposureHours,
    precipitationRateMmH,
  ]);

  // GPS coordinates of the probe
  const probeGps = useMemo(() => {
    const lat = siteLat - probePos.y / 111139;
    const lon = siteLon + probePos.x / (111139 * Math.cos((siteLat * Math.PI) / 180));
    return {
      latStr: `${lat.toFixed(4)}° N`,
      lonStr: `${lon.toFixed(4)}° E`,
    };
  }, [siteLat, siteLon, probePos.x, probePos.y]);

  // Handlers for Multi-Nuclide Configuration
  const handleApplyPreset = (preset: AccidentScenarioPreset) => {
    setSelectedPresetId(preset.id);
    const updated: NuclideReleaseItem[] = preset.items.map((item, idx) => {
      const iso = getExtendedIsotope(item.symbol);
      return {
        id: `nuc-${preset.id}-${idx + 1}-${Date.now()}`,
        isotopeSymbol: iso.symbol,
        activityBq: item.activityTbq * 1e12,
        enabled: true,
        nameRu: iso.nameRu,
        category: iso.category,
      };
    });
    setNuclides(updated);
    pushToSyncedInput({ nuclides: updated });
  };

  const handleToggleNuclide = (id: string) => {
    const updated = nuclides.map((n) => (n.id === id ? { ...n, enabled: !n.enabled } : n));
    setNuclides(updated);
    setSelectedPresetId("custom");
    pushToSyncedInput({ nuclides: updated });
  };

  const handleUpdateActivity = (id: string, valInDisplayUnit: number) => {
    const safeVal = Math.max(0.001, isNaN(valInDisplayUnit) ? 1 : valInDisplayUnit);
    const activityBq = activityDisplayUnit === "Ci" ? ciToBq(safeVal) : safeVal * 1e12;
    const updated = nuclides.map((n) => (n.id === id ? { ...n, activityBq } : n));
    setNuclides(updated);
    setSelectedPresetId("custom");
    pushToSyncedInput({ nuclides: updated });
  };

  const handleUpdateDepositionVel = (id: string, vd: number) => {
    const safeVd = Math.max(0, Math.min(0.1, isNaN(vd) ? 0 : vd));
    setNuclides((prev) =>
      prev.map((n) => (n.id === id ? { ...n, depositionVelocityMs: safeVd } : n)),
    );
    setSelectedPresetId("custom");
  };

  const handleRemoveNuclide = (id: string) => {
    if (nuclides.length <= 1) return;
    const updated = nuclides.filter((n) => n.id !== id);
    setNuclides(updated);
    setSelectedPresetId("custom");
    pushToSyncedInput({ nuclides: updated });
  };

  const handleAddNuclide = () => {
    const iso = getExtendedIsotope(newNuclideSymbol);
    const activityBq =
      activityDisplayUnit === "Ci"
        ? ciToBq(Math.max(0.001, newNuclideActivityVal))
        : Math.max(0.001, newNuclideActivityVal) * 1e12;
    const newItem: NuclideReleaseItem = {
      id: `nuc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      isotopeSymbol: iso.symbol,
      activityBq,
      enabled: true,
      nameRu: iso.nameRu,
      category: iso.category,
    };
    const updated = [...nuclides, newItem];
    setNuclides(updated);
    setSelectedPresetId("custom");
    pushToSyncedInput({ nuclides: updated });
  };

  const handleCategoryFilterChange = (cat: NuclideCategory | "all") => {
    setCategoryFilter(cat);
    const list = filterIsotopesByCategory(cat);
    if (list.length > 0 && !list.some((i) => i.symbol === newNuclideSymbol)) {
      setNewNuclideSymbol(list[0]!.symbol);
    }
  };

  const handleReset = () => {
    const preset = ACCIDENT_PRESETS[0]!;
    const updated: NuclideReleaseItem[] = preset.items.map((item, idx) => {
      const iso = getExtendedIsotope(item.symbol);
      return {
        id: `nuc-${preset.id}-${idx + 1}-${Date.now()}`,
        isotopeSymbol: iso.symbol,
        activityBq: item.activityTbq * 1e12,
        enabled: true,
        nameRu: iso.nameRu,
        category: iso.category,
      };
    });
    setSelectedPresetId(preset.id);
    setNuclides(updated);
    setSiteLat(JIZZAKH_NPP_LAT);
    setSiteLon(JIZZAKH_NPP_LON);
    setWindSpeed(5.5);
    setWindDirection(90);
    setStabilityClass("D");
    setReleaseHeight(45);
    setPrecipitationRateMmH(0);
    setGroundExposureHours(4);
    pushToSyncedInput({
      nuclides: updated,
      latitude: JIZZAKH_NPP_LAT,
      longitude: JIZZAKH_NPP_LON,
      windSpeed: 5.5,
      windDirection: 90,
      stabilityClass: "D",
      releaseHeight: 45,
      precipitationRate: 0,
    });
    setProbePos({
      id: "probe-alpha",
      name: "Датчик-1 (Разведка)",
      x: 600,
      y: 0,
      z: 1.5,
    });
    setCameraPreset("perspective");
  };

  const handleDownloadReport = (format: "csv" | "json") => {
    const content =
      format === "csv"
        ? formatHotSpotReportCsv(assessmentReport)
        : formatHotSpotReportJson(assessmentReport);
    const mime = format === "csv" ? "text/csv;charset=utf-8;" : "application/json;charset=utf-8;";
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aura-rad-hotspot-report-${selectedPresetId}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatActivity = (bq: number) => {
    if (activityDisplayUnit === "Ci") {
      const ci = bqToCi(bq);
      if (ci >= 1e6) return `${(ci / 1e6).toFixed(2)} МКи`;
      if (ci >= 1e3) return `${(ci / 1e3).toFixed(2)} кКи`;
      return `${ci.toFixed(1)} Ки`;
    }
    if (bq >= 1e15) return `${(bq / 1e15).toFixed(2)} ПБк`;
    if (bq >= 1e12) return `${(bq / 1e12).toFixed(2)} ТБк`;
    if (bq >= 1e9) return `${(bq / 1e9).toFixed(2)} ГБк`;
    return `${bq.toExponential(2)} Бк`;
  };

  const formatDoseMsv = (msv: number) => {
    if (msv >= 1000) return `${(msv / 1000).toFixed(3)} Зв`;
    if (msv >= 1) return `${msv.toFixed(2)} мЗв`;
    if (msv >= 0.001) return `${(msv * 1000).toFixed(1)} мкЗв`;
    return `${msv.toExponential(2)} мЗв`;
  };

  const formatDoseRateMsvH = (msvh: number) => {
    if (msvh >= 1000) return `${(msvh / 1000).toFixed(2)} Зв/ч`;
    if (msvh >= 0.01) return `${msvh.toFixed(3)} мЗв/ч`;
    return `${(msvh * 1000).toFixed(2)} мкЗв/ч`;
  };

  const formatSafeTime = (minutes: number) => {
    if (minutes >= 99999) return "> 100 сут (Безопасно)";
    if (minutes > 1440) return `${(minutes / 1440).toFixed(1)} сут`;
    if (minutes > 60) return `${(minutes / 60).toFixed(1)} ч`;
    if (minutes < 1) return `${(minutes * 60).toFixed(0)} сек (КРИТИЧНО)`;
    return `${minutes.toFixed(1)} мин`;
  };

  const activeIsolines =
    isolineMetric === "total_dose_msv"
      ? assessmentReport.totalDoseIsolines
      : assessmentReport.isolines;

  return (
    <div className="relative w-full h-full flex flex-col bg-[#080c12] text-[#e2e8f0] overflow-hidden select-none">
      {/* 3D WebGL Canvas Layer */}
      <div className="absolute inset-0">
        <Plume3DCanvas
          source={sourceData}
          meteorology={meteoData}
          isotope={primaryIsotope}
          nuclides={nuclides}
          groundExposureHours={groundExposureHours}
          peakCoords={assessmentReport.totalMixturePeak.dosePeakCoords}
          probe={probePos}
          onProbeMove={(newPos) => setProbePos((prev) => ({ ...prev, ...newPos }))}
          zones={assessmentReport.zones}
          isolines={activeIsolines}
          showZones={showZones}
          showIsolines={showIsolines}
          showCenterline={showCenterline}
          mapStyle={mapStyle}
          particleDensity={particleDensity}
          cameraPreset={cameraPreset}
          isSimulating={isSimulating}
        />
      </div>

      {/* Unified Compact Top Status Bar */}
      <div className="relative z-10 flex items-center justify-between gap-3 px-4 py-2 bg-[#0f172a]/95 border-b border-slate-800">
        {/* Left: Site Title & Release Parameters */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
            <Flame className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-white truncate">
              <span>3D Атмосферный шлейф</span>
              <span className="text-[11px] font-mono font-normal text-cyan-300/90">
                {siteLat.toFixed(4)}° N, {siteLon.toFixed(4)}° E
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-2 font-mono tabular-nums truncate">
              <span>
                Смесь: <strong className="text-slate-200">{activeNuclidesCount}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <strong className="text-amber-300">{formatActivity(totalMixtureActivityBq)}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Ветер:{" "}
                <strong className="text-slate-200">
                  {windSpeed.toFixed(1)} м/с ({windDirection}°)
                </strong>
              </span>
              {precipitationRateMmH > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-sky-300">{precipitationRateMmH} мм/ч</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Integrated Peak Readout + Clean HUD Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Unified Peak Status Strip */}
          <div className="hidden lg:flex items-center gap-3 px-3 py-1 rounded-lg bg-slate-900/90 border border-slate-800 font-mono tabular-nums">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] text-slate-400">Пик D ({groundExposureHours}ч):</span>
              <span className="text-xs font-bold text-rose-400">
                {formatDoseMsv(assessmentReport.totalMixturePeak.maxTotalEffectiveDoseMsv)}
              </span>
            </div>
            <div className="h-3.5 w-px bg-slate-800" />
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] text-slate-400">H*(10):</span>
              <span className="text-xs font-bold text-amber-300">
                {formatDoseRateMsvH(assessmentReport.totalMixturePeak.maxDoseRateH10MsvH)}
              </span>
            </div>
            <div className="h-3.5 w-px bg-slate-800" />
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] text-slate-400">X_max:</span>
              <span className="text-xs font-bold text-cyan-300">
                {assessmentReport.totalMixturePeak.dosePeakCoords.xDownwindM} м
              </span>
            </div>
          </div>

          {/* Probe & Full-Map Mode Toggles */}
          <div className="flex items-center gap-1 bg-slate-900/90 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => {
                if (hideAllPanels) setHideAllPanels(false);
                setIsProbeVisible((v) => !v);
              }}
              title="Показать / скрыть виджет дозиметрического зонда"
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors ${
                !hideAllPanels && isProbeVisible
                  ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Зонд</span>
            </button>
            <button
              onClick={() => setHideAllPanels((v) => !v)}
              title={
                hideAllPanels
                  ? "Показать панели управления"
                  : "Свернуть все панели (чистая 3D-карта)"
              }
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors ${
                hideAllPanels
                  ? "bg-cyan-600 text-white font-medium"
                  : "text-slate-300 hover:text-white hover:bg-slate-800"
              }`}
            >
              {hideAllPanels ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">
                {hideAllPanels ? "Показать панели" : "Свернуть панели"}
              </span>
            </button>
          </div>

          {/* Simulation Controls */}
          <div className="flex items-center gap-0.5 bg-slate-900/90 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setIsSimulating(!isSimulating)}
              title={isSimulating ? "Пауза анимации" : "Запуск анимации"}
              className={`p-1.5 rounded hover:bg-slate-800 transition-colors ${
                isSimulating ? "text-cyan-400" : "text-slate-400"
              }`}
            >
              {isSimulating ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={handleReset}
              title="Сбросить на площадку АЭС Джизак"
              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Collapsible & Hideable Dosimeter Probe Widget (Top-Left) */}
      {!hideAllPanels && isProbeVisible && (
        <div className="absolute top-14 left-4 z-10 w-80 rounded-xl bg-[#0f172a]/95 border border-slate-700/90 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-slate-900/80 border-b border-slate-800">
            <div className="flex items-center gap-1.5 min-w-0">
              <Radio className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-xs font-semibold text-white truncate">Зонд</span>
              <span className="text-[10px] text-slate-400 font-mono truncate">· Shift+Клик</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setIsProbeMinimized((m) => !m)}
                title={isProbeMinimized ? "Развернуть показания" : "Свернуть показания"}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                {isProbeMinimized ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronUp className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={() => setIsProbeVisible(false)}
                title="Скрыть виджет зонда"
                className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {isProbeMinimized ? (
            <div className="px-3 py-2 flex items-center justify-between text-[11px] font-mono tabular-nums">
              <span className="text-slate-400">
                ({probePos.x.toFixed(0)}, {probePos.y.toFixed(0)} м)
              </span>
              <span className="font-bold text-rose-400">
                {formatDoseMsv(probeReading.totalEffectiveDoseMsv)}
              </span>
              <span className="font-bold text-amber-300">
                {formatDoseRateMsvH(probeReading.ambientDoseEquivalentRateH10)}
              </span>
            </div>
          ) : (
            <div className="p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between font-mono tabular-nums text-[11px] bg-slate-900/90 px-2 py-1 rounded border border-slate-800">
                <span className="text-cyan-300">
                  X={probePos.x.toFixed(0)} Y={probePos.y.toFixed(0)} м
                </span>
                <span className="text-slate-400">
                  {probeGps.latStr}, {probeGps.lonStr}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Доза D_total ({groundExposureHours}ч):</span>
                <span className="font-mono tabular-nums font-bold text-sm text-rose-400">
                  {formatDoseMsv(probeReading.totalEffectiveDoseMsv)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5 p-1.5 rounded bg-slate-900/75 border border-slate-800 font-mono tabular-nums text-[10px]">
                <div>
                  <div className="text-slate-400">Ингаляция</div>
                  <div className="text-amber-300 font-semibold">
                    {formatDoseMsv(probeReading.inhalationDoseMsv)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Облако</div>
                  <div className="text-cyan-300 font-semibold">
                    {formatDoseMsv(probeReading.cloudDoseMsv)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Грунт (W)</div>
                  <div className="text-emerald-300 font-semibold">
                    {formatDoseMsv(probeReading.groundDoseMsv)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Мощность H*(10):</span>
                <span className="font-mono tabular-nums font-bold text-amber-300">
                  {formatDoseRateMsvH(probeReading.ambientDoseEquivalentRateH10)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5 font-mono tabular-nums text-[10px]">
                <div className="flex items-center justify-between bg-slate-900/70 px-2 py-1 rounded border border-slate-800">
                  <span className="text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-cyan-400" />
                    20 мЗв:
                  </span>
                  <span
                    className={`font-bold ${
                      probeReading.personnelSafeTimeMin < 60 ? "text-rose-400" : "text-emerald-400"
                    }`}
                  >
                    {formatSafeTime(probeReading.personnelSafeTimeMin)}
                  </span>
                </div>
                <div className="flex items-center justify-between bg-slate-900/70 px-2 py-1 rounded border border-slate-800">
                  <span className="text-slate-400">1 мЗв:</span>
                  <span
                    className={`font-bold ${
                      probeReading.publicSafeTimeMin < 60 ? "text-rose-400" : "text-emerald-400"
                    }`}
                  >
                    {formatSafeTime(probeReading.publicSafeTimeMin)}
                  </span>
                </div>
              </div>

              {/* Multi-Nuclide Spectrum Breakdown Accordion */}
              <div className="pt-1 border-t border-slate-800">
                <button
                  onClick={() => setShowNuclideBreakdown(!showNuclideBreakdown)}
                  className="w-full flex items-center justify-between text-[11px] text-cyan-300 hover:text-cyan-200 transition-colors py-0.5"
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <PieChart className="w-3 h-3 text-cyan-400" />
                    <span>Вклад нуклидов ({probeReading.nuclides.length})</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-rose-300 font-mono">
                      {probeReading.primaryDoseContributor}
                    </span>
                    {showNuclideBreakdown ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </div>
                </button>

                {showNuclideBreakdown && (
                  <div className="mt-1.5 space-y-1 max-h-36 overflow-y-auto pr-1">
                    {probeReading.nuclides.map((nuc) => (
                      <div
                        key={nuc.symbol}
                        className="p-1.5 rounded bg-slate-900/90 border border-slate-800/80 text-[10px]"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-white font-mono">{nuc.symbol}</span>
                          <div className="flex items-center gap-2 font-mono tabular-nums shrink-0">
                            <span className="text-rose-300 font-bold">
                              {formatDoseMsv(nuc.totalEffectiveDoseMsv)}
                            </span>
                            <span className="font-bold text-amber-300 w-9 text-right">
                              {nuc.fractionPercent.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                        <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-200"
                            style={{
                              width: `${Math.min(100, Math.max(1, nuc.fractionPercent))}%`,
                              backgroundColor:
                                nuc.hazardGroup === "A"
                                  ? "#ef4444"
                                  : nuc.hazardGroup === "B"
                                    ? "#f97316"
                                    : "#06b6d4",
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Consolidated Collapsible Camera & Basemap Switcher (Top-Right) */}
      {!hideAllPanels && (
        <div className="absolute top-14 right-4 z-10 flex flex-col items-end gap-1.5">
          <button
            onClick={() => setIsViewportBarOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0f172a]/95 border border-slate-700/90 text-[11px] text-slate-300 hover:text-white shadow-lg"
          >
            <Compass className="w-3.5 h-3.5 text-cyan-400" />
            <span>Ракурс и карта</span>
            {isViewportBarOpen ? (
              <ChevronUp className="w-3 h-3 text-slate-400" />
            ) : (
              <ChevronDown className="w-3 h-3 text-slate-400" />
            )}
          </button>

          {isViewportBarOpen && (
            <div className="flex flex-col gap-1.5 bg-[#0f172a]/95 p-2 rounded-xl border border-slate-700/90 shadow-xl">
              <div className="flex gap-1">
                {(
                  [
                    { id: "perspective", label: "3D" },
                    { id: "top", label: "План" },
                    { id: "downwind", label: "По ветру" },
                    { id: "side", label: "Профиль" },
                    { id: "source", label: "Эпицентр" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setCameraPreset(item.id)}
                    className={`px-2 py-1 text-[11px] rounded transition-colors whitespace-nowrap shrink-0 ${
                      cameraPreset === item.id
                        ? "bg-cyan-600 text-white font-medium"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="flex gap-1 pt-1 border-t border-slate-800">
                {(
                  [
                    { id: "satellite", label: "Спутник" },
                    { id: "topographic", label: "Топо" },
                    { id: "tactical", label: "Тактика" },
                    { id: "osm", label: "OSM" },
                  ] as const
                ).map((style) => (
                  <button
                    key={style.id}
                    onClick={() => setMapStyle(style.id)}
                    className={`flex-1 px-2 py-1 text-[11px] rounded transition-colors whitespace-nowrap shrink-0 ${
                      mapStyle === style.id
                        ? "bg-emerald-600 text-white font-medium"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {style.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Unified Collapsible Bottom Control Dock */}
      {!hideAllPanels && (
        <div className="relative z-10 mt-auto flex flex-col items-center pb-3 px-4 pointer-events-none">
          <button
            onClick={() => setIsDockOpen(!isDockOpen)}
            className="pointer-events-auto mb-1.5 flex items-center gap-2 px-3 py-1 rounded-full bg-[#1e293b]/95 border border-[#334155] text-xs text-slate-300 hover:text-white transition-all shadow-lg hover:border-cyan-500"
          >
            {isDockOpen ? (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Свернуть панель</span>
              </>
            ) : (
              <>
                <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
                <span>Параметры моделирования и отчёт</span>
              </>
            )}
          </button>

          {isDockOpen && (
            <div className="pointer-events-auto w-full max-w-5xl bg-[#0f172a]/96 border border-[#334155] rounded-2xl shadow-2xl overflow-hidden">
              {/* Dock Navigation Tabs */}
              <div className="flex items-center justify-between border-b border-[#334155] bg-[#1e293b]/70 px-4">
                <div className="flex overflow-x-auto">
                  {(
                    [
                      { id: "source", label: "Источник (Смесь)", icon: Activity },
                      { id: "meteo", label: "Метео и Осадки", icon: Wind },
                      { id: "map", label: "Карта и Масштаб", icon: MapIcon },
                      { id: "zones", label: "Зоны и Изолинии", icon: ShieldAlert },
                      { id: "report", label: "Отчет HotSpot", icon: FileSpreadsheet },
                      { id: "probe", label: "Зонд и Лимиты", icon: MapPin },
                    ] as const
                  ).map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                          activeTab === tab.id
                            ? "border-cyan-400 text-cyan-400"
                            : "border-transparent text-slate-400 hover:text-white"
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Unit Toggle Bq(TBq) / Ci */}
                <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-700 shrink-0">
                  <button
                    onClick={() => setActivityDisplayUnit("TBq")}
                    className={`px-2 py-0.5 text-[11px] font-mono rounded ${
                      activityDisplayUnit === "TBq"
                        ? "bg-cyan-600 text-white font-semibold"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    ТБк
                  </button>
                  <button
                    onClick={() => setActivityDisplayUnit("Ci")}
                    className={`px-2 py-0.5 text-[11px] font-mono rounded ${
                      activityDisplayUnit === "Ci"
                        ? "bg-amber-600 text-white font-semibold"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Ки
                  </button>
                </div>
              </div>

              {/* Tab Contents */}
              <div className="p-4">
                {activeTab === "source" && (
                  <div className="space-y-3">
                    {/* Scenario Presets Bar */}
                    <div className="flex flex-wrap items-center gap-1.5 pb-2 border-b border-slate-800">
                      <span className="text-xs text-slate-400 font-medium mr-1 flex items-center gap-1.5">
                        <Radiation className="w-3.5 h-3.5 text-amber-400" />
                        Сценарии:
                      </span>
                      {ACCIDENT_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() => handleApplyPreset(preset)}
                          className={`px-2.5 py-1 text-xs rounded-lg border transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                            selectedPresetId === preset.id
                              ? "border-cyan-400 bg-cyan-950/70 text-cyan-200 font-medium"
                              : "border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:text-white"
                          }`}
                        >
                          <span>{preset.name}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            · {preset.items.length}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* 2-Column Multi-Nuclide Layout */}
                    <div className="grid grid-cols-3 gap-4">
                      {/* Left: Radionuclides Table & Add Form (2 cols) */}
                      <div className="col-span-2 space-y-2.5">
                        {/* Mixture Overview Stats */}
                        <div className="grid grid-cols-4 gap-2 p-2 rounded-lg bg-slate-900/80 border border-slate-800 text-xs font-mono tabular-nums">
                          <div>
                            <div className="text-[10px] text-slate-400">Сумм. активность</div>
                            <div className="font-bold text-amber-300">
                              {formatActivity(totalMixtureActivityBq)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400">В Кюри (Ки)</div>
                            <div className="font-bold text-slate-200">
                              {bqToCi(totalMixtureActivityBq).toExponential(2)} Ки
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400">Состав смеси</div>
                            <div className="font-bold text-cyan-300">
                              {activeNuclidesCount} / {nuclides.length} актив.
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400">Выброс Q</div>
                            <div className="font-bold text-white">
                              {assessmentReport.sourceMix.totalActivityBq > 0
                                ? (
                                    assessmentReport.sourceMix.totalActivityBq /
                                    Math.max(1, sourceData.releaseDuration)
                                  ).toExponential(2)
                                : "0"}{" "}
                              Бк/с
                            </div>
                          </div>
                        </div>

                        {/* Nuclides List */}
                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                          {nuclides.map((item) => {
                            const iso = getExtendedIsotope(item.isotopeSymbol);
                            const displayVal =
                              activityDisplayUnit === "Ci"
                                ? bqToCi(item.activityBq).toFixed(1)
                                : (item.activityBq / 1e12).toFixed(1);
                            const sharePercent =
                              totalMixtureActivityBq > 0 && item.enabled
                                ? ((item.activityBq / totalMixtureActivityBq) * 100).toFixed(1)
                                : "0.0";
                            const vd = item.depositionVelocityMs ?? iso.defaultDepositionVelocityMs;

                            return (
                              <div
                                key={item.id}
                                className={`p-2 rounded-lg border flex items-center justify-between gap-2 text-xs transition-colors ${
                                  item.enabled
                                    ? "bg-slate-900/90 border-slate-700/80"
                                    : "bg-slate-950/40 border-slate-900 text-slate-400 opacity-60"
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={item.enabled}
                                    onChange={() => handleToggleNuclide(item.id)}
                                    className="rounded accent-cyan-400 w-3.5 h-3.5 cursor-pointer"
                                  />
                                  <span
                                    className="px-1.5 py-0.5 rounded text-[11px] font-mono font-bold border shrink-0"
                                    style={{
                                      borderColor:
                                        iso.hazardGroup === "A"
                                          ? "#ef4444"
                                          : iso.hazardGroup === "B"
                                            ? "#f97316"
                                            : "#06b6d4",
                                      color:
                                        iso.hazardGroup === "A"
                                          ? "#fca5a5"
                                          : iso.hazardGroup === "B"
                                            ? "#fdba74"
                                            : "#67e8f9",
                                    }}
                                  >
                                    {iso.symbol}
                                  </span>
                                  <div className="truncate">
                                    <span className="font-semibold text-white">{iso.nameRu}</span>
                                    <span className="text-[10px] text-slate-400 ml-1.5">
                                      {NUCLIDE_CATEGORY_LABELS[iso.category]} · T₁/₂={iso.halfLife}{" "}
                                      {iso.halfLifeUnit}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0 font-mono tabular-nums">
                                  <div
                                    className="flex items-center gap-1"
                                    title="Скорость осаждения Vd (м/с)"
                                  >
                                    <span className="text-[10px] text-slate-400">Vd:</span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={0.1}
                                      step={0.001}
                                      value={vd}
                                      disabled={!item.enabled}
                                      onChange={(e) =>
                                        handleUpdateDepositionVel(
                                          item.id,
                                          parseFloat(e.target.value) || 0,
                                        )
                                      }
                                      className="w-14 bg-[#1e293b] border border-slate-700 rounded px-1 py-0.5 text-[11px] text-right text-emerald-300 disabled:opacity-50"
                                    />
                                  </div>

                                  <div className="flex items-center gap-1">
                                    <input
                                      type="number"
                                      min={0.1}
                                      step={activityDisplayUnit === "Ci" ? 100 : 1}
                                      value={displayVal}
                                      disabled={!item.enabled}
                                      onChange={(e) =>
                                        handleUpdateActivity(
                                          item.id,
                                          parseFloat(e.target.value) || 0.1,
                                        )
                                      }
                                      className="w-20 bg-[#1e293b] border border-slate-700 rounded px-1.5 py-0.5 text-xs text-right font-bold text-amber-300 disabled:opacity-50"
                                    />
                                    <span className="text-[11px] text-slate-400 w-7">
                                      {activityDisplayUnit === "Ci" ? "Ки" : "ТБк"}
                                    </span>
                                  </div>

                                  <span className="w-12 text-right text-[11px] text-cyan-300">
                                    {sharePercent}%
                                  </span>

                                  <button
                                    onClick={() => handleRemoveNuclide(item.id)}
                                    disabled={nuclides.length <= 1}
                                    title="Удалить из смеси"
                                    className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Category Filter + Add Radionuclide Inline Row */}
                        <div className="space-y-1.5 pt-1 border-t border-slate-800">
                          <div className="flex items-center gap-1 text-[11px]">
                            <span className="text-slate-400 mr-1">Категория:</span>
                            {(
                              [
                                { id: "all", label: "Все" },
                                { id: "fission_product", label: "Продукты деления" },
                                { id: "actinide", label: "Актиниды" },
                                { id: "activation_product", label: "Активация" },
                                { id: "natural", label: "Естественные" },
                              ] as const
                            ).map((cat) => (
                              <button
                                key={cat.id}
                                onClick={() => handleCategoryFilterChange(cat.id)}
                                className={`px-2 py-0.5 rounded text-[11px] transition-colors whitespace-nowrap ${
                                  categoryFilter === cat.id
                                    ? "bg-cyan-600/80 text-white font-medium"
                                    : "bg-slate-800/80 text-slate-400 hover:text-white"
                                }`}
                              >
                                {cat.label}
                              </button>
                            ))}
                          </div>

                          <div className="flex items-center gap-2">
                            <select
                              value={newNuclideSymbol}
                              onChange={(e) => setNewNuclideSymbol(e.target.value)}
                              className="flex-1 bg-[#1e293b] border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-400"
                            >
                              {filteredIsotopes.map((iso) => (
                                <option key={iso.symbol} value={iso.symbol}>
                                  {iso.symbol} ({iso.nameRu}) ·{" "}
                                  {NUCLIDE_CATEGORY_LABELS[iso.category]} · Гр.{iso.hazardGroup} ·
                                  Vd=
                                  {iso.defaultDepositionVelocityMs} м/с
                                </option>
                              ))}
                            </select>

                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={0.1}
                                step={activityDisplayUnit === "Ci" ? 100 : 5}
                                value={newNuclideActivityVal}
                                onChange={(e) =>
                                  setNewNuclideActivityVal(parseFloat(e.target.value) || 1)
                                }
                                className="w-20 bg-[#1e293b] border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-right font-mono text-amber-300"
                              />
                              <span className="text-[11px] text-slate-400 font-mono">
                                {activityDisplayUnit === "Ci" ? "Ки" : "ТБк"}
                              </span>
                            </div>

                            <button
                              onClick={handleAddNuclide}
                              className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Добавить</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Right: Stack Height, Duration & Ground Exposure Time (1 col) */}
                      <div className="space-y-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-xs text-slate-300 font-medium">
                              Эффективная высота (H)
                            </label>
                            <span className="text-xs font-mono font-bold text-cyan-300">
                              {releaseHeight} м
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={200}
                            step={5}
                            value={releaseHeight}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setReleaseHeight(val);
                              pushToSyncedInput({ releaseHeight: val });
                            }}
                            className="w-full accent-cyan-400"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-xs text-slate-300 font-medium">
                              Длительность выброса
                            </label>
                            <span className="text-xs font-mono font-bold text-amber-300">
                              {releaseDurationHours} ч
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.25}
                            max={24}
                            step={0.25}
                            value={releaseDurationHours}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setReleaseDurationHours(val);
                              pushToSyncedInput({ releaseDuration: val });
                            }}
                            className="w-full accent-cyan-400"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-xs text-slate-300 font-medium">
                              Экспозиция на грунте T_eff
                            </label>
                            <span className="text-xs font-mono font-bold text-emerald-300">
                              {groundExposureHours} ч
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-1">
                            {[
                              { h: 4, label: "4 ч" },
                              { h: 24, label: "24 ч" },
                              { h: 168, label: "7 сут" },
                              { h: 720, label: "30 сут" },
                            ].map((opt) => (
                              <button
                                key={opt.h}
                                onClick={() => setGroundExposureHours(opt.h)}
                                className={`py-1 rounded text-[11px] font-mono transition-colors ${
                                  groundExposureHours === opt.h
                                    ? "bg-emerald-600 text-white font-semibold"
                                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="text-[10px] text-slate-400 p-2 rounded bg-slate-950/70 border border-slate-800/80 space-y-1">
                          <div className="text-cyan-300 font-semibold">
                            DCF: ICRP 72 / НРБ-99 (AMAD = 1 мкм)
                          </div>
                          <p>
                            Интеграция: Ингаляция + Облако + Выпадения W(x,y) с истощением и
                            распадом t = x/u.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "meteo" && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-slate-900/70 border border-slate-800 text-xs">
                      <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums text-[11px]">
                        <span className="text-slate-400">Вектор переноса:</span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300">
                          kₓ={transportVec3D.kx.toFixed(3)}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300">
                          kᵧ={transportVec3D.ky.toFixed(3)}
                        </span>
                        <span className="text-slate-300">
                          uₓ={transportVec3D.uxMs.toFixed(2)} м/с · uᵧ=
                          {transportVec3D.uyMs.toFixed(2)} м/с
                        </span>
                        {meteoApiMeta && <span className="text-emerald-300">· {meteoApiMeta}</span>}
                      </div>
                      <button
                        type="button"
                        onClick={handleFetchLiveMeteo}
                        disabled={meteoSyncLoading}
                        className="px-2.5 py-1 rounded bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-300 text-[11px] font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${meteoSyncLoading ? "animate-spin" : ""}`}
                        />
                        {meteoSyncLoading ? "Запрос..." : "Загрузить погоду (API)"}
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <label className="text-xs text-slate-400">Скорость ветра (u)</label>
                          <span className="text-xs font-mono font-bold text-cyan-300">
                            {windSpeed.toFixed(1)} м/с
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.5}
                          max={25}
                          step={0.5}
                          value={windSpeed}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setWindSpeed(val);
                            pushToSyncedInput({ windSpeed: val });
                          }}
                          className="w-full accent-cyan-400"
                        />
                        <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                          <span>0.5 м/с</span>
                          <span>5 м/с</span>
                          <span>25 м/с</span>
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <label className="text-xs text-slate-400">Направление (Откуда)</label>
                          <span className="text-xs font-mono font-bold text-amber-300">
                            {windDirection}°
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={359}
                          step={5}
                          value={windDirection}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            setWindDirection(val);
                            pushToSyncedInput({ windDirection: val });
                          }}
                          className="w-full accent-cyan-400"
                        />
                        <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                          <span>0° С</span>
                          <span>90° В</span>
                          <span>180° Ю</span>
                          <span>270° З</span>
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <label className="text-xs text-slate-400 flex items-center gap-1">
                            <CloudRain className="w-3.5 h-3.5 text-sky-400" />
                            Осадки (вымывание Λ)
                          </label>
                          <span className="text-xs font-mono font-bold text-sky-300">
                            {precipitationRateMmH} мм/ч
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={25}
                          step={0.5}
                          value={precipitationRateMmH}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setPrecipitationRateMmH(val);
                            pushToSyncedInput({ precipitationRate: val });
                          }}
                          className="w-full accent-sky-400"
                        />
                        <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                          <span>0 (Сухо)</span>
                          <span>5 (Дождь)</span>
                          <span>25 (Ливень)</span>
                        </div>
                      </div>

                      <div>
                        <label className="text-xs text-slate-400 block mb-1.5">
                          Стабильность (Паскуилл)
                        </label>
                        <div className="grid grid-cols-6 gap-1">
                          {(["A", "B", "C", "D", "E", "F"] as StabilityClass[]).map((cat) => (
                            <button
                              key={cat}
                              onClick={() => {
                                setStabilityClass(cat);
                                pushToSyncedInput({ stabilityClass: cat });
                              }}
                              className={`py-1.5 rounded text-xs font-bold transition-all ${
                                stabilityClass === cat
                                  ? "bg-cyan-500 text-black shadow"
                                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                              }`}
                            >
                              {cat}
                            </button>
                          ))}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1.5">
                          {stabilityClass === "A" && "A — Сильная конвекция"}
                          {stabilityClass === "B" && "B — Умеренно неустойчивая"}
                          {stabilityClass === "C" && "C — Слабо неустойчивая"}
                          {stabilityClass === "D" && "D — Нейтральная стратификация"}
                          {stabilityClass === "E" && "E — Слабо устойчивая (ночь)"}
                          {stabilityClass === "F" && "F — Инверсия, штиль"}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "map" && (
                  <div className="grid grid-cols-3 gap-5">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1.5">
                        Тип подложки карты
                      </label>
                      <div className="space-y-1.5">
                        {(
                          [
                            {
                              id: "satellite",
                              name: "Спутниковый снимок",
                              desc: "Поля, река, дороги, застройка",
                            },
                            {
                              id: "topographic",
                              name: "Топографическая карта",
                              desc: "Горизонтали рельефа, гидрография",
                            },
                            {
                              id: "tactical",
                              name: "Тактическая тёмная сетка",
                              desc: "Контрастный командный режим",
                            },
                            {
                              id: "osm",
                              name: "OpenStreetMap",
                              desc: "Обзорная открытая карта местности",
                            },
                          ] as const
                        ).map((item) => (
                          <button
                            key={item.id}
                            onClick={() => setMapStyle(item.id)}
                            className={`w-full text-left p-2 rounded-lg border transition-all text-xs ${
                              mapStyle === item.id
                                ? "border-emerald-500 bg-emerald-950/40 text-white font-medium"
                                : "border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700"
                            }`}
                          >
                            <div className="font-semibold">{item.name}</div>
                            <div className="text-[10px] text-slate-400">{item.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1.5">
                        Географическая привязка эпицентра
                      </label>
                      <div className="space-y-2 text-xs">
                        <div>
                          <span className="text-slate-400">Широта (Lat):</span>
                          <input
                            type="number"
                            step="0.0001"
                            value={siteLat}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || JIZZAKH_NPP_LAT;
                              setSiteLat(val);
                              pushToSyncedInput({ latitude: val });
                            }}
                            className="w-full bg-[#1e293b] border border-slate-700 rounded px-2 py-1 text-white mt-1"
                          />
                        </div>
                        <div>
                          <span className="text-slate-400">Долгота (Lon):</span>
                          <input
                            type="number"
                            step="0.0001"
                            value={siteLon}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || JIZZAKH_NPP_LON;
                              setSiteLon(val);
                              pushToSyncedInput({ longitude: val });
                            }}
                            className="w-full bg-[#1e293b] border border-slate-700 rounded px-2 py-1 text-white mt-1"
                          />
                        </div>
                        <button
                          onClick={() => {
                            setSiteLat(JIZZAKH_NPP_LAT);
                            setSiteLon(JIZZAKH_NPP_LON);
                            pushToSyncedInput({
                              latitude: JIZZAKH_NPP_LAT,
                              longitude: JIZZAKH_NPP_LON,
                            });
                          }}
                          className="w-full py-1.5 px-2 rounded bg-cyan-950/70 hover:bg-cyan-900/80 border border-cyan-500/40 text-cyan-300 text-[11px] font-medium transition-colors"
                        >
                          АЭС Джизак (оз. Тузкан, 40.7084° N, 67.1584° E)
                        </button>
                        <div className="text-[10px] text-slate-400 bg-slate-900/60 p-2 rounded border border-slate-800">
                          Охват: <strong>12 × 12 км</strong> · Масштаб 1:1 (1 ед = 1 м).
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1.5">Слои и изолинии</label>
                      <div className="space-y-2 text-xs">
                        <div className="flex gap-1 bg-slate-900 p-1 rounded border border-slate-800">
                          <button
                            onClick={() => setIsolineMetric("dose_rate_msvh")}
                            className={`flex-1 py-1 rounded text-[11px] ${
                              isolineMetric === "dose_rate_msvh"
                                ? "bg-cyan-600 text-white font-medium"
                                : "text-slate-400 hover:text-white"
                            }`}
                          >
                            H*(10) (мЗв/ч)
                          </button>
                          <button
                            onClick={() => setIsolineMetric("total_dose_msv")}
                            className={`flex-1 py-1 rounded text-[11px] ${
                              isolineMetric === "total_dose_msv"
                                ? "bg-rose-600 text-white font-medium"
                                : "text-slate-400 hover:text-white"
                            }`}
                          >
                            D_total (мЗв)
                          </button>
                        </div>

                        <label className="flex items-center justify-between cursor-pointer p-1.5 rounded bg-slate-900/60 border border-slate-800">
                          <span>Изолинии на карте:</span>
                          <input
                            type="checkbox"
                            checked={showIsolines}
                            onChange={(e) => setShowIsolines(e.target.checked)}
                            className="rounded accent-cyan-400"
                          />
                        </label>
                        <label className="flex items-center justify-between cursor-pointer p-1.5 rounded bg-slate-900/60 border border-slate-800">
                          <span>Круговые зоны реагирования:</span>
                          <input
                            type="checkbox"
                            checked={showZones}
                            onChange={(e) => setShowZones(e.target.checked)}
                            className="rounded accent-cyan-400"
                          />
                        </label>
                        <label className="flex items-center justify-between cursor-pointer p-1.5 rounded bg-slate-900/60 border border-slate-800">
                          <span>Осевая линия факела:</span>
                          <input
                            type="checkbox"
                            checked={showCenterline}
                            onChange={(e) => setShowCenterline(e.target.checked)}
                            className="rounded accent-cyan-400"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "zones" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">
                        Границы зон защитных мероприятий по суммарной эффективной дозе D_total (
                        {groundExposureHours}ч):
                      </span>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={showIsolines}
                            onChange={(e) => setShowIsolines(e.target.checked)}
                            className="rounded accent-cyan-400"
                          />
                          <span>Изолинии</span>
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={showZones}
                            onChange={(e) => setShowZones(e.target.checked)}
                            className="rounded accent-cyan-400"
                          />
                          <span>Зоны реагирования</span>
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-3">
                      {assessmentReport.zones.map((zone) => (
                        <div
                          key={zone.name}
                          className="p-2.5 rounded-xl border bg-slate-900/70"
                          style={{ borderColor: zone.colorHex }}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold" style={{ color: zone.colorHex }}>
                              {zone.nameRu}
                            </span>
                            <span className="text-[10px] font-mono font-bold text-white">
                              R = {zone.radiusMeters} м
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Критерий: &ge; {zone.doseThresholdMsv} мЗв
                          </div>
                          <div className="text-[10px] text-slate-300 mt-1 line-clamp-2">
                            {zone.recommendedAction}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-4 text-xs pt-1 border-t border-slate-800">
                      <span className="text-slate-400 text-[11px]">
                        Изолинии ({isolineMetric === "total_dose_msv" ? "D_total" : "H*(10)"}):
                      </span>
                      {activeIsolines.map((iso) => (
                        <span
                          key={iso.label}
                          className="flex items-center gap-1.5 font-mono text-[11px]"
                          style={{ color: iso.colorHex }}
                        >
                          <span
                            className="w-2.5 h-0.5 inline-block"
                            style={{ backgroundColor: iso.colorHex }}
                          />
                          {iso.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === "report" && (
                  <div className="space-y-3">
                    {/* Top Summary Strip + Export Buttons */}
                    <div className="flex items-center justify-between gap-4 pb-2 border-b border-slate-800">
                      <div className="grid grid-cols-5 gap-3 flex-1 font-mono tabular-nums text-xs">
                        <div className="bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                          <div className="text-[10px] text-slate-400">Макс. D_total</div>
                          <div className="font-bold text-rose-400">
                            {formatDoseMsv(
                              assessmentReport.totalMixturePeak.maxTotalEffectiveDoseMsv,
                            )}
                          </div>
                        </div>
                        <div className="bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                          <div className="text-[10px] text-slate-400">Коорд. пика (X, Y)</div>
                          <div className="font-bold text-cyan-300">
                            {assessmentReport.totalMixturePeak.dosePeakCoords.xDownwindM} м, 0 м
                          </div>
                        </div>
                        <div className="bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                          <div className="text-[10px] text-slate-400">Макс. C / W</div>
                          <div className="font-bold text-amber-300">
                            {assessmentReport.totalMixturePeak.maxConcentrationBqM3.toExponential(
                              1,
                            )}{" "}
                            / {assessmentReport.totalMixturePeak.maxDepositionBqM2.toExponential(1)}
                          </div>
                        </div>
                        <div className="bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                          <div className="text-[10px] text-slate-400">t_max Персонал (20мЗв)</div>
                          <div className="font-bold text-emerald-300">
                            {formatSafeTime(
                              assessmentReport.safeStayAssessment.personnelSafeTimeAtPeakMin,
                            )}
                          </div>
                        </div>
                        <div className="bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
                          <div className="text-[10px] text-slate-400">t_max Население (1мЗв)</div>
                          <div className="font-bold text-amber-300">
                            {formatSafeTime(
                              assessmentReport.safeStayAssessment.publicSafeTimeAtPeakMin,
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleDownloadReport("csv")}
                          className="px-2.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>CSV</span>
                        </button>
                        <button
                          onClick={() => handleDownloadReport("json")}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>JSON</span>
                        </button>
                      </div>
                    </div>

                    {/* Per-Nuclide Peak Breakdown Table */}
                    <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/70">
                      <table className="w-full text-left border-collapse text-[11px] font-mono tabular-nums">
                        <thead className="sticky top-0 bg-slate-950 text-slate-400 border-b border-slate-800">
                          <tr>
                            <th className="py-1.5 px-2">Нуклид</th>
                            <th className="py-1.5 px-2 text-right">Активность</th>
                            <th className="py-1.5 px-2 text-right">C_max (Бк/м³)</th>
                            <th className="py-1.5 px-2 text-right">W_max (Бк/м²)</th>
                            <th className="py-1.5 px-2 text-right">D_инг</th>
                            <th className="py-1.5 px-2 text-right">D_обл</th>
                            <th className="py-1.5 px-2 text-right">D_грунт</th>
                            <th className="py-1.5 px-2 text-right">D_total</th>
                            <th className="py-1.5 px-2 text-right">X_max</th>
                            <th className="py-1.5 px-2 text-right">Доля</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {assessmentReport.perNuclidePeaks.map((row) => (
                            <tr key={row.symbol} className="hover:bg-slate-800/40">
                              <td className="py-1.5 px-2 font-sans">
                                <span className="font-mono font-bold text-white">{row.symbol}</span>{" "}
                                <span className="text-slate-400 text-[10px]">
                                  ({NUCLIDE_CATEGORY_LABELS[row.category]})
                                </span>
                              </td>
                              <td className="py-1.5 px-2 text-right text-amber-300">
                                {formatActivity(row.activityBq)}
                              </td>
                              <td className="py-1.5 px-2 text-right text-cyan-300">
                                {row.maxConcentrationBqM3.toExponential(2)}
                              </td>
                              <td className="py-1.5 px-2 text-right text-emerald-300">
                                {row.maxDepositionBqM2.toExponential(2)}
                              </td>
                              <td className="py-1.5 px-2 text-right text-slate-300">
                                {formatDoseMsv(row.maxInhalationDoseMsv)}
                              </td>
                              <td className="py-1.5 px-2 text-right text-slate-300">
                                {formatDoseMsv(row.maxCloudDoseMsv)}
                              </td>
                              <td className="py-1.5 px-2 text-right text-slate-300">
                                {formatDoseMsv(row.maxGroundDoseMsv)}
                              </td>
                              <td className="py-1.5 px-2 text-right font-bold text-rose-400">
                                {formatDoseMsv(row.maxTotalDoseMsv)}
                              </td>
                              <td className="py-1.5 px-2 text-right text-cyan-200">
                                {row.dosePeakCoords.xDownwindM} м
                              </td>
                              <td className="py-1.5 px-2 text-right font-bold text-amber-300">
                                {row.contributionToPeakTotalDosePercent.toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === "probe" && (
                  <div className="grid grid-cols-3 gap-5">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1.5">
                        Предел дозы для t_max (D_limit)
                      </label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[
                          { val: 1.0, label: "1 мЗв (Население)" },
                          { val: 20.0, label: "20 мЗв (Персонал)" },
                          { val: 50.0, label: "50 мЗв (Аварийный)" },
                        ].map((preset) => (
                          <button
                            key={preset.val}
                            onClick={() => setDoseLimitMsv(preset.val)}
                            className={`p-1.5 rounded text-xs transition-colors ${
                              doseLimitMsv === preset.val
                                ? "bg-amber-500 text-black font-bold"
                                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-xs text-slate-400">
                          Положение зонда X (Вост-Зап)
                        </label>
                        <span className="text-xs font-mono text-cyan-300">
                          {probePos.x.toFixed(0)} м
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-3000}
                        max={5000}
                        step={25}
                        value={probePos.x}
                        onChange={(e) =>
                          setProbePos((prev) => ({ ...prev, x: parseFloat(e.target.value) }))
                        }
                        className="w-full accent-cyan-400"
                      />

                      <div className="flex justify-between items-center mb-1 mt-2">
                        <label className="text-xs text-slate-400">Положение зонда Y (Сев-Юг)</label>
                        <span className="text-xs font-mono text-cyan-300">
                          {probePos.y.toFixed(0)} м
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-3000}
                        max={3000}
                        step={25}
                        value={probePos.y}
                        onChange={(e) =>
                          setProbePos((prev) => ({ ...prev, y: parseFloat(e.target.value) }))
                        }
                        className="w-full accent-cyan-400"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1.5">
                        Настройки 3D рендера облака
                      </label>
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span>Плотность частиц:</span>
                          <div className="flex gap-1">
                            {(["low", "medium", "high"] as const).map((d) => (
                              <button
                                key={d}
                                onClick={() => setParticleDensity(d)}
                                className={`px-2 py-0.5 rounded uppercase text-[10px] ${
                                  particleDensity === d
                                    ? "bg-cyan-500 text-black font-bold"
                                    : "bg-slate-800 text-slate-400"
                                }`}
                              >
                                {d}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="text-[11px] text-slate-400 bg-slate-900/60 p-2 rounded border border-slate-800">
                          Красный ромб на карте отмечает расчетную точку максимума дозы смеси
                          (X_max, Y_max).
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
