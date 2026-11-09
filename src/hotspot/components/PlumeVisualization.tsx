import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Tooltip, Polyline, CircleMarker, useMap } from "react-leaflet";
import { HeatmapLayer } from "./HeatmapLayer";
import type { DispersionResult } from "../lib/types";
import { formatDistance, formatActivity } from "../lib/dispersion";

interface PlumeVisualizationProps {
  result: DispersionResult;
}

const COLOR_SCALE = [
  { threshold: 0.75, color: "#7c2d12" },
  { threshold: 0.5, color: "#dc2626" },
  { threshold: 0.25, color: "#f97316" },
  { threshold: 0.1, color: "#eab308" },
  { threshold: 0.05, color: "#84cc16" },
  { threshold: 0.01, color: "#22c55e" },
  { threshold: 0, color: "#06b6d4" },
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
  const lat0 = result.input.sourceTerm.latitude;
  const lon0 = result.input.sourceTerm.longitude;
  const windDir = result.input.meteorology.windDirection;

  // Формируем массив точек для тепловой карты HeatmapLayer
  const heatmapPoints = useMemo(() => {
    if (!geoFootprint || geoFootprint.length === 0) return [];
    return geoFootprint.map((p) => ({
      lat: p.lat,
      lng: p.lon,
      concentration: p.concentration,
    }));
  }, [geoFootprint]);

  const { zoneCircles, zonePolylines } = useMemo(() => {
    if (geoFootprint.length === 0) {
      return { zoneCircles: [], zonePolylines: [] };
    }

    const zones = [
      { radius: result.zoneSummary.exclusionZone, color: "#ef4444", label: "Exclusion" },
      { radius: result.zoneSummary.contaminationZone, color: "#f59e0b", label: "Contamination" },
      { radius: result.zoneSummary.ingestionZone, color: "#3b82f6", label: "Ingestion" },
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
    const arrowLenM = 2000;
    const rad = ((windDir - 90) * Math.PI) / 180;
    return metersToLatLng(lat0, lon0, arrowLenM * Math.cos(rad), arrowLenM * Math.sin(rad));
  }, [windDir, lat0, lon0]);

  const isotopeLabel = result.input.sourceTerm.isotope;
  const activityLabel = formatActivity(result.input.sourceTerm.activity);
  const tooltipText = `${isotopeLabel} | ${activityLabel} | Wind: ${windDir}°`;

  const mapKey = `${lat0},${lon0}`;
  const maxRadius = Math.max(result.zoneSummary.ingestionZone, 5000);
  const zoomLevel = maxRadius > 20000 ? 8 : maxRadius > 5000 ? 9 : maxRadius > 1000 ? 11 : 13;

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="panel p-4 flex-1 flex flex-col" style={{ minHeight: 0 }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Plume Footprint — Geographic Map
          </h3>
          <div className="flex items-center gap-3">
            {COLOR_SCALE.map((c, i) => (
              <div key={i} className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: c.color }} />
                <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                  {c.threshold === 0 ? "<1%" : `${c.threshold * 100}%`}
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

            {/* СПЛОШНОЕ ОБЛАКО РАССЕИВАНИЯ */}
            <HeatmapLayer points={heatmapPoints} />

            {/* ЗОНЫ БЕЗОПАСНОСТИ (ПУНКТИРНЫЕ КРУГИ) */}
            {zonePolylines.map((zone, i) => (
              <Polyline
                key={`zone-${i}`}
                positions={zone.points}
                pathOptions={{
                  color: zone.color,
                  weight: 2,
                  opacity: 0.7,
                  dashArray: "6 4",
                }}
              >
                <Tooltip sticky>
                  {zone.label}: {formatDistance(zone.radius)}
                </Tooltip>
              </Polyline>
            ))}

            {/* ВЕКТОР НАПРАВЛЕНИЯ ВЕТРА */}
            <Polyline
              positions={[[lat0, lon0], windArrowEnd]}
              pathOptions={{ color: "#06b6d4", weight: 3, opacity: 0.8 }}
            />

            {/* ТОЧКА ИСТОЧНИКА ВЫБРОСА */}
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
          className="flex items-center gap-4 mt-3 pt-3 border-t"
          style={{ borderColor: "var(--border-default)" }}
        >
          {zoneCircles.map((zone, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded-full border-2"
                style={{ borderColor: zone.color, borderStyle: "dashed" }}
              />
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {zone.label}: {formatDistance(zone.radius)}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2 ml-auto">
            <div className="w-4 h-1" style={{ backgroundColor: "#06b6d4" }} />
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Wind: {windDir}° at {result.input.meteorology.windSpeed} m/s
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
