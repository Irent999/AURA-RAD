import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";

interface PlumePoint {
  lat: number;
  lng: number;
  dose?: number;
  concentration?: number;
  intensity?: number;
}

interface HeatmapLayerProps {
  points: PlumePoint[];
}

export const HeatmapLayer = ({ points }: HeatmapLayerProps) => {
  const map = useMap();

  useEffect(() => {
    if (!map || !points || points.length === 0) return;

    const origin = points[0];
    const hasDose = points.some((p) => (p.dose ?? 0) > 0);
    const rawValues = points.map((p) =>
      hasDose ? (p.dose ?? 0) : (p.concentration ?? p.intensity ?? 0),
    );
    const maxVal = Math.max(...rawValues, 1e-12);

    const interpolatedPoints: [number, number, number][] = [];
    const densePathPoints: { lat: number; lng: number; val: number }[] = [];

    for (let i = 0; i < points.length; i++) {
      const current = points[i];
      const currentVal = hasDose
        ? (current.dose ?? 0)
        : (current.concentration ?? current.intensity ?? 0);

      densePathPoints.push({ lat: current.lat, lng: current.lng, val: currentVal });

      if (i < points.length - 1) {
        const next = points[i + 1];
        const nextVal = hasDose ? (next.dose ?? 0) : (next.concentration ?? next.intensity ?? 0);
        const STEPS = 14;

        for (let s = 1; s < STEPS; s++) {
          const t = s / STEPS;
          densePathPoints.push({
            lat: current.lat + (next.lat - current.lat) * t,
            lng: current.lng + (next.lng - current.lng) * t,
            val: currentVal + (nextVal - currentVal) * t,
          });
        }
      }
    }

    for (const p of densePathPoints) {
      if (p.val <= 0) continue;

      let normVal: number;
      if (hasDose) {
        const doseMsv = p.val * 1000;
        // Map 0.005 mSv .. 200 mSv onto 0.12 .. 1.0 hazard color ramp
        const absScore = Math.min(
          1,
          Math.max(
            0.08,
            (Math.log10(Math.max(doseMsv, 1e-4)) - Math.log10(0.005)) /
              (Math.log10(200) - Math.log10(0.005)),
          ),
        );
        const relScore = Math.pow(p.val / maxVal, 0.35);
        normVal = 0.65 * absScore + 0.35 * relScore * absScore;
      } else {
        normVal = Math.pow(p.val / maxVal, 0.35);
      }

      const distFromOrigin = Math.hypot(p.lat - origin.lat, p.lng - origin.lng);
      const spreadRadius = Math.max(0.0025, distFromOrigin * 0.22);

      const numRings = 3;
      const pointsPerRing = 8;

      for (let r = 0; r <= numRings; r++) {
        const currentR = (r / numRings) * spreadRadius;
        const ringIntensity = normVal * Math.exp(-Math.pow(r / numRings, 2) * 2.0);

        if (ringIntensity < 0.04) continue;

        const count = r === 0 ? 1 : pointsPerRing;
        for (let a = 0; a < count; a++) {
          const angle = (a / count) * 2 * Math.PI;
          interpolatedPoints.push([
            p.lat + currentR * Math.cos(angle),
            p.lng + currentR * Math.sin(angle),
            ringIntensity,
          ]);
        }
      }
    }

    const leafletWithHeat = L as unknown as {
      heatLayer: (latlngs: [number, number, number][], options: Record<string, unknown>) => L.Layer;
    };
    const heatLayer = leafletWithHeat.heatLayer(interpolatedPoints, {
      radius: 20,
      blur: 14,
      maxZoom: 18,
      max: 1.0,
      minOpacity: 0.35,
      gradient: {
        0.15: "#06b6d4",
        0.35: "#10b981",
        0.55: "#eab308",
        0.75: "#f97316",
        0.92: "#ef4444",
        1.0: "#dc2626",
      },
    });

    heatLayer.addTo(map);

    return () => {
      map.removeLayer(heatLayer);
    };
  }, [map, points]);

  return null;
};
