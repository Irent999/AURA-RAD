import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

interface MeteoApiObservation {
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

interface WindHistorySample {
  timestamp: string;
  windSpeedMs: number;
  windDirectionDeg: number;
}

const currentCache = new Map<string, { value: MeteoApiObservation; expiresAt: number }>();
const historyCache = new Map<
  string,
  { value: { source: string; samples: WindHistorySample[] }; expiresAt: number }
>();

const CURRENT_TTL_MS = 5 * 60 * 1000;
const HISTORY_TTL_MS = 30 * 60 * 1000;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function pickNumber(obj: Record<string, unknown>, keys: string[], fallback?: number): number {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number" && Number.isFinite(val)) return val;
    if (typeof val === "string" && val.trim() !== "" && Number.isFinite(Number(val))) {
      return Number(val);
    }
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing numeric field among ${keys.join(", ")}`);
}

async function fetchUzhydromet(lat: number, lon: number): Promise<MeteoApiObservation> {
  const url = `https://data.meteo.uz/api/v1/weather/current?lat=${lat}&lon=${lon}`;
  const resp = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "AURA-RAD-Server/1.0" },
    signal: AbortSignal.timeout(3000),
  });
  if (!resp.ok) throw new Error(`Uzhydromet HTTP ${resp.status}`);
  const raw = (await resp.json()) as unknown;
  const unwrapped =
    raw && typeof raw === "object" && "data" in raw ? (raw as { data: unknown }).data : raw;

  let record: Record<string, unknown> | undefined;
  if (Array.isArray(unwrapped)) {
    const objs = unwrapped.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
    );
    if (objs.length > 0) {
      record = objs.reduce((best, cur) => {
        const bDist = haversineKm(
          lat,
          lon,
          pickNumber(best, ["lat", "latitude"], lat),
          pickNumber(best, ["lon", "longitude"], lon),
        );
        const cDist = haversineKm(
          lat,
          lon,
          pickNumber(cur, ["lat", "latitude"], lat),
          pickNumber(cur, ["lon", "longitude"], lon),
        );
        return cDist < bDist ? cur : best;
      });
    }
  } else if (unwrapped && typeof unwrapped === "object") {
    record = unwrapped as Record<string, unknown>;
  }

  if (!record) throw new Error("Empty Uzhydromet payload");

  const windSpeed = Math.max(
    0,
    pickNumber(record, ["wind_speed", "wind_s", "windSpeed", "ws", "wind_speed_ms"]),
  );
  const windDir =
    ((pickNumber(record, ["wind_dir", "wind_direction", "windDirection", "wd", "wind_d"], 0) %
      360) +
      360) %
    360;
  const temp = pickNumber(record, ["air_t", "temperature", "temp", "t", "airTemperature"]);
  let pressure = pickNumber(record, ["pressure", "press", "surface_pressure", "p_hpa"], 1013.25);
  if (pressure < 850) pressure *= 1.33322;
  const humidity = Math.min(
    100,
    Math.max(0, pickNumber(record, ["humidity", "rh", "relative_humidity", "air_humidity"], 50)),
  );
  const precip = Math.max(0, pickNumber(record, ["precipitation", "precip", "rain"], 0));
  const station = String(record.station_name ?? record.title ?? record.city ?? "Узгидромет");
  const ts = String(
    record.datetime ?? record.updated_at ?? record.time ?? new Date().toISOString(),
  );

  return {
    timestamp: ts,
    latitude: pickNumber(record, ["lat", "latitude"], lat),
    longitude: pickNumber(record, ["lon", "longitude"], lon),
    windSpeedMs: windSpeed,
    windDirectionDeg: windDir,
    temperatureC: temp,
    pressureHpa: Math.round(pressure * 10) / 10,
    humidityPct: humidity,
    precipitationMmh: precip,
    source: "data.meteo.uz",
    stationName: station,
    cached: false,
  };
}

async function fetchOpenMeteoCurrent(lat: number, lon: number): Promise<MeteoApiObservation> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,precipitation,surface_pressure,wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=ms&timezone=UTC`;
  const resp = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "AURA-RAD-Server/1.0" },
    signal: AbortSignal.timeout(7000),
  });
  if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
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
  return {
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
}

async function fetchOpenMeteoHistory(
  lat: number,
  lon: number,
  days: number,
): Promise<{ source: string; samples: WindHistorySample[] }> {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end.getTime() - Math.max(1, days - 1) * 86400_000);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);

  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${startStr}&end_date=${endStr}&hourly=wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=ms&timezone=Asia%2FTashkent`;
  const resp = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "AURA-RAD-Server/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`Open-Meteo Archive HTTP ${resp.status}`);
  const payload = (await resp.json()) as {
    hourly: {
      time: string[];
      wind_speed_10m: (number | null)[];
      wind_direction_10m: (number | null)[];
    };
  };
  const samples: WindHistorySample[] = [];
  const { time, wind_speed_10m, wind_direction_10m } = payload.hourly;
  for (let i = 0; i < time.length; i++) {
    const s = wind_speed_10m[i];
    const d = wind_direction_10m[i];
    if (s !== null && s !== undefined && d !== null && d !== undefined) {
      samples.push({
        timestamp: time[i]!,
        windSpeedMs: Math.max(0, s),
        windDirectionDeg: ((d % 360) + 360) % 360,
      });
    }
  }
  return { source: "open-meteo-archive", samples };
}

async function handleMeteoApi(url: URL): Promise<Response> {
  const mode = url.searchParams.get("mode") ?? "current";
  const lat = Number(url.searchParams.get("lat") ?? "40.7084");
  const lon = Number(url.searchParams.get("lon") ?? "67.1584");
  const refresh = url.searchParams.get("refresh") === "1";

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json({ error: "Invalid lat/lon" }, { status: 400 });
  }

  if (mode === "history") {
    const days = Math.min(90, Math.max(3, Number(url.searchParams.get("days") ?? "30")));
    const key = `${lat.toFixed(2)},${lon.toFixed(2)},${days}`;
    const now = Date.now();
    const cached = historyCache.get(key);
    if (!refresh && cached && cached.expiresAt > now) {
      return Response.json({ ...cached.value, cached: true });
    }
    try {
      const data = await fetchOpenMeteoHistory(lat, lon, days);
      historyCache.set(key, { value: data, expiresAt: now + HISTORY_TTL_MS });
      return Response.json({ ...data, cached: false });
    } catch (err) {
      if (cached) {
        return Response.json({ ...cached.value, cached: true, stale: true });
      }
      return Response.json(
        { error: err instanceof Error ? err.message : "Failed to load wind history" },
        { status: 502 },
      );
    }
  }

  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const now = Date.now();
  const cached = currentCache.get(key);
  if (!refresh && cached && cached.expiresAt > now) {
    return Response.json({ ...cached.value, cached: true });
  }

  try {
    let obs: MeteoApiObservation;
    try {
      obs = await fetchUzhydromet(lat, lon);
    } catch {
      obs = await fetchOpenMeteoCurrent(lat, lon);
    }
    currentCache.set(key, { value: obs, expiresAt: now + CURRENT_TTL_MS });
    return Response.json(obs);
  } catch (err) {
    if (cached) {
      return Response.json({ ...cached.value, cached: true, stale: true });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to fetch live weather" },
      { status: 502 },
    );
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);
    if (url.pathname === "/api/meteo") {
      return handleMeteoApi(url);
    }

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
