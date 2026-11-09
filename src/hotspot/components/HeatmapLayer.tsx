import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';

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
    const rawValues = points.map((p) => p.concentration ?? p.dose ?? p.intensity ?? 1);
    const maxVal = Math.max(...rawValues, 1e-12);

    const interpolatedPoints: [number, number, number][] = [];
    const densePathPoints: { lat: number; lng: number; val: number }[] = [];

    for (let i = 0; i < points.length; i++) {
      const current = points[i];
      const currentVal = current.concentration ?? current.dose ?? current.intensity ?? 0;

      densePathPoints.push({ lat: current.lat, lng: current.lng, val: currentVal });

      if (i < points.length - 1) {
        const next = points[i + 1];
        const nextVal = next.concentration ?? next.dose ?? next.intensity ?? 0;
        const STEPS = 20;

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

      let normVal = Math.pow(p.val / maxVal, 0.35);
      const distFromOrigin = Math.hypot(p.lat - origin.lat, p.lng - origin.lng);
      const spreadRadius = Math.max(0.003, distFromOrigin * 0.25);

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

    const heatLayer = (L as any).heatLayer(interpolatedPoints, {
      radius: 20,
      blur: 14,
      maxZoom: 18,
      max: 1.0,
      minOpacity: 0.35,
      gradient: {
        0.12: '#0000ff',
        0.32: '#00ffff',
        0.52: '#00ff00',
        0.72: '#ffff00',
        0.88: '#ff7700',
        1.00: '#ff0000',
      },
    });

    heatLayer.addTo(map);

    return () => {
      map.removeLayer(heatLayer);
    };
  }, [map, points]);

  return null;
};
