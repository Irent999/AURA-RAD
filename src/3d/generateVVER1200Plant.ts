import * as THREE from "three";

export interface VVER1200PlantOptions {
  /** Azimuth rotation in degrees (clockwise from North). Default: 330 (-30°, SW-NE axis) */
  bearingDeg?: number;
  /** Uniform model scale multiplier (1.0 = 1 unit = 1 meter). Default: 1.2 */
  scaleMultiplier?: number;
  /** Ventilation stack height in meters. Default: 185 */
  stackHeight?: number;
  /** Whether to attach AmbientLight & DirectionalLight to the returned Group. Default: true */
  includeLighting?: boolean;
  /** Whether meshes cast/receive shadows. Default: true */
  enableShadows?: boolean;
  /** Whether to generate procedural CanvasTextures (set false for headless Node GLB export). Default: true */
  includeTextures?: boolean;
  /** Whether to use InstancedMesh for tower struts (set false for broad GLB viewer compatibility). Default: true */
  useInstancing?: boolean;
}

export interface VVER1200PlantMetadata {
  /** Local coordinates of the ventilation stack base (meters, relative to group origin) */
  stackBaseLocal: THREE.Vector3;
  /** Local coordinates of the ventilation stack emission tip (meters, relative to group origin) */
  stackTopLocal: THREE.Vector3;
  /** Ventilation stack height in meters */
  stackHeightMeters: number;
  /** Characteristic horizontal span of the L-shaped NPP complex in meters (~1920m) */
  footprintSpanMeters: number;
  /** Aviation obstruction beacon meshes for blinking animation */
  beaconMeshes: THREE.Mesh[];
  /** Procedural textures created for disposal tracking */
  textures: THREE.Texture[];
}

export const PLANT_FOOTPRINT_SPAN_METERS = 1920;
export const DEFAULT_PLANT_BEARING_DEG = 330; // -30° clockwise (SW–NE main wing, NW auxiliary wing)
export const DEFAULT_PLANT_MODEL_SCALE = 1.2;

/** Local coordinates (meters) of the primary ventilation stack on the L-shaped masterplan */
export const VVER1200_STACK_LOCAL_POS = {
  x: -400,
  z: 80,
} as const;

function createCorrugatedMetalTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#707d8f";
  ctx.fillRect(0, 0, 256, 256);

  for (let x = 0; x < 256; x += 8) {
    ctx.fillStyle = x % 16 === 0 ? "#8190a4" : "#5e6a7c";
    ctx.fillRect(x, 0, 4, 256);
  }
  ctx.strokeStyle = "rgba(15, 23, 42, 0.28)";
  ctx.lineWidth = 2;
  for (let y = 0; y < 256; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 3);
  tex.needsUpdate = true;
  return tex;
}

function createConcreteShellTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#e6ebf1";
  ctx.fillRect(0, 0, 256, 256);

  for (let y = 0; y < 256; y += 16) {
    ctx.fillStyle = y % 32 === 0 ? "rgba(148, 163, 184, 0.25)" : "rgba(255, 255, 255, 0.3)";
    ctx.fillRect(0, y, 256, 4);
  }
  for (let x = 0; x < 256; x += 32) {
    ctx.strokeStyle = "rgba(148, 163, 184, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 6);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a procedural 3D model of a twin-unit VVER-1200 Nuclear Power Plant
 * oriented in an L-shaped (Г-образная) masterplan so that at bearingDeg = 330° (-30°):
 *
 * - Main Wing (Local X: -960..+960, Z: -140..+580) aligns along the SW–NE (ЮЗ–СВ) axis:
 *     * Twin VVER-1200 power units on the SW half (Unit 1 closed dome, Unit 2 amber cutaway dome),
 *       turbine halls, auxiliary halls, coolant tanks, pump annexes & primary ventilation stack
 *     * Four hyperbolic cooling towers (2 pairs) on the NE half with water channels & basins
 * - Adjacent NW Wing (Local X: -960..+240, Z: -840..-140) protrudes toward North-West (СЗ):
 *     * Blue-trimmed administrative/auxiliary complex + 8-cell ventilation fan bank
 *     * Circular switchyard / intake compound (R = 265m) with 3x3 transformers & gantry portals
 *
 * Scale: 1 scene unit = 1 meter.
 * Origin: (0, 0, 0) at ground level (y = 0).
 */
export function generateVVER1200Plant(options: VVER1200PlantOptions = {}): THREE.Group {
  const {
    bearingDeg = DEFAULT_PLANT_BEARING_DEG,
    scaleMultiplier = DEFAULT_PLANT_MODEL_SCALE,
    stackHeight = 185,
    includeLighting = true,
    enableShadows = true,
    includeTextures = typeof document !== "undefined",
    useInstancing = true,
  } = options;

  const effectiveStackHeight = Math.max(185, stackHeight);
  const root = new THREE.Group();
  root.name = "VVER1200_NPP_Complex";

  const textures: THREE.Texture[] = [];
  const beaconMeshes: THREE.Mesh[] = [];

  const metalTex = includeTextures ? createCorrugatedMetalTexture() : null;
  const concreteTex = includeTextures ? createConcreteShellTexture() : null;
  if (metalTex) textures.push(metalTex);
  if (concreteTex) textures.push(concreteTex);

  // Shared PBR Materials
  const siteApronMat = new THREE.MeshStandardMaterial({
    color: "#e6ebf1",
    roughness: 0.9,
    metalness: 0.04,
  });
  const padCurbMat = new THREE.MeshStandardMaterial({
    color: "#94a3b8",
    roughness: 0.72,
    metalness: 0.16,
  });
  const roadMat = new THREE.MeshStandardMaterial({
    color: "#cfd7e2",
    roughness: 0.88,
    metalness: 0.05,
  });
  const courtyardMat = new THREE.MeshStandardMaterial({
    color: "#f5f7fa",
    roughness: 0.92,
    metalness: 0.02,
  });
  const roofSlateMat = new THREE.MeshStandardMaterial({
    color: "#6b7788",
    roughness: 0.68,
    metalness: 0.25,
  });
  const turbineCladMat = new THREE.MeshStandardMaterial({
    color: "#778496",
    ...(metalTex ? { map: metalTex } : {}),
    roughness: 0.45,
    metalness: 0.55,
  });
  const darkTrimMat = new THREE.MeshStandardMaterial({
    color: "#3f4a5a",
    roughness: 0.55,
    metalness: 0.4,
  });
  const cobaltBlueMat = new THREE.MeshStandardMaterial({
    color: "#2563eb",
    roughness: 0.42,
    metalness: 0.32,
  });
  const whiteConcreteMat = new THREE.MeshStandardMaterial({
    color: "#f1f5f9",
    roughness: 0.52,
    metalness: 0.14,
  });
  const domeClosedMat = new THREE.MeshStandardMaterial({
    color: "#768394",
    roughness: 0.5,
    metalness: 0.25,
  });
  const domeAmberCoreMat = new THREE.MeshStandardMaterial({
    color: "#fde047",
    emissive: "#f59e0b",
    emissiveIntensity: 0.25,
    roughness: 0.42,
    metalness: 0.15,
  });
  const craneAmberMat = new THREE.MeshStandardMaterial({
    color: "#d97706",
    roughness: 0.45,
    metalness: 0.5,
  });
  const towerShellMat = new THREE.MeshStandardMaterial({
    color: "#edf1f6",
    ...(concreteTex ? { map: concreteTex } : {}),
    roughness: 0.82,
    metalness: 0.06,
    side: THREE.DoubleSide,
  });
  const basinFloorMat = new THREE.MeshStandardMaterial({
    color: "#cbd5e1",
    roughness: 0.28,
    metalness: 0.18,
  });
  const steelMat = new THREE.MeshStandardMaterial({
    color: "#cbd5e1",
    roughness: 0.3,
    metalness: 0.78,
  });
  const stackWhiteMat = new THREE.MeshStandardMaterial({
    color: "#f8fafc",
    roughness: 0.45,
    metalness: 0.18,
  });
  const stackRedMat = new THREE.MeshStandardMaterial({
    color: "#ef4444",
    roughness: 0.42,
    metalness: 0.18,
  });
  const vaporMat = new THREE.MeshStandardMaterial({
    color: "#f1f5f9",
    transparent: true,
    opacity: 0.22,
    roughness: 0.95,
    metalness: 0.0,
    depthWrite: false,
  });

  const configureShadow = (mesh: THREE.Object3D, cast = true, receive = true) => {
    mesh.castShadow = enableShadows && cast;
    mesh.receiveShadow = enableShadows && receive;
  };

  // ============================================================================
  // 1. L-Shaped Industrial Foundation Pad (SW-NE Main Wing + NW Protruding Wing)
  // ============================================================================
  // Main SW-NE Wing: X = [-960 .. +960] (1920m), Z = [-140 .. +580] (720m)
  const mainWingPad = new THREE.Mesh(new THREE.BoxGeometry(1920, 3.0, 720), siteApronMat);
  mainWingPad.position.set(0, 1.5, 220);
  configureShadow(mainWingPad, false, true);
  root.add(mainWingPad);

  // NW Protruding Wing (into Local -Z): X = [-960 .. +240] (1200m), Z = [-840 .. -140] (700m)
  const nwWingPad = new THREE.Mesh(new THREE.BoxGeometry(1200, 3.0, 700), siteApronMat);
  nwWingPad.position.set(-360, 1.5, -490);
  configureShadow(nwWingPad, false, true);
  root.add(nwWingPad);

  // Crisp perimeter curb walls tracing the exact outer L-contour
  const curbSegments: Array<[number, number, number, number]> = [
    [-360, -836, 1200, 8], // NW wing top edge
    [236, -490, 8, 700], // NW wing inner step edge
    [600, -144, 720, 8], // Main wing NE upper edge
    [956, 220, 8, 720], // Main wing NE far edge
    [0, 576, 1920, 8], // Main wing SE bottom edge
    [-956, -130, 8, 1420], // Full SW outer edge
  ];
  for (const [cx, cz, cw, cd] of curbSegments) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(cw, 5.0, cd), padCurbMat);
    curb.position.set(cx, 2.5, cz);
    configureShadow(curb, false, true);
    root.add(curb);
  }

  // Internal paved roads linking NW wing and SW-NE main wing
  const roadStripConfigs: Array<[number, number, number, number]> = [
    [-905, -130, 32, 1340], // SW perimeter avenue
    [0, -135, 1840, 34], // Main SW-NE spine road along wing junction
    [0, 525, 1840, 32], // SE perimeter road
    [-400, 220, 34, 680], // Cross road between Unit 1 & Unit 2
    [200, -100, 34, 1320], // Road dividing nuclear island & cooling towers / switchyard
  ];
  for (const [rx, rz, rw, rd] of roadStripConfigs) {
    const rMesh = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.4, rd), roadMat);
    rMesh.position.set(rx, 3.2, rz);
    configureShadow(rMesh, false, true);
    root.add(rMesh);
  }

  // Bright courtyard islands under the two power blocks
  for (const cx of [-640, -160]) {
    const cMesh = new THREE.Mesh(new THREE.BoxGeometry(410, 0.25, 580), courtyardMat);
    cMesh.position.set(cx, 3.12, 220);
    configureShadow(cMesh, false, true);
    root.add(cMesh);
  }

  // ============================================================================
  // 2. NW Wing — Left: Administrative / Auxiliary Complex & 8-Cell Fan Bank
  // ============================================================================
  const adminGroup = new THREE.Group();
  adminGroup.name = "VVER1200_Admin_Complex";

  const adminHalls: Array<{ x: number; z: number; w: number; h: number; d: number }> = [
    { x: -790, z: -550, w: 145, h: 52, d: 220 },
    { x: -630, z: -550, w: 160, h: 64, d: 245 },
    { x: -465, z: -550, w: 150, h: 52, d: 220 },
  ];
  for (const hall of adminHalls) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(hall.w, hall.h, hall.d), cobaltBlueMat);
    body.position.set(hall.x, 3.0 + hall.h / 2, hall.z);
    configureShadow(body);
    adminGroup.add(body);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(hall.w - 4, 3.5, hall.d - 4), roofSlateMat);
    roof.position.set(hall.x, 3.0 + hall.h + 1.5, hall.z);
    configureShadow(roof);
    adminGroup.add(roof);
  }

  // Auxiliary warehouse / engineering building south-east of admin complex
  const auxWarehouse = new THREE.Mesh(new THREE.BoxGeometry(330, 26, 105), roofSlateMat);
  auxWarehouse.position.set(-660, 16, -310);
  configureShadow(auxWarehouse);
  adminGroup.add(auxWarehouse);

  // Rooftop HVAC vents & two white rooftop stacks on admin roofs
  for (const [vx, vz] of [
    [-690, -640],
    [-570, -640],
    [-600, -470],
  ]) {
    const vMesh = new THREE.Mesh(new THREE.BoxGeometry(18, 12, 18), whiteConcreteMat);
    vMesh.position.set(vx, 74, vz);
    configureShadow(vMesh);
    adminGroup.add(vMesh);
  }

  for (const [sx, sz, sh] of [
    [-630, -565, 48],
    [-465, -550, 38],
  ]) {
    const miniStack = new THREE.Mesh(
      new THREE.CylinderGeometry(6.5, 8.0, sh, 16),
      whiteConcreteMat,
    );
    miniStack.position.set(sx, 68 + sh / 2, sz);
    configureShadow(miniStack);
    adminGroup.add(miniStack);
  }

  // 8-cell mechanical ventilation / cooling bank (2 rows x 4 fans)
  const fanDeck = new THREE.Mesh(new THREE.BoxGeometry(170, 22, 95), darkTrimMat);
  fanDeck.position.set(-395, 14, -295);
  configureShadow(fanDeck);
  adminGroup.add(fanDeck);

  const fanShroudGeo = new THREE.CylinderGeometry(15.5, 16.5, 5, 16);
  const fanHubGeo = new THREE.CylinderGeometry(10.0, 10.0, 5.4, 14);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const fx = -456 + col * 40;
      const fz = -317 + row * 44;
      const shroud = new THREE.Mesh(fanShroudGeo, cobaltBlueMat);
      shroud.position.set(fx, 26.5, fz);
      adminGroup.add(shroud);

      const hub = new THREE.Mesh(fanHubGeo, whiteConcreteMat);
      hub.position.set(fx, 26.8, fz);
      adminGroup.add(hub);
    }
  }

  root.add(adminGroup);

  // ============================================================================
  // 3. NW Wing — Right: Circular Switchyard / Intake Compound & Feed Bridge
  // ============================================================================
  const switchyardX = -35;
  const switchyardZ = -495;
  const switchyardRadius = 265;

  const circularPad = new THREE.Mesh(
    new THREE.CylinderGeometry(switchyardRadius, switchyardRadius, 2.2, 56),
    courtyardMat,
  );
  circularPad.position.set(switchyardX, 3.6, switchyardZ);
  configureShadow(circularPad, false, true);
  root.add(circularPad);

  const perimeterRing = new THREE.Mesh(
    new THREE.TorusGeometry(switchyardRadius - 2, 3.8, 10, 64),
    roofSlateMat,
  );
  perimeterRing.rotation.x = Math.PI / 2;
  perimeterRing.position.set(switchyardX, 6.2, switchyardZ);
  root.add(perimeterRing);

  // Pipe / cable bridge connecting admin complex horizontally into the circular compound
  const intakeBridge = new THREE.Mesh(new THREE.BoxGeometry(240, 15, 40), roofSlateMat);
  intakeBridge.position.set(switchyardX - 310, 10.5, switchyardZ);
  configureShadow(intakeBridge);
  root.add(intakeBridge);

  // 3x3 array of substation transformers & steel gantry portals inside circular yard
  const bayRowZs = [switchyardZ - 95, switchyardZ, switchyardZ + 95];
  for (const bz of bayRowZs) {
    const xfmr = new THREE.Mesh(new THREE.BoxGeometry(30, 24, 34), roofSlateMat);
    xfmr.position.set(switchyardX - 75, 16, bz);
    configureShadow(xfmr);
    root.add(xfmr);

    for (const gx of [switchyardX + 30, switchyardX + 120]) {
      const colNorth = new THREE.Mesh(new THREE.BoxGeometry(5.5, 38, 5.5), darkTrimMat);
      colNorth.position.set(gx, 23, bz - 26);
      configureShadow(colNorth);
      root.add(colNorth);

      const colSouth = new THREE.Mesh(new THREE.BoxGeometry(5.5, 38, 5.5), darkTrimMat);
      colSouth.position.set(gx, 23, bz + 26);
      configureShadow(colSouth);
      root.add(colSouth);

      const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 58), steelMat);
      crossBeam.position.set(gx, 41, bz);
      configureShadow(crossBeam);
      root.add(crossBeam);
    }

    const busbar = new THREE.Mesh(new THREE.BoxGeometry(205, 2.0, 2.5), steelMat);
    busbar.position.set(switchyardX + 25, 37, bz);
    root.add(busbar);
  }

  // ============================================================================
  // 4. Main SW-NE Wing — Left Half: Twin VVER-1200 Power Units (X=-640, X=-160)
  // ============================================================================
  const unitConfigs: Array<{ x: number; isCutawayLower: boolean; name: string }> = [
    { x: -640, isCutawayLower: false, name: "VVER1200_Unit_1_SW" },
    { x: -160, isCutawayLower: true, name: "VVER1200_Unit_2_NE" },
  ];

  unitConfigs.forEach((cfg) => {
    const unitGroup = new THREE.Group();
    unitGroup.name = cfg.name;
    const ux = cfg.x;

    // 4a. Auxiliary building west/left of each reactor + twin coolant tanks
    const auxBlock = new THREE.Mesh(new THREE.BoxGeometry(78, 30, 185), cobaltBlueMat);
    auxBlock.position.set(ux - 145, 18, 120);
    configureShadow(auxBlock);
    unitGroup.add(auxBlock);

    const auxRoof = new THREE.Mesh(new THREE.BoxGeometry(72, 3.0, 178), roofSlateMat);
    auxRoof.position.set(ux - 145, 34.5, 120);
    configureShadow(auxRoof);
    unitGroup.add(auxRoof);

    // Maintenance skid
    const skid = new THREE.Mesh(new THREE.BoxGeometry(20, 7, 60), whiteConcreteMat);
    skid.position.set(ux - 145, 6.5, 320);
    skid.rotation.y = 0.22;
    unitGroup.add(skid);

    // Twin cylindrical coolant storage tanks
    for (const tz of [-10, 46]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(21, 21, 32, 22), roofSlateMat);
      tank.position.set(ux - 105, 19, tz);
      configureShadow(tank);
      unitGroup.add(tank);

      const tankRim = new THREE.Mesh(new THREE.TorusGeometry(20, 1.6, 8, 22), whiteConcreteMat);
      tankRim.rotation.x = Math.PI / 2;
      tankRim.position.set(ux - 105, 35.5, tz);
      unitGroup.add(tankRim);
    }

    // 4b. Elongated Turbine Hall (Машинный зал) along +Z (South-East)
    const turbineMesh = new THREE.Mesh(new THREE.BoxGeometry(132, 56, 260), turbineCladMat);
    turbineMesh.position.set(ux + 15, 31, 330);
    configureShadow(turbineMesh);
    unitGroup.add(turbineMesh);

    const ridgeMesh = new THREE.Mesh(new THREE.BoxGeometry(68, 14, 225), roofSlateMat);
    ridgeMesh.position.set(ux + 15, 66, 330);
    configureShadow(ridgeMesh);
    unitGroup.add(ridgeMesh);

    // 4c. Reactor Containment Building (North-West side of main wing)
    const reactorZ = 75;
    const reactorPodium = new THREE.Mesh(new THREE.BoxGeometry(165, 60, 175), roofSlateMat);
    reactorPodium.position.set(ux + 15, 33, reactorZ);
    configureShadow(reactorPodium);
    unitGroup.add(reactorPodium);

    const containmentRadius = 64;
    const containmentWallH = 50;

    if (!cfg.isCutawayLower) {
      // Unit 1: Closed spherical dome with crisp white ring collar
      const cylinder = new THREE.Mesh(
        new THREE.CylinderGeometry(containmentRadius, containmentRadius, containmentWallH, 36),
        roofSlateMat,
      );
      cylinder.position.set(ux + 15, 35 + containmentWallH / 2, reactorZ);
      configureShadow(cylinder);
      unitGroup.add(cylinder);

      const whiteRing = new THREE.Mesh(
        new THREE.TorusGeometry(containmentRadius - 1.5, 4.0, 10, 36),
        whiteConcreteMat,
      );
      whiteRing.rotation.x = Math.PI / 2;
      whiteRing.position.set(ux + 15, 35 + containmentWallH, reactorZ);
      unitGroup.add(whiteRing);

      const domeMesh = new THREE.Mesh(
        new THREE.SphereGeometry(containmentRadius - 3.5, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2),
        domeClosedMat,
      );
      domeMesh.position.set(ux + 15, 35 + containmentWallH - 1.0, reactorZ);
      configureShadow(domeMesh);
      unitGroup.add(domeMesh);
    } else {
      // Unit 2: Cutaway containment revealing warm yellow-amber core dome & gantry crane
      const outerWall = new THREE.Mesh(
        new THREE.CylinderGeometry(
          containmentRadius,
          containmentRadius,
          containmentWallH,
          36,
          1,
          false,
          Math.PI * 0.45,
          Math.PI * 1.45,
        ),
        roofSlateMat,
      );
      outerWall.position.set(ux + 15, 35 + containmentWallH / 2, reactorZ);
      configureShadow(outerWall);
      unitGroup.add(outerWall);

      const partialRing = new THREE.Mesh(
        new THREE.TorusGeometry(containmentRadius - 1.5, 3.8, 10, 28, Math.PI * 1.45),
        whiteConcreteMat,
      );
      partialRing.rotation.x = Math.PI / 2;
      partialRing.rotation.z = Math.PI * 0.45;
      partialRing.position.set(ux + 15, 35 + containmentWallH, reactorZ);
      unitGroup.add(partialRing);

      const innerCoreDome = new THREE.Mesh(
        new THREE.SphereGeometry(containmentRadius - 6.5, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2),
        domeAmberCoreMat,
      );
      innerCoreDome.position.set(ux + 15, 33 + containmentWallH - 8.0, reactorZ);
      configureShadow(innerCoreDome);
      unitGroup.add(innerCoreDome);

      const craneArm = new THREE.Mesh(new THREE.BoxGeometry(72, 11, 15), craneAmberMat);
      craneArm.position.set(ux + 12, 90, reactorZ + 52);
      craneArm.rotation.y = -0.35;
      configureShadow(craneArm);
      unitGroup.add(craneArm);
    }

    const reactorAccent = new THREE.Mesh(new THREE.BoxGeometry(16, 18, 16), craneAmberMat);
    reactorAccent.position.set(ux - 22, 64, reactorZ + 92);
    unitGroup.add(reactorAccent);

    // 4d. Pump / Electrical Annex on north-east edge of unit
    const pumpAnnex = new THREE.Mesh(new THREE.BoxGeometry(135, 38, 78), whiteConcreteMat);
    pumpAnnex.position.set(ux + 15, 22, -62);
    configureShadow(pumpAnnex);
    unitGroup.add(pumpAnnex);

    const pumpRoof = new THREE.Mesh(new THREE.BoxGeometry(128, 4.0, 72), roofSlateMat);
    pumpRoof.position.set(ux + 15, 42.5, -62);
    configureShadow(pumpRoof);
    unitGroup.add(pumpRoof);

    root.add(unitGroup);
  });

  // ============================================================================
  // 5. Primary Ventilation Stack (plume emission point anchored between units)
  // ============================================================================
  const stackPosX = VVER1200_STACK_LOCAL_POS.x;
  const stackPosZ = VVER1200_STACK_LOCAL_POS.z;

  const pedestalHeight = Math.min(34, effectiveStackHeight * 0.2);
  const pedestalMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(13, 16, pedestalHeight, 20),
    darkTrimMat,
  );
  pedestalMesh.position.set(stackPosX, pedestalHeight / 2 + 3.0, stackPosZ);
  configureShadow(pedestalMesh);
  root.add(pedestalMesh);

  const shaftHeight = Math.max(30, effectiveStackHeight - pedestalHeight);
  const shaftMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(6.8, 11.5, shaftHeight, 22),
    stackWhiteMat,
  );
  shaftMesh.position.set(stackPosX, pedestalHeight + shaftHeight / 2, stackPosZ);
  configureShadow(shaftMesh);
  root.add(shaftMesh);

  for (const frac of [0.62, 0.84]) {
    const rAtFrac = THREE.MathUtils.lerp(11.5, 6.8, frac) + 0.35;
    const bMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(rAtFrac - 0.35, rAtFrac, shaftHeight * 0.11, 22),
      stackRedMat,
    );
    bMesh.position.set(stackPosX, pedestalHeight + shaftHeight * frac, stackPosZ);
    root.add(bMesh);
  }

  const stackLip = new THREE.Mesh(new THREE.TorusGeometry(7.2, 1.0, 8, 22), darkTrimMat);
  stackLip.rotation.x = Math.PI / 2;
  stackLip.position.set(stackPosX, effectiveStackHeight - 2.0, stackPosZ);
  root.add(stackLip);

  const beaconMesh = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 12, 12),
    new THREE.MeshBasicMaterial({ color: "#ff2222" }),
  );
  beaconMesh.position.set(stackPosX, effectiveStackHeight + 2.5, stackPosZ);
  root.add(beaconMesh);
  beaconMeshes.push(beaconMesh);

  const stackBaseAnchor = new THREE.Object3D();
  stackBaseAnchor.name = "VentilationStackBase";
  stackBaseAnchor.position.set(stackPosX, 0, stackPosZ);
  root.add(stackBaseAnchor);

  const stackTipAnchor = new THREE.Object3D();
  stackTipAnchor.name = "VentilationStackTip";
  stackTipAnchor.position.set(stackPosX, effectiveStackHeight, stackPosZ);
  root.add(stackTipAnchor);

  // ============================================================================
  // 6. Main SW-NE Wing — Right Half: Four Hyperbolic Cooling Towers (2x2 Grid)
  // ============================================================================
  // Pump distribution house & circulating water channels linking nuclear island to cooling towers
  const coolingPumpHouse = new THREE.Mesh(new THREE.BoxGeometry(80, 34, 420), roofSlateMat);
  coolingPumpHouse.position.set(170, 20, 210);
  configureShadow(coolingPumpHouse);
  root.add(coolingPumpHouse);

  for (const cz of [70, 350]) {
    const ch = new THREE.Mesh(new THREE.BoxGeometry(580, 6.5, 42), courtyardMat);
    ch.position.set(500, 5.2, cz);
    configureShadow(ch, false, true);
    root.add(ch);
  }

  const towerPositions: Array<[number, number]> = [
    [400, 70],
    [720, 70],
    [400, 350],
    [720, 350],
  ];

  // Hyperbolic shell (~175m tall, base soffit R = 70m, throat R = 46m, top R = 52m)
  const towerTotalHeight = 175;
  const soffitY = 16;
  const throatY = 128;
  const rThroat = 46;
  const hyperScale = 64;
  const lathePoints: THREE.Vector2[] = [];
  const profileSteps = 22;
  for (let i = 0; i <= profileSteps; i++) {
    const y = THREE.MathUtils.lerp(soffitY, towerTotalHeight, i / profileSteps);
    const dy = (y - throatY) / hyperScale;
    const radius = rThroat * Math.sqrt(1 + dy * dy);
    lathePoints.push(new THREE.Vector2(radius, y));
  }
  const towerGeo = new THREE.LatheGeometry(lathePoints, 40);
  towerGeo.computeVertexNormals();

  const topRadius = lathePoints[lathePoints.length - 1]!.x;
  const baseSoffitRadius = lathePoints[0]!.x;

  const ringGeos = [52, 95, 138, towerTotalHeight].map((rh) => {
    const dy = (rh - throatY) / hyperScale;
    const rr = rThroat * Math.sqrt(1 + dy * dy);
    return { y: rh, geo: new THREE.TorusGeometry(rr + 0.35, 1.5, 8, 40) };
  });

  const basinWallGeo = new THREE.CylinderGeometry(
    baseSoffitRadius + 12,
    baseSoffitRadius + 15,
    5.5,
    40,
    1,
    true,
  );
  const basinRimGeo = new THREE.TorusGeometry(baseSoffitRadius + 12, 1.8, 8, 40);
  const waterDiscGeo = new THREE.CircleGeometry(baseSoffitRadius + 11.5, 40);
  const vaporDiscGeo = new THREE.CircleGeometry(topRadius * 0.85, 32);

  const strutsPerTower = 16;
  const strutGeo = new THREE.CylinderGeometry(1.1, 1.6, 17, 8);
  const strutInstanced = useInstancing
    ? new THREE.InstancedMesh(strutGeo, darkTrimMat, towerPositions.length * strutsPerTower)
    : null;
  if (strutInstanced) {
    configureShadow(strutInstanced, true, false);
  }
  const dummy = new THREE.Object3D();
  let strutIdx = 0;

  for (const [tx, tz] of towerPositions) {
    const towerGroup = new THREE.Group();
    towerGroup.position.set(tx, 0, tz);

    const shell = new THREE.Mesh(towerGeo, towerShellMat);
    configureShadow(shell);
    towerGroup.add(shell);

    for (const ring of ringGeos) {
      const rMesh = new THREE.Mesh(ring.geo, darkTrimMat);
      rMesh.rotation.x = Math.PI / 2;
      rMesh.position.y = ring.y;
      towerGroup.add(rMesh);
    }

    const basinWall = new THREE.Mesh(basinWallGeo, roofSlateMat);
    basinWall.position.y = 4.2;
    configureShadow(basinWall, true, true);
    towerGroup.add(basinWall);

    const basinRim = new THREE.Mesh(basinRimGeo, whiteConcreteMat);
    basinRim.rotation.x = Math.PI / 2;
    basinRim.position.y = 7.0;
    towerGroup.add(basinRim);

    const waterDisc = new THREE.Mesh(waterDiscGeo, basinFloorMat);
    waterDisc.rotation.x = -Math.PI / 2;
    waterDisc.position.y = 3.5;
    towerGroup.add(waterDisc);

    const vaporDisc = new THREE.Mesh(vaporDiscGeo, vaporMat);
    vaporDisc.rotation.x = -Math.PI / 2;
    vaporDisc.position.y = towerTotalHeight - 10;
    towerGroup.add(vaporDisc);

    root.add(towerGroup);

    for (let s = 0; s < strutsPerTower; s++) {
      const angle = (s / strutsPerTower) * Math.PI * 2;
      const rMid = baseSoffitRadius + 0.8;
      if (strutInstanced) {
        dummy.position.set(tx + Math.cos(angle) * rMid, 9.5, tz + Math.sin(angle) * rMid);
        dummy.rotation.set(0, -angle, s % 2 === 0 ? 0.22 : -0.22);
        dummy.updateMatrix();
        strutInstanced.setMatrixAt(strutIdx++, dummy.matrix);
      } else {
        const strutMesh = new THREE.Mesh(strutGeo, darkTrimMat);
        strutMesh.position.set(tx + Math.cos(angle) * rMid, 9.5, tz + Math.sin(angle) * rMid);
        strutMesh.rotation.set(0, -angle, s % 2 === 0 ? 0.22 : -0.22);
        configureShadow(strutMesh, true, false);
        root.add(strutMesh);
      }
    }
  }
  if (strutInstanced) {
    strutInstanced.instanceMatrix.needsUpdate = true;
    strutInstanced.computeBoundingSphere();
    root.add(strutInstanced);
  }

  // ============================================================================
  // 7. Optional Self-Contained Lighting (AmbientLight + DirectionalLight)
  // ============================================================================
  if (includeLighting) {
    const ambient = new THREE.AmbientLight(0xeef2f7, 0.92);
    ambient.name = "VVER1200_AmbientLight";
    root.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xfffbeb, 1.25);
    dirLight.name = "VVER1200_DirectionalLight";
    dirLight.position.set(600, 1100, 700);
    if (enableShadows) {
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.width = 1024;
      dirLight.shadow.mapSize.height = 1024;
      dirLight.shadow.camera.near = 100;
      dirLight.shadow.camera.far = 3200;
      const d = 1100;
      dirLight.shadow.camera.left = -d;
      dirLight.shadow.camera.right = d;
      dirLight.shadow.camera.top = d;
      dirLight.shadow.camera.bottom = -d;
      dirLight.shadow.bias = -0.0005;
    }
    root.add(dirLight);
  }

  // Apply Azimuth Rotation (bearing) and Uniform Scale Multiplier
  root.rotation.y = -THREE.MathUtils.degToRad(bearingDeg);
  const safeScale =
    Number.isFinite(scaleMultiplier) && scaleMultiplier > 0
      ? scaleMultiplier
      : DEFAULT_PLANT_MODEL_SCALE;
  root.scale.setScalar(safeScale);

  const metadata: VVER1200PlantMetadata = {
    stackBaseLocal: new THREE.Vector3(stackPosX, 0, stackPosZ),
    stackTopLocal: new THREE.Vector3(stackPosX, effectiveStackHeight, stackPosZ),
    stackHeightMeters: effectiveStackHeight,
    footprintSpanMeters: PLANT_FOOTPRINT_SPAN_METERS,
    beaconMeshes,
    textures,
  };
  root.userData.vver1200 = metadata;

  return root;
}

/**
 * Computes the exact world-space position of the ventilation stack top
 * after applying the plant group's position, bearing rotation, and scaleMultiplier.
 */
export function getVVER1200StackWorldPosition(
  plantGroup: THREE.Group,
  target: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  const meta = plantGroup.userData?.vver1200 as VVER1200PlantMetadata | undefined;
  const localTip =
    meta?.stackTopLocal ??
    new THREE.Vector3(VVER1200_STACK_LOCAL_POS.x, 185, VVER1200_STACK_LOCAL_POS.z);
  plantGroup.updateMatrixWorld(true);
  return target.copy(localTip).applyMatrix4(plantGroup.matrixWorld);
}

/**
 * Disposes all geometries, materials, and procedural textures created inside a VVER-1200 plant Group.
 */
export function disposeVVER1200Plant(plantGroup: THREE.Group): void {
  const meta = plantGroup.userData?.vver1200 as VVER1200PlantMetadata | undefined;
  if (meta?.textures) {
    meta.textures.forEach((t) => t.dispose());
  }
  const disposedMaterials = new Set<THREE.Material>();
  plantGroup.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        if (!disposedMaterials.has(m)) {
          disposedMaterials.add(m);
          m.dispose();
        }
      });
    }
  });
}
