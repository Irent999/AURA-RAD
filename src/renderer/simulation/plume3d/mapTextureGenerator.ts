import * as THREE from "three";

export type MapStyleType = "satellite" | "topographic" | "tactical" | "osm";

export interface MapBoundsInfo {
  centerLat: number;
  centerLon: number;
  widthMeters: number;
  heightMeters: number;
  metersPerPixel: number;
}

/**
 * Procedural Realistic Geographic Map Texture Generator
 * Generates calibrated 2048x2048 geographic textures with strict 1:1 metric scale (12km x 12km)
 * centered at the release point (lat0, lon0).
 * Conforms to Three.js zero-404 directive: 100% self-contained procedural rendering.
 */
export function createGeographicMapCanvas(
  style: MapStyleType,
  centerLat: number = 40.212,
  centerLon: number = 68.865,
  sizeMeters: number = 12000,
): { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } {
  const size = 2048;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { alpha: false })!;

  const metersPerPx = sizeMeters / size; // ~5.86 m/px
  const halfSizeM = sizeMeters / 2;

  // Coordinate helper: world (x, z in meters) to canvas (px, py)
  // In Three.js: +X is East, -Z is North
  const toPx = (mX: number) => ((mX + halfSizeM) / sizeMeters) * size;
  const toPy = (mZ: number) => ((mZ + halfSizeM) / sizeMeters) * size;

  if (style === "satellite") {
    renderSatelliteMap(ctx, size, centerLat, centerLon, sizeMeters, toPx, toPy);
  } else if (style === "topographic") {
    renderTopographicMap(ctx, size, centerLat, centerLon, sizeMeters, toPx, toPy);
  } else if (style === "osm") {
    renderOsmMap(ctx, size, centerLat, centerLon, sizeMeters, toPx, toPy);
  } else {
    renderTacticalDarkMap(ctx, size, centerLat, centerLon, sizeMeters, toPx, toPy);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true; // Crucial for immediate WebGL GPU texture upload

  return { canvas, texture };
}

/**
 * Renders realistic satellite aerial imagery with agricultural fields,
 * river & canal hydrography, industrial plant layout, transport network,
 * and settlements with calibrated metric coordinates.
 */
function renderSatelliteMap(
  ctx: CanvasRenderingContext2D,
  size: number,
  centerLat: number,
  centerLon: number,
  sizeMeters: number,
  toPx: (mX: number) => number,
  toPy: (mZ: number) => number,
) {
  const metersPerPx = sizeMeters / size; // ~5.86 m/px

  // 1. Terrain Base (varied agricultural land & arid soil albedo)
  ctx.fillStyle = "#1e261d"; // Dark natural earth/vegetation base
  ctx.fillRect(0, 0, size, size);

  // Procedural agricultural fields grid with rotation and varied tones
  const fieldColors = [
    "#253123", // Dark green pasture
    "#2f3c2c", // Forest/shrub
    "#3a3d2e", // Arid grassland
    "#3c3726", // Dry plowed soil
    "#463f2d", // Ochre crop
    "#263427", // Irrigated crop
    "#313d2f", // Fresh foliage
    "#393627", // Fallow field
  ];

  // Draw irregular agricultural mosaic
  const cols = 28;
  const rows = 28;
  const cw = size / cols;
  const rh = size / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Don't draw over plant epicenter
      const cx = (c + 0.5) * cw;
      const cy = (r + 0.5) * rh;
      const distFromCenter = Math.hypot(cx - size / 2, cy - size / 2);
      if (distFromCenter < 140) continue; // Industrial zone

      const colorIdx = Math.abs(Math.sin(c * 12.9898 + r * 78.233) * 1000) % fieldColors.length;
      ctx.fillStyle = fieldColors[Math.floor(colorIdx)]!;

      const jitterX = Math.sin(c * 3.7 + r * 5.1) * cw * 0.15;
      const jitterY = Math.cos(r * 4.3 + c * 2.9) * rh * 0.15;

      ctx.fillRect(c * cw + jitterX, r * rh + jitterY, cw * 0.96, rh * 0.96);

      // Fine field tracks / hedgerows
      ctx.strokeStyle = "rgba(10, 15, 10, 0.35)";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(c * cw + jitterX, r * rh + jitterY, cw * 0.96, rh * 0.96);
    }
  }

  // 2. Natural River & Cooling Water Reservoir (Hydrography)
  // Main river winding from North-West to South-East
  ctx.save();
  ctx.beginPath();
  const riverPoints = [
    { x: -5800, z: -3500 },
    { x: -4200, z: -2800 },
    { x: -2800, z: -3200 },
    { x: -1400, z: -2400 },
    { x: 300, z: -2100 },
    { x: 1800, z: -1700 },
    { x: 3200, z: -1200 },
    { x: 4400, z: 200 },
    { x: 5800, z: 1200 },
  ];

  ctx.moveTo(toPx(riverPoints[0]!.x), toPy(riverPoints[0]!.z));
  for (let i = 1; i < riverPoints.length; i++) {
    const prev = riverPoints[i - 1]!;
    const cur = riverPoints[i]!;
    const midX = (prev.x + cur.x) / 2;
    const midZ = (prev.z + cur.z) / 2;
    ctx.quadraticCurveTo(toPx(prev.x), toPy(prev.z), toPx(midX), toPy(midZ));
  }
  ctx.quadraticCurveTo(
    toPx(riverPoints[riverPoints.length - 1]!.x),
    toPy(riverPoints[riverPoints.length - 1]!.z),
    toPx(riverPoints[riverPoints.length - 1]!.x),
    toPy(riverPoints[riverPoints.length - 1]!.z),
  );

  // Riverbed banks (wet sand / mud)
  ctx.strokeStyle = "#1b332c";
  ctx.lineWidth = 55;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();

  // Water body
  ctx.strokeStyle = "#143743";
  ctx.lineWidth = 42;
  ctx.stroke();

  // River water highlights
  ctx.strokeStyle = "#1a4656";
  ctx.lineWidth = 14;
  ctx.stroke();
  ctx.restore();

  // Cooling Pond (Reservoir) North-East of Plant
  const pondX = toPx(1100);
  const pondZ = toPy(-1100);
  ctx.fillStyle = "#1b332c";
  ctx.beginPath();
  ctx.ellipse(pondX, pondZ, 95, 65, Math.PI / 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#143743";
  ctx.beginPath();
  ctx.ellipse(pondX, pondZ, 80, 50, Math.PI / 6, 0, Math.PI * 2);
  ctx.fill();

  // Intake / discharge canals
  ctx.strokeStyle = "#143743";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(toPx(200), toPy(-150));
  ctx.lineTo(toPx(800), toPy(-950));
  ctx.stroke();

  // 3. Regional Road Network
  // Highway (Federal / Regional Route)
  ctx.strokeStyle = "#383f47";
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(toPx(-5800), toPy(2600));
  ctx.lineTo(toPx(-1200), toPy(2100));
  ctx.lineTo(toPx(2400), toPy(2800));
  ctx.lineTo(toPx(5800), toPy(3400));
  ctx.stroke();

  // Highway yellow central line
  ctx.strokeStyle = "#7c7247";
  ctx.lineWidth = 2;
  ctx.setLineDash([12, 12]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arterial industrial access road to plant
  ctx.strokeStyle = "#474f57";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(toPx(-1200), toPy(2100));
  ctx.lineTo(toPx(-400), toPy(600));
  ctx.lineTo(toPx(0), toPy(0));
  ctx.stroke();

  // Ring bypass road around Exclusion Zone (at ~1.2 km)
  ctx.strokeStyle = "#2d353c";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(toPx(0), toPy(0), 1200 / metersPerPx, 0, Math.PI * 2);
  ctx.stroke();

  // Secondary rural roads
  ctx.strokeStyle = "#2e3430";
  ctx.lineWidth = 4;
  const secondaryRoads = [
    [
      [-4500, -1500],
      [-3000, 500],
      [-1200, 2100],
    ],
    [
      [1800, -1700],
      [2800, -800],
      [4200, 500],
    ],
    [
      [0, 0],
      [2200, 1500],
      [3800, 2200],
    ],
    [
      [-2000, -4500],
      [-1000, -3200],
      [300, -2100],
    ],
  ];
  secondaryRoads.forEach((pts) => {
    ctx.beginPath();
    ctx.moveTo(toPx(pts[0]![0]), toPy(pts[0]![1]));
    for (let k = 1; k < pts.length; k++) {
      ctx.lineTo(toPx(pts[k]![0]), toPy(pts[k]![1]));
    }
    ctx.stroke();
  });

  // 4. Populated Settlements / Villages
  // Settlement 1: "Пос. Заречье" (Zarechye) at X = -3200m, Z = -2200m (~3.8 km)
  renderSettlement(ctx, toPx(-3200), toPy(-2200), 180, 130, "Пос. Заречье (3.8 км)");

  // Settlement 2: "Пос. Энергетик" (Energetik) at X = 2600m, Z = 2400m (~3.5 km)
  renderSettlement(ctx, toPx(2600), toPy(2400), 220, 160, "Пос. Энергетик (3.5 км)");

  // Settlement 3: "Дер. Сосново" (Sosnovo) at X = -4200m, Z = 3000m (~5.1 km)
  renderSettlement(ctx, toPx(-4200), toPy(3000), 140, 110, "Дер. Сосново (5.1 км)");

  // 5. Nuclear Power Plant / Nuclear Complex Site Footprint at Center (0, 0)
  const siteHalfM = 400; // 800m x 800m protected site
  const siteL = toPx(-siteHalfM);
  const siteT = toPy(-siteHalfM);
  const siteW = (siteHalfM * 2) / metersPerPx;
  const siteH = (siteHalfM * 2) / metersPerPx;

  // Site base pad (compacted asphalt / concrete industrial apron)
  ctx.fillStyle = "#2c343f";
  ctx.fillRect(siteL, siteT, siteW, siteH);

  // Security Perimeter Double Fence
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(siteL, siteT, siteW, siteH);
  ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
  ctx.lineWidth = 1.0;
  ctx.strokeRect(siteL - 6, siteT - 6, siteW + 12, siteH + 12);

  // Building footprints
  ctx.fillStyle = "#475569";
  // Reactor building #1
  ctx.fillRect(toPx(-60), toPy(-60), 120 / metersPerPx, 120 / metersPerPx);
  // Turbine Hall
  ctx.fillStyle = "#64748b";
  ctx.fillRect(toPx(70), toPy(-120), 180 / metersPerPx, 80 / metersPerPx);
  // Electrical Switchyard
  ctx.fillStyle = "#334155";
  ctx.fillRect(toPx(-280), toPy(-180), 150 / metersPerPx, 140 / metersPerPx);
  // Administration building
  ctx.fillStyle = "#526071";
  ctx.fillRect(toPx(-180), toPy(120), 140 / metersPerPx, 60 / metersPerPx);

  // Cooling towers footprint (circular rings)
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(toPx(240), toPy(160), 45 / metersPerPx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(toPx(360), toPy(160), 45 / metersPerPx, 0, Math.PI * 2);
  ctx.stroke();

  // Facility Label
  ctx.font = "bold 16px Inter, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText("АЭС / ЭПИЦЕНТР ВЫБРОСА", toPx(0), toPy(260));

  // 6. Calibrated Coordinate & Metric Grid Overlay
  renderCartographicGrid(ctx, size, centerLat, centerLon, sizeMeters, toPx, toPy);
}

/**
 * Topographic map with elevation isolines, hillshading, forest tints,
 * and standard geodetic contour symbology.
 */
function renderTopographicMap(
  ctx: CanvasRenderingContext2D,
  size: number,
  centerLat: number,
  centerLon: number,
  sizeMeters: number,
  toPx: (mX: number) => number,
  toPy: (mZ: number) => number,
) {
  // Pale topo paper base
  ctx.fillStyle = "#18201e";
  ctx.fillRect(0, 0, size, size);

  // Topographic elevation contour lines (procedural concentric hills)
  const hills = [
    { x: -3500, z: -3500, h: 420, r: 2400 },
    { x: 3800, z: -2500, h: 390, r: 2200 },
    { x: 4200, z: 3600, h: 440, r: 2800 },
    { x: -4500, z: 3200, h: 360, r: 2000 },
  ];

  ctx.strokeStyle = "rgba(180, 160, 120, 0.25)";
  ctx.lineWidth = 1.2;

  hills.forEach((hill) => {
    const numRings = 10;
    for (let r = 1; r <= numRings; r++) {
      const ringRadius = (r / numRings) * (hill.r / (sizeMeters / size));
      ctx.beginPath();
      ctx.ellipse(toPx(hill.x), toPy(hill.z), ringRadius, ringRadius * 0.85, 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  // Topo rivers & streams
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(toPx(-5800), toPy(-3200));
  ctx.bezierCurveTo(toPx(-2000), toPy(-2800), toPx(1000), toPy(-1800), toPx(5800), toPy(1400));
  ctx.stroke();

  // Topo Roads (Orange/Yellow standard cartographic routes)
  ctx.strokeStyle = "#d97706";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(toPx(-5800), toPy(2600));
  ctx.lineTo(toPx(-1200), toPy(2100));
  ctx.lineTo(toPx(2400), toPy(2800));
  ctx.lineTo(toPx(5800), toPy(3400));
  ctx.stroke();

  // Settlements
  renderSettlement(ctx, toPx(-3200), toPy(-2200), 160, 110, "Заречье");
  renderSettlement(ctx, toPx(2600), toPy(2400), 190, 140, "Энергетик");

  // Plant outline
  ctx.fillStyle = "#374151";
  ctx.fillRect(toPx(-300), toPy(-300), 600 / (sizeMeters / size), 600 / (sizeMeters / size));
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 2;
  ctx.strokeRect(toPx(-300), toPy(-300), 600 / (sizeMeters / size), 600 / (sizeMeters / size));

  renderCartographicGrid(ctx, size, centerLat, centerLon, sizeMeters, toPx, toPy);
}

/**
 * Tactical Dark Radar Map with military symbology, range rings,
 * compass azimuths, and high contrast for night / incident operations.
 */
function renderTacticalDarkMap(
  ctx: CanvasRenderingContext2D,
  size: number,
  centerLat: number,
  centerLon: number,
  sizeMeters: number,
  toPx: (mX: number) => number,
  toPy: (mZ: number) => number,
) {
  ctx.fillStyle = "#0a0f18";
  ctx.fillRect(0, 0, size, size);

  // Tactical radar rings every 1 km
  const ringDistances = [500, 1000, 2000, 3000, 4000, 5000];
  ctx.strokeStyle = "rgba(6, 182, 212, 0.22)";
  ctx.lineWidth = 1.5;

  ringDistances.forEach((dist) => {
    const rPx = dist / (sizeMeters / size);
    ctx.beginPath();
    ctx.arc(toPx(0), toPy(0), rPx, 0, Math.PI * 2);
    ctx.stroke();

    // Range distance label
    ctx.font = "bold 13px monospace";
    ctx.fillStyle = "rgba(6, 182, 212, 0.75)";
    ctx.textAlign = "left";
    ctx.fillText(`${(dist / 1000).toFixed(1)} км`, toPx(dist) + 4, toPy(0) - 4);
  });

  // Azimuth crosshairs (North, South, East, West)
  ctx.strokeStyle = "rgba(6, 182, 212, 0.35)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(toPx(0), 0);
  ctx.lineTo(toPx(0), size);
  ctx.moveTo(0, toPy(0));
  ctx.lineTo(size, toPy(0));
  ctx.stroke();

  // Subtle river outline
  ctx.strokeStyle = "rgba(30, 58, 138, 0.6)";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(toPx(-5800), toPy(-3200));
  ctx.bezierCurveTo(toPx(-2000), toPy(-2800), toPx(1000), toPy(-1800), toPx(5800), toPy(1400));
  ctx.stroke();

  // Plant box
  ctx.fillStyle = "rgba(239, 68, 68, 0.25)";
  ctx.fillRect(toPx(-300), toPy(-300), 600 / (sizeMeters / size), 600 / (sizeMeters / size));
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 2;
  ctx.strokeRect(toPx(-300), toPy(-300), 600 / (sizeMeters / size), 600 / (sizeMeters / size));

  renderCartographicGrid(ctx, size, centerLat, centerLon, sizeMeters, toPx, toPy);
}

/**
 * Draws residential settlement street grid & building blocks
 */
function renderSettlement(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  w: number,
  h: number,
  name: string,
) {
  ctx.save();
  // Settlement boundary polygon
  ctx.fillStyle = "rgba(55, 65, 81, 0.75)";
  ctx.fillRect(px - w / 2, py - h / 2, w, h);

  // Streets
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(px - w / 2, py);
  ctx.lineTo(px + w / 2, py);
  ctx.moveTo(px, py - h / 2);
  ctx.lineTo(px, py + h / 2);
  ctx.stroke();

  // Individual building blocks
  ctx.fillStyle = "#94a3b8";
  const numBuildings = 14;
  for (let b = 0; b < numBuildings; b++) {
    const bx = px - w / 2 + 15 + ((b * 37) % (w - 30));
    const by = py - h / 2 + 12 + ((b * 29) % (h - 24));
    ctx.fillRect(bx, by, 10, 8);
  }

  // Label
  ctx.font = "bold 13px Inter, sans-serif";
  ctx.fillStyle = "#f8fafc";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
  ctx.lineWidth = 3;
  ctx.textAlign = "center";
  ctx.strokeText(name, px, py + h / 2 + 16);
  ctx.fillText(name, px, py + h / 2 + 16);
  ctx.restore();
}

/**
 * Renders calibrated 1-km metric grid and geographic lat/lon ticks
 */
function renderCartographicGrid(
  ctx: CanvasRenderingContext2D,
  size: number,
  centerLat: number,
  centerLon: number,
  sizeMeters: number,
  toPx: (mX: number) => number,
  toPy: (mZ: number) => number,
) {
  ctx.save();
  // 1 km Metric Grid Lines
  ctx.strokeStyle = "rgba(148, 163, 184, 0.15)";
  ctx.lineWidth = 1;

  for (let m = -5000; m <= 5000; m += 1000) {
    if (m === 0) continue; // Skip center axis
    // Vertical grid line (East-West distance)
    const gx = toPx(m);
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, size);
    ctx.stroke();

    // Horizontal grid line (North-South distance)
    const gy = toPy(m);
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(size, gy);
    ctx.stroke();

    // Metric coordinate labels
    ctx.font = "11px monospace";
    ctx.fillStyle = "rgba(148, 163, 184, 0.45)";
    ctx.textAlign = "center";
    ctx.fillText(`${m > 0 ? "+" : ""}${m / 1000} км`, gx, size - 8);
    ctx.textAlign = "left";
    ctx.fillText(`${m > 0 ? "+" : ""}${m / 1000} км`, 8, gy - 4);
  }

  // Geographic Lat/Lon Corner Watermark
  ctx.font = "12px monospace";
  ctx.fillStyle = "rgba(226, 232, 240, 0.75)";
  ctx.textAlign = "right";
  ctx.fillText(
    `ЦЕНТР: ${centerLat.toFixed(3)}° N, ${centerLon.toFixed(3)}° E · МАСШТАБ 1:1 (12×12 км)`,
    size - 16,
    24,
  );

  // Graphic Scale Bar at bottom left
  const scaleBarLenM = 1000; // 1 km bar
  const scaleBarLenPx = scaleBarLenM / (sizeMeters / size);
  const barX = 24;
  const barY = size - 36;

  ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
  ctx.fillRect(barX - 8, barY - 20, scaleBarLenPx + 50, 36);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(barX, barY, scaleBarLenPx / 2, 4);
  ctx.fillStyle = "#06b6d4";
  ctx.fillRect(barX + scaleBarLenPx / 2, barY, scaleBarLenPx / 2, 4);

  ctx.font = "bold 11px monospace";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.fillText("0", barX, barY - 6);
  ctx.fillText("500м", barX + scaleBarLenPx / 2 - 12, barY - 6);
  ctx.fillText("1 км", barX + scaleBarLenPx - 10, barY - 6);

  ctx.restore();
}

/**
 * OpenStreetMap cartographic layout with light clean terrain,
 * distinct highway hierarchies, waterways, green park zones, and settlements.
 */
function renderOsmMap(
  ctx: CanvasRenderingContext2D,
  size: number,
  centerLat: number,
  centerLon: number,
  sizeMeters: number,
  toPx: (mX: number) => number,
  toPy: (mZ: number) => number,
) {
  // Light carto neutral ground
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(0, 0, size, size);

  // Green park / forest zones
  ctx.fillStyle = "#cbd5e1";
  ctx.fillRect(toPx(-5200), toPy(-4800), 3200, 2400);
  ctx.fillRect(toPx(1800), toPy(-3600), 2800, 2200);
  ctx.fillRect(toPx(-4200), toPy(1200), 2400, 3600);

  // River & water bodies (OSM blue)
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 28;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(toPx(-5800), toPy(-3200));
  ctx.bezierCurveTo(toPx(-2000), toPy(-2800), toPx(1000), toPy(-1800), toPx(5800), toPy(1400));
  ctx.stroke();

  // Cooling reservoir
  ctx.fillStyle = "#38bdf8";
  ctx.beginPath();
  ctx.ellipse(toPx(750), toPy(-900), 140, 80, Math.PI / 6, 0, Math.PI * 2);
  ctx.fill();

  // Major Highway (Orange/Yellow)
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(toPx(-5800), toPy(2600));
  ctx.lineTo(toPx(-1200), toPy(2100));
  ctx.lineTo(toPx(2400), toPy(2800));
  ctx.lineTo(toPx(5800), toPy(3400));
  ctx.stroke();

  // Plant access road
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(toPx(-1200), toPy(2100));
  ctx.lineTo(toPx(-400), toPy(600));
  ctx.lineTo(toPx(0), toPy(0));
  ctx.stroke();

  // Settlements
  renderSettlement(ctx, toPx(-3200), toPy(-2200), 160, 110, "Заречье");
  renderSettlement(ctx, toPx(2600), toPy(2400), 190, 140, "Энергетик");
  renderSettlement(ctx, toPx(3800), toPy(-1200), 150, 95, "Сосново");

  // Reactor perimeter boundary
  ctx.fillStyle = "#94a3b8";
  ctx.fillRect(toPx(-300), toPy(-300), 600 / (sizeMeters / size), 600 / (sizeMeters / size));
  ctx.strokeStyle = "#dc2626";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(toPx(-300), toPy(-300), 600 / (sizeMeters / size), 600 / (sizeMeters / size));

  // Facility Text
  ctx.font = "bold 15px Inter, sans-serif";
  ctx.fillStyle = "#0f172a";
  ctx.textAlign = "center";
  ctx.fillText("АЭС / ИСТОЧНИК ВЫБРОСА", toPx(0), toPy(240));

  renderCartographicGrid(ctx, size, centerLat, centerLon, sizeMeters, toPx, toPy);
}

/**
 * Procedural fail-safe high-contrast coordinate grid texture
 * to guarantee that a black square is NEVER rendered even in extreme failure modes.
 */
export function createFallbackGridTexture(sizeMeters: number = 12000): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "#0ea5e9";
  ctx.lineWidth = 2;
  const step = size / 12;
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }

  // Epicenter crosshair
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 40, 0, Math.PI * 2);
  ctx.moveTo(size / 2 - 60, size / 2);
  ctx.lineTo(size / 2 + 60, size / 2);
  ctx.moveTo(size / 2, size / 2 - 60);
  ctx.lineTo(size / 2, size / 2 + 60);
  ctx.stroke();

  ctx.font = "bold 14px monospace";
  ctx.fillStyle = "#f8fafc";
  ctx.textAlign = "center";
  ctx.fillText("РЕЗЕРВНАЯ КООРДИНАТНАЯ СЕТКА (12×12 км)", size / 2, size / 2 + 80);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Robust asynchronous texture loader with TextureLoader, CORS support,
 * error handling and guaranteed procedural fallback so a black ground is NEVER displayed.
 */
export function loadMapTextureAsync(
  style: MapStyleType,
  centerLat: number = 40.212,
  centerLon: number = 68.865,
  sizeMeters: number = 12000,
  customUrl?: string,
  onLoaded?: (texture: THREE.Texture) => void,
  onError?: (err: unknown) => void,
): THREE.Texture {
  // Always produce a valid procedural texture first for immediate display
  const { texture: proceduralTexture } = createGeographicMapCanvas(
    style,
    centerLat,
    centerLon,
    sizeMeters,
  );

  if (!customUrl) {
    if (onLoaded) onLoaded(proceduralTexture);
    return proceduralTexture;
  }

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  loader.load(
    customUrl,
    (loadedTexture) => {
      loadedTexture.colorSpace = THREE.SRGBColorSpace;
      loadedTexture.wrapS = THREE.ClampToEdgeWrapping;
      loadedTexture.wrapT = THREE.ClampToEdgeWrapping;
      loadedTexture.generateMipmaps = true;
      loadedTexture.minFilter = THREE.LinearMipmapLinearFilter;
      loadedTexture.magFilter = THREE.LinearFilter;
      loadedTexture.needsUpdate = true;
      if (onLoaded) onLoaded(loadedTexture);
    },
    undefined,
    (err) => {
      console.warn(
        "External map texture loading failed (network/CORS/format). Reverting to procedural calibrated map:",
        err,
      );
      if (onError) onError(err);
      if (onLoaded) onLoaded(proceduralTexture);
    },
  );

  return proceduralTexture;
}
