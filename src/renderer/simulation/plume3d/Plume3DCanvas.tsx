import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type {
  PlumeSource3D,
  Meteorology3D,
  Isotope3D,
  DosimeterProbe,
  ZoneBoundary3D,
  PlumeIsoline3D,
  MapStyleType,
  NuclideReleaseItem,
} from "./types";
import {
  calculateDispersionCoefficients,
  calculatePointRadiologicalDose,
  calculateMultiNuclidePointDose,
} from "./gaussianPlume3D";
import { loadMapTextureAsync, JIZZAKH_NPP_LAT, JIZZAKH_NPP_LON } from "./mapTextureGenerator";
import {
  DEFAULT_PLANT_BEARING_DEG,
  DEFAULT_PLANT_MODEL_SCALE,
  generateVVER1200Plant,
  getVVER1200StackWorldPosition,
  disposeVVER1200Plant,
  type VVER1200PlantMetadata,
} from "../../../3d/generateVVER1200Plant";

interface Plume3DCanvasProps {
  source: PlumeSource3D;
  meteorology: Meteorology3D;
  isotope: Isotope3D;
  nuclides?: NuclideReleaseItem[];
  groundExposureHours?: number;
  peakCoords?: { worldX: number; worldZ: number } | null;
  probe: DosimeterProbe;
  onProbeMove: (newPos: { x: number; y: number; z: number }) => void;
  zones: ZoneBoundary3D[];
  isolines: PlumeIsoline3D[];
  showZones: boolean;
  showIsolines: boolean;
  showCenterline: boolean;
  mapStyle: MapStyleType;
  particleDensity: "low" | "medium" | "high";
  cameraPreset: "perspective" | "top" | "side" | "downwind" | "source";
  onCameraPresetSettled?: () => void;
  isSimulating: boolean;
  plantBearingDeg?: number;
  plantScaleMultiplier?: number;
}

// Pre-allocated math helpers to ensure zero GC in the render loop
const _colorA = new THREE.Color();
const _colorStopSafe = new THREE.Color(0.02, 0.72, 0.85); // < 0.02 mSv/h cyan
const _colorStopMon = new THREE.Color(0.1, 0.85, 0.5); // ~0.2 mSv/h emerald
const _colorStopWarn = new THREE.Color(0.92, 0.68, 0.08); // ~1.5 mSv/h amber
const _colorStopHigh = new THREE.Color(0.95, 0.28, 0.06); // ~8 mSv/h orange-red
const _colorStopCrit = new THREE.Color(1.0, 0.06, 0.24); // >= 30 mSv/h crimson
const _raycaster = new THREE.Raycaster();
const _mouse = new THREE.Vector2();
const _stackWorldPos = new THREE.Vector3();

export function Plume3DCanvas({
  source,
  meteorology,
  isotope,
  nuclides,
  groundExposureHours = 4,
  peakCoords,
  probe,
  onProbeMove,
  zones,
  isolines,
  showZones,
  showIsolines,
  showCenterline,
  mapStyle,
  particleDensity,
  cameraPreset,
  onCameraPresetSettled,
  isSimulating,
  plantBearingDeg = DEFAULT_PLANT_BEARING_DEG,
  plantScaleMultiplier = DEFAULT_PLANT_MODEL_SCALE,
}: Plume3DCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  // References to preserve Three.js state across React renders
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // Ground Terrain Mesh & Texture
  const groundMeshRef = useRef<THREE.Mesh | null>(null);
  const groundMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const currentTextureRef = useRef<THREE.Texture | null>(null);

  // Scene dynamic visual objects
  const particlesRef = useRef<THREE.Points | null>(null);
  const particleCountRef = useRef<number>(3500);
  const particleDataRef = useRef<{
    positions: Float32Array;
    colors: Float32Array;
    sizes: Float32Array;
    ages: Float32Array;
    lifeTimes: Float32Array;
    latOffsets: Float32Array;
    vertOffsets: Float32Array;
    speeds: Float32Array;
  } | null>(null);

  const zonesGroupRef = useRef<THREE.Group | null>(null);
  const isolinesGroupRef = useRef<THREE.Group | null>(null);
  const centerlineLineRef = useRef<THREE.Line | null>(null);
  const probeMeshRef = useRef<THREE.Group | null>(null);
  const peakMarkerRef = useRef<THREE.Group | null>(null);
  const windArrowGroupRef = useRef<THREE.Group | null>(null);
  const plantGroupRef = useRef<THREE.Group | null>(null);

  // Camera animation target
  const cameraTargetRef = useRef<{
    pos: THREE.Vector3;
    lookAt: THREE.Vector3;
    active: boolean;
  }>({
    pos: new THREE.Vector3(500, 300, 700),
    lookAt: new THREE.Vector3(0, 50, 0),
    active: false,
  });

  // Keep latest props in refs for the RAF loop
  const propsRef = useRef({
    source,
    meteorology,
    isotope,
    nuclides,
    groundExposureHours,
    peakCoords,
    probe,
    mapStyle,
    showZones,
    showIsolines,
    showCenterline,
    isSimulating,
    plantBearingDeg,
    plantScaleMultiplier,
    onProbeMove,
    onCameraPresetSettled,
  });
  useEffect(() => {
    propsRef.current = {
      source,
      meteorology,
      isotope,
      nuclides,
      groundExposureHours,
      peakCoords,
      probe,
      mapStyle,
      showZones,
      showIsolines,
      showCenterline,
      isSimulating,
      plantBearingDeg,
      plantScaleMultiplier,
      onProbeMove,
      onCameraPresetSettled,
    };
  }, [
    source,
    meteorology,
    isotope,
    nuclides,
    groundExposureHours,
    peakCoords,
    probe,
    mapStyle,
    showZones,
    showIsolines,
    showCenterline,
    isSimulating,
    plantBearingDeg,
    plantScaleMultiplier,
    onProbeMove,
    onCameraPresetSettled,
  ]);

  // Handle camera presets with strict metric alignment
  const applyCameraPreset = useCallback(
    (preset: "perspective" | "top" | "side" | "downwind" | "source") => {
      const windAngleRad = (((meteorology.windDirectionDeg + 180) % 360) * Math.PI) / 180;
      const dwX = Math.sin(windAngleRad);
      const dwZ = -Math.cos(windAngleRad);

      let targetPos = new THREE.Vector3(500, 350, 700);
      let targetLookAt = new THREE.Vector3(dwX * 600, 40, dwZ * 600);

      switch (preset) {
        case "top":
          // Orthogonal-like bird's-eye view aligned with North (-Z)
          targetPos = new THREE.Vector3(dwX * 800, 2400, dwZ * 800 + 0.1);
          targetLookAt = new THREE.Vector3(dwX * 800, 0, dwZ * 800);
          break;
        case "side":
          // Crosswind side perspective along dispersion cone
          targetPos = new THREE.Vector3(-dwZ * 1400 + dwX * 600, 380, dwX * 1400 + dwZ * 600);
          targetLookAt = new THREE.Vector3(dwX * 600, 50, dwZ * 600);
          break;
        case "downwind":
          // Standing downwind looking back up at source stack
          targetPos = new THREE.Vector3(dwX * 1800, 140, dwZ * 1800);
          targetLookAt = new THREE.Vector3(0, source.effectiveHeight, 0);
          break;
        case "source":
          // Close-up framing the L-shaped 1920m VVER-1200 complex, switchyard, and 4 cooling towers
          targetPos = new THREE.Vector3(-1050, 920, 1250);
          targetLookAt = new THREE.Vector3(-80, 45, 20);
          break;
        case "perspective":
        default:
          targetPos = new THREE.Vector3(-dwZ * 950 - dwX * 200, 480, dwX * 950 - dwZ * 200);
          targetLookAt = new THREE.Vector3(dwX * 550, 50, dwZ * 550);
          break;
      }

      cameraTargetRef.current = {
        pos: targetPos,
        lookAt: targetLookAt,
        active: true,
      };
    },
    [meteorology.windDirectionDeg, source.effectiveHeight],
  );

  useEffect(() => {
    applyCameraPreset(cameraPreset);
  }, [cameraPreset, applyCameraPreset]);

  // Main Scene & Renderer Initialization
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Detect software WebGL as per Three.js directives
    const isSoftwareGl = (() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return true;
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // 1. Renderer Setup
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: "high-performance",
      alpha: false,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    // 2. Scene & Horizon Fog
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#080c12");
    scene.fog = new THREE.FogExp2("#080c12", 0.0003);
    sceneRef.current = scene;

    // 3. Camera & OrbitControls (tight near=0.5 prevents clipping during close zoom)
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 50000);
    camera.position.set(650, 420, 850);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // Prevent going beneath terrain
    controls.minDistance = 8;
    controls.maxDistance = 12000;
    controlsRef.current = controls;

    controls.addEventListener("start", () => {
      cameraTargetRef.current.active = false;
    });

    // 4. Lighting Rig (Key Light + Cool Sky Fill)
    const hemiLight = new THREE.HemisphereLight("#93c5fd", "#0f172a", 0.75);
    hemiLight.position.set(0, 1000, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight("#fef08a", 1.25);
    dirLight.position.set(800, 1500, 900);
    dirLight.castShadow = !isSoftwareGl;
    if (dirLight.shadow) {
      dirLight.shadow.mapSize.width = 1024;
      dirLight.shadow.mapSize.height = 1024;
      dirLight.shadow.camera.near = 100;
      dirLight.shadow.camera.far = 5000;
      const d = 1800;
      dirLight.shadow.camera.left = -d;
      dirLight.shadow.camera.right = d;
      dirLight.shadow.camera.top = d;
      dirLight.shadow.camera.bottom = -d;
      dirLight.shadow.bias = -0.0005;
    }
    scene.add(dirLight);

    const backLight = new THREE.DirectionalLight("#38bdf8", 0.55);
    backLight.position.set(-900, 700, -900);
    scene.add(backLight);

    // 5. Embedded Realistic Geographic Map Terrain (12km x 12km)
    const groundSize = 12000;
    let initCancelled = false;
    const initialTexture = loadMapTextureAsync(
      propsRef.current.mapStyle,
      propsRef.current.source.latitude ?? JIZZAKH_NPP_LAT,
      propsRef.current.source.longitude ?? JIZZAKH_NPP_LON,
      groundSize,
      undefined,
      (tex) => {
        if (initCancelled) {
          if (tex !== currentTextureRef.current) tex.dispose();
          return;
        }
        if (groundMatRef.current) {
          if (currentTextureRef.current && currentTextureRef.current !== tex) {
            currentTextureRef.current.dispose();
          }
          currentTextureRef.current = tex;
          groundMatRef.current.map = tex;
          groundMatRef.current.needsUpdate = true;
        }
      },
    );
    currentTextureRef.current = initialTexture;

    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, 4, 4);
    const groundMat = new THREE.MeshBasicMaterial({
      map: initialTexture,
      side: THREE.DoubleSide,
      fog: false, // Ensures ground texture is always 100% visible, luminous, and independent of distance fog / nighttime scene illumination
      depthWrite: true,
    });
    groundMatRef.current = groundMat;

    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.position.set(0, -0.05, 0); // Position at y = -0.05 so isolines and zones at y = 0.5 never z-fight
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = false;
    scene.add(groundMesh);
    groundMeshRef.current = groundMesh;

    // 6. Procedural Twin-Unit VVER-1200 Nuclear Power Plant Complex (2 Reactors + 4 Cooling Towers)
    const plantGroup = generateVVER1200Plant({
      bearingDeg: propsRef.current.plantBearingDeg,
      scaleMultiplier: propsRef.current.plantScaleMultiplier,
      stackHeight: Math.max(25, source.effectiveHeight),
      includeLighting: false,
      enableShadows: !isSoftwareGl,
    });
    plantGroup.position.set(source.position.x, 0, source.position.z);

    // Subtle ground contact shadow beneath the L-shaped NPP industrial pad
    const contactGeo = new THREE.PlaneGeometry(2100, 2000);
    const contactCanvas = document.createElement("canvas");
    contactCanvas.width = 128;
    contactCanvas.height = 128;
    const ctx = contactCanvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
    grad.addColorStop(0, "rgba(0, 0, 0, 0.38)");
    grad.addColorStop(0.65, "rgba(0, 0, 0, 0.14)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const contactTexture = new THREE.CanvasTexture(contactCanvas);
    const contactMat = new THREE.MeshBasicMaterial({
      map: contactTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    });
    const contactMesh = new THREE.Mesh(contactGeo, contactMat);
    contactMesh.rotation.x = -Math.PI / 2;
    contactMesh.position.set(-120, 0.25, 20);
    plantGroup.add(contactMesh);

    const plantMeta = plantGroup.userData?.vver1200 as VVER1200PlantMetadata | undefined;
    plantMeta?.textures.push(contactTexture);

    scene.add(plantGroup);
    plantGroupRef.current = plantGroup;

    // 7. Dynamic Volumetric Particle System (Gaussian Radioactive Plume)
    const count = particleDensity === "high" ? 6000 : particleDensity === "medium" ? 3500 : 1800;
    particleCountRef.current = count;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const ages = new Float32Array(count);
    const lifeTimes = new Float32Array(count);
    const latOffsets = new Float32Array(count);
    const vertOffsets = new Float32Array(count);
    const speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      lifeTimes[i] = 12 + Math.random() * 20;
      ages[i] = Math.random() * lifeTimes[i];
      latOffsets[i] = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.5;
      vertOffsets[i] = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.5;
      speeds[i] = 0.85 + Math.random() * 0.3;
    }

    particleDataRef.current = {
      positions,
      colors,
      sizes,
      ages,
      lifeTimes,
      latOffsets,
      vertOffsets,
      speeds,
    };

    // Soft circular particle texture generated procedurally
    const pCanvas = document.createElement("canvas");
    pCanvas.width = 64;
    pCanvas.height = 64;
    const pCtx = pCanvas.getContext("2d")!;
    const pGrad = pCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    pGrad.addColorStop(0, "rgba(255, 255, 255, 1.0)");
    pGrad.addColorStop(0.3, "rgba(255, 255, 255, 0.7)");
    pGrad.addColorStop(0.7, "rgba(255, 255, 255, 0.2)");
    pGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
    pCtx.fillStyle = pGrad;
    pCtx.fillRect(0, 0, 64, 64);
    const particleTexture = new THREE.CanvasTexture(pCanvas);

    const particlesGeo = new THREE.BufferGeometry();
    particlesGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    particlesGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    particlesGeo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    const particlesMat = new THREE.PointsMaterial({
      size: 38,
      map: particleTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(particlesGeo, particlesMat);
    particles.renderOrder = 20;
    scene.add(particles);
    particlesRef.current = particles;

    // 8. Protective Zones & Isolines Visual Groups
    const zonesGroup = new THREE.Group();
    zonesGroup.renderOrder = 10;
    scene.add(zonesGroup);
    zonesGroupRef.current = zonesGroup;

    const isolinesGroup = new THREE.Group();
    isolinesGroup.renderOrder = 11;
    scene.add(isolinesGroup);
    isolinesGroupRef.current = isolinesGroup;

    // 9. Centerline Visual Trajectory Line
    const centerlineGeo = new THREE.BufferGeometry();
    const centerlineMat = new THREE.LineBasicMaterial({
      color: "#06b6d4",
      linewidth: 2,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    const centerlineLine = new THREE.Line(centerlineGeo, centerlineMat);
    centerlineLine.renderOrder = 21;
    scene.add(centerlineLine);
    centerlineLineRef.current = centerlineLine;

    // 10. Wind Compass Indicator Group
    const windGroup = new THREE.Group();
    windGroup.position.set(-300, 20, -300);

    const arrowShaftGeo = new THREE.CylinderGeometry(2, 2, 120, 12);
    const arrowShaftMat = new THREE.MeshStandardMaterial({
      color: "#06b6d4",
      metalness: 0.5,
      roughness: 0.3,
    });
    const arrowShaft = new THREE.Mesh(arrowShaftGeo, arrowShaftMat);
    arrowShaft.position.z = 60;
    arrowShaft.rotation.x = Math.PI / 2;
    windGroup.add(arrowShaft);

    const arrowHeadGeo = new THREE.ConeGeometry(8, 28, 16);
    const arrowHeadMat = new THREE.MeshStandardMaterial({
      color: "#38bdf8",
      metalness: 0.6,
      roughness: 0.2,
    });
    const arrowHead = new THREE.Mesh(arrowHeadGeo, arrowHeadMat);
    arrowHead.position.z = 130;
    arrowHead.rotation.x = Math.PI / 2;
    windGroup.add(arrowHead);

    scene.add(windGroup);
    windArrowGroupRef.current = windGroup;

    // 11. Interactive 3D Dosimeter Sensor Probe
    const probeGroup = new THREE.Group();
    const probePostGeo = new THREE.CylinderGeometry(1.2, 1.2, 12, 12);
    const probePostMat = new THREE.MeshBasicMaterial({
      color: "#06b6d4",
      transparent: true,
      opacity: 0.6,
    });
    const probePost = new THREE.Mesh(probePostGeo, probePostMat);
    probePost.position.y = 6;
    probeGroup.add(probePost);

    const probeHeadGeo = new THREE.SphereGeometry(6, 16, 16);
    const probeHeadMat = new THREE.MeshStandardMaterial({
      color: "#fbbf24",
      emissive: "#b45309",
      roughness: 0.3,
      metalness: 0.8,
    });
    const probeHead = new THREE.Mesh(probeHeadGeo, probeHeadMat);
    probeHead.position.y = 12;
    probeGroup.add(probeHead);

    const probeRingGeo = new THREE.RingGeometry(12, 16, 32);
    const probeRingMat = new THREE.MeshBasicMaterial({
      color: "#fbbf24",
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
    });
    const probeRing = new THREE.Mesh(probeRingGeo, probeRingMat);
    probeRing.rotation.x = -Math.PI / 2;
    probeRing.position.y = 0.5;
    probeGroup.add(probeRing);

    probeGroup.position.set(propsRef.current.probe.x, 0, propsRef.current.probe.y);
    scene.add(probeGroup);
    probeMeshRef.current = probeGroup;

    // 11b. Peak Dose Coordinate Marker (X_max, Y_max)
    const peakGroup = new THREE.Group();
    const peakRingGeo = new THREE.RingGeometry(18, 25, 32);
    const peakRingMat = new THREE.MeshBasicMaterial({
      color: "#f43f5e",
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
    });
    const peakRing = new THREE.Mesh(peakRingGeo, peakRingMat);
    peakRing.rotation.x = -Math.PI / 2;
    peakRing.position.y = 0.6;
    peakGroup.add(peakRing);

    const peakPoleGeo = new THREE.CylinderGeometry(1.0, 1.0, 26, 8);
    const peakPoleMat = new THREE.MeshBasicMaterial({
      color: "#f43f5e",
      transparent: true,
      opacity: 0.7,
    });
    const peakPole = new THREE.Mesh(peakPoleGeo, peakPoleMat);
    peakPole.position.y = 13;
    peakGroup.add(peakPole);

    const peakDiamondGeo = new THREE.OctahedronGeometry(7, 0);
    const peakDiamondMat = new THREE.MeshBasicMaterial({ color: "#fb7185" });
    const peakDiamond = new THREE.Mesh(peakDiamondGeo, peakDiamondMat);
    peakDiamond.position.y = 28;
    peakGroup.add(peakDiamond);

    peakGroup.visible = false;
    scene.add(peakGroup);
    peakMarkerRef.current = peakGroup;

    // Interactive pointer placement for the sensor probe (Shift + Click on terrain)
    const onPointerDown = (event: MouseEvent) => {
      if (event.button !== 0 || !event.shiftKey) return;
      const rect = renderer.domElement.getBoundingClientRect();
      _mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      _mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      _raycaster.setFromCamera(_mouse, camera);
      const intersects = _raycaster.intersectObject(groundMesh);
      if (intersects.length > 0) {
        const pt = intersects[0]!.point;
        propsRef.current.onProbeMove({ x: pt.x, y: pt.z, z: 1.5 });
      }
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    // Resize Handler + ResizeObserver for embedded tab container transitions
    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // 12. Main Render & Physics Simulation Loop
    let animationFrameId = 0;
    let lastTime = performance.now();

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      const {
        source: src,
        meteorology: met,
        isotope: iso,
        probe: curProbe,
        showZones: sz,
        showIsolines: si,
        showCenterline: sc,
        isSimulating: simActive,
      } = propsRef.current;

      // Camera preset smooth damping transition
      if (cameraTargetRef.current.active) {
        const target = cameraTargetRef.current;
        camera.position.lerp(target.pos, Math.min(1, dt * 3.5));
        controls.target.lerp(target.lookAt, Math.min(1, dt * 3.5));
        if (camera.position.distanceTo(target.pos) < 5) {
          cameraTargetRef.current.active = false;
          propsRef.current.onCameraPresetSettled?.();
        }
      }
      controls.update();

      // Beacon flashing on ventilation stack & reactor domes
      const plantMetaRef = plantGroupRef.current?.userData?.vver1200 as
        VVER1200PlantMetadata | undefined;
      if (plantMetaRef?.beaconMeshes) {
        const beaconHex = now % 1000 < 500 ? 0xff2222 : 0x440000;
        for (let b = 0; b < plantMetaRef.beaconMeshes.length; b++) {
          (plantMetaRef.beaconMeshes[b]!.material as THREE.MeshBasicMaterial).color.setHex(
            beaconHex,
          );
        }
      }

      // Compute exact world position of the VVER-1200 ventilation stack emission tip
      if (plantGroupRef.current) {
        getVVER1200StackWorldPosition(plantGroupRef.current, _stackWorldPos);
      } else {
        _stackWorldPos.set(src.position.x, src.effectiveHeight, src.position.z);
      }

      // Update wind compass orientation
      if (windArrowGroupRef.current) {
        const windTravelRad = (((met.windDirectionDeg + 180) % 360) * Math.PI) / 180;
        windArrowGroupRef.current.rotation.y = -windTravelRad;
      }

      // Update probe position in 3D
      if (probeMeshRef.current) {
        probeMeshRef.current.position.set(curProbe.x, 0, curProbe.y);
      }

      // Update peak marker in 3D
      if (peakMarkerRef.current) {
        const pk = propsRef.current.peakCoords;
        if (pk) {
          peakMarkerRef.current.visible = true;
          peakMarkerRef.current.position.set(pk.worldX, 0, pk.worldZ);
          peakMarkerRef.current.rotation.y = now * 0.0012;
        } else {
          peakMarkerRef.current.visible = false;
        }
      }

      // Visibility toggles
      if (zonesGroupRef.current) zonesGroupRef.current.visible = sz;
      if (isolinesGroupRef.current) isolinesGroupRef.current.visible = si;

      // Centerline trajectory line starting strictly from the ventilation stack tip
      if (centerlineLineRef.current) {
        centerlineLineRef.current.visible = sc;
        const windTravelRad = (((met.windDirectionDeg + 180) % 360) * Math.PI) / 180;
        const dwX = Math.sin(windTravelRad);
        const dwZ = -Math.cos(windTravelRad);
        const pts: THREE.Vector3[] = [];
        for (let d = 0; d <= 6000; d += 100) {
          pts.push(
            new THREE.Vector3(
              _stackWorldPos.x + dwX * d,
              _stackWorldPos.y,
              _stackWorldPos.z + dwZ * d,
            ),
          );
        }
        centerlineLineRef.current.geometry.setFromPoints(pts);
      }

      // Atmospheric Gaussian Plume Particle System
      if (particlesRef.current && particleDataRef.current) {
        const pData = particleDataRef.current;
        const pCount = particleCountRef.current;
        const posAttr = particlesRef.current.geometry.attributes[
          "position"
        ] as THREE.BufferAttribute;
        const colAttr = particlesRef.current.geometry.attributes["color"] as THREE.BufferAttribute;
        const sizeAttr = particlesRef.current.geometry.attributes["size"] as THREE.BufferAttribute;

        const u = Math.max(0.5, met.windSpeed);
        const windTravelRad = (((met.windDirectionDeg + 180) % 360) * Math.PI) / 180;
        const unitDwX = Math.sin(windTravelRad);
        const unitDwZ = -Math.cos(windTravelRad);
        const unitCwX = Math.cos(windTravelRad);
        const unitCwZ = Math.sin(windTravelRad);

        const stackX = _stackWorldPos.x;
        const stackZ = _stackWorldPos.z;
        const effH = _stackWorldPos.y;

        for (let i = 0; i < pCount; i++) {
          if (simActive) {
            pData.ages[i] += dt * pData.speeds[i];
          }

          if (pData.ages[i] >= pData.lifeTimes[i]) {
            pData.ages[i] = 0;
            pData.lifeTimes[i] = 12 + Math.random() * 20;
            pData.latOffsets[i] =
              (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.5;
            pData.vertOffsets[i] =
              (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.5;
            pData.speeds[i] = 0.85 + Math.random() * 0.3;
          }

          const age = pData.ages[i];
          const xDownwind = u * age * 18;

          const { sigmaY, sigmaZ } = calculateDispersionCoefficients(xDownwind, met.stabilityClass);

          const yCrosswind = pData.latOffsets[i] * sigmaY;
          let zElev = effH + pData.vertOffsets[i] * sigmaZ;
          if (zElev < 1.0) zElev = Math.abs(zElev) + 1.0;
          if (met.mixingHeight > 0 && zElev > met.mixingHeight) {
            zElev = met.mixingHeight - Math.abs(zElev - met.mixingHeight);
          }

          const wx = stackX + unitDwX * xDownwind + unitCwX * yCrosswind;
          const wy = Math.max(0.5, zElev);
          const wz = stackZ + unitDwZ * xDownwind + unitCwZ * yCrosswind;

          posAttr.setXYZ(i, wx, wy, wz);

          // Continuous log10 hazard color ramp calibrated to additive mixture dose rate H*(10)
          const nuclidesList = propsRef.current.nuclides;
          const dose =
            nuclidesList && nuclidesList.length > 0
              ? calculateMultiNuclidePointDose(
                  xDownwind,
                  yCrosswind,
                  zElev,
                  src,
                  met,
                  nuclidesList,
                  1.0,
                  {
                    fastMode: true,
                    groundExposureHours: propsRef.current.groundExposureHours,
                  },
                ).totalDoseRate
              : calculatePointRadiologicalDose(xDownwind, yCrosswind, zElev, src, met, iso, 1.0)
                  .totalDoseRate;

          if (dose <= 0.02) {
            _colorA.copy(_colorStopSafe);
          } else if (dose <= 0.2) {
            const t = (Math.log10(dose) - Math.log10(0.02)) / (Math.log10(0.2) - Math.log10(0.02));
            _colorA.copy(_colorStopSafe).lerp(_colorStopMon, t);
          } else if (dose <= 1.5) {
            const t = (Math.log10(dose) - Math.log10(0.2)) / (Math.log10(1.5) - Math.log10(0.2));
            _colorA.copy(_colorStopMon).lerp(_colorStopWarn, t);
          } else if (dose <= 8.0) {
            const t = (Math.log10(dose) - Math.log10(1.5)) / (Math.log10(8.0) - Math.log10(1.5));
            _colorA.copy(_colorStopWarn).lerp(_colorStopHigh, t);
          } else if (dose <= 30.0) {
            const t = (Math.log10(dose) - Math.log10(8.0)) / (Math.log10(30.0) - Math.log10(8.0));
            _colorA.copy(_colorStopHigh).lerp(_colorStopCrit, t);
          } else {
            _colorA.copy(_colorStopCrit);
          }

          colAttr.setXYZ(i, _colorA.r, _colorA.g, _colorA.b);

          const pSize = Math.min(180, 25 + (xDownwind / 3000) * 110);
          sizeAttr.setX(i, pSize);
        }

        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
        sizeAttr.needsUpdate = true;
      }

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);

    return () => {
      initCancelled = true;
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      if (plantGroupRef.current) {
        disposeVVER1200Plant(plantGroupRef.current);
        plantGroupRef.current = null;
      }
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [source.position.x, source.position.z, source.effectiveHeight, particleDensity]);

  // Reactively update VVER-1200 azimuth bearing and scale without rebuilding the scene
  useEffect(() => {
    const group = plantGroupRef.current;
    if (!group) return;
    group.rotation.y = -THREE.MathUtils.degToRad(plantBearingDeg);
    const safeScale =
      Number.isFinite(plantScaleMultiplier) && plantScaleMultiplier > 0
        ? plantScaleMultiplier
        : 1.0;
    group.scale.setScalar(safeScale);
  }, [plantBearingDeg, plantScaleMultiplier]);

  // Update Geographic Map Texture when mapStyle or source coordinates change
  useEffect(() => {
    if (!groundMatRef.current) return;
    let cancelled = false;
    const newTexture = loadMapTextureAsync(
      mapStyle,
      source.latitude ?? JIZZAKH_NPP_LAT,
      source.longitude ?? JIZZAKH_NPP_LON,
      12000,
      undefined,
      (loadedTex) => {
        if (cancelled) {
          if (loadedTex !== currentTextureRef.current) loadedTex.dispose();
          return;
        }
        if (!groundMatRef.current) return;
        if (currentTextureRef.current && currentTextureRef.current !== loadedTex) {
          currentTextureRef.current.dispose();
        }
        currentTextureRef.current = loadedTex;
        groundMatRef.current.map = loadedTex;
        groundMatRef.current.needsUpdate = true;
      },
      (err) => {
        console.warn("Map texture update error handled with fallback:", err);
      },
    );
    if (currentTextureRef.current && currentTextureRef.current !== newTexture) {
      currentTextureRef.current.dispose();
    }
    currentTextureRef.current = newTexture;
    groundMatRef.current.map = newTexture;
    groundMatRef.current.needsUpdate = true;
    return () => {
      cancelled = true;
    };
  }, [mapStyle, source.latitude, source.longitude]);

  // Update Protective Action Zones geometries on ground map
  useEffect(() => {
    const group = zonesGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      const child = group.children[0]!;
      group.remove(child);
      if ("geometry" in child) (child as { geometry: THREE.BufferGeometry }).geometry.dispose();
    }

    if (!showZones || zones.length === 0) return;

    zones.forEach((zone) => {
      const r = Math.max(50, zone.radiusMeters);
      const ringGeo = new THREE.RingGeometry(r - 5, r + 5, 128);
      const ringMat = new THREE.MeshBasicMaterial({
        color: zone.colorHex,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.68,
        depthTest: false,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.y = 4.2;
      ringMesh.renderOrder = 10;
      group.add(ringMesh);
    });
  }, [zones, showZones]);

  // Update H*(10) Ground Dose Isolines
  useEffect(() => {
    const group = isolinesGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      const child = group.children[0]!;
      group.remove(child);
      if ("geometry" in child) (child as { geometry: THREE.BufferGeometry }).geometry.dispose();
    }

    if (!showIsolines || isolines.length === 0) return;

    isolines.forEach((iso) => {
      const pts = iso.points.map((p) => new THREE.Vector3(p.x, 4.5, p.z));
      if (pts.length > 2) {
        pts.push(pts[0]!.clone()); // Close loop
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const lineMat = new THREE.LineBasicMaterial({
          color: iso.colorHex,
          linewidth: 2,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
        });
        const line = new THREE.Line(lineGeo, lineMat);
        line.renderOrder = 11;
        group.add(line);
      }
    });
  }, [isolines, showIsolines]);

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      <div ref={mountRef} className="w-full h-full" />
    </div>
  );
}
