import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { VREmergencySystem, type VRTelemetry } from "./vrEmergencySystem";
import {
  ChevronDown,
  ChevronUp,
  Droplets,
  Flame,
  Maximize2,
  Minimize2,
  RotateCcw,
  ShieldAlert,
  Upload,
  Users,
  Wind,
  X,
} from "lucide-react";
import type { DispersionInput, StabilityClass } from "../hotspot/lib/types";
import { DEFAULT_PLANT_BEARING_DEG, VVER1200_STACK_LOCAL_POS } from "./generateVVER1200Plant";

export type AccidentScenarioMode = DispersionInput["calculationType"];

export interface NppInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  lat: number;
  lon: number;
  windDirectionDeg: number;
  windSpeedMs: number;
  stabilityClass: StabilityClass;
  stackHeightM: number;
  bearingDeg?: number;
  calculationType: AccidentScenarioMode;
  onChangeCalculationType?: (mode: AccidentScenarioMode) => void;
}

interface ScenarioMeta {
  id: AccidentScenarioMode;
  shortLabel: string;
  title: string;
  description: string;
  accentHex: string;
}

const SCENARIO_LIST: ScenarioMeta[] = [
  {
    id: "plume",
    shortLabel: "Continuous Plume",
    title: "Непрерывный факел (Continuous Plume)",
    description:
      "Постоянный поток выброса из вентиляционной трубы с формированием устойчивого шлейфа по направлению ветра и гауссовым рассеянием по осям σy, σz.",
    accentHex: "#06b6d4",
  },
  {
    id: "puff",
    shortLabel: "Puff Release",
    title: "Залповый выброс (Puff Release)",
    description:
      "Мгновенное формирование локального сферического облака, которое отрывается от источника, дрейфует со скоростью ветра и расширяется по мере разбавления.",
    accentHex: "#f59e0b",
  },
  {
    id: "shortTerm",
    shortLabel: "Short-term (Acute)",
    title: "Кратковременный острый (Short-term Acute)",
    description:
      "Интенсивный импульсный выброс ограниченной длительности с плотным высокодозовым фронтом и выраженной пиковой зоной приземного воздействия.",
    accentHex: "#ef4444",
  },
  {
    id: "longTerm",
    shortLabel: "Long-term (Chronic)",
    title: "Долгосрочный хронический (Long-term Chronic)",
    description:
      "Длительное накопительное воздействие: протяжённый шлейф сочетается с формированием устойчивого приземного следа выпадений (осаждения) по сектору ветра.",
    accentHex: "#10b981",
  },
];

interface FireHotspotState {
  id: string;
  label: string;
  position: [number, number, number];
  truckPos: [number, number, number];
  progress: number; // 0..100
  extinguished: boolean;
}

interface EvacGroupState {
  id: string;
  label: string;
  count: number;
  waypoints: [number, number, number][];
  status: "waiting" | "moving" | "safe";
  progress: number; // 0..1
}

const INITIAL_FIRE_HOTSPOTS: FireHotspotState[] = [
  {
    id: "fire-turbine",
    label: "Турбинный зал №2",
    position: [-145, 58, 330],
    truckPos: [-320, 4, 420],
    progress: 0,
    extinguished: false,
  },
  {
    id: "fire-oru",
    label: "Трансформатор ОРУ",
    position: [-110, 26, -495],
    truckPos: [-255, 4, -560],
    progress: 0,
    extinguished: false,
  },
  {
    id: "fire-diesel",
    label: "Топливный узел",
    position: [-790, 54, -550],
    truckPos: [-895, 4, -420],
    progress: 0,
    extinguished: false,
  },
  {
    id: "fire-pump",
    label: "Насосная градирен",
    position: [170, 36, 210],
    truckPos: [200, 4, 40],
    progress: 0,
    extinguished: false,
  },
];

const SAFE_ZONE_POS: [number, number, number] = [-1080, 4, -960];

const INITIAL_EVAC_GROUPS: EvacGroupState[] = [
  {
    id: "evac-turbine",
    label: "Турбинный цех",
    count: 24,
    waypoints: [
      [-230, 5, 410],
      [-400, 5, 360],
      [-400, 5, -135],
      [-905, 5, -135],
      [-905, 5, -780],
      SAFE_ZONE_POS,
    ],
    status: "waiting",
    progress: 0,
  },
  {
    id: "evac-control",
    label: "Смена БЩУ и АБК",
    count: 18,
    waypoints: [[-630, 5, -420], [-760, 5, -350], [-905, 5, -350], [-905, 5, -800], SAFE_ZONE_POS],
    status: "waiting",
    progress: 0,
  },
  {
    id: "evac-oru",
    label: "Бригада ОРУ-500",
    count: 12,
    waypoints: [[-35, 5, -240], [-35, 5, -135], [-905, 5, -135], [-905, 5, -790], SAFE_ZONE_POS],
    status: "waiting",
    progress: 0,
  },
  {
    id: "evac-security",
    label: "Охрана и КПП",
    count: 16,
    waypoints: [[-895, 5, 160], [-905, 5, -135], [-905, 5, -780], SAFE_ZONE_POS],
    status: "waiting",
    progress: 0,
  },
];

const TOTAL_EVAC_PEOPLE = INITIAL_EVAC_GROUPS.reduce((sum, g) => sum + g.count, 0);

// Pre-allocated math helpers outside animation loop (Zero GC)
const _tmpVecA = new THREE.Vector3();
const _tmpVecB = new THREE.Vector3();
const _tmpVecC = new THREE.Vector3();
const _tmpColor = new THREE.Color();
const _raycaster = new THREE.Raycaster();
const _pointerNdc = new THREE.Vector2();

const _colCyan = new THREE.Color("#06b6d4");
const _colEmerald = new THREE.Color("#10b981");
const _colAmber = new THREE.Color("#f59e0b");
const _colRed = new THREE.Color("#ef4444");
const _colWhite = new THREE.Color("#e2e8f0");

function createGroundGridTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#0e1726";
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = "rgba(56, 189, 248, 0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 512; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 512, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(28, 28);
  tex.needsUpdate = true;
  return tex;
}

function createFalloutFootprintTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 512, 256);

  // Longitudinal cumulative ground deposition gradient along +X (scaled & rotated to wind)
  const grad = ctx.createRadialGradient(70, 128, 12, 230, 128, 260);
  grad.addColorStop(0.0, "rgba(239, 68, 68, 0.58)");
  grad.addColorStop(0.28, "rgba(245, 158, 11, 0.44)");
  grad.addColorStop(0.62, "rgba(16, 185, 129, 0.28)");
  grad.addColorStop(0.88, "rgba(6, 182, 212, 0.12)");
  grad.addColorStop(1.0, "rgba(6, 182, 212, 0.0)");

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(245, 128, 240, 96, 0, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function buildFireTruckGroup(): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: "#dc2626",
    roughness: 0.42,
    metalness: 0.28,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: "#f8fafc",
    roughness: 0.45,
    metalness: 0.15,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: "#1e293b",
    roughness: 0.7,
    metalness: 0.2,
  });
  const beaconMat = new THREE.MeshBasicMaterial({ color: "#38bdf8" });

  // 1. Chassis
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(36, 9, 16), darkMat);
  chassis.position.y = 6;
  group.add(chassis);
  // 2. Cab
  const cab = new THREE.Mesh(new THREE.BoxGeometry(12, 13, 15), bodyMat);
  cab.position.set(12, 13, 0);
  group.add(cab);
  // 3. Tank body
  const tank = new THREE.Mesh(new THREE.BoxGeometry(22, 14, 15.5), bodyMat);
  tank.position.set(-6, 14, 0);
  group.add(tank);
  // 4. White stripe
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(34.5, 3, 16), trimMat);
  stripe.position.set(0, 11.5, 0);
  group.add(stripe);
  // 5. Roof monitor nozzle
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 6, 10), trimMat);
  turret.position.set(-4, 23, 0);
  group.add(turret);
  // 6. Roof beacon + wheels
  const beacon = new THREE.Mesh(new THREE.BoxGeometry(4, 2.5, 8), beaconMat);
  beacon.position.set(12, 20.5, 0);
  group.add(beacon);

  const wheelGeo = new THREE.CylinderGeometry(4.2, 4.2, 3, 12);
  wheelGeo.rotateX(Math.PI / 2);
  for (const [wx, wz] of [
    [12, 8.2],
    [12, -8.2],
    [-10, 8.2],
    [-10, -8.2],
  ]) {
    const w = new THREE.Mesh(wheelGeo, darkMat);
    w.position.set(wx, 4.2, wz);
    group.add(w);
  }
  return group;
}

function buildEvacSquadGroup(): THREE.Group {
  const group = new THREE.Group();
  const vestMat = new THREE.MeshStandardMaterial({
    color: "#10b981",
    emissive: "#059669",
    emissiveIntensity: 0.4,
    roughness: 0.45,
  });
  const helmetMat = new THREE.MeshStandardMaterial({
    color: "#facc15",
    roughness: 0.35,
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: "#34d399",
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });

  const ring = new THREE.Mesh(new THREE.RingGeometry(18, 25, 24), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 1.2;
  group.add(ring);

  const offsets = [
    [-8, 0, -6],
    [8, 0, -5],
    [0, 0, 8],
  ];
  for (const [ox, oy, oz] of offsets) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5.2, 16, 10), vestMat);
    body.position.set(ox, oy + 9, oz);
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(3.6, 10, 10), helmetMat);
    head.position.set(ox, oy + 20, oz);
    group.add(head);
  }

  return group;
}

function buildSafeZoneGroup(): THREE.Group {
  const group = new THREE.Group();
  const padMat = new THREE.MeshStandardMaterial({
    color: "#064e3b",
    roughness: 0.75,
    metalness: 0.1,
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: "#34d399",
    side: THREE.DoubleSide,
  });
  const tentMat = new THREE.MeshStandardMaterial({
    color: "#ecfdf5",
    roughness: 0.65,
  });
  const crossMat = new THREE.MeshBasicMaterial({ color: "#10b981" });

  const pad = new THREE.Mesh(new THREE.CylinderGeometry(95, 102, 4, 36), padMat);
  pad.position.y = 2;
  group.add(pad);

  const ring = new THREE.Mesh(new THREE.RingGeometry(82, 92, 36), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 4.6;
  group.add(ring);

  const tent = new THREE.Mesh(new THREE.BoxGeometry(58, 22, 36), tentMat);
  tent.position.set(-20, 15, -18);
  group.add(tent);

  const crossA = new THREE.Mesh(new THREE.BoxGeometry(24, 1.5, 6), crossMat);
  crossA.position.set(-20, 26.8, -18);
  group.add(crossA);

  const crossB = new THREE.Mesh(new THREE.BoxGeometry(6, 1.5, 24), crossMat);
  crossB.position.set(-20, 26.8, -18);
  group.add(crossB);

  const beaconPole = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 56, 10), tentMat);
  beaconPole.position.set(42, 30, 28);
  group.add(beaconPole);

  const beaconOrb = new THREE.Mesh(
    new THREE.SphereGeometry(7, 14, 14),
    new THREE.MeshBasicMaterial({ color: "#34d399" }),
  );
  beaconOrb.position.set(42, 60, 28);
  group.add(beaconOrb);

  return group;
}

export function NppInspectorModal({
  isOpen,
  onClose,
  lat,
  lon,
  windDirectionDeg,
  windSpeedMs,
  stabilityClass,
  stackHeightM,
  bearingDeg = DEFAULT_PLANT_BEARING_DEG,
  calculationType,
  onChangeCalculationType,
}: NppInspectorModalProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [activeScenario, setActiveScenario] = useState<AccidentScenarioMode>(calculationType);
  const [mchsMode, setMchsMode] = useState(false);

  const [glbSourceUrl, setGlbSourceUrl] = useState<string>("/assembly.glb");
  const [glbLabel, setGlbLabel] = useState<string>("assembly.glb");
  const [loadProgress, setLoadProgress] = useState<number>(0);
  const [isLoadingModel, setIsLoadingModel] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fires, setFires] = useState<FireHotspotState[]>(() =>
    INITIAL_FIRE_HOTSPOTS.map((f) => ({ ...f })),
  );
  const [evacGroups, setEvacGroups] = useState<EvacGroupState[]>(() =>
    INITIAL_EVAC_GROUPS.map((g) => ({ ...g })),
  );
  const [activeExtinguishId, setActiveExtinguishId] = useState<string | null>(null);
  const [hoveredTargetLabel, setHoveredTargetLabel] = useState<string | null>(null);

  const [vrActive, setVrActive] = useState(false);
  const [fpActive, setFpActive] = useState(false);
  const [vrStatusMsg, setVrStatusMsg] = useState<string | null>(null);
  const [vrTelemetry, setVrTelemetry] = useState<VRTelemetry>({
    doseRate: 0.08,
    accumulatedDose: 0,
    hazardLevel: "normal",
  });

  const mountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const customObjectUrlRef = useRef<string | null>(null);

  const scaledBaseFiresRef = useRef<FireHotspotState[]>(
    INITIAL_FIRE_HOTSPOTS.map((f) => ({ ...f })),
  );
  const scaledBaseEvacsRef = useRef<EvacGroupState[]>(
    INITIAL_EVAC_GROUPS.map((g) => ({
      ...g,
      waypoints: g.waypoints.map((w) => [...w] as [number, number, number]),
    })),
  );

  const scenarioRef = useRef<AccidentScenarioMode>(activeScenario);
  scenarioRef.current = activeScenario;
  const mchsModeRef = useRef<boolean>(mchsMode);
  mchsModeRef.current = mchsMode;
  const windDirRef = useRef<number>(windDirectionDeg);
  windDirRef.current = windDirectionDeg;
  const windSpeedRef = useRef<number>(windSpeedMs);
  windSpeedRef.current = windSpeedMs;
  const stackHeightRef = useRef<number>(stackHeightM);
  stackHeightRef.current = stackHeightM;

  const firesRef = useRef<FireHotspotState[]>(fires);
  firesRef.current = fires;
  const evacGroupsRef = useRef<EvacGroupState[]>(evacGroups);
  evacGroupsRef.current = evacGroups;
  const activeExtinguishRef = useRef<string | null>(activeExtinguishId);
  activeExtinguishRef.current = activeExtinguishId;

  const cameraActionRef = useRef<{
    setPreset: (preset: "iso" | "top" | "plume") => void;
    triggerPuff: () => void;
  } | null>(null);

  const vrControlRef = useRef<{
    enterVR: () => void;
    enableFirstPerson: () => void;
    disableFirstPerson: () => void;
  } | null>(null);

  // Sync calculationType from parent prop when opened or updated
  useEffect(() => {
    setActiveScenario(calculationType);
  }, [calculationType]);

  // Escape key exits first-person / fullscreen first, then closes modal
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (fpActive) {
          vrControlRef.current?.disableFirstPerson();
        } else if (isFullscreen) {
          setIsFullscreen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, fpActive, isFullscreen, onClose]);

  const handleSelectScenario = (mode: AccidentScenarioMode) => {
    setActiveScenario(mode);
    onChangeCalculationType?.(mode);
    if (mode === "puff" || mode === "shortTerm") {
      cameraActionRef.current?.triggerPuff();
    }
  };

  const burstClearTimerRef = useRef<number | null>(null);

  const handleExtinguishBurst = useCallback((fireId: string) => {
    setActiveExtinguishId(fireId);
    if (burstClearTimerRef.current !== null) {
      window.clearTimeout(burstClearTimerRef.current);
    }
    burstClearTimerRef.current = window.setTimeout(() => {
      setActiveExtinguishId((cur) => (cur === fireId ? null : cur));
    }, 600);
    setFires((prev) =>
      prev.map((f) => {
        if (f.id !== fireId || f.extinguished) return f;
        const nextProg = Math.min(100, f.progress + 34);
        return {
          ...f,
          progress: nextProg,
          extinguished: nextProg >= 100,
        };
      }),
    );
  }, []);

  const handleDispatchEvacGroup = useCallback((groupId: string) => {
    setEvacGroups((prev) =>
      prev.map((g) =>
        g.id === groupId && g.status === "waiting" ? { ...g, status: "moving" } : g,
      ),
    );
  }, []);

  const handleEvacuateAll = useCallback(() => {
    setEvacGroups((prev) =>
      prev.map((g) => (g.status === "waiting" ? { ...g, status: "moving" } : g)),
    );
  }, []);

  const handleResetEmergency = useCallback(() => {
    setActiveExtinguishId(null);
    setFires(scaledBaseFiresRef.current.map((f) => ({ ...f })));
    setEvacGroups(
      scaledBaseEvacsRef.current.map((g) => ({
        ...g,
        waypoints: g.waypoints.map((w) => [...w] as [number, number, number]),
      })),
    );
  }, []);

  const handleGlbFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (customObjectUrlRef.current) {
      URL.revokeObjectURL(customObjectUrlRef.current);
      customObjectUrlRef.current = null;
    }
    const objUrl = URL.createObjectURL(file);
    customObjectUrlRef.current = objUrl;
    setGlbLabel(file.name);
    setGlbSourceUrl(objUrl);
    e.target.value = "";
  };

  const handleResetToDefaultGlb = () => {
    if (customObjectUrlRef.current) {
      URL.revokeObjectURL(customObjectUrlRef.current);
      customObjectUrlRef.current = null;
    }
    setGlbLabel("assembly.glb");
    setGlbSourceUrl("/assembly.glb");
  };

  useEffect(() => {
    return () => {
      if (customObjectUrlRef.current) {
        URL.revokeObjectURL(customObjectUrlRef.current);
      }
    };
  }, []);

  // Main Three.js Scene Lifecycle inside Modal
  useEffect(() => {
    if (!isOpen) return;
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return true;
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const initW = Math.max(300, container.clientWidth);
    const initH = Math.max(240, container.clientHeight);
    renderer.setSize(initW, initH);

    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.innerHTML = "";
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b1120");
    scene.fog = new THREE.FogExp2("#0b1120", 0.00014);

    // Studio Environment Map (RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envRenderTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRenderTarget.texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(50, initW / initH, 0.05, 25000);
    camera.position.set(-1450, 1180, 1550);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.minDistance = 180;
    controls.maxDistance = 6500;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.target.set(-80, 40, -20);
    controls.update();

    // Smooth camera preset transition state (cancelled on user OrbitControls 'start')
    let camTransition: {
      pos: THREE.Vector3;
      target: THREE.Vector3;
    } | null = null;

    const onControlsStart = () => {
      camTransition = null;
    };
    controls.addEventListener("start", onControlsStart);

    // Lighting: Hemisphere + directional with shadows for VR-scale detail
    const hemiLight = new THREE.HemisphereLight(0xcbd5e1, 0x1e293b, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.6);
    keyLight.position.set(1100, 1650, 950);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 200;
      keyLight.shadow.camera.far = 5200;
      const d = 1400;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.65);
    rimLight.position.set(-1200, 680, -1100);
    scene.add(rimLight);

    // Ground terrain plane (no floating void)
    const groundTex = createGroundGridTexture();
    groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: 0.92,
      metalness: 0.05,
    });
    const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), groundMat);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.y = -0.5;
    groundPlane.receiveShadow = !isSoftwareGl;
    scene.add(groundPlane);

    // Load GLB model root
    const modelContainer = new THREE.Group();
    scene.add(modelContainer);
    let loadedModelRoot: THREE.Object3D | null = null;
    const stackTipWorld = new THREE.Vector3(
      VVER1200_STACK_LOCAL_POS.x,
      Math.max(185, stackHeightRef.current),
      VVER1200_STACK_LOCAL_POS.z,
    );

    const puffCenterWorld = new THREE.Vector3();
    let puffRadiusWorld = 70;

    const syncStackTipFromModel = (rootObj: THREE.Object3D) => {
      rootObj.updateMatrixWorld(true);
      let namedTip: THREE.Object3D | undefined;
      rootObj.traverse((obj) => {
        if (namedTip) return;
        const n = (obj.name || "").toLowerCase();
        if (
          n === "ventilationstacktip" ||
          n.includes("ventstack") ||
          n.includes("stacktip") ||
          n.includes("chimney")
        ) {
          namedTip = obj;
        }
      });
      if (namedTip) {
        namedTip.getWorldPosition(stackTipWorld);
      } else {
        const box = new THREE.Box3().setFromObject(rootObj);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const sx = size.x / 1920;
        const sz = size.z / 1920;
        stackTipWorld.set(
          center.x + VVER1200_STACK_LOCAL_POS.x * sx,
          Math.max(box.max.y * 0.85, stackHeightRef.current),
          center.z + VVER1200_STACK_LOCAL_POS.z * sz,
        );
      }
    };

    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, loaded, total) => {
      if (total > 0) setLoadProgress(Math.round((loaded / total) * 100));
    };

    const gltfLoader = new GLTFLoader(manager);
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
    gltfLoader.setDRACOLoader(dracoLoader);
    let cancelled = false;
    setIsLoadingModel(true);
    setLoadError(null);
    setLoadProgress(12);

    let syncEmergencyTargetsToModel: ((modelBox: THREE.Box3) => void) | null = null;

    const loadValidatedGlb = async () => {
      try {
        const res = await fetch(glbSourceUrl);
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const buffer = await res.arrayBuffer();
        if (cancelled) return;

        const headerBytes = new Uint8Array(buffer.slice(0, 64));
        const headerText = new TextDecoder().decode(headerBytes).trimStart();
        const isBinaryGlb =
          headerBytes.length >= 4 &&
          headerBytes[0] === 0x67 &&
          headerBytes[1] === 0x6c &&
          headerBytes[2] === 0x54 &&
          headerBytes[3] === 0x46; // "glTF"
        const isJsonGltf = headerText.startsWith("{");

        if (!isBinaryGlb && !isJsonGltf) {
          if (headerText.startsWith("version https://git-lfs")) {
            throw new Error(
              "Файл является Git LFS-указателем. Поместите реальный assembly.glb в public/ или загрузите .GLB кнопкой выше.",
            );
          }
          throw new Error(
            `Файл ${glbSourceUrl} не найден в public/ — загрузите модель кнопкой «Загрузить .GLB».`,
          );
        }

        setLoadProgress(65);
        gltfLoader.parse(
          buffer,
          "",
          (gltf) => {
            if (cancelled) return;
            const model = gltf.scene;

            // Compute raw bounds; normalize only tiny/giant models to ~1800m human scale
            const rawBox = new THREE.Box3().setFromObject(model);
            const rawSize = rawBox.getSize(new THREE.Vector3());
            const maxHorizontal = Math.max(rawSize.x, rawSize.z, 1);
            if (maxHorizontal < 250 || maxHorizontal > 5500) {
              model.scale.multiplyScalar(1800 / maxHorizontal);
            }

            // Align base strictly to y = 0 and center on X/Z
            const alignedBox = new THREE.Box3().setFromObject(model);
            const alignedCenter = alignedBox.getCenter(new THREE.Vector3());
            model.position.x -= alignedCenter.x;
            model.position.z -= alignedCenter.z;
            model.position.y -= alignedBox.min.y;

            model.traverse((child) => {
              const mesh = child as THREE.Mesh;
              if (mesh.isMesh) {
                mesh.castShadow = !isSoftwareGl;
                mesh.receiveShadow = !isSoftwareGl;
              }
            });

            loadedModelRoot = model;
            modelContainer.add(model);
            syncStackTipFromModel(model);

            const finalBox = new THREE.Box3().setFromObject(model);
            syncEmergencyTargetsToModel?.(finalBox);

            setIsLoadingModel(false);
            setLoadProgress(100);
          },
          (parseErr) => {
            if (cancelled) return;
            setIsLoadingModel(false);
            setLoadError(
              parseErr instanceof Error
                ? `Ошибка разбора GLB: ${parseErr.message}`
                : "Не удалось разобрать файл .glb",
            );
          },
        );
      } catch (err) {
        if (cancelled) return;
        setIsLoadingModel(false);
        setLoadError(err instanceof Error ? err.message : "Не удалось загрузить файл .glb");
      }
    };
    void loadValidatedGlb();

    // =========================================================================
    // STAGE 3: 4 Accident / Release Scenario 3D Visuals
    // =========================================================================
    const PARTICLE_COUNT = 1600;
    const pPositions = new Float32Array(PARTICLE_COUNT * 3);
    const pColors = new Float32Array(PARTICLE_COUNT * 3);
    const pAges = new Float32Array(PARTICLE_COUNT);
    const pLives = new Float32Array(PARTICLE_COUNT);
    const pSeedY = new Float32Array(PARTICLE_COUNT);
    const pSeedZ = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      pAges[i] = Math.random() * 14;
      pLives[i] = 8 + Math.random() * 7;
      pSeedY[i] = (Math.random() - 0.5) * 2.0;
      pSeedZ[i] = (Math.random() - 0.5) * 2.0;
    }

    const pGeometry = new THREE.BufferGeometry();
    pGeometry.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
    pGeometry.setAttribute("color", new THREE.BufferAttribute(pColors, 3));
    const pMaterial = new THREE.PointsMaterial({
      size: 26,
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const plumeParticles = new THREE.Points(pGeometry, pMaterial);
    plumeParticles.frustumCulled = false;
    plumeParticles.renderOrder = 20;
    scene.add(plumeParticles);

    // Volumetric puff sphere (used prominently in Puff Release & Acute wave front)
    const puffCloudGroup = new THREE.Group();
    const puffOuterGeo = new THREE.SphereGeometry(1, 24, 18);
    const puffOuterMat = new THREE.MeshStandardMaterial({
      color: "#fbbf24",
      emissive: "#f59e0b",
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.34,
      roughness: 0.9,
      depthWrite: false,
    });
    const puffOuterMesh = new THREE.Mesh(puffOuterGeo, puffOuterMat);
    const puffInnerMesh = new THREE.Mesh(
      puffOuterGeo,
      new THREE.MeshBasicMaterial({
        color: "#ef4444",
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    );
    puffInnerMesh.scale.setScalar(0.55);
    puffCloudGroup.add(puffOuterMesh, puffInnerMesh);
    puffCloudGroup.renderOrder = 19;
    scene.add(puffCloudGroup);

    // Acute peak touchdown ring (Short-term Acute)
    const acuteRingMat = new THREE.MeshBasicMaterial({
      color: "#ef4444",
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const acuteRingMesh = new THREE.Mesh(new THREE.RingGeometry(85, 130, 36), acuteRingMat);
    acuteRingMesh.rotation.x = -Math.PI / 2;
    acuteRingMesh.position.y = 4.5;
    scene.add(acuteRingMesh);

    // Chronic cumulative ground fallout decal (Long-term Chronic)
    const falloutTex = createFalloutFootprintTexture();
    const falloutMat = new THREE.MeshBasicMaterial({
      map: falloutTex,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const falloutPlane = new THREE.Mesh(new THREE.PlaneGeometry(2400, 950), falloutMat);
    falloutPlane.rotation.x = -Math.PI / 2;
    falloutPlane.position.y = 4.2;
    falloutPlane.renderOrder = 12;
    scene.add(falloutPlane);

    // Wind indicator arrow at stack
    const windArrowGroup = new THREE.Group();
    const arrowShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(3.5, 3.5, 220, 8),
      new THREE.MeshBasicMaterial({ color: "#06b6d4", transparent: true, opacity: 0.75 }),
    );
    arrowShaft.rotation.z = Math.PI / 2;
    arrowShaft.position.x = 110;
    const arrowHead = new THREE.Mesh(
      new THREE.ConeGeometry(12, 34, 12),
      new THREE.MeshBasicMaterial({ color: "#06b6d4" }),
    );
    arrowHead.rotation.z = -Math.PI / 2;
    arrowHead.position.x = 230;
    windArrowGroup.add(arrowShaft, arrowHead);
    scene.add(windArrowGroup);

    // =========================================================================
    // STAGE 4: MCHS Emergency Response Group (Fires, Water Jets, Evac Routes)
    // =========================================================================
    const mchsGroup = new THREE.Group();
    scene.add(mchsGroup);

    const fireVisuals = new Map<string, FireVisualEntry>();
    const evacVisuals = new Map<string, EvacVisualEntry>();

    // VR Emergency System: player rig, controllers, fire hose, dosimeter, locomotion
    const vrSystem = new VREmergencySystem({
      renderer,
      camera,
      scene,
      getFires: () =>
        firesRef.current.map((f) => ({
          id: f.id,
          position: new THREE.Vector3(...f.position),
          intensity: 1 - f.progress / 100,
          extinguished: f.extinguished,
        })),
      getEvacs: () =>
        evacGroupsRef.current.map((g) => {
          const vis = evacVisuals.get(g.id);
          return {
            id: g.id,
            position: vis ? vis.squad.position.clone() : new THREE.Vector3(...g.waypoints[0]),
            status: g.status,
          };
        }),
      onExtinguishProgress: (id, delta) => {
        setActiveExtinguishId(id);
        setFires((prev) =>
          prev.map((f) => {
            if (f.id !== id || f.extinguished) return f;
            const nextProg = Math.min(100, f.progress + delta);
            return { ...f, progress: nextProg, extinguished: nextProg >= 100 };
          }),
        );
      },
      onDispatchEvac: (id) => {
        setEvacGroups((prev) =>
          prev.map((g) => (g.id === id && g.status === "waiting" ? { ...g, status: "moving" } : g)),
        );
      },
      getDoseContext: () => ({
        scenario: scenarioRef.current,
        stackTipWorld: stackTipWorld.clone(),
        windDirDeg: windDirRef.current,
        windSpeedMs: windSpeedRef.current,
        stackHeightM: stackHeightRef.current,
        puffCenterWorld: puffCenterWorld.clone(),
        puffRadius: puffRadiusWorld,
      }),
      onModeChange: ({ isInVR, fpMode, statusMsg }) => {
        const active = isInVR || fpMode;
        controls.enabled = !active;
        if (!active) {
          controls.update();
        } else {
          setMchsMode(true);
        }
        setVrActive(isInVR);
        setFpActive(fpMode);
        setVrStatusMsg(statusMsg ?? null);
      },
    });

    vrControlRef.current = {
      enterVR: () => {
        void vrSystem.enterVR();
      },
      enableFirstPerson: () => vrSystem.enableFirstPerson(),
      disableFirstPerson: () => vrSystem.disableFirstPerson(),
    };

    const safeZoneObj = buildSafeZoneGroup();
    safeZoneObj.position.set(...SAFE_ZONE_POS);
    mchsGroup.add(safeZoneObj);

    const clickableTargets: THREE.Object3D[] = [];

    interface FireVisualEntry {
      id: string;
      root: THREE.Group;
      flames: THREE.Mesh[];
      smokeOrb: THREE.Mesh;
      ringMat: THREE.MeshBasicMaterial;
      jetMesh: THREE.Mesh;
      truck: THREE.Group;
    }

    for (const f of INITIAL_FIRE_HOTSPOTS) {
      const fRoot = new THREE.Group();
      fRoot.position.set(...f.position);

      const flames: THREE.Mesh[] = [];
      const flameMatA = new THREE.MeshBasicMaterial({
        color: "#ff5a1f",
        transparent: true,
        opacity: 0.88,
      });
      const flameMatB = new THREE.MeshBasicMaterial({
        color: "#fde047",
        transparent: true,
        opacity: 0.92,
      });
      for (let k = 0; k < 3; k++) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(16 - k * 3.5, 58 - k * 10, 10),
          k === 1 ? flameMatB : flameMatA,
        );
        cone.position.set((k - 1) * 10, 26 + k * 4, (k % 2 === 0 ? 1 : -1) * 6);
        fRoot.add(cone);
        flames.push(cone);
      }

      const smokeOrb = new THREE.Mesh(
        new THREE.SphereGeometry(26, 14, 12),
        new THREE.MeshStandardMaterial({
          color: "#1e293b",
          transparent: true,
          opacity: 0.55,
          roughness: 1,
          depthWrite: false,
        }),
      );
      smokeOrb.position.set(0, 74, 0);
      fRoot.add(smokeOrb);

      const ringMat = new THREE.MeshBasicMaterial({
        color: "#ef4444",
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      });
      const targetRing = new THREE.Mesh(new THREE.RingGeometry(36, 46, 24), ringMat);
      targetRing.rotation.x = -Math.PI / 2;
      targetRing.position.y = 2;
      fRoot.add(targetRing);

      // Invisible enlarged hit collider for effortless clicking
      const collider = new THREE.Mesh(
        new THREE.SphereGeometry(56, 12, 10),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      collider.position.y = 26;
      collider.userData = { mchsType: "fire", targetId: f.id, label: f.label };
      fRoot.add(collider);
      clickableTargets.push(collider);

      // Fire truck + curved water/foam jet
      const truck = buildFireTruckGroup();
      truck.position.set(...f.truckPos);
      truck.lookAt(f.position[0], f.truckPos[1], f.position[2]);
      truck.rotateY(-Math.PI / 2);
      mchsGroup.add(truck);

      const pStart = new THREE.Vector3(f.truckPos[0], f.truckPos[1] + 24, f.truckPos[2]);
      const pEnd = new THREE.Vector3(f.position[0], f.position[1] + 18, f.position[2]);
      const pMid = pStart.clone().lerp(pEnd, 0.5);
      pMid.y += 65;
      const jetCurve = new THREE.QuadraticBezierCurve3(pStart, pMid, pEnd);
      const jetMesh = new THREE.Mesh(
        new THREE.TubeGeometry(jetCurve, 18, 3.2, 8, false),
        new THREE.MeshBasicMaterial({
          color: "#38bdf8",
          transparent: true,
          opacity: 0.85,
        }),
      );
      jetMesh.visible = false;
      mchsGroup.add(jetMesh);

      mchsGroup.add(fRoot);
      fireVisuals.set(f.id, {
        id: f.id,
        root: fRoot,
        flames,
        smokeOrb,
        ringMat,
        jetMesh,
        truck,
      });
    }

    interface EvacVisualEntry {
      id: string;
      curve: THREE.CatmullRomCurve3;
      routeMesh: THREE.Mesh;
      routeMat: THREE.MeshBasicMaterial;
      squad: THREE.Group;
    }

    for (const g of INITIAL_EVAC_GROUPS) {
      const pts = g.waypoints.map(([x, y, z]) => new THREE.Vector3(x, y + 2, z));
      const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.15);
      const routeMat = new THREE.MeshBasicMaterial({
        color: "#10b981",
        transparent: true,
        opacity: 0.65,
      });
      const routeMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 4.5, 6, false), routeMat);
      mchsGroup.add(routeMesh);

      const squad = buildEvacSquadGroup();
      squad.position.copy(pts[0]);
      const hitCol = new THREE.Mesh(
        new THREE.SphereGeometry(38, 10, 10),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hitCol.position.y = 14;
      hitCol.userData = { mchsType: "evac", targetId: g.id, label: g.label };
      squad.add(hitCol);
      clickableTargets.push(hitCol);

      mchsGroup.add(squad);
      evacVisuals.set(g.id, { id: g.id, curve, routeMesh, routeMat, squad });
    }

    syncEmergencyTargetsToModel = (modelBox: THREE.Box3) => {
      const modelSize = modelBox.getSize(new THREE.Vector3());
      const modelCenter = modelBox.getCenter(new THREE.Vector3());
      const scaleX = Math.max(0.15, modelSize.x / 1920);
      const scaleZ = Math.max(0.15, modelSize.z / 1920);
      const scaleY = Math.max(0.25, Math.min(scaleX, scaleZ));

      const safePos: [number, number, number] = [
        modelCenter.x + SAFE_ZONE_POS[0] * scaleX,
        4,
        modelCenter.z + SAFE_ZONE_POS[2] * scaleZ,
      ];
      safeZoneObj.position.set(...safePos);

      const syncedFires: FireHotspotState[] = INITIAL_FIRE_HOTSPOTS.map((f) => ({
        ...f,
        position: [
          modelCenter.x + f.position[0] * scaleX,
          Math.max(2, f.position[1] * scaleY),
          modelCenter.z + f.position[2] * scaleZ,
        ],
        truckPos: [
          modelCenter.x + f.truckPos[0] * scaleX,
          4,
          modelCenter.z + f.truckPos[2] * scaleZ,
        ],
        progress: 0,
        extinguished: false,
      }));

      for (const f of syncedFires) {
        const vis = fireVisuals.get(f.id);
        if (!vis) continue;
        vis.root.position.set(...f.position);
        vis.truck.position.set(...f.truckPos);
        vis.truck.lookAt(f.position[0], f.truckPos[1], f.position[2]);
        vis.truck.rotateY(-Math.PI / 2);

        const pStart = new THREE.Vector3(f.truckPos[0], f.truckPos[1] + 24, f.truckPos[2]);
        const pEnd = new THREE.Vector3(f.position[0], f.position[1] + 18, f.position[2]);
        const pMid = pStart.clone().lerp(pEnd, 0.5);
        pMid.y += 65 * scaleY;
        const jetCurve = new THREE.QuadraticBezierCurve3(pStart, pMid, pEnd);
        vis.jetMesh.geometry.dispose();
        vis.jetMesh.geometry = new THREE.TubeGeometry(jetCurve, 18, 3.2, 8, false);
      }

      const syncedEvacs: EvacGroupState[] = INITIAL_EVAC_GROUPS.map((g) => ({
        ...g,
        waypoints: g.waypoints.map(([wx, , wz], idx) =>
          idx === g.waypoints.length - 1
            ? [...safePos]
            : [modelCenter.x + wx * scaleX, 5, modelCenter.z + wz * scaleZ],
        ),
        status: "waiting",
        progress: 0,
      }));

      for (const g of syncedEvacs) {
        const vis = evacVisuals.get(g.id);
        if (!vis) continue;
        const pts = g.waypoints.map(([x, y, z]) => new THREE.Vector3(x, y + 2, z));
        vis.curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.15);
        vis.routeMesh.geometry.dispose();
        vis.routeMesh.geometry = new THREE.TubeGeometry(vis.curve, 48, 4.5, 6, false);
        vis.squad.position.copy(pts[0]);
      }

      scaledBaseFiresRef.current = syncedFires.map((f) => ({ ...f }));
      scaledBaseEvacsRef.current = syncedEvacs.map((g) => ({
        ...g,
        waypoints: g.waypoints.map((w) => [...w] as [number, number, number]),
      }));
      setFires(syncedFires);
      setEvacGroups(syncedEvacs);

      // Position VR/FP spawn cleanly outside the outer perimeter facing the plant
      vrSystem.setSpawnPosition(modelCenter.x, modelBox.max.z + 120);
    };

    // Raycaster interaction for MCHS mode (hover + click/hold)
    let holdExtinguishTimer: number | null = null;
    let lastHoverTs = 0;

    const getHitTarget = (clientX: number, clientY: number) => {
      if (!mchsModeRef.current) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      _pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(_pointerNdc, camera);
      const hits = _raycaster.intersectObjects(clickableTargets, false);
      return hits[0]?.object?.userData as
        { mchsType: "fire" | "evac"; targetId: string; label: string } | undefined | null;
    };

    const onCanvasPointerMove = (e: PointerEvent) => {
      if (vrSystem.isActive()) return;
      const now = performance.now();
      if (now - lastHoverTs < 55) return;
      lastHoverTs = now;
      const hit = getHitTarget(e.clientX, e.clientY);
      canvas.style.cursor = hit ? "pointer" : "grab";
      setHoveredTargetLabel(hit ? hit.label : null);
    };

    const stopHoldExtinguish = () => {
      if (holdExtinguishTimer !== null) {
        window.clearInterval(holdExtinguishTimer);
        holdExtinguishTimer = null;
      }
      if (!vrSystem.isActive()) {
        controls.enabled = true;
      }
      setActiveExtinguishId(null);
    };

    const onCanvasPointerDown = (e: PointerEvent) => {
      if (vrSystem.isActive()) return;
      if (e.button !== 0 || !mchsModeRef.current) return;
      const hit = getHitTarget(e.clientX, e.clientY);
      if (!hit) return;

      controls.enabled = false;
      if (hit.mchsType === "fire") {
        handleExtinguishBurst(hit.targetId);
        if (holdExtinguishTimer !== null) {
          window.clearInterval(holdExtinguishTimer);
        }
        setActiveExtinguishId(hit.targetId);
        holdExtinguishTimer = window.setInterval(() => {
          setFires((prev) =>
            prev.map((f) => {
              if (f.id !== hit.targetId || f.extinguished) return f;
              const nextProg = Math.min(100, f.progress + 12);
              return { ...f, progress: nextProg, extinguished: nextProg >= 100 };
            }),
          );
        }, 160);
      } else if (hit.mchsType === "evac") {
        handleDispatchEvacGroup(hit.targetId);
        controls.enabled = true;
      }
    };

    const onWebglContextLost = (e: Event) => {
      e.preventDefault();
    };
    canvas.addEventListener("webglcontextlost", onWebglContextLost);

    canvas.addEventListener("pointermove", onCanvasPointerMove, { passive: true });
    canvas.addEventListener("pointerdown", onCanvasPointerDown);
    window.addEventListener("pointerup", stopHoldExtinguish);

    // Camera Presets & Puff Trigger
    let puffCycleTime = 0;
    cameraActionRef.current = {
      setPreset: (preset) => {
        if (vrSystem.isActive()) {
          vrSystem.disableFirstPerson();
        }
        if (preset === "iso") {
          camTransition = {
            pos: new THREE.Vector3(-1450, 1180, 1550),
            target: new THREE.Vector3(-80, 40, -20),
          };
        } else if (preset === "top") {
          camTransition = {
            pos: new THREE.Vector3(-40, 2650, 120),
            target: new THREE.Vector3(-40, 0, -40),
          };
        } else if (preset === "plume") {
          const rad = (windDirRef.current * Math.PI) / 180;
          const dx = Math.sin(rad);
          const dz = -Math.cos(rad);
          camTransition = {
            pos: new THREE.Vector3(
              stackTipWorld.x - dx * 950 + dz * 750,
              580,
              stackTipWorld.z - dz * 950 - dx * 750,
            ),
            target: new THREE.Vector3(
              stackTipWorld.x + dx * 520,
              stackTipWorld.y * 0.6,
              stackTipWorld.z + dz * 520,
            ),
          };
        }
      },
      triggerPuff: () => {
        puffCycleTime = 0;
      },
    };

    // ResizeObserver for compact <-> fullscreen transition
    const resizeObserver = new ResizeObserver(() => {
      const w = Math.max(200, container.clientWidth);
      const h = Math.max(180, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    // Animation Loop (supports both WebXR setAnimationLoop and Software-GL fallback pacing)
    let frameId = 0;
    let lastTime = performance.now();
    let lastEvacUiSync = 0;
    let lastTelemetrySync = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const tick = () => {
      if (cancelled) return;
      const now = performance.now();
      const dt = Math.min(0.08, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      // Smooth damped camera reset/preset (only when OrbitControls is active)
      if (!vrSystem.isActive()) {
        if (camTransition) {
          const lambda = 7.5;
          camera.position.x = THREE.MathUtils.damp(
            camera.position.x,
            camTransition.pos.x,
            lambda,
            dt,
          );
          camera.position.y = THREE.MathUtils.damp(
            camera.position.y,
            camTransition.pos.y,
            lambda,
            dt,
          );
          camera.position.z = THREE.MathUtils.damp(
            camera.position.z,
            camTransition.pos.z,
            lambda,
            dt,
          );
          controls.target.x = THREE.MathUtils.damp(
            controls.target.x,
            camTransition.target.x,
            lambda,
            dt,
          );
          controls.target.y = THREE.MathUtils.damp(
            controls.target.y,
            camTransition.target.y,
            lambda,
            dt,
          );
          controls.target.z = THREE.MathUtils.damp(
            controls.target.z,
            camTransition.target.z,
            lambda,
            dt,
          );
          if (
            camera.position.distanceTo(camTransition.pos) < 3 &&
            controls.target.distanceTo(camTransition.target) < 3
          ) {
            camTransition = null;
          }
        }
        controls.update();
      } else {
        camTransition = null;
      }

      // Rotate wind arrow & align plume vector
      const mode = scenarioRef.current;
      const windRad = (windDirRef.current * Math.PI) / 180;
      const wx = Math.sin(windRad);
      const wz = -Math.cos(windRad);
      const cx = -wz; // crosswind unit X
      const cz = wx; // crosswind unit Z
      const speedScale = Math.max(1.5, windSpeedRef.current);

      windArrowGroup.position.set(stackTipWorld.x, stackTipWorld.y + 18, stackTipWorld.z);
      windArrowGroup.rotation.y = Math.atan2(-wz, wx);

      // Update Stage 3 Plume Visualization
      puffCycleTime = (puffCycleTime + dt) % 10.5;
      const puffT = puffCycleTime;

      const posAttr = pGeometry.attributes.position as THREE.BufferAttribute;
      const colAttr = pGeometry.attributes.color as THREE.BufferAttribute;

      if (mode === "plume") {
        puffCloudGroup.visible = false;
        acuteRingMesh.visible = false;
        falloutPlane.visible = false;
        pMaterial.size = 26;
        pMaterial.opacity = 0.85;

        for (let i = 0; i < PARTICLE_COUNT; i++) {
          pAges[i] += dt * (0.9 + speedScale * 0.12);
          if (pAges[i] >= pLives[i]) {
            pAges[i] = 0;
            pSeedY[i] = (Math.random() - 0.5) * 2.0;
            pSeedZ[i] = (Math.random() - 0.5) * 2.0;
          }
          const frac = pAges[i] / pLives[i];
          const dist = frac * 1750;
          const sigmaY = 18 + Math.pow(dist, 0.82) * 0.42;
          const sigmaZ = 10 + Math.pow(dist, 0.72) * 0.22;
          const swirl = Math.sin(now * 0.002 + i) * 8 * frac;

          const px = stackTipWorld.x + wx * dist + cx * (pSeedY[i] * sigmaY + swirl);
          const py = Math.max(6, stackTipWorld.y + 24 * Math.sin(frac * 2.2) + pSeedZ[i] * sigmaZ);
          const pz = stackTipWorld.z + wz * dist + cz * (pSeedY[i] * sigmaY + swirl);

          posAttr.setXYZ(i, px, py, pz);
          _tmpColor.copy(frac < 0.25 ? _colRed : frac < 0.55 ? _colAmber : _colCyan);
          colAttr.setXYZ(i, _tmpColor.r, _tmpColor.g, _tmpColor.b);
        }
      } else if (mode === "puff") {
        puffCloudGroup.visible = true;
        acuteRingMesh.visible = false;
        falloutPlane.visible = false;
        pMaterial.size = 30;
        pMaterial.opacity = Math.max(0.2, 0.92 - puffT * 0.065);

        const puffDist = puffT * (95 + speedScale * 18);
        const puffRadius = 42 + puffT * 34;
        const centerX = stackTipWorld.x + wx * puffDist;
        const centerY = stackTipWorld.y + 18 + Math.sin(puffT * 0.6) * 22;
        const centerZ = stackTipWorld.z + wz * puffDist;

        puffCenterWorld.set(centerX, centerY, centerZ);
        puffRadiusWorld = puffRadius;

        puffCloudGroup.position.set(centerX, centerY, centerZ);
        puffCloudGroup.scale.set(puffRadius * 1.15, puffRadius * 0.82, puffRadius * 1.15);
        puffOuterMat.opacity = Math.max(0.06, 0.36 * (1 - puffT / 11));

        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const theta = (i * 2.39996) % (Math.PI * 2);
          const phi = Math.acos(1 - (2 * ((i % 199) + 0.5)) / 200);
          const rFrac = 0.35 + ((i * 17) % 65) / 100;
          const r = puffRadius * rFrac;
          const px = centerX + r * Math.sin(phi) * Math.cos(theta);
          const py = Math.max(8, centerY + r * Math.cos(phi) * 0.72);
          const pz = centerZ + r * Math.sin(phi) * Math.sin(theta);

          posAttr.setXYZ(i, px, py, pz);
          _tmpColor.copy(rFrac < 0.55 ? _colRed : _colAmber);
          colAttr.setXYZ(i, _tmpColor.r, _tmpColor.g, _tmpColor.b);
        }
      } else if (mode === "shortTerm") {
        puffCloudGroup.visible = true;
        acuteRingMesh.visible = true;
        falloutPlane.visible = false;
        pMaterial.size = 32;
        pMaterial.opacity = 0.95;

        const waveFrac = (puffT % 6.0) / 6.0;
        const frontDist = 140 + waveFrac * 1350;
        const peakX = stackTipWorld.x + wx * 420;
        const peakZ = stackTipWorld.z + wz * 420;
        acuteRingMesh.position.set(peakX, 5, peakZ);
        const pulseScale = 0.85 + Math.sin(now * 0.006) * 0.18;
        acuteRingMesh.scale.setScalar(pulseScale);
        acuteRingMat.opacity = 0.45 + Math.sin(now * 0.006) * 0.25;

        puffCloudGroup.position.set(
          stackTipWorld.x + wx * frontDist,
          stackTipWorld.y * 0.78,
          stackTipWorld.z + wz * frontDist,
        );
        puffCloudGroup.scale.setScalar(75 + waveFrac * 110);
        puffOuterMat.opacity = 0.26 * (1 - waveFrac * 0.75);

        for (let i = 0; i < PARTICLE_COUNT; i++) {
          pAges[i] += dt * 1.45;
          if (pAges[i] >= 5.0) pAges[i] = 0;
          const f = pAges[i] / 5.0;
          const dist = Math.max(0, frontDist - 420 + f * 620);
          const spread = 24 + dist * 0.14;
          const px = stackTipWorld.x + wx * dist + cx * pSeedY[i] * spread;
          const py = Math.max(6, stackTipWorld.y * (1 - f * 0.45) + pSeedZ[i] * (16 + dist * 0.07));
          const pz = stackTipWorld.z + wz * dist + cz * pSeedY[i] * spread;

          posAttr.setXYZ(i, px, py, pz);
          _tmpColor.copy(f < 0.4 ? _colRed : _colAmber);
          colAttr.setXYZ(i, _tmpColor.r, _tmpColor.g, _tmpColor.b);
        }
      } else {
        // Long-term (Chronic): extended plume + cumulative surface fallout footprint
        puffCloudGroup.visible = false;
        acuteRingMesh.visible = false;
        falloutPlane.visible = true;
        pMaterial.size = 24;
        pMaterial.opacity = 0.72;

        const falloutCenterDist = 960;
        falloutPlane.position.set(
          stackTipWorld.x + wx * falloutCenterDist,
          4.2,
          stackTipWorld.z + wz * falloutCenterDist,
        );
        falloutPlane.rotation.z = Math.atan2(-wz, wx);
        falloutMat.opacity = 0.78 + Math.sin(now * 0.002) * 0.12;

        for (let i = 0; i < PARTICLE_COUNT; i++) {
          pAges[i] += dt * 0.75;
          if (pAges[i] >= pLives[i]) pAges[i] = 0;
          const f = pAges[i] / pLives[i];
          const dist = f * 2150;
          const spread = 32 + Math.pow(dist, 0.86) * 0.48;
          const settleY = THREE.MathUtils.lerp(stackTipWorld.y, 14, Math.pow(f, 0.75));
          const px = stackTipWorld.x + wx * dist + cx * pSeedY[i] * spread;
          const py = Math.max(5, settleY + pSeedZ[i] * (18 + dist * 0.06));
          const pz = stackTipWorld.z + wz * dist + cz * pSeedY[i] * spread;

          posAttr.setXYZ(i, px, py, pz);
          _tmpColor.copy(f < 0.25 ? _colAmber : f < 0.65 ? _colEmerald : _colCyan);
          colAttr.setXYZ(i, _tmpColor.r, _tmpColor.g, _tmpColor.b);
        }
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;

      // Update Stage 4 MCHS Scene Objects
      const mchsActive = mchsModeRef.current;
      mchsGroup.visible = mchsActive;
      if (mchsActive) {
        const curFires = firesRef.current;
        for (const fState of curFires) {
          const vis = fireVisuals.get(fState.id);
          if (!vis) continue;
          const isExtinguished = fState.extinguished;
          const isBeingSprayed = activeExtinguishRef.current === fState.id && !isExtinguished;
          vis.jetMesh.visible = isBeingSprayed;

          const intensity = isExtinguished ? 0 : Math.max(0.2, 1 - fState.progress / 100);
          vis.flames.forEach((cone, idx) => {
            cone.visible = !isExtinguished;
            if (!isExtinguished) {
              const flicker = 0.85 + Math.sin(now * 0.018 + idx * 2.1) * 0.25;
              cone.scale.set(intensity, intensity * flicker, intensity);
            }
          });
          vis.smokeOrb.visible = !isExtinguished;
          if (!isExtinguished) {
            const puffS = 0.9 + Math.sin(now * 0.005) * 0.16;
            vis.smokeOrb.position.y = 66 + Math.sin(now * 0.004) * 10;
            vis.smokeOrb.scale.setScalar(puffS * intensity);
          }
          vis.ringMat.color.copy(isExtinguished ? _colEmerald : _colRed);
          vis.ringMat.opacity = isExtinguished ? 0.5 : 0.72 + Math.sin(now * 0.008) * 0.22;
        }

        // Advance any moving evacuation squads smoothly along their CatmullRomCurve3 routes
        let anyMoving = false;
        let completedIds: string[] | null = null;
        const curEvacs = evacGroupsRef.current;
        for (const gState of curEvacs) {
          const vis = evacVisuals.get(gState.id);
          if (!vis) continue;
          if (gState.status === "moving") {
            anyMoving = true;
            gState.progress = Math.min(1, gState.progress + dt * 0.22);
            if (gState.progress >= 1) {
              gState.status = "safe";
              if (!completedIds) completedIds = [];
              completedIds.push(gState.id);
            }
          }
          const t = gState.status === "safe" ? 1 : gState.progress;
          vis.curve.getPointAt(t, _tmpVecA);
          vis.squad.position.copy(_tmpVecA);
          if (t < 0.99) {
            vis.curve.getPointAt(Math.min(1, t + 0.01), _tmpVecB);
            vis.squad.lookAt(_tmpVecB.x, _tmpVecA.y, _tmpVecB.z);
          }
          vis.routeMat.color.copy(gState.status === "safe" ? _colCyan : _colEmerald);
          vis.routeMat.opacity = gState.status === "safe" ? 0.28 : 0.72;
        }
        if (
          (completedIds && completedIds.length > 0) ||
          (anyMoving && now - lastEvacUiSync > 200)
        ) {
          lastEvacUiSync = now;
          const doneSet = completedIds ? new Set(completedIds) : null;
          const progMap = new Map(curEvacs.map((g) => [g.id, g.progress]));
          setEvacGroups((prev) =>
            prev.map((g) => {
              const prog = progMap.get(g.id) ?? g.progress;
              if (doneSet?.has(g.id) || prog >= 1) {
                return { ...g, status: "safe", progress: 1 };
              }
              return g.status === "moving" ? { ...g, progress: prog } : g;
            }),
          );
        }
      }

      // Update VR emergency system (locomotion, hose, dosimeter, evac)
      if (vrSystem.isActive()) {
        vrSystem.update();
        if (now - lastTelemetrySync > 180) {
          lastTelemetrySync = now;
          setVrTelemetry(vrSystem.getTelemetry());
        }
      }

      renderer.render(scene, camera);
      if (isSoftwareGl && !renderer.xr.isPresenting) {
        afterDraw(tick);
      }
    };

    const onXrStartLoop = () => {
      clearTimeout(frameId);
      renderer.setAnimationLoop(tick);
    };
    renderer.xr.addEventListener("sessionstart", onXrStartLoop);

    if (isSoftwareGl) {
      tick();
    } else {
      renderer.setAnimationLoop(tick);
    }

    return () => {
      cancelled = true;
      stopHoldExtinguish();
      if (burstClearTimerRef.current !== null) {
        window.clearTimeout(burstClearTimerRef.current);
        burstClearTimerRef.current = null;
      }
      renderer.setAnimationLoop(null);
      renderer.xr.removeEventListener("sessionstart", onXrStartLoop);
      window.removeEventListener("pointerup", stopHoldExtinguish);
      canvas.removeEventListener("webglcontextlost", onWebglContextLost);
      canvas.removeEventListener("pointermove", onCanvasPointerMove);
      canvas.removeEventListener("pointerdown", onCanvasPointerDown);
      controls.removeEventListener("start", onControlsStart);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      cameraActionRef.current = null;
      vrControlRef.current = null;
      setVrActive(false);
      setFpActive(false);
      setVrStatusMsg(null);

      if (loadedModelRoot) {
        loadedModelRoot.traverse((obj) => {
          const m = obj as THREE.Mesh;
          m.geometry?.dispose();
          if (m.material) {
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            mats.forEach((mat) => mat.dispose());
          }
        });
      }
      mchsGroup.traverse((obj) => {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        if (m.material) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mat) => mat.dispose());
        }
      });
      groundTex.dispose();
      groundMat.dispose();
      groundPlane.geometry.dispose();
      pGeometry.dispose();
      pMaterial.dispose();
      puffOuterGeo.dispose();
      puffOuterMat.dispose();
      (puffInnerMesh.material as THREE.Material).dispose();
      acuteRingMesh.geometry.dispose();
      acuteRingMat.dispose();
      falloutTex.dispose();
      falloutMat.dispose();
      falloutPlane.geometry.dispose();
      envRenderTarget.dispose();
      vrSystem.dispose();
      dracoLoader.dispose();
      controls.dispose();
      renderer.dispose();
    };
  }, [isOpen, glbSourceUrl, handleDispatchEvacGroup, handleExtinguishBurst]);

  const extinguishedCount = useMemo(() => fires.filter((f) => f.extinguished).length, [fires]);
  const evacuatedCount = useMemo(
    () => evacGroups.reduce((sum, g) => sum + (g.status === "safe" ? g.count : 0), 0),
    [evacGroups],
  );
  const activeScenarioMeta = useMemo(
    () => SCENARIO_LIST.find((s) => s.id === activeScenario) ?? SCENARIO_LIST[0],
    [activeScenario],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(2, 6, 23, 0.82)" }}
      role="dialog"
      aria-modal="true"
      aria-label="3D-инспектор АЭС ВВЭР-1200"
    >
      <div
        className={
          isFullscreen
            ? "fixed inset-0 w-screen h-screen bg-[#0b1120] flex flex-col overflow-hidden"
            : "relative w-[min(1080px,94vw)] h-[min(700px,88vh)] rounded-xl border border-slate-700/80 bg-[#0b1120] shadow-2xl flex flex-col overflow-hidden"
        }
      >
        {/* Top Modal Header Bar (Clean single-row controls, zero clutter) */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-800 bg-[#0f172a] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-semibold text-slate-100 whitespace-nowrap truncate">
              3D-инспектор АЭС (GLB) · {lat.toFixed(3)}°, {lon.toFixed(3)}°
            </h2>
            <span className="hidden md:inline text-xs font-mono tabular-nums text-slate-400 whitespace-nowrap">
              {glbLabel} · азимут {bearingDeg}° · ветер {windSpeedMs} м/с ({windDirectionDeg}°) ·{" "}
              {stabilityClass}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".glb,.gltf"
              onChange={handleGlbFileSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 transition-colors"
              title="Загрузить внешнюю 3D-модель .glb"
            >
              <Upload className="w-3.5 h-3.5 text-cyan-400" />
              Загрузить .GLB
            </button>
            {glbSourceUrl !== "/assembly.glb" && (
              <button
                type="button"
                onClick={handleResetToDefaultGlb}
                className="px-2.5 py-1.5 rounded-md border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-xs text-slate-300 whitespace-nowrap shrink-0 transition-colors"
              >
                Сброс к assembly.glb
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (fpActive) {
                  vrControlRef.current?.disableFirstPerson();
                } else {
                  vrControlRef.current?.enableFirstPerson();
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                fpActive
                  ? "border-cyan-500/80 bg-cyan-600 text-white"
                  : "border-cyan-500/50 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"
              }`}
              title="Режим от первого лица (WASD + мышь + Пробел/ЛКМ + E)"
            >
              <Users className="w-3.5 h-3.5" />
              {fpActive ? "1-е лицо: Вкл" : "1-е лицо"}
            </button>

            <button
              type="button"
              onClick={() => vrControlRef.current?.enterVR()}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                vrActive
                  ? "border-violet-500/80 bg-violet-600 text-white"
                  : "border-violet-500/50 bg-violet-500/15 text-violet-300 hover:bg-violet-500/25"
              }`}
              title="Войти в WebXR VR-режим (или 1-е лицо при отсутствии шлема)"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              {vrActive ? "Выйти из VR" : "Войти в VR"}
            </button>

            <button
              type="button"
              onClick={() => setMchsMode((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                mchsMode
                  ? "border-red-500/80 bg-red-600 text-white"
                  : "border-amber-500/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              {mchsMode ? "МЧС: Активен" : "МЧС"}
            </button>

            <button
              type="button"
              onClick={() => setIsFullscreen((f) => !f)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 transition-colors"
              title={isFullscreen ? "Выйти из полноэкранного режима" : "На весь экран"}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-cyan-400" />
                  Свернуть
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-cyan-400" />
                  На весь экран
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              aria-label="Закрыть окно"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Dedicated 3D WebGL Viewport Container */}
        <div className="relative flex-1 min-h-0 bg-[#0b1120]">
          <div ref={mountRef} className="w-full h-full" />

          {(vrActive || fpActive) && (
            <div className="absolute bottom-20 left-3 max-w-xs px-3 py-2 rounded-lg border border-cyan-500/50 bg-[#0f172a]/95 text-[11px] text-cyan-200 space-y-1 pointer-events-none">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-cyan-300">
                  {vrActive ? "VR-режим МЧС (WebXR)" : "Режим от первого лица"}
                </span>
                <span
                  className={`font-mono font-bold tabular-nums ${
                    vrTelemetry.hazardLevel === "danger"
                      ? "text-red-400"
                      : vrTelemetry.hazardLevel === "elevated"
                        ? "text-amber-300"
                        : "text-emerald-300"
                  }`}
                >
                  {vrTelemetry.doseRate < 1000
                    ? `${vrTelemetry.doseRate.toFixed(1)} мкЗв/ч`
                    : `${(vrTelemetry.doseRate / 1000).toFixed(2)} мЗв/ч`}
                </span>
              </div>
              <div className="text-[10px] text-slate-300 font-mono tabular-nums">
                Накопл. доза: {vrTelemetry.accumulatedDose.toFixed(4)} мЗв · ДКС-96
              </div>
              {vrActive ? (
                <div>Стик Л: шаг · Стик П: поворот 30° · Курок П: ствол · Л: телепорт</div>
              ) : (
                <div>Клик по сцене: обзор · WASD+Shift: шаг · Пробел/F/ЛКМ: ствол · E: эвак.</div>
              )}
              {vrStatusMsg && <div className="text-amber-300">{vrStatusMsg}</div>}
            </div>
          )}

          {/* Loading / Error State Overlay (never uses backdrop-blur over WebGL) */}
          {isLoadingModel && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0b1120]/90 pointer-events-none">
              <div className="px-5 py-3 rounded-lg border border-slate-700 bg-[#0f172a] text-center space-y-2">
                <div className="text-xs font-medium text-slate-200">
                  Загрузка 3D-сборки {glbLabel}...
                </div>
                <div className="w-48 h-1.5 rounded-full bg-slate-800 overflow-hidden mx-auto">
                  <div
                    className="h-full bg-cyan-400 transition-all duration-150"
                    style={{ width: `${Math.max(12, loadProgress)}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {loadError && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg border border-red-500/50 bg-[#1e1b24] text-xs text-red-200">
              {loadError}
            </div>
          )}

          {/* Subtle Top-Left Scenario / Raycast Hover Readout (No viewport center occlusion) */}
          <div className="absolute top-3 left-3 max-w-md pointer-events-none space-y-1.5">
            <div className="px-3 py-2 rounded-lg border border-slate-700/80 bg-[#0f172a]/92">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: activeScenarioMeta.accentHex }}
                />
                <span>{activeScenarioMeta.title}</span>
              </div>
              <p className="text-[11px] leading-snug text-slate-300 mt-1">
                {activeScenarioMeta.description}
              </p>
            </div>

            {mchsMode && hoveredTargetLabel && (
              <div className="px-2.5 py-1 rounded border border-amber-500/50 bg-[#0f172a]/95 text-[11px] font-medium text-amber-300">
                Объект МЧС: {hoveredTargetLabel} — нажмите для действия
              </div>
            )}
          </div>

          {/* Top-Right Compact Camera Control Strip */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5 p-1 rounded-lg border border-slate-700/80 bg-[#0f172a]/92">
            <button
              type="button"
              onClick={() => cameraActionRef.current?.setPreset("iso")}
              className="px-2.5 py-1 rounded text-xs text-slate-200 hover:bg-slate-800 whitespace-nowrap transition-colors"
            >
              Изометрия
            </button>
            <button
              type="button"
              onClick={() => cameraActionRef.current?.setPreset("top")}
              className="px-2.5 py-1 rounded text-xs text-slate-200 hover:bg-slate-800 whitespace-nowrap transition-colors"
            >
              Сверху
            </button>
            <button
              type="button"
              onClick={() => cameraActionRef.current?.setPreset("plume")}
              className="px-2.5 py-1 rounded text-xs text-slate-200 hover:bg-slate-800 whitespace-nowrap transition-colors"
            >
              Факел
            </button>
            <button
              type="button"
              onClick={() => cameraActionRef.current?.setPreset("iso")}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-cyan-300 whitespace-nowrap transition-colors"
              title="Сбросить позицию камеры"
            >
              <RotateCcw className="w-3 h-3" />
              Сброс вида
            </button>
          </div>

          {/* Collapsible Unified Bottom Control Dock */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[min(980px,95%)] flex flex-col items-center pointer-events-none">
            <button
              type="button"
              onClick={() => setDockCollapsed((v) => !v)}
              className="pointer-events-auto flex items-center gap-1.5 px-3 py-1 rounded-t-lg border border-b-0 border-slate-700/80 bg-[#0f172a]/95 text-[11px] font-medium text-slate-300 hover:text-white transition-colors"
            >
              {dockCollapsed ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  Показать панель сценариев
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  Скрыть панель
                </>
              )}
            </button>

            {!dockCollapsed && (
              <div className="pointer-events-auto w-full rounded-xl border border-slate-700/90 bg-[#0f172a]/95 p-3 shadow-2xl space-y-2.5">
                {/* Stage 3: 4 Scenario Mode Switcher */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800">
                    {SCENARIO_LIST.map((sc) => {
                      const active = activeScenario === sc.id;
                      return (
                        <button
                          key={sc.id}
                          type="button"
                          onClick={() => handleSelectScenario(sc.id)}
                          className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                            active
                              ? "bg-slate-800 text-white shadow-sm border border-slate-600"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                          style={
                            active ? { borderColor: sc.accentHex, color: "#ffffff" } : undefined
                          }
                        >
                          {sc.shortLabel}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-slate-400">
                    {(activeScenario === "puff" || activeScenario === "shortTerm") && (
                      <button
                        type="button"
                        onClick={() => cameraActionRef.current?.triggerPuff()}
                        className="flex items-center gap-1 px-2.5 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 text-xs font-sans font-medium whitespace-nowrap"
                      >
                        <Wind className="w-3.5 h-3.5" />
                        Повторить залп
                      </button>
                    )}
                    <span className="hidden sm:inline">
                      ЛКМ: орбита · ПКМ: панорама · Колесо: зум
                    </span>
                  </div>
                </div>

                {/* Stage 4: Interactive MCHS Response Controls (shown when MCHS mode is toggled on) */}
                {mchsMode && (
                  <div className="pt-2.5 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Fire Suppression Panel */}
                    <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                          <Flame className="w-3.5 h-3.5" />
                          Очаги возгорания (клик на карте или кнопкой)
                        </div>
                        <span className="text-xs font-mono tabular-nums text-slate-300">
                          Потушено: {extinguishedCount} / {fires.length}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        {fires.map((f) => (
                          <div
                            key={f.id}
                            className="flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-slate-800 bg-[#0f172a]"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-medium text-slate-200 truncate">
                                {f.label}
                              </div>
                              <div className="w-full h-1.5 rounded-full bg-slate-800 mt-1 overflow-hidden">
                                <div
                                  className="h-full transition-all duration-150"
                                  style={{
                                    width: `${f.progress}%`,
                                    backgroundColor: f.extinguished ? "#10b981" : "#f97316",
                                  }}
                                />
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={f.extinguished}
                              onClick={() => handleExtinguishBurst(f.id)}
                              className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                                f.extinguished
                                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 cursor-default"
                                  : "bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40"
                              }`}
                            >
                              {f.extinguished ? (
                                "Локализован"
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <Droplets className="w-3 h-3" />
                                  Тушить ({Math.round(f.progress)}%)
                                </span>
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Evacuation Panel */}
                    <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                          <Users className="w-3.5 h-3.5" />
                          Эвакуация в безопасную зону
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono tabular-nums font-semibold text-emerald-300">
                            Эвакуировано: {evacuatedCount} / {TOTAL_EVAC_PEOPLE} чел.
                          </span>
                          <button
                            type="button"
                            onClick={handleEvacuateAll}
                            className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-[11px] font-medium text-white whitespace-nowrap"
                          >
                            Эвакуировать всех
                          </button>
                          <button
                            type="button"
                            onClick={handleResetEmergency}
                            className="px-2 py-0.5 rounded border border-slate-700 hover:bg-slate-800 text-[11px] text-slate-300 whitespace-nowrap"
                          >
                            Сброс ЧС
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        {evacGroups.map((g) => (
                          <div
                            key={g.id}
                            className="flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-slate-800 bg-[#0f172a]"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-medium text-slate-200 truncate">
                                {g.label} ({g.count} чел.)
                              </div>
                              <div className="w-full h-1.5 rounded-full bg-slate-800 mt-1 overflow-hidden">
                                <div
                                  className="h-full bg-emerald-400 transition-all duration-150"
                                  style={{ width: `${Math.round(g.progress * 100)}%` }}
                                />
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={g.status !== "waiting"}
                              onClick={() => handleDispatchEvacGroup(g.id)}
                              className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                                g.status === "safe"
                                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                  : g.status === "moving"
                                    ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                    : "bg-emerald-600 hover:bg-emerald-500 text-white"
                              }`}
                            >
                              {g.status === "safe"
                                ? "В зоне"
                                : g.status === "moving"
                                  ? "В пути"
                                  : "Вывести"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
