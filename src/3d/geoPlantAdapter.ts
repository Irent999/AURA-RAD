import * as THREE from "three";
import {
  DEFAULT_PLANT_BEARING_DEG,
  DEFAULT_PLANT_MODEL_SCALE,
  VVER1200_STACK_LOCAL_POS,
  generateVVER1200Plant,
  type VVER1200PlantOptions,
} from "./generateVVER1200Plant";

const EARTH_RADIUS_M = 6371000;

/**
 * Computes the exact geographic (lat, lon) coordinates of the primary VVER-1200
 * ventilation stack top after applying uniform scaleMultiplier and clockwise bearingDeg.
 */
export function getVVER1200StackGeoLocation(
  plantCenterLat: number,
  plantCenterLon: number,
  bearingDeg: number = DEFAULT_PLANT_BEARING_DEG,
  scaleMultiplier: number = DEFAULT_PLANT_MODEL_SCALE,
): { lat: number; lon: number; offsetEastM: number; offsetNorthM: number } {
  const safeScale =
    Number.isFinite(scaleMultiplier) && scaleMultiplier > 0
      ? scaleMultiplier
      : DEFAULT_PLANT_MODEL_SCALE;
  const sx = VVER1200_STACK_LOCAL_POS.x * safeScale;
  const sz = VVER1200_STACK_LOCAL_POS.z * safeScale;

  // Matches Three.js root.rotation.y = -degToRad(bearingDeg) (+X = East, +Z = South)
  const theta = -THREE.MathUtils.degToRad(bearingDeg);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const offsetEastM = sx * cosT + sz * sinT;
  const offsetSouthM = -sx * sinT + sz * cosT;
  const offsetNorthM = -offsetSouthM;

  const dLat = (offsetNorthM / EARTH_RADIUS_M) * (180 / Math.PI);
  const cosLat = Math.max(0.01, Math.cos((plantCenterLat * Math.PI) / 180));
  const dLon = (offsetEastM / (EARTH_RADIUS_M * cosLat)) * (180 / Math.PI);

  return {
    lat: plantCenterLat + dLat,
    lon: plantCenterLon + dLon,
    offsetEastM,
    offsetNorthM,
  };
}

/**
 * Parses numeric geographic coordinate strings supporting both dot (.) and comma (,)
 * decimal separators without snapping intermediate valid edits.
 */
export function parseCoordinateInput(value: string | number, fallback: number = 0): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  const normalized = String(value).trim().replace(/,/g, ".");
  if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") {
    return fallback;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Checks whether a raw coordinate string represents a complete, finite decimal number
 * (supporting both "." and "," decimal separators).
 */
export function isCompleteCoordinateString(raw: string): number | null {
  const normalized = String(raw).trim().replace(/,/g, ".");
  if (!normalized || normalized === "-" || normalized.endsWith(".")) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Computes Web Mercator ground resolution in meters per CSS pixel at latitude `lat` and `zoom`.
 */
export function leafletMetersPerPixel(lat: number, zoom: number): number {
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  return (156543.03392 * Math.cos((clampedLat * Math.PI) / 180)) / Math.pow(2, zoom);
}

export interface MercatorCoordinateLike {
  x: number;
  y: number;
  z?: number;
  meterInMercatorCoordinateUnits(): number;
}

export interface MapLibreLikeMercatorStatic {
  fromLngLat(lngLat: [number, number], altitude?: number): MercatorCoordinateLike;
}

export interface MapboxCustomLayerOptions extends VVER1200PlantOptions {
  id?: string;
  lat: number;
  lon: number;
  /** MapLibre/Mapbox MercatorCoordinate class constructor */
  MercatorCoordinate: MapLibreLikeMercatorStatic;
}

/**
 * Creates a MapLibre GL / Mapbox GL CustomLayerInterface that anchors the 3D VVER-1200 NPP
 * at exact MercatorCoordinate.fromLngLat([lon, lat], 0) scaled by meterInMercatorCoordinateUnits()
 * and synchronized with the map camera matrix on every zoom, pitch, and bearing change.
 */
export function createMapLibreVVER1200CustomLayer(options: MapboxCustomLayerOptions) {
  const {
    id = "aura-vver1200-3d-layer",
    lat,
    lon,
    MercatorCoordinate,
    bearingDeg = DEFAULT_PLANT_BEARING_DEG,
    scaleMultiplier = DEFAULT_PLANT_MODEL_SCALE,
    stackHeight = 185,
  } = options;

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  let renderer: THREE.WebGLRenderer | null = null;
  let currentLat = lat;
  let currentLon = lon;
  let currentBearing = bearingDeg;
  let currentScale = scaleMultiplier;

  const plantGroup = generateVVER1200Plant({
    bearingDeg: 0,
    scaleMultiplier: 1.0,
    stackHeight,
    includeLighting: true,
    enableShadows: false,
  });
  scene.add(plantGroup);

  const _modelMatrix = new THREE.Matrix4();
  const _projMatrix = new THREE.Matrix4();
  const _rotX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const _rotY = new THREE.Matrix4();
  const _scaleMat = new THREE.Matrix4();
  const _transMat = new THREE.Matrix4();

  return {
    id,
    type: "custom" as const,
    renderingMode: "3d" as const,
    setLocation(nextLat: number, nextLon: number) {
      currentLat = nextLat;
      currentLon = nextLon;
    },
    setTransform(nextBearingDeg: number, nextScaleMultiplier: number) {
      currentBearing = nextBearingDeg;
      currentScale = nextScaleMultiplier;
    },
    onAdd(map: { getCanvas(): HTMLCanvasElement }, gl: WebGLRenderingContext) {
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    },
    render(_gl: WebGLRenderingContext, matrix: number[]) {
      if (!renderer) return;
      const mercator = MercatorCoordinate.fromLngLat([currentLon, currentLat], 0);
      const meterUnit = mercator.meterInMercatorCoordinateUnits() * currentScale;

      _transMat.makeTranslation(mercator.x, mercator.y, mercator.z ?? 0);
      _scaleMat.makeScale(meterUnit, -meterUnit, meterUnit);
      _rotY.makeRotationAxis(new THREE.Vector3(0, 1, 0), -THREE.MathUtils.degToRad(currentBearing));

      _modelMatrix.copy(_transMat).multiply(_scaleMat).multiply(_rotX).multiply(_rotY);
      _projMatrix.fromArray(matrix).multiply(_modelMatrix);

      camera.projectionMatrix.copy(_projMatrix);
      renderer.resetState();
      renderer.render(scene, camera);
    },
  };
}
