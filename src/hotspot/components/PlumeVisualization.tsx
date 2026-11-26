import { useEffect, useMemo, useState } from "react";
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
import { LeafletVVER1200Overlay } from "../../3d/LeafletVVER1200Overlay";
import { NppInspectorModal } from "../../3d/NppInspectorModal";
import { getVVER1200StackGeoLocation } from "../../3d/geoPlantAdapter";
import {
  DEFAULT_PLANT_BEARING_DEG,
  DEFAULT_PLANT_MODEL_SCALE,
} from "../../3d/generateVVER1200Plant";
import type { DispersionInput, DispersionResult } from "../lib/types";
import {
  formatDistance,
  formatActivity,
  formatMixSummary,
  getTotalMixActivityBq,
} from "../lib/dispersion";

interface PlumeVisualizationProps {
  result: DispersionResult;
  input?: DispersionInput;
  setInput?: (input: DispersionInput) => void;
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

function MapResizer({
  flyRequest,
  lat,
  lon,
}: {
  flyRequest: { id: number; zoom: number } | null;
  lat: number;
  lon: number;
}) {
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

  useEffect(() => {
    if (!flyRequest) return;
    map.flyTo([lat, lon], flyRequest.zoom, { duration: 0.7 });
  }, [flyRequest, lat, lon, map]);

  return null;
}

export function PlumeVisualization({ result, input, setInput }: PlumeVisualizationProps) {
  const [show3DPlant, setShow3DPlant] = useState(true);
  const [isDetailed3DVisible, setIsDetailed3DVisible] = useState(false);
  const [isPlantHovered, setIsPlantHovered] = useState(false);
  const [isNppModalOpen, setIsNppModalOpen] = useState(false);
  const [flyRequest, setFlyRequest] = useState<{ id: number; zoom: number } | null>(null);
  const geoFootprint = result.geoFootprint;
  const isodoseContours = result.isodoseContours ?? [];
  const lat0 = result.input.sourceTerm.latitude;
  const lon0 = result.input.sourceTerm.longitude;
  const windDir = result.input.meteorology.windDirection;
  const stackHeightM = Math.max(25, result.input.sourceTerm.releaseHeight || 100);
  const plantModelScale = result.input.sourceTerm.plantModelScale ?? DEFAULT_PLANT_MODEL_SCALE;
  const plantBearingDeg = result.input.sourceTerm.plantBearingDeg ?? DEFAULT_PLANT_BEARING_DEG;

  const stackGeo = getVVER1200StackGeoLocation(lat0, lon0, plantBearingDeg, plantModelScale);
  const releaseLat = result.releaseOrigin?.lat ?? stackGeo.lat;
  const releaseLon = result.releaseOrigin?.lon ?? stackGeo.lon;

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
        points.push(metersToLatLng(releaseLat, releaseLon, x, y));
      }
      return { points, color: zone.color, label: zone.label, radius: zone.radius };
    });

    return { zoneCircles: zones, zonePolylines: zonePolys };
  }, [geoFootprint, result.zoneSummary, releaseLat, releaseLon]);

  const windArrowEnd = useMemo(() => {
    const arrowLenM = Math.max(2000, Math.min(12000, result.zoneSummary.ingestionZone * 0.85));
    const rad = (windDir * Math.PI) / 180;
    return metersToLatLng(
      releaseLat,
      releaseLon,
      arrowLenM * Math.sin(rad),
      arrowLenM * Math.cos(rad),
    );
  }, [windDir, releaseLat, releaseLon, result.zoneSummary.ingestionZone]);

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
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Plume Footprint — Изолинии и карта заражения (1:1)
            </h3>
            <button
              type="button"
              onClick={() => setFlyRequest({ id: Date.now(), zoom: 14 })}
              className="px-2.5 py-1 rounded text-xs font-medium border transition-colors hover:bg-cyan-500/10"
              style={{
                borderColor: "rgba(6, 182, 212, 0.35)",
                color: "var(--accent)",
                backgroundColor: "rgba(6, 182, 212, 0.06)",
              }}
            >
              Приблизить к АЭС (ВВЭР-1200)
            </button>
            <button
              type="button"
              onClick={() => setFlyRequest({ id: Date.now(), zoom: zoomLevel })}
              className="px-2.5 py-1 rounded text-xs border transition-colors"
              style={{
                borderColor: "var(--border-default)",
                color: "var(--text-secondary)",
                backgroundColor: "var(--bg-tertiary)",
              }}
            >
              Весь шлейф
            </button>
            <button
              type="button"
              onClick={() => setShow3DPlant((v) => !v)}
              className="px-2.5 py-1 rounded text-xs border transition-colors"
              style={{
                borderColor: show3DPlant ? "rgba(6, 182, 212, 0.35)" : "var(--border-default)",
                color: show3DPlant ? "var(--accent)" : "var(--text-tertiary)",
                backgroundColor: show3DPlant ? "rgba(6, 182, 212, 0.06)" : "var(--bg-tertiary)",
              }}
            >
              {show3DPlant ? "3D АЭС: Вкл" : "3D АЭС: Выкл"}
            </button>
            <button
              type="button"
              onClick={() => setIsNppModalOpen(true)}
              className="px-2.5 py-1 rounded text-xs font-semibold border transition-colors hover:bg-amber-500/20"
              style={{
                borderColor: "rgba(245, 158, 11, 0.45)",
                color: "#fbbf24",
                backgroundColor: "rgba(245, 158, 11, 0.1)",
              }}
            >
              3D Инспектор АЭС (GLB / МЧС)
            </button>
          </div>
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
          className="relative flex-1 rounded-lg overflow-hidden"
          style={{ minHeight: 500, backgroundColor: "#1a2230" }}
        >
          <MapContainer
            key={mapKey}
            center={[lat0, lon0]}
            zoom={zoomLevel}
            maxZoom={20}
            style={{ height: "100%", width: "100%", backgroundColor: "#1a2230" }}
            scrollWheelZoom={true}
            attributionControl={true}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              maxNativeZoom={19}
              maxZoom={20}
            />

            <MapResizer flyRequest={flyRequest} lat={lat0} lon={lon0} />

            <HeatmapLayer points={heatmapPoints} />

            <LeafletVVER1200Overlay
              lat={lat0}
              lon={lon0}
              stackHeight={stackHeightM}
              bearingDeg={plantBearingDeg}
              scaleMultiplier={plantModelScale}
              windDirectionDeg={windDir}
              visible={show3DPlant}
              minScreenSizePx={0}
              onDetailVisibilityChange={setIsDetailed3DVisible}
              onPlantClick={() => setIsNppModalOpen(true)}
              onPlantHoverChange={setIsPlantHovered}
            />

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
              positions={[[releaseLat, releaseLon], windArrowEnd]}
              pathOptions={{ color: "#06b6d4", weight: 2.5, opacity: 0.85, dashArray: "4 4" }}
            />

            <CircleMarker
              center={[releaseLat, releaseLon]}
              radius={show3DPlant && isDetailed3DVisible ? 4 : 8}
              pathOptions={{
                color: "#ef4444",
                fillColor: "#ef4444",
                fillOpacity: show3DPlant && isDetailed3DVisible ? 0.6 : 1,
                weight: show3DPlant && isDetailed3DVisible ? 1.5 : 2,
              }}
              eventHandlers={{
                click: () => setIsNppModalOpen(true),
              }}
            >
              <Tooltip permanent={!show3DPlant} direction="top" offset={[0, -10]}>
                {tooltipText}
              </Tooltip>
            </CircleMarker>
          </MapContainer>
          {isPlantHovered && show3DPlant && (
            <div className="pointer-events-none absolute bottom-3 left-3 z-[500] px-3 py-1.5 rounded-md border border-cyan-500/40 bg-[#0f172a]/92 text-xs text-cyan-200 shadow-lg">
              Кликните по 3D-модели АЭС для открытия инспектора (GLB, сценарии выброса и режим МЧС)
            </div>
          )}
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

      <NppInspectorModal
        isOpen={isNppModalOpen}
        onClose={() => setIsNppModalOpen(false)}
        lat={lat0}
        lon={lon0}
        windDirectionDeg={windDir}
        windSpeedMs={result.input.meteorology.windSpeed}
        stabilityClass={result.input.meteorology.stabilityClass}
        stackHeightM={stackHeightM}
        bearingDeg={plantBearingDeg}
        calculationType={result.input.calculationType}
        onChangeCalculationType={(mode) => {
          if (input && setInput) {
            setInput({ ...input, calculationType: mode });
          }
        }}
      />
    </div>
  );
}
