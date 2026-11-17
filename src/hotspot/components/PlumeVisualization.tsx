import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Tooltip,
  Polyline,
  Polygon,
  CircleMarker,
  useMap,
} from "react-leaflet";
import { HeatmapLayer } from "./HeatmapLayer";
import type { DispersionResult } from "../lib/types";
import {
  formatDistance,
  formatActivity,
  formatMixSummary,
  getTotalMixActivityBq,
} from "../lib/dispersion";

interface PlumeVisualizationProps {
  result: DispersionResult;
}

const DOSE_LEGEND = [
  { label: "< 0.1 мЗв", color: "#06b6d4" },
  { label: "0.1–1 мЗв", color: "#10b981" },
  { label: "1–10 мЗв", color: "#eab308" },
  { label: "10–100 мЗв", color: "#f97316" },
  { label: ">= 100 мЗв", color: "#ef4444" },
];

const EARTH_RADIUS_M = 6371000;

function metersToLatLng(
  lat0: number,
  lon0: number,
  xMeters: number,
  yMeters: number,
): [number, number] {
  const dLat = (yMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLon = (xMeters / (EARTH_RADIUS_M * Math.cos((lat0 * Math.PI) / 180))) * (180 / Math.PI);
  return [lat0 + dLat, lon0 + dLon];
}

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const resize = () => map.invalidateSize();
    const timer = setTimeout(resize, 100);
    const timer2 = setTimeout(resize, 500);
    return () => {
      clearTimeout(timer);
      clearTimeout(timer2);
    };
  }, [map]);
  return null;
}

export function PlumeVisualization({ result }: PlumeVisualizationProps) {
  const geoFootprint = result.geoFootprint;
  const isodoseContours = result.isodoseContours ?? [];
  const lat0 = result.input.sourceTerm.latitude;
  const lon0 = result.input.sourceTerm.longitude;
  const windDir = result.input.meteorology.windDirection;

  const heatmapPoints = useMemo(() => {
    if (!geoFootprint || geoFootprint.length === 0) return [];
    return geoFootprint.map((p) => ({
      lat: p.lat,
      lng: p.lon,
      concentration: p.concentration,
      dose: p.dose,
    }));
  }, [geoFootprint]);

  const { zoneCircles, zonePolylines } = useMemo(() => {
    if (geoFootprint.length === 0) {
      return { zoneCircles: [], zonePolylines: [] };
    }

    const zones = [
      { radius: result.zoneSummary.exclusionZone, color: "#ef4444", label: "Exclusion (100 мЗв)" },
      {
        radius: result.zoneSummary.contaminationZone,
        color: "#f59e0b",
        label: "Control (10 мЗв)",
      },
      { radius: result.zoneSummary.ingestionZone, color: "#06b6d4", label: "Monitoring (1 мЗв)" },
    ].filter((z) => z.radius > 0);

    const zonePolys = zones.map((zone) => {
      const points: [number, number][] = [];
      const N = 64;
      for (let i = 0; i <= N; i++) {
        const angle = (i / N) * 2 * Math.PI;
        const x = zone.radius * Math.cos(angle);
        const y = zone.radius * Math.sin(angle);
        points.push(metersToLatLng(lat0, lon0, x, y));
      }
      return { points, color: zone.color, label: zone.label, radius: zone.radius };
    });

    return { zoneCircles: zones, zonePolylines: zonePolys };
  }, [geoFootprint, result.zoneSummary, lat0, lon0]);

  const windArrowEnd = useMemo(() => {
    const arrowLenM = Math.max(2000, Math.min(12000, result.zoneSummary.ingestionZone * 0.85));
    const rad = (windDir * Math.PI) / 180;
    return metersToLatLng(lat0, lon0, arrowLenM * Math.sin(rad), arrowLenM * Math.cos(rad));
  }, [windDir, lat0, lon0, result.zoneSummary.ingestionZone]);

  const isotopeLabel = formatMixSummary(result.input.sourceTerm);
  const activityLabel = formatActivity(getTotalMixActivityBq(result.input.sourceTerm));
  const tooltipText = `${isotopeLabel} | ${activityLabel} | Wind: ${windDir}°`;

  const mapKey = `${lat0},${lon0}`;
  const maxRadius = Math.max(result.zoneSummary.ingestionZone, 5000);
  const zoomLevel = maxRadius > 20000 ? 8 : maxRadius > 5000 ? 9 : maxRadius > 1000 ? 11 : 13;

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="panel p-4 flex-1 flex flex-col" style={{ minHeight: 0 }}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Plume Footprint — Изолинии и карта заражения (1:1)
          </h3>
          <div className="flex items-center gap-3">
            {DOSE_LEGEND.map((c) => (
              <div key={c.label} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: c.color }} />
                <span
                  className="text-xs font-mono tabular-nums"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {c.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          className="flex-1 rounded-lg overflow-hidden"
          style={{ minHeight: 500, backgroundColor: "#1a2230" }}
        >
          <MapContainer
            key={mapKey}
            center={[lat0, lon0]}
            zoom={zoomLevel}
            style={{ height: "100%", width: "100%", backgroundColor: "#1a2230" }}
            scrollWheelZoom={true}
            attributionControl={true}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />

            <MapResizer />

            <HeatmapLayer points={heatmapPoints} />

            {isodoseContours.map((contour) => (
              <Polygon
                key={`iso-${contour.thresholdMsv}`}
                positions={contour.points.map((p) => [p.lat, p.lon] as [number, number])}
                pathOptions={{
                  color: contour.color,
                  fillColor: contour.color,
                  fillOpacity: 0.14,
                  weight: 2,
                  opacity: 0.9,
                }}
              >
                <Tooltip sticky>
                  {contour.label} · {isotopeLabel} ({activityLabel})
                </Tooltip>
              </Polygon>
            ))}

            {zonePolylines.map((zone, i) => (
              <Polyline
                key={`zone-${i}`}
                positions={zone.points}
                pathOptions={{
                  color: zone.color,
                  weight: 1.5,
                  opacity: 0.65,
                  dashArray: "6 4",
                }}
              >
                <Tooltip sticky>
                  {zone.label}: {formatDistance(zone.radius)}
                </Tooltip>
              </Polyline>
            ))}

            <Polyline
              positions={[[lat0, lon0], windArrowEnd]}
              pathOptions={{ color: "#06b6d4", weight: 2.5, opacity: 0.85, dashArray: "4 4" }}
            />

            <CircleMarker
              center={[lat0, lon0]}
              radius={8}
              pathOptions={{ color: "#ef4444", fillColor: "#ef4444", fillOpacity: 1, weight: 2 }}
            >
              <Tooltip permanent direction="top" offset={[0, -10]}>
                {tooltipText}
              </Tooltip>
            </CircleMarker>
          </MapContainer>
        </div>

        <div
          className="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t"
          style={{ borderColor: "var(--border-default)" }}
        >
          {zoneCircles.map((zone, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded-full border-2"
                style={{ borderColor: zone.color, borderStyle: "dashed" }}
              />
              <span
                className="text-xs font-mono tabular-nums"
                style={{ color: "var(--text-secondary)" }}
              >
                {zone.label}: {formatDistance(zone.radius)}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2 ml-auto">
            <div className="w-4 h-1" style={{ backgroundColor: "#06b6d4" }} />
            <span
              className="text-xs font-mono tabular-nums"
              style={{ color: "var(--text-secondary)" }}
            >
              Wind: {windDir}° at {result.input.meteorology.windSpeed} m/s
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
