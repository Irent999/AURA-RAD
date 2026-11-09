import { useState, useMemo } from "react";
import {
  Wind,
  Activity,
  Compass,
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
  Layers,
  Sparkles,
} from "lucide-react";
import { Plume3DCanvas } from "./Plume3DCanvas";
import { EXTENDED_ISOTOPE_LIBRARY, getExtendedIsotope } from "./isotopes";
import {
  runGaussianPlume3DModel,
  calculatePointRadiologicalDose,
  calculateAccumulatedDoseMsv,
  worldToPlumeCoordinates,
} from "./gaussianPlume3D";
import type {
  PlumeSource3D,
  Meteorology3D,
  StabilityClass,
  DosimeterProbe,
  MapStyleType,
} from "./types";

export function Plume3DView() {
  // 1. Simulation Input State
  const [selectedIsotopeSymbol, setSelectedIsotopeSymbol] = useState<string>("Cs-137");
  const [activityExponent, setActivityExponent] = useState<number>(14); // 10^14 Bq = 100 TBq
  const [releaseDurationHours, setReleaseDurationHours] = useState<number>(1.0);
  const [releaseHeight, setReleaseHeight] = useState<number>(45); // meters
  const [siteLat, setSiteLat] = useState<number>(40.212);
  const [siteLon, setSiteLon] = useState<number>(68.865);

  const [windSpeed, setWindSpeed] = useState<number>(5.5); // m/s
  const [windDirection, setWindDirection] = useState<number>(90); // deg (East)
  const [stabilityClass, setStabilityClass] = useState<StabilityClass>("D");
  const [mixingHeight, setMixingHeight] = useState<number>(1200); // meters

  // Dose limit for safe stay time calculation: 1 mSv (public), 20 mSv (personnel), 50 mSv (emergency intervention)
  const [doseLimitMsv, setDoseLimitMsv] = useState<number>(20.0);

  // 2. Interactive Dosimeter Probe Position in World Space (X East, Y North, Z Height)
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
  const [showCenterline, setShowCenterline] = useState<boolean>(true);
  const [particleDensity, setParticleDensity] = useState<"low" | "medium" | "high">("medium");
  const [cameraPreset, setCameraPreset] = useState<
    "perspective" | "top" | "side" | "downwind" | "source"
  >("perspective");

  // Dock UI Collapsible State
  const [isDockOpen, setIsDockOpen] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<"source" | "meteo" | "map" | "zones" | "probe">(
    "source",
  );

  // 4. Derived Physical Model Data
  const currentIsotope = useMemo(() => {
    return getExtendedIsotope(selectedIsotopeSymbol);
  }, [selectedIsotopeSymbol]);

  const sourceData: PlumeSource3D = useMemo(() => {
    return {
      isotopeSymbol: selectedIsotopeSymbol,
      totalActivity: Math.pow(10, activityExponent),
      releaseDuration: releaseDurationHours * 3600,
      position: { x: 0, y: 0, z: 0 },
      effectiveHeight: releaseHeight,
      latitude: siteLat,
      longitude: siteLon,
    };
  }, [
    selectedIsotopeSymbol,
    activityExponent,
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
    };
  }, [windSpeed, windDirection, stabilityClass, mixingHeight]);

  // Full Gaussian Model Output
  const modelOutput = useMemo(() => {
    return runGaussianPlume3DModel(sourceData, meteoData, currentIsotope);
  }, [sourceData, meteoData, currentIsotope]);

  // Dosimeter Sensor Live Readout with H*(10)
  const probeReading = useMemo(() => {
    const { xDownwind, yCrosswind, zHeight } = worldToPlumeCoordinates(
      probePos.x,
      probePos.z,
      probePos.y,
      sourceData.position,
      meteoData.windDirectionDeg,
    );

    return calculatePointRadiologicalDose(
      xDownwind,
      yCrosswind,
      zHeight,
      sourceData,
      meteoData,
      currentIsotope,
      doseLimitMsv,
    );
  }, [probePos, sourceData, meteoData, currentIsotope, doseLimitMsv]);

  const probeAccumulated4h = useMemo(() => {
    return calculateAccumulatedDoseMsv(probeReading.totalDoseRate, 4, currentIsotope.decayConstant);
  }, [probeReading.totalDoseRate, currentIsotope.decayConstant]);

  // GPS coordinates of the probe
  const probeGps = useMemo(() => {
    const lat = siteLat - probePos.y / 111139;
    const lon = siteLon + probePos.x / (111139 * Math.cos((siteLat * Math.PI) / 180));
    return {
      latStr: `${lat.toFixed(4)}° N`,
      lonStr: `${lon.toFixed(4)}° E`,
    };
  }, [siteLat, siteLon, probePos.x, probePos.y]);

  const handleReset = () => {
    setWindSpeed(5.0);
    setWindDirection(90);
    setStabilityClass("D");
    setReleaseHeight(45);
    setActivityExponent(14);
    setProbePos({
      id: "probe-alpha",
      name: "Датчик-1 (Разведка)",
      x: 600,
      y: 0,
      z: 1.5,
    });
    setCameraPreset("perspective");
  };

  const formatActivityDisplay = (exponent: number) => {
    if (exponent >= 15) return `${(Math.pow(10, exponent) / 1e15).toFixed(1)} PBq`;
    if (exponent >= 12) return `${(Math.pow(10, exponent) / 1e12).toFixed(1)} TBq`;
    if (exponent >= 9) return `${(Math.pow(10, exponent) / 1e9).toFixed(1)} GBq`;
    return `${Math.pow(10, exponent).toExponential(2)} Bq`;
  };

  const formatSafeTime = (minutes: number) => {
    if (minutes >= 99999) return "> 100 суток (Безопасно)";
    if (minutes > 1440) return `${(minutes / 1440).toFixed(1)} сут.`;
    if (minutes > 60) return `${(minutes / 60).toFixed(1)} ч.`;
    if (minutes < 1) return `${(minutes * 60).toFixed(0)} сек. (КРИТИЧНО)`;
    return `${minutes.toFixed(1)} мин.`;
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-[#080c12] text-[#e2e8f0] overflow-hidden select-none">
      {/* 3D WebGL Canvas Layer */}
      <div className="absolute inset-0">
        <Plume3DCanvas
          source={sourceData}
          meteorology={meteoData}
          isotope={currentIsotope}
          probe={probePos}
          onProbeMove={(newPos) => setProbePos((prev) => ({ ...prev, ...newPos }))}
          zones={modelOutput.zones}
          isolines={modelOutput.isolines}
          showZones={showZones}
          showIsolines={showIsolines}
          showCenterline={showCenterline}
          mapStyle={mapStyle}
          particleDensity={particleDensity}
          cameraPreset={cameraPreset}
          isSimulating={isSimulating}
        />
      </div>

      {/* Top Header & HUD Status Bar */}
      <div className="relative z-10 flex items-center justify-between px-6 py-3 bg-[#0f172a]/85 border-b border-[#334155]/60 backdrop-blur-none">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-wide uppercase text-white">
                3D Атмосферный шлейф
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-700/40">
                Гауссова модель · Геопривязка 1:1
              </span>
            </div>
            <div className="text-xs text-slate-400 flex items-center gap-3">
              <span>
                Изотоп: <strong className="text-cyan-300">{currentIsotope.symbol}</strong> (
                {currentIsotope.nameRu})
              </span>
              <span>·</span>
              <span>
                Выброс:{" "}
                <strong className="text-amber-300">
                  {formatActivityDisplay(activityExponent)}
                </strong>
              </span>
              <span>·</span>
              <span>
                Ветер:{" "}
                <strong className="text-white">
                  {windSpeed} м/с ({windDirection}°)
                </strong>
              </span>
            </div>
          </div>
        </div>

        {/* Live Peak Ground Metrics & H*(10) Indicator */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-[#1e293b]/70 border border-[#334155]">
            <div className="text-right">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                Пик H*(10) на грунте
              </div>
              <div className="text-sm font-mono font-bold text-rose-400">
                {modelOutput.peakGroundDoseRateMsvH >= 1000
                  ? `${(modelOutput.peakGroundDoseRateMsvH / 1000).toFixed(2)} Зв/ч`
                  : `${modelOutput.peakGroundDoseRateMsvH.toFixed(2)} мЗв/ч`}
              </div>
            </div>
            <div className="h-6 w-px bg-slate-700" />
            <div className="text-left">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                Удаление максимума
              </div>
              <div className="text-sm font-mono font-bold text-amber-300">
                {modelOutput.peakGroundDoseDistanceM} м
              </div>
            </div>
          </div>

          {/* Quick Simulation Toggles */}
          <div className="flex items-center gap-1.5 bg-[#1e293b]/80 p-1 rounded-lg border border-[#334155]">
            <button
              onClick={() => setIsSimulating(!isSimulating)}
              title={isSimulating ? "Пауза анимации" : "Запуск анимации"}
              className={`p-1.5 rounded hover:bg-slate-700 text-xs flex items-center gap-1 transition-colors ${
                isSimulating ? "text-cyan-400 bg-cyan-950/60" : "text-slate-400"
              }`}
            >
              {isSimulating ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              onClick={handleReset}
              title="Сброс параметров по умолчанию"
              className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Floating 3D Dosimeter Sensor Readout (Top-Left, non-blocking) */}
      <div className="absolute top-16 left-6 z-10 w-84 p-3.5 rounded-xl bg-[#0f172a]/92 border border-cyan-500/30 shadow-2xl">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-semibold text-white">Дозиметрический зонд H*(10)</span>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
            Shift + Клик по карте
          </span>
        </div>

        <div className="space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px] bg-slate-900/80 p-1.5 rounded border border-slate-800">
            <div>
              Метры:{" "}
              <span className="text-cyan-300">
                X={probePos.x.toFixed(0)} Y={probePos.y.toFixed(0)}
              </span>
            </div>
            <div>
              GPS: <span className="text-cyan-300">{probeGps.latStr}</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400">Мощность H*(10):</span>
            <span className="font-mono font-bold text-sm text-rose-400">
              {probeReading.ambientDoseEquivalentRateH10.toFixed(3)} мЗв/ч
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400">Ингаляционная доза:</span>
            <span className="font-mono text-amber-300">
              {probeReading.inhalationDoseRate.toFixed(3)} мЗв/ч
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400">Концентрация C:</span>
            <span className="font-mono text-cyan-300">
              {probeReading.concentration.toExponential(2)} Бк/м³
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400">Накопленная доза (4 ч):</span>
            <span className="font-mono text-amber-300">{probeAccumulated4h.toFixed(2)} мЗв</span>
          </div>

          <div className="pt-1.5 mt-1 border-t border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-slate-300">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>Безопасное время t_max:</span>
            </div>
            <span
              className={`font-mono font-bold ${
                probeReading.safeStayTimeMinutes < 60 ? "text-rose-400" : "text-emerald-400"
              }`}
            >
              {formatSafeTime(probeReading.safeStayTimeMinutes)}
            </span>
          </div>
        </div>
      </div>

      {/* Camera Presets & Map Style Quick Selector (Top-Right) */}
      <div className="absolute top-16 right-6 z-10 flex flex-col gap-2">
        {/* Camera Views */}
        <div className="flex flex-col gap-1.5 bg-[#0f172a]/88 p-1.5 rounded-xl border border-slate-700/80 shadow-lg">
          <span className="text-[10px] px-2 py-0.5 text-slate-400 font-medium uppercase tracking-wider">
            Ракурс камеры
          </span>
          <div className="flex gap-1">
            {(
              [
                { id: "perspective", label: "3D Обзор" },
                { id: "top", label: "План (Сверху)" },
                { id: "downwind", label: "По ветру" },
                { id: "side", label: "Профиль (Сбоку)" },
                { id: "source", label: "Эпицентр" },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                onClick={() => setCameraPreset(item.id)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  cameraPreset === item.id
                    ? "bg-cyan-600 text-white font-medium"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Map Style Quick Pills */}
        <div className="flex flex-col gap-1.5 bg-[#0f172a]/88 p-1.5 rounded-xl border border-slate-700/80 shadow-lg">
          <span className="text-[10px] px-2 py-0.5 text-slate-400 font-medium uppercase tracking-wider flex items-center gap-1.5">
            <MapIcon className="w-3 h-3 text-cyan-400" />
            Подложка карты
          </span>
          <div className="flex gap-1">
            {(
              [
                { id: "satellite", label: "Спутник" },
                { id: "topographic", label: "Топокарта" },
                { id: "tactical", label: "Тактическая" },
                { id: "osm", label: "OpenStreetMap" },
              ] as const
            ).map((style) => (
              <button
                key={style.id}
                onClick={() => setMapStyle(style.id)}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
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
      </div>

      {/* Unified Ergonomic Bottom Control Dock (Three.js Directive Compliant) */}
      <div className="relative z-10 mt-auto flex flex-col items-center pb-4 px-4 pointer-events-none">
        {/* Dock Collapse Toggle Button */}
        <button
          onClick={() => setIsDockOpen(!isDockOpen)}
          className="pointer-events-auto mb-2 flex items-center gap-2 px-3 py-1 rounded-full bg-[#1e293b]/95 border border-[#334155] text-xs text-slate-300 hover:text-white transition-all shadow-lg hover:border-cyan-500"
        >
          {isDockOpen ? (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              <span>Свернуть панель управления</span>
            </>
          ) : (
            <>
              <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
              <span>Развернуть параметры моделирования и карты</span>
            </>
          )}
        </button>

        {/* Collapsible Main Controls Card */}
        {isDockOpen && (
          <div className="pointer-events-auto w-full max-w-4xl bg-[#0f172a]/95 border border-[#334155] rounded-2xl shadow-2xl overflow-hidden animate-fadeIn">
            {/* Dock Navigation Tabs */}
            <div className="flex border-b border-[#334155] bg-[#1e293b]/60 px-4">
              <button
                onClick={() => setActiveTab("source")}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === "source"
                    ? "border-cyan-400 text-cyan-400"
                    : "border-transparent text-slate-400 hover:text-white"
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Источник и Нуклид</span>
              </button>
              <button
                onClick={() => setActiveTab("meteo")}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === "meteo"
                    ? "border-cyan-400 text-cyan-400"
                    : "border-transparent text-slate-400 hover:text-white"
                }`}
              >
                <Wind className="w-3.5 h-3.5" />
                <span>Метеоусловия</span>
              </button>
              <button
                onClick={() => setActiveTab("map")}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === "map"
                    ? "border-cyan-400 text-cyan-400"
                    : "border-transparent text-slate-400 hover:text-white"
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" />
                <span>Карта и Масштаб</span>
              </button>
              <button
                onClick={() => setActiveTab("zones")}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === "zones"
                    ? "border-cyan-400 text-cyan-400"
                    : "border-transparent text-slate-400 hover:text-white"
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Зоны и Изолинии H*(10)</span>
              </button>
              <button
                onClick={() => setActiveTab("probe")}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === "probe"
                    ? "border-cyan-400 text-cyan-400"
                    : "border-transparent text-slate-400 hover:text-white"
                }`}
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>Зонд и Лимиты</span>
              </button>
            </div>

            {/* Tab Contents */}
            <div className="p-4">
              {activeTab === "source" && (
                <div className="grid grid-cols-3 gap-5">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">
                      Радионуклид (33 изотопа)
                    </label>
                    <select
                      value={selectedIsotopeSymbol}
                      onChange={(e) => setSelectedIsotopeSymbol(e.target.value)}
                      className="w-full bg-[#1e293b] border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-400"
                    >
                      {EXTENDED_ISOTOPE_LIBRARY.map((iso) => (
                        <option key={iso.symbol} value={iso.symbol}>
                          {iso.symbol} ({iso.nameRu}) · T1/2 = {iso.halfLife} {iso.halfLifeUnit}
                        </option>
                      ))}
                    </select>
                    <div className="text-[11px] text-slate-400 mt-2 bg-slate-900/60 p-2 rounded border border-slate-800">
                      <div>
                        Гамма-постоянная Γ:{" "}
                        <strong>{currentIsotope.gammaConstant} (мЗв·м²)/(ГБк·ч)</strong>
                      </div>
                      <div>
                        Энергия гамма: <strong>{currentIsotope.avgGammaEnergy} МэВ</strong>
                      </div>
                      <div className="text-slate-400 italic mt-0.5">
                        {currentIsotope.description}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-xs text-slate-400">Активность выброса</label>
                      <span className="text-xs font-mono font-bold text-amber-300">
                        {formatActivityDisplay(activityExponent)} (10^{activityExponent} Бк)
                      </span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={17}
                      step={0.2}
                      value={activityExponent}
                      onChange={(e) => setActivityExponent(parseFloat(e.target.value))}
                      className="w-full accent-cyan-400"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                      <span>10 ГБк (Лаб. авария)</span>
                      <span>100 ТБк (Инцидент)</span>
                      <span>100 ПБк (Чернобыль)</span>
                    </div>

                    <div className="mt-3">
                      <div className="flex justify-between items-center mb-1.5">
                        <label className="text-xs text-slate-400">Длительность выброса</label>
                        <span className="text-xs font-mono text-cyan-300">
                          {releaseDurationHours} ч.
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.25}
                        max={12}
                        step={0.25}
                        value={releaseDurationHours}
                        onChange={(e) => setReleaseDurationHours(parseFloat(e.target.value))}
                        className="w-full accent-cyan-400"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-xs text-slate-400">Эффективная высота трубы (H)</label>
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
                      onChange={(e) => setReleaseHeight(parseFloat(e.target.value))}
                      className="w-full accent-cyan-400"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                      <span>0 м (Приземный)</span>
                      <span>50 м (Венттруба)</span>
                      <span>150 м (Высокая труба АЭС)</span>
                    </div>

                    <div className="mt-3 p-2 rounded bg-slate-900/60 border border-slate-800 text-[11px] text-slate-300">
                      Интенсивность Q:{" "}
                      <strong className="text-cyan-300 font-mono">
                        {modelOutput.emissionRateBqPerSec.toExponential(2)} Бк/с
                      </strong>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "meteo" && (
                <div className="grid grid-cols-3 gap-5">
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
                      onChange={(e) => setWindSpeed(parseFloat(e.target.value))}
                      className="w-full accent-cyan-400"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                      <span>0.5 м/с (Штиль)</span>
                      <span>5 м/с (Умеренный)</span>
                      <span>20 м/с (Шторм)</span>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-xs text-slate-400">
                        Направление ветра (Откуда дует)
                      </label>
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
                      onChange={(e) => setWindDirection(parseInt(e.target.value))}
                      className="w-full accent-cyan-400"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                      <span>0° (Сев)</span>
                      <span>90° (Вост)</span>
                      <span>180° (Юг)</span>
                      <span>270° (Зап)</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">
                      Категория стабильности (Паскуилл)
                    </label>
                    <div className="grid grid-cols-6 gap-1">
                      {(["A", "B", "C", "D", "E", "F"] as StabilityClass[]).map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setStabilityClass(cat)}
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
                    <div className="text-[10px] text-slate-400 mt-2">
                      {stabilityClass === "A" &&
                        "A — Крайне неустойчивая (сильное дневное солнце, штиль)"}
                      {stabilityClass === "B" && "B — Умеренно неустойчивая"}
                      {stabilityClass === "C" && "C — Слабо неустойчивая"}
                      {stabilityClass === "D" &&
                        "D — Нейтральная (сплошная облачность или ветер > 5 м/с)"}
                      {stabilityClass === "E" && "E — Слабо устойчивая (ночь, слабая облачность)"}
                      {stabilityClass === "F" &&
                        "F — Умеренно устойчивая (ясная морозная ночь, инверсия)"}
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
                            name: "Спутниковый снимок (Гибрид)",
                            desc: "Поля, река, дороги, жилая застройка",
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
                          step="0.001"
                          value={siteLat}
                          onChange={(e) => setSiteLat(parseFloat(e.target.value) || 40.212)}
                          className="w-full bg-[#1e293b] border border-slate-700 rounded px-2 py-1 text-white mt-1"
                        />
                      </div>
                      <div>
                        <span className="text-slate-400">Долгота (Lon):</span>
                        <input
                          type="number"
                          step="0.001"
                          value={siteLon}
                          onChange={(e) => setSiteLon(parseFloat(e.target.value) || 68.865)}
                          className="w-full bg-[#1e293b] border border-slate-700 rounded px-2 py-1 text-white mt-1"
                        />
                      </div>
                      <div className="text-[10px] text-slate-400 bg-slate-900/60 p-2 rounded border border-slate-800">
                        Охват модели: <strong>12 × 12 км</strong> вокруг аварийной площадки. Строгий
                        масштаб 1:1 (1 единица = 1 метр).
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">Слои визуализации</label>
                    <div className="space-y-2 text-xs">
                      <label className="flex items-center justify-between cursor-pointer p-1.5 rounded bg-slate-900/60 border border-slate-800">
                        <span>Изолинии H*(10) на карте:</span>
                        <input
                          type="checkbox"
                          checked={showIsolines}
                          onChange={(e) => setShowIsolines(e.target.checked)}
                          className="rounded accent-cyan-400"
                        />
                      </label>
                      <label className="flex items-center justify-between cursor-pointer p-1.5 rounded bg-slate-900/60 border border-slate-800">
                        <span>Круговые зоны аварийного реагирования:</span>
                        <input
                          type="checkbox"
                          checked={showZones}
                          onChange={(e) => setShowZones(e.target.checked)}
                          className="rounded accent-cyan-400"
                        />
                      </label>
                      <label className="flex items-center justify-between cursor-pointer p-1.5 rounded bg-slate-900/60 border border-slate-800">
                        <span>Осевая линия факела (Centerline):</span>
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
                      Границы зон защитных мероприятий и изолинии H*(10):
                    </span>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showIsolines}
                          onChange={(e) => setShowIsolines(e.target.checked)}
                          className="rounded accent-cyan-400"
                        />
                        <span>Изолинии H*(10)</span>
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
                    {modelOutput.zones.map((zone) => (
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

                  {/* Isolines legend */}
                  <div className="flex items-center gap-4 text-xs pt-1 border-t border-slate-800">
                    <span className="text-slate-400 text-[11px]">Изолинии на грунте:</span>
                    <span className="flex items-center gap-1.5 text-rose-400 font-mono text-[11px]">
                      <span className="w-2.5 h-0.5 bg-rose-500 inline-block" /> 50 мЗв/ч
                    </span>
                    <span className="flex items-center gap-1.5 text-orange-400 font-mono text-[11px]">
                      <span className="w-2.5 h-0.5 bg-orange-500 inline-block" /> 10 мЗв/ч
                    </span>
                    <span className="flex items-center gap-1.5 text-yellow-400 font-mono text-[11px]">
                      <span className="w-2.5 h-0.5 bg-yellow-500 inline-block" /> 1.0 мЗв/ч
                    </span>
                    <span className="flex items-center gap-1.5 text-cyan-400 font-mono text-[11px]">
                      <span className="w-2.5 h-0.5 bg-cyan-500 inline-block" /> 0.1 мЗв/ч
                    </span>
                  </div>
                </div>
              )}

              {activeTab === "probe" && (
                <div className="grid grid-cols-3 gap-5">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">
                      Предел дозы для расчета t_max (D_limit)
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
                        Положение зонда X (Восток-Запад)
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
                      <label className="text-xs text-slate-400">Положение зонда Y (Север-Юг)</label>
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
                        Оптимизированный рендеринг: пре-аллоцированные Float32Array буферы, нулевой
                        GC оверхед.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
