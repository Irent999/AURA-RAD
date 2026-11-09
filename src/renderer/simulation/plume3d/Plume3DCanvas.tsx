import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type {
  PlumeSource3D,
  Meteorology3D,
  Isotope3D,
  DosimeterProbe,
  ZoneBoundary3D,
} from "./types";
import {
  calculateDispersionCoefficients,
  calculatePointRadiologicalDose,
  worldToPlumeCoordinates,
} from "./gaussianPlume3D";

interface Plume3DCanvasProps {
  source: PlumeSource3D;
  meteorology: Meteorology3D;
  isotope: Isotope3D;
  probe: DosimeterProbe;
  onProbeMove: (newPos: { x: number; y: number; z: number }) => void;
  zones: ZoneBoundary3D[];
  showZones: boolean;
  showCenterline: boolean;
  particleDensity: "low" | "medium" | "high";
  cameraPreset: "perspective" | "top" | "side" | "downwind" | "source";
  onCameraPresetSettled?: () => void;
  isSimulating: boolean;
}

// Pre-allocated math helpers to ensure zero GC in the render loop
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _colorA = new THREE.Color();
const _raycaster = new THREE.Raycaster();
const _mouse = new THREE.Vector2();

export function Plume3DCanvas({
  source,
  meteorology,
  isotope,
  probe,
  onProbeMove,
  zones,
  showZones,
  showCenterline,
  particleDensity,
  cameraPreset,
  onCameraPresetSettled,
  isSimulating,
}: Plume3DCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  // References to preserve Three.js state across React renders
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // Scene dynamic objects
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
  const centerlineLineRef = useRef<THREE.Line | null>(null);
  const probeMeshRef = useRef<THREE.Group | null>(null);
  const windArrowGroupRef = useRef<THREE.Group | null>(null);

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
    probe,
    showZones,
    showCenterline,
    isSimulating,
    onProbeMove,
    onCameraPresetSettled,
  });
  useEffect(() => {
    propsRef.current = {
      source,
      meteorology,
      isotope,
      probe,
      showZones,
      showCenterline,
      isSimulating,
      onProbeMove,
      onCameraPresetSettled,
    };
  }, [
    source,
    meteorology,
    isotope,
    probe,
    showZones,
    showCenterline,
    isSimulating,
    onProbeMove,
    onCameraPresetSettled,
  ]);

  // Handle camera presets
  const applyCameraPreset = useCallback(
    (preset: "perspective" | "top" | "side" | "downwind" | "source") => {
      const windAngleRad = (((meteorology.windDirectionDeg + 180) % 360) * Math.PI) / 180;
      const dwX = Math.sin(windAngleRad);
      const dwZ = -Math.cos(windAngleRad);

      let targetPos = new THREE.Vector3(500, 350, 700);
      let targetLookAt = new THREE.Vector3(dwX * 600, 40, dwZ * 600);

      switch (preset) {
        case "top":
          targetPos = new THREE.Vector3(dwX * 800, 2200, dwZ * 800 + 0.1);
          targetLookAt = new THREE.Vector3(dwX * 800, 0, dwZ * 800);
          break;
        case "side":
          // Crosswind side perspective
          targetPos = new THREE.Vector3(-dwZ * 1400 + dwX * 600, 400, dwX * 1400 + dwZ * 600);
          targetLookAt = new THREE.Vector3(dwX * 600, 60, dwZ * 600);
          break;
        case "downwind":
          // Standing downwind looking back up at source
          targetPos = new THREE.Vector3(dwX * 1800, 150, dwZ * 1800);
          targetLookAt = new THREE.Vector3(0, source.effectiveHeight, 0);
          break;
        case "source":
          // Close-up at release stack
          targetPos = new THREE.Vector3(-150, 120, -150);
          targetLookAt = new THREE.Vector3(0, source.effectiveHeight * 0.7, 0);
          break;
        case "perspective":
        default:
          targetPos = new THREE.Vector3(-dwZ * 900 - dwX * 200, 450, dwX * 900 - dwZ * 200);
          targetLookAt = new THREE.Vector3(dwX * 500, 50, dwZ * 500);
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

  // Main Scene Initialization
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
    scene.fog = new THREE.FogExp2("#080c12", 0.00035);
    sceneRef.current = scene;

    // 3. Camera & Controls
    const camera = new THREE.PerspectiveCamera(45, width / height, 5, 25000);
    camera.position.set(600, 400, 800);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // Prevent going beneath ground
    controls.minDistance = 30;
    controls.maxDistance = 8000;
    controlsRef.current = controls;

    // Cancel scripted camera transitions when user starts interacting
    controls.addEventListener("start", () => {
      cameraTargetRef.current.active = false;
    });

    // 4. Lighting Rig (Warm Key Light + Cool Hemisphere Fill)
    const hemiLight = new THREE.HemisphereLight("#93c5fd", "#0f172a", 0.7);
    hemiLight.position.set(0, 1000, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight("#fef08a", 1.2);
    dirLight.position.set(600, 1200, 800);
    dirLight.castShadow = !isSoftwareGl;
    if (dirLight.shadow) {
      dirLight.shadow.mapSize.width = 1024;
      dirLight.shadow.mapSize.height = 1024;
      dirLight.shadow.camera.near = 100;
      dirLight.shadow.camera.far = 4000;
      const d = 1000;
      dirLight.shadow.camera.left = -d;
      dirLight.shadow.camera.right = d;
      dirLight.shadow.camera.top = d;
      dirLight.shadow.camera.bottom = -d;
      dirLight.shadow.bias = -0.0005;
    }
    scene.add(dirLight);

    // Subtle blue accent back light
    const backLight = new THREE.DirectionalLight("#38bdf8", 0.6);
    backLight.position.set(-800, 600, -800);
    scene.add(backLight);

    // 5. High-Tech Ground Terrain & Grid System
    const groundSize = 12000;
    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, 4, 4);
    const groundMat = new THREE.MeshStandardMaterial({
      color: "#0a0f18",
      roughness: 0.9,
      metalness: 0.1,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = !isSoftwareGl;
    scene.add(groundMesh);

    // Radar coordinate grid
    const gridHelper = new THREE.GridHelper(groundSize, 120, "#1e293b", "#0f172a");
    gridHelper.position.y = 0.2;
    scene.add(gridHelper);

    // Range rings (500m, 1km, 2km, 5km)
    const rangeDistances = [500, 1000, 2000, 5000];
    rangeDistances.forEach((r) => {
      const ringGeo = new THREE.RingGeometry(r - 3, r + 3, 128);
      const ringMat = new THREE.MeshBasicMaterial({
        color: "#334155",
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.35,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.y = 0.3;
      scene.add(ringMesh);
    });

    // 6. Procedural Composite Industrial Reactor / Stack Facility (3-12 parts)
    const facilityGroup = new THREE.Group();
    facilityGroup.position.set(source.position.x, 0, source.position.z);

    // Part 1: Heavy Reinforced Concrete Base Foundation
    const baseGeo = new THREE.BoxGeometry(60, 6, 60);
    const baseMat = new THREE.MeshStandardMaterial({
      color: "#334155",
      roughness: 0.85,
      metalness: 0.2,
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = 3;
    baseMesh.castShadow = !isSoftwareGl;
    baseMesh.receiveShadow = !isSoftwareGl;
    facilityGroup.add(baseMesh);

    // Part 2: Reactor Reactor Dome / Auxiliary Building
    const buildingGeo = new THREE.BoxGeometry(38, 22, 38);
    const buildingMat = new THREE.MeshStandardMaterial({
      color: "#475569",
      roughness: 0.7,
      metalness: 0.3,
    });
    const buildingMesh = new THREE.Mesh(buildingGeo, buildingMat);
    buildingMesh.position.set(-10, 14, -10);
    buildingMesh.castShadow = !isSoftwareGl;
    facilityGroup.add(buildingMesh);

    const domeGeo = new THREE.SphereGeometry(14, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshStandardMaterial({
      color: "#64748b",
      roughness: 0.5,
      metalness: 0.4,
    });
    const domeMesh = new THREE.Mesh(domeGeo, domeMat);
    domeMesh.position.set(-10, 25, -10);
    domeMesh.castShadow = !isSoftwareGl;
    facilityGroup.add(domeMesh);

    // Part 3: Ventilation Stack (Emission Chimney)
    const stackHeight = Math.max(25, source.effectiveHeight);
    const stackGeo = new THREE.CylinderGeometry(3.5, 5.5, stackHeight, 24);
    const stackMat = new THREE.MeshStandardMaterial({
      color: "#e2e8f0",
      roughness: 0.4,
      metalness: 0.3,
    });
    const stackMesh = new THREE.Mesh(stackGeo, stackMat);
    stackMesh.position.set(12, stackHeight / 2 + 3, 12);
    stackMesh.castShadow = !isSoftwareGl;
    facilityGroup.add(stackMesh);

    // Part 4 & 5: Red Warning Bands on Chimney
    const bandHeight = stackHeight * 0.12;
    const bandGeo = new THREE.CylinderGeometry(3.6, 3.8, bandHeight, 24);
    const bandMat = new THREE.MeshStandardMaterial({
      color: "#ef4444",
      roughness: 0.4,
      metalness: 0.2,
    });
    const bandMesh1 = new THREE.Mesh(bandGeo, bandMat);
    bandMesh1.position.set(12, stackHeight * 0.75 + 3, 12);
    facilityGroup.add(bandMesh1);

    const bandMesh2 = new THREE.Mesh(bandGeo, bandMat);
    bandMesh2.position.set(12, stackHeight * 0.45 + 3, 12);
    facilityGroup.add(bandMesh2);

    // Part 6: Flashing Aviation Beacon Atop Chimney
    const beaconGeo = new THREE.SphereGeometry(1.5, 12, 12);
    const beaconMat = new THREE.MeshBasicMaterial({ color: "#ff2222" });
    const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
    beaconMesh.position.set(12, stackHeight + 4, 12);
    facilityGroup.add(beaconMesh);

    // Part 7: Ground Contact Shadow Plane
    const contactGeo = new THREE.PlaneGeometry(90, 90);
    const contactCanvas = document.createElement("canvas");
    contactCanvas.width = 128;
    contactCanvas.height = 128;
    const ctx = contactCanvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(64, 64, 5, 64, 64, 60);
    grad.addColorStop(0, "rgba(0, 0, 0, 0.75)");
    grad.addColorStop(0.5, "rgba(0, 0, 0, 0.35)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const contactTexture = new THREE.CanvasTexture(contactCanvas);
    const contactMat = new THREE.MeshBasicMaterial({
      map: contactTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.75,
    });
    const contactMesh = new THREE.Mesh(contactGeo, contactMat);
    contactMesh.rotation.x = -Math.PI / 2;
    contactMesh.position.y = 0.25;
    facilityGroup.add(contactMesh);

    scene.add(facilityGroup);

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

    // Initialize particles along initial plume trajectory
    for (let i = 0; i < count; i++) {
      lifeTimes[i] = 12 + Math.random() * 20; // 12-32 seconds travel life
      ages[i] = Math.random() * lifeTimes[i]; // Stagger initial ages
      // Normalized Gaussian offsets (-3 to +3 standard deviations)
      latOffsets[i] = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.5;
      vertOffsets[i] = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.5;
      speeds[i] = 0.85 + Math.random() * 0.3; // Local wind speed turbulence
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
      size: 35,
      map: particleTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(particlesGeo, particlesMat);
    scene.add(particles);
    particlesRef.current = particles;

    // 8. Protective Zones Visual Group
    const zonesGroup = new THREE.Group();
    scene.add(zonesGroup);
    zonesGroupRef.current = zonesGroup;

    // 9. Centerline Visual Trajectory Line
    const centerlineGeo = new THREE.BufferGeometry();
    const centerlineMat = new THREE.LineBasicMaterial({
      color: "#06b6d4",
      linewidth: 2,
      transparent: true,
      opacity: 0.8,
    });
    const centerlineLine = new THREE.Line(centerlineGeo, centerlineMat);
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

    // Interactive pointer drag / click placement for the sensor probe
    const onPointerDown = (event: MouseEvent) => {
      if (event.button !== 0 || !event.shiftKey) return; // Shift + Click to place probe
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

    // Resize Handler
    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

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

      // Beacon flashing
      beaconMesh.material.color.setHex(now % 1000 < 500 ? 0xff2222 : 0x440000);

      // Update wind compass orientation
      if (windArrowGroupRef.current) {
        const windTravelRad = (((met.windDirectionDeg + 180) % 360) * Math.PI) / 180;
        windArrowGroupRef.current.rotation.y = -windTravelRad;
      }

      // Update probe position in 3D
      if (probeMeshRef.current) {
        probeMeshRef.current.position.set(curProbe.x, 0, curProbe.y);
      }

      // Update Protective Zones
      if (zonesGroupRef.current) {
        zonesGroupRef.current.visible = sz;
      }

      // Update Centerline Trajectory Line
      if (centerlineLineRef.current) {
        centerlineLineRef.current.visible = sc;
        const windTravelRad = (((met.windDirectionDeg + 180) % 360) * Math.PI) / 180;
        const dwX = Math.sin(windTravelRad);
        const dwZ = -Math.cos(windTravelRad);
        const pts: THREE.Vector3[] = [];
        for (let d = 0; d <= 6000; d += 100) {
          pts.push(new THREE.Vector3(dwX * d, src.effectiveHeight, dwZ * d));
        }
        centerlineLineRef.current.geometry.setFromPoints(pts);
      }

      // Update Atmospheric Gaussian Plume Particle System
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

        const stackX = src.position.x;
        const stackZ = src.position.z;
        const effH = src.effectiveHeight;

        for (let i = 0; i < pCount; i++) {
          if (simActive) {
            pData.ages[i] += dt * pData.speeds[i];
          }

          // Recycle particle when lifetime reached
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
          // Downwind travel distance x = u * age * scaleFactor
          // For visualization scale, 1 unit = 1 meter
          const xDownwind = u * age * 18; // scaled for visible dynamic transit

          const { sigmaY, sigmaZ } = calculateDispersionCoefficients(xDownwind, met.stabilityClass);

          // Crosswind and vertical Gaussian spread
          const yCrosswind = pData.latOffsets[i] * sigmaY;
          // Vertical elevation with ground bounce (z >= 0)
          let zElev = effH + pData.vertOffsets[i] * sigmaZ;
          if (zElev < 1.0) zElev = Math.abs(zElev) + 1.0; // Ground reflection
          if (met.mixingHeight > 0 && zElev > met.mixingHeight) {
            zElev = met.mixingHeight - Math.abs(zElev - met.mixingHeight); // Inversion lid reflection
          }

          // World coordinates
          const wx = stackX + unitDwX * xDownwind + unitCwX * yCrosswind;
          const wy = Math.max(0.5, zElev);
          const wz = stackZ + unitDwZ * xDownwind + unitCwZ * yCrosswind;

          posAttr.setXYZ(i, wx, wy, wz);

          // Physical Radiological Hazard Color Ramp:
          // Centerline dose rate determines color
          const ptDose = calculatePointRadiologicalDose(
            xDownwind,
            yCrosswind,
            zElev,
            src,
            met,
            iso,
            1.0,
          );

          // Hazard color map:
          // > 10 mSv/h: Red/Magenta
          // 1 - 10 mSv/h: Orange
          // 0.1 - 1 mSv/h: Yellow
          // < 0.1 mSv/h: Cyan/Green
          const dose = ptDose.totalDoseRate;
          if (dose > 20) {
            _colorA.setRGB(1.0, 0.05, 0.2); // Core hazard magenta-red
          } else if (dose > 5.0) {
            _colorA.setRGB(0.95, 0.25, 0.05); // High danger orange-red
          } else if (dose > 1.0) {
            _colorA.setRGB(0.92, 0.65, 0.08); // Evacuation zone amber-yellow
          } else if (dose > 0.1) {
            _colorA.setRGB(0.1, 0.85, 0.5); // Monitoring zone green
          } else {
            _colorA.setRGB(0.02, 0.7, 0.85); // Safe background cyan
          }

          colAttr.setXYZ(i, _colorA.r, _colorA.g, _colorA.b);

          // Dynamic particle size expands as cloud disperses downwind
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
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [source.position.x, source.position.z, source.effectiveHeight, particleDensity]);

  // Update Protective Action Zones geometries when zones or wind direction change
  useEffect(() => {
    const group = zonesGroupRef.current;
    if (!group) return;

    // Clear old zone meshes
    while (group.children.length > 0) {
      const child = group.children[0]!;
      group.remove(child);
      if ("geometry" in child) (child as { geometry: THREE.BufferGeometry }).geometry.dispose();
    }

    if (!showZones || zones.length === 0) return;

    zones.forEach((zone) => {
      const r = Math.max(50, zone.radiusMeters);
      const ringGeo = new THREE.RingGeometry(r - 4, r + 4, 128);
      const ringMat = new THREE.MeshBasicMaterial({
        color: zone.colorHex,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.65,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.y = 0.4;
      group.add(ringMesh);
    });
  }, [zones, showZones]);

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      <div ref={mountRef} className="w-full h-full" />
    </div>
  );
}
