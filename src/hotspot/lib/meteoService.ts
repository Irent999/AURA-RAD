import type { StabilityClass } from "./types";

export const COMPASS_SECTORS_16 = [
  "С",
  "ССВ",
  "СВ",
  "ВСВ",
  "В",
  "ВЮВ",
  "ЮВ",
  "ЮЮВ",
  "Ю",
  "ЮЮЗ",
  "ЮЗ",
  "ЗЮЗ",
  "З",
  "ЗСЗ",
  "СЗ",
  "ССЗ",
] as const;

export const COMPASS_SECTORS_8 = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"] as const;

export const WIND_SPEED_BINS = [
  { label: "0.5–2 м/с", min: 0.5, max: 2, color: "#06b6d4" },
  { label: "2–5 м/с", min: 2, max: 5, color: "#10b981" },
  { label: "5–8 м/с", min: 5, max: 8, color: "#eab308" },
  { label: "8–12 м/с", min: 8, max: 12, color: "#f97316" },
  { label: ">= 12 м/с", min: 12, max: Infinity, color: "#ef4444" },
] as const;

export interface LiveMeteoObservation {
  timestamp: string;
  latitude: number;
  longitude: number;
  windSpeedMs: number;
  windDirectionDeg: number;
  temperatureC: number;
  pressureHpa: number;
  humidityPct: number;
  precipitationMmh: number;
  source: string;
  stationName: string;
  cached: boolean;
  stale?: boolean;
}

export interface WindHistorySample {
  timestamp: string;
  windSpeedMs: number;
  windDirectionDeg: number;
}

export interface TransportVector {
  windSpeedMs: number;
  meteoAzimuthDeg: number;
  transportAzimuthDeg: number;
  kx: number;
  ky: number;
  uxMs: number;
  uyMs: number;
  cx: number;
  cy: number;
  isCalm: boolean;
}

export interface WindRoseSectorStat {
  sector: string;
  centerDeg: number;
  totalFreqPct: number;
  meanSpeedMs: number;
  binFreqPct: number[];
  sampleCount: number;
}

export interface WindRoseResult {
  sectors: WindRoseSectorStat[];
  calmPct: number;
  dominantMeteoSector: string;
  dominantMeteoDeg: number;
  dominantTransportSector: string;
  dominantTransportDeg: number;
  sampleCount: number;
  meanWindSpeedMs: number;
}

const clientCurrentCache = new Map<string, { value: LiveMeteoObservation; expiresAt: number }>();
const clientHistoryCache = new Map<
  string,
  { value: { source: string; samples: WindHistorySample[]; cached: boolean }; expiresAt: number }
>();

const CLIENT_CURRENT_TTL_MS = 5 * 60 * 1000;
const CLIENT_HISTORY_TTL_MS = 30 * 60 * 1000;

export async function fetchCurrentMeteo(
  lat: number,
  lon: number,
  forceRefresh = false,
): Promise<LiveMeteoObservation> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const now = Date.now();
  const cached = clientCurrentCache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return { ...cached.value, cached: true };
  }

  try {
    const resp = await fetch(
      `/api/meteo?mode=current&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&refresh=${forceRefresh ? "1" : "0"}`,
      { signal: AbortSignal.timeout(9000) },
    );
    if (resp.ok) {
      const data = (await resp.json()) as LiveMeteoObservation;
      clientCurrentCache.set(key, { value: data, expiresAt: now + CLIENT_CURRENT_TTL_MS });
      return data;
    }
  } catch {
    // Fallback to direct CORS-enabled Open-Meteo request
  }

  const directUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,precipitation,surface_pressure,wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=ms&timezone=UTC`;
  const resp = await fetch(directUrl, { signal: AbortSignal.timeout(7000) });
  if (!resp.ok) {
    if (cached) return { ...cached.value, cached: true, stale: true };
    throw new Error(`Ошибка загрузки метеоданных (HTTP ${resp.status})`);
  }
  const payload = (await resp.json()) as {
    latitude?: number;
    longitude?: number;
    current: {
      time: string;
      temperature_2m: number;
      relative_humidity_2m: number;
      precipitation: number;
      surface_pressure: number;
      wind_speed_10m: number;
      wind_direction_10m: number;
    };
  };
  const c = payload.current;
  const obs: LiveMeteoObservation = {
    timestamp: c.time,
    latitude: payload.latitude ?? lat,
    longitude: payload.longitude ?? lon,
    windSpeedMs: Math.max(0, c.wind_speed_10m),
    windDirectionDeg: ((c.wind_direction_10m % 360) + 360) % 360,
    temperatureC: c.temperature_2m,
    pressureHpa: c.surface_pressure,
    humidityPct: c.relative_humidity_2m,
    precipitationMmh: Math.max(0, c.precipitation ?? 0),
    source: "open-meteo.com",
    stationName: "Jizzakh / Tuzkan Grid",
    cached: false,
  };
  clientCurrentCache.set(key, { value: obs, expiresAt: now + CLIENT_CURRENT_TTL_MS });
  return obs;
}

export async function fetchWindHistory(
  lat: number,
  lon: number,
  days = 30,
  forceRefresh = false,
): Promise<{ source: string; samples: WindHistorySample[]; cached: boolean }> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${days}`;
  const now = Date.now();
  const cached = clientHistoryCache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return { ...cached.value, cached: true };
  }

  try {
    const resp = await fetch(
      `/api/meteo?mode=history&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&days=${days}&refresh=${forceRefresh ? "1" : "0"}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (resp.ok) {
      const data = (await resp.json()) as {
        source: string;
        samples: WindHistorySample[];
        cached: boolean;
      };
      clientHistoryCache.set(key, { value: data, expiresAt: now + CLIENT_HISTORY_TTL_MS });
      return data;
    }
  } catch {
    // Fallback to direct archive request
  }

  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end.getTime() - Math.max(1, days - 1) * 86400_000);
  const directUrl =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${start.toISOString().slice(0, 10)}&end_date=${end.toISOString().slice(0, 10)}` +
    `&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=Asia%2FTashkent`;
  const resp = await fetch(directUrl, { signal: AbortSignal.timeout(9000) });
  if (!resp.ok) {
    if (cached) return { ...cached.value, cached: true };
    throw new Error(`Ошибка загрузки архива ветра (HTTP ${resp.status})`);
  }
  const payload = (await resp.json()) as {
    hourly: {
      time: string[];
      wind_speed_10m: (number | null)[];
      wind_direction_10m: (number | null)[];
    };
  };
  const samples: WindHistorySample[] = [];
  for (let i = 0; i < payload.hourly.time.length; i++) {
    const s = payload.hourly.wind_speed_10m[i];
    const d = payload.hourly.wind_direction_10m[i];
    if (s !== null && s !== undefined && d !== null && d !== undefined) {
      samples.push({
        timestamp: payload.hourly.time[i]!,
        windSpeedMs: Math.max(0, s),
        windDirectionDeg: ((d % 360) + 360) % 360,
      });
    }
  }
  const res = { source: "open-meteo-archive", samples, cached: false };
  clientHistoryCache.set(key, { value: res, expiresAt: now + CLIENT_HISTORY_TTL_MS });
  return res;
}

/**
 * Переводит азимут ветра в коэффициенты разложения (kx, ky) для сетки (+X = Восток, +Y = Север).
 * directionConvention = "from" (стандарт WMO/Узгидромет: откуда дует) или "to" (куда направлен шлейф).
 */
export function calculateTransportVector(
  windSpeedMs: number,
  windDirectionDeg: number,
  directionConvention: "from" | "to" = "to",
  calmThresholdMs = 0.5,
): TransportVector {
  const normAngle = ((windDirectionDeg % 360) + 360) % 360;
  const transportAz = directionConvention === "from" ? (normAngle + 180) % 360 : normAngle;
  const meteoAz = directionConvention === "from" ? normAngle : (normAngle + 180) % 360;

  const rad = (transportAz * Math.PI) / 180;
  const kx = Math.sin(rad);
  const ky = Math.cos(rad);
  const cx = Math.cos(rad);
  const cy = -Math.sin(rad);
  const speed = Math.max(0, windSpeedMs);

  return {
    windSpeedMs: speed,
    meteoAzimuthDeg: meteoAz,
    transportAzimuthDeg: transportAz,
    kx,
    ky,
    uxMs: speed * kx,
    uyMs: speed * ky,
    cx,
    cy,
    isCalm: speed < calmThresholdMs,
  };
}

export function estimatePasquillStability(windSpeedMs: number, isDaytime = true): StabilityClass {
  if (isDaytime) {
    if (windSpeedMs < 2) return "A";
    if (windSpeedMs < 3.5) return "B";
    if (windSpeedMs < 5.5) return "C";
    return "D";
  }
  if (windSpeedMs < 2.5) return "F";
  if (windSpeedMs < 4.5) return "E";
  return "D";
}

export function computeWindRose(
  samples: WindHistorySample[],
  nSectors: 8 | 16 = 16,
  calmThresholdMs = 0.5,
): WindRoseResult {
  const labels = nSectors === 16 ? COMPASS_SECTORS_16 : COMPASS_SECTORS_8;
  const stepDeg = 360 / nSectors;
  const totalCount = samples.length;

  const binsCount = WIND_SPEED_BINS.length;
  const sectorCounts = Array.from({ length: nSectors }, () => new Array<number>(binsCount).fill(0));
  const sectorTotals = new Array<number>(nSectors).fill(0);
  const sectorSpeedSums = new Array<number>(nSectors).fill(0);

  let calmCount = 0;
  let speedSumAll = 0;

  for (const s of samples) {
    speedSumAll += s.windSpeedMs;
    if (s.windSpeedMs < calmThresholdMs) {
      calmCount++;
      continue;
    }
    const az = ((s.windDirectionDeg % 360) + 360) % 360;
    const secIdx = Math.floor(((az + stepDeg / 2) % 360) / stepDeg) % nSectors;
    sectorTotals[secIdx]!++;
    sectorSpeedSums[secIdx]! += s.windSpeedMs;

    const binIdx = WIND_SPEED_BINS.findIndex(
      (b) => s.windSpeedMs >= b.min && s.windSpeedMs < b.max,
    );
    if (binIdx >= 0) {
      sectorCounts[secIdx]![binIdx]!++;
    }
  }

  const denom = Math.max(1, totalCount);
  const sectors: WindRoseSectorStat[] = labels.map((label, i) => {
    const cnt = sectorTotals[i]!;
    return {
      sector: label,
      centerDeg: i * stepDeg,
      totalFreqPct: (cnt / denom) * 100,
      meanSpeedMs: cnt > 0 ? sectorSpeedSums[i]! / cnt : 0,
      binFreqPct: sectorCounts[i]!.map((c) => (c / denom) * 100),
      sampleCount: cnt,
    };
  });

  let domIdx = 0;
  for (let i = 1; i < nSectors; i++) {
    if (sectors[i]!.totalFreqPct > sectors[domIdx]!.totalFreqPct) {
      domIdx = i;
    }
  }
  const transportIdx = (domIdx + nSectors / 2) % nSectors;

  return {
    sectors,
    calmPct: (calmCount / denom) * 100,
    dominantMeteoSector: sectors[domIdx]!.sector,
    dominantMeteoDeg: sectors[domIdx]!.centerDeg,
    dominantTransportSector: sectors[transportIdx]!.sector,
    dominantTransportDeg: sectors[transportIdx]!.centerDeg,
    sampleCount: totalCount,
    meanWindSpeedMs: totalCount > 0 ? speedSumAll / totalCount : 0,
  };
}
