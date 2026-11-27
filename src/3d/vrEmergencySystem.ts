import * as THREE from "three";

/**
 * VR + first-person emergency response system for the AURA-RAD NPP inspector.
 *
 * Features:
 *  - WebXR immersive-vr session with playerRig (headset camera + two controllers + grip models)
 *  - Smooth locomotion (left thumbstick) + 30° snap-turn (right thumbstick)
 *  - Parabolic arc teleport with landing ring preview on y = 0
 *  - Desktop first-person fallback (WASD + pointer-lock mouse look + Space/F/LMB + E)
 *  - Fire hose on right controller / view: spray water particles, extinguish fires (0..100%)
 *  - Evacuation: approach or press trigger/grip/E near a waiting squad to dispatch along route
 *  - 3D handheld dosimeter-radiometer (ДКС-96) on left hand / view corner with live CanvasTexture,
 *    Gaussian ground-reflection + scenario-aware dose rate, accumulated dose, Web Audio Geiger clicks & alarm.
 */

const EYE_HEIGHT = 1.7;
const SNAP_TURN_DEG = 30;
const MOVE_SPEED = 14.0; // m/s brisk MCHS response pace across ~1800m plant
const TELEPORT_MAX_DIST = 450;
const TELEPORT_STEPS = 36;
const FIRE_HOSE_RANGE = 75;
const FIRE_EXTINGUISH_RATE = 24; // progress points per second
const EVAC_AUTO_RADIUS = 16;
const EVAC_ACTION_RADIUS = 32;
const EVAC_RAY_RADIUS = 55;

export interface FireTarget {
  id: string;
  position: THREE.Vector3;
  intensity: number; // 0..1 (1 - progress/100)
  extinguished: boolean;
}

export interface EvacTarget {
  id: string;
  position: THREE.Vector3;
  status: "waiting" | "moving" | "safe";
}

export interface DoseContext {
  scenario: "plume" | "puff" | "shortTerm" | "longTerm";
  stackTipWorld: THREE.Vector3;
  windDirDeg: number;
  windSpeedMs: number;
  stackHeightM: number;
  puffCenterWorld?: THREE.Vector3;
  puffRadius?: number;
}

export interface VRTelemetry {
  doseRate: number; // uSv/h
  accumulatedDose: number; // mSv
  hazardLevel: "normal" | "elevated" | "danger";
}

export interface VREmergencySystemOptions {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  getFires: () => FireTarget[];
  getEvacs: () => EvacTarget[];
  onExtinguishProgress: (id: string, delta: number) => void;
  onDispatchEvac: (id: string) => void;
  getDoseContext: () => DoseContext;
  onModeChange?: (state: { isInVR: boolean; fpMode: boolean; statusMsg?: string }) => void;
}

interface VRControllerState {
  controller: THREE.Group;
  grip: THREE.Group;
  rayLine: THREE.Line;
  isSelecting: boolean;
  triggerValue: number;
  gripValue: number;
  thumbstick: { x: number; y: number };
  turned: boolean;
}

export class VREmergencySystem {
  private opts: VREmergencySystemOptions;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;

  private playerRig: THREE.Group;
  private controllers: VRControllerState[] = [];

  private isInVR = false;
  private fpMode = false;

  // Saved Orbit camera transform before entering VR/FP
  private savedCamPos = new THREE.Vector3(-1450, 1180, 1550);
  private savedCamQuat = new THREE.Quaternion();
  private spawnPos = new THREE.Vector3(0, 0, 260);

  // Keyboard / mouse state
  private keys: Record<string, boolean> = {};
  private pointerLocked = false;
  private mouseFireDown = false;
  private yaw = 0;
  private pitch = 0;

  // Teleport
  private teleportIndicator: THREE.Mesh;
  private teleportRay: THREE.Line;
  private teleportPositions: Float32Array;
  private isTeleporting = false;
  private hasTeleportTarget = false;
  private teleportTarget = new THREE.Vector3();

  // Fire hose
  private hoseGroup: THREE.Group;
  private hoseNozzleTip: THREE.Object3D;
  private hoseParticles: THREE.Points;
  private hosePositions: Float32Array;
  private hoseVelocities: Float32Array;
  private hoseLife: Float32Array;
  private hoseHitFireId: string | null = null;

  // Dosimeter
  private dosimeterGroup: THREE.Group;
  private dosimeterCanvas: HTMLCanvasElement;
  private dosimeterCtx: CanvasRenderingContext2D;
  private dosimeterTexture: THREE.CanvasTexture;
  private accumulatedDose = 0; // mSv
  private currentDoseRate = 0.08; // uSv/h
  private hazardLevel: "normal" | "elevated" | "danger" = "normal";
  private lastDisplayUpdate = 0;

  // Web Audio Geiger + Alarm
  private geigerAudioCtx: AudioContext | null = null;
  private lastGeigerClick = 0;
  private alarmActive = false;
  private alarmOsc: OscillatorNode | null = null;
  private alarmGain: GainNode | null = null;
  private alarmTimerId: number | null = null;

  private clock = new THREE.Clock();

  // Pre-allocated scratch math objects (Zero GC in frame loop)
  private _vecA = new THREE.Vector3();
  private _vecB = new THREE.Vector3();
  private _vecC = new THREE.Vector3();
  private _vecD = new THREE.Vector3();
  private _vecE = new THREE.Vector3();
  private _quatA = new THREE.Quaternion();

  private disposableGeos: THREE.BufferGeometry[] = [];
  private disposableMats: THREE.Material[] = [];

  constructor(options: VREmergencySystemOptions) {
    this.opts = options;
    this.renderer = options.renderer;
    this.camera = options.camera;
    this.scene = options.scene;

    // ---- Player Rig (camera is attached ONLY while VR or FP mode is active) ----
    this.playerRig = new THREE.Group();
    this.playerRig.position.copy(this.spawnPos);
    this.scene.add(this.playerRig);

    // ---- Teleport indicator & arc ray ----
    const telGeo = new THREE.RingGeometry(2.2, 3.2, 32);
    const telMat = new THREE.MeshBasicMaterial({
      color: "#06b6d4",
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
    });
    this.disposableGeos.push(telGeo);
    this.disposableMats.push(telMat);

    this.teleportIndicator = new THREE.Mesh(telGeo, telMat);
    this.teleportIndicator.rotation.x = -Math.PI / 2;
    this.teleportIndicator.visible = false;
    this.scene.add(this.teleportIndicator);

    this.teleportPositions = new Float32Array(TELEPORT_STEPS * 3);
    const tRayGeo = new THREE.BufferGeometry();
    tRayGeo.setAttribute("position", new THREE.BufferAttribute(this.teleportPositions, 3));
    tRayGeo.setDrawRange(0, 0);
    const tRayMat = new THREE.LineBasicMaterial({
      color: "#22d3ee",
      transparent: true,
      opacity: 0.75,
    });
    this.disposableGeos.push(tRayGeo);
    this.disposableMats.push(tRayMat);

    this.teleportRay = new THREE.Line(tRayGeo, tRayMat);
    this.teleportRay.frustumCulled = false;
    this.teleportRay.visible = false;
    this.scene.add(this.teleportRay);

    // ---- Fire hose nozzle (attached to right hand / camera) ----
    this.hoseGroup = new THREE.Group();
    this.hoseGroup.visible = false;
    this.scene.add(this.hoseGroup);

    const hoseBodyGeo = new THREE.CylinderGeometry(0.045, 0.065, 0.75, 10);
    const hoseBodyMat = new THREE.MeshStandardMaterial({
      color: "#dc2626",
      roughness: 0.42,
      metalness: 0.35,
    });
    const hoseBody = new THREE.Mesh(hoseBodyGeo, hoseBodyMat);
    hoseBody.rotation.x = Math.PI / 2;
    hoseBody.position.z = -0.25;
    this.hoseGroup.add(hoseBody);

    const nozzleGeo = new THREE.CylinderGeometry(0.075, 0.05, 0.25, 10);
    const nozzleMat = new THREE.MeshStandardMaterial({
      color: "#1e293b",
      roughness: 0.35,
      metalness: 0.65,
    });
    const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = -0.68;
    this.hoseGroup.add(nozzle);

    this.hoseNozzleTip = new THREE.Object3D();
    this.hoseNozzleTip.position.set(0, 0, -0.82);
    this.hoseGroup.add(this.hoseNozzleTip);

    this.disposableGeos.push(hoseBodyGeo, nozzleGeo);
    this.disposableMats.push(hoseBodyMat, nozzleMat);

    // ---- Water/foam particle stream in WORLD space (child of scene, never hoseGroup!) ----
    const HOSE_PARTICLES = 320;
    this.hosePositions = new Float32Array(HOSE_PARTICLES * 3);
    this.hoseVelocities = new Float32Array(HOSE_PARTICLES * 3);
    this.hoseLife = new Float32Array(HOSE_PARTICLES);
    for (let i = 0; i < HOSE_PARTICLES; i++) {
      this.hoseLife[i] = -1;
      this.hosePositions[i * 3 + 1] = -9999;
    }

    const hosePartGeo = new THREE.BufferGeometry();
    hosePartGeo.setAttribute("position", new THREE.BufferAttribute(this.hosePositions, 3));
    const hosePartMat = new THREE.PointsMaterial({
      size: 1.5,
      color: "#38bdf8",
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.disposableGeos.push(hosePartGeo);
    this.disposableMats.push(hosePartMat);

    this.hoseParticles = new THREE.Points(hosePartGeo, hosePartMat);
    this.hoseParticles.frustumCulled = false;
    this.hoseParticles.visible = false;
    this.scene.add(this.hoseParticles);

    // ---- 3D Handheld Dosimeter (ДКС-96) ----
    this.dosimeterCanvas = document.createElement("canvas");
    this.dosimeterCanvas.width = 256;
    this.dosimeterCanvas.height = 128;
    this.dosimeterCtx = this.dosimeterCanvas.getContext("2d")!;
    this.dosimeterTexture = new THREE.CanvasTexture(this.dosimeterCanvas);
    this.dosimeterTexture.colorSpace = THREE.SRGBColorSpace;

    this.dosimeterGroup = this.buildDosimeterModel(this.dosimeterTexture);
    this.dosimeterGroup.visible = false;
    this.scene.add(this.dosimeterGroup);

    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType("local-floor");

    this.setupControllers();
    this.setupKeyboardMouse();

    this.renderer.xr.addEventListener("sessionstart", this.onVRSessionStart);
    this.renderer.xr.addEventListener("sessionend", this.onVRSessionEnd);

    this.updateDosimeterDisplay(true);
  }

  private buildDosimeterModel(screenTex: THREE.CanvasTexture): THREE.Group {
    const group = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(0.22, 0.14, 0.055);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: "#334155",
      roughness: 0.45,
      metalness: 0.45,
    });
    group.add(new THREE.Mesh(bodyGeo, bodyMat));

    const bezelGeo = new THREE.BoxGeometry(0.195, 0.105, 0.006);
    const bezelMat = new THREE.MeshStandardMaterial({
      color: "#0f172a",
      roughness: 0.3,
      metalness: 0.5,
    });
    const bezel = new THREE.Mesh(bezelGeo, bezelMat);
    bezel.position.z = 0.028;
    group.add(bezel);

    const screenGeo = new THREE.PlaneGeometry(0.18, 0.09);
    const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false });
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.z = 0.032;
    group.add(screenMesh);

    const gripGeo = new THREE.BoxGeometry(0.08, 0.14, 0.045);
    const gripMat = new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 0.65 });
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.y = -0.13;
    group.add(grip);

    const probeGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.22, 8);
    const probeMat = new THREE.MeshStandardMaterial({
      color: "#94a3b8",
      roughness: 0.3,
      metalness: 0.75,
    });
    const probe = new THREE.Mesh(probeGeo, probeMat);
    probe.rotation.x = Math.PI / 2;
    probe.position.set(0, 0, -0.13);
    group.add(probe);

    this.disposableGeos.push(bodyGeo, bezelGeo, screenGeo, gripGeo, probeGeo);
    this.disposableMats.push(bodyMat, bezelMat, screenMat, gripMat, probeMat);
    return group;
  }

  private setupControllers(): void {
    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      const grip = this.renderer.xr.getControllerGrip(i);

      const rayGeo = new THREE.BufferGeometry();
      rayGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, -18]), 3),
      );
      const rayMat = new THREE.LineBasicMaterial({
        color: i === 0 ? "#06b6d4" : "#f97316",
        transparent: true,
        opacity: 0.65,
      });
      const rayLine = new THREE.Line(rayGeo, rayMat);
      controller.add(rayLine);

      // Stylized VR hand / controller body
      const ctrlGeo = new THREE.BoxGeometry(0.045, 0.045, 0.12);
      const ctrlMat = new THREE.MeshStandardMaterial({
        color: i === 0 ? "#0f172a" : "#1e293b",
        roughness: 0.45,
        metalness: 0.35,
      });
      const ctrlBody = new THREE.Mesh(ctrlGeo, ctrlMat);
      ctrlBody.position.z = -0.04;
      controller.add(ctrlBody);

      const palmGeo = new THREE.BoxGeometry(0.08, 0.03, 0.09);
      const palmMat = new THREE.MeshStandardMaterial({
        color: i === 0 ? "#0891b2" : "#ea580c",
        roughness: 0.6,
      });
      const palm = new THREE.Mesh(palmGeo, palmMat);
      grip.add(palm);

      this.disposableGeos.push(rayGeo, ctrlGeo, palmGeo);
      this.disposableMats.push(rayMat, ctrlMat, palmMat);

      this.playerRig.add(controller);
      this.playerRig.add(grip);

      const entry: VRControllerState = {
        controller,
        grip,
        rayLine,
        isSelecting: false,
        triggerValue: 0,
        gripValue: 0,
        thumbstick: { x: 0, y: 0 },
        turned: false,
      };

      controller.addEventListener("selectstart", () => {
        entry.isSelecting = true;
        this.ensureAudioUnlocked();
        if (i === 0 && this.isInVR) {
          this.isTeleporting = true;
        }
      });

      controller.addEventListener("selectend", () => {
        entry.isSelecting = false;
        if (i === 0 && this.isInVR) {
          if (this.hasTeleportTarget) {
            this.playerRig.position.x = this.teleportTarget.x;
            this.playerRig.position.z = this.teleportTarget.z;
          }
          this.isTeleporting = false;
          this.hasTeleportTarget = false;
          this.teleportIndicator.visible = false;
          this.teleportRay.visible = false;
        }
      });

      this.controllers.push(entry);
    }
  }

  private setupKeyboardMouse(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    this.renderer.domElement.addEventListener("click", this.onCanvasClick);
  }

  private onCanvasClick = () => {
    this.ensureAudioUnlocked();
    if (!this.isInVR && this.fpMode && document.pointerLockElement !== this.renderer.domElement) {
      this.renderer.domElement.requestPointerLock?.();
    }
  };

  private onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys[e.code] = true;
    if (this.isActive()) {
      this.ensureAudioUnlocked();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0 && this.fpMode && !this.isInVR && this.pointerLocked) {
      this.mouseFireDown = true;
      this.ensureAudioUnlocked();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      this.mouseFireDown = false;
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked || !this.fpMode || this.isInVR) return;
    this.yaw -= e.movementX * 0.0022;
    this.pitch -= e.movementY * 0.0022;
    this.pitch = Math.max(-Math.PI / 2 + 0.08, Math.min(Math.PI / 2 - 0.08, this.pitch));
  };

  private ensureAudioUnlocked(): void {
    if (!this.geigerAudioCtx) {
      try {
        this.geigerAudioCtx = new AudioContext();
      } catch {
        return;
      }
    }
    if (this.geigerAudioCtx.state === "suspended") {
      this.geigerAudioCtx.resume().catch(() => {});
    }
  }

  setSpawnPosition(x: number, z: number): void {
    this.spawnPos.set(x, 0, z);
    if (!this.isActive()) {
      this.playerRig.position.copy(this.spawnPos);
    }
  }

  private attachCameraToRig(forVR: boolean): void {
    if (this.camera.parent !== this.playerRig) {
      this.savedCamPos.copy(this.camera.position);
      this.savedCamQuat.copy(this.camera.quaternion);
      this.playerRig.position.copy(this.spawnPos);
      this.playerRig.rotation.set(0, 0, 0);
      this.yaw = 0;
      this.pitch = 0;
      this.playerRig.add(this.camera);
    }
    if (forVR) {
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
    } else {
      this.camera.position.set(0, EYE_HEIGHT, 0);
      this.camera.rotation.order = "YXZ";
      this.camera.rotation.set(this.pitch, 0, 0);
    }
  }

  private detachCameraToScene(): void {
    if (this.camera.parent === this.playerRig) {
      this.playerRig.remove(this.camera);
      this.scene.add(this.camera);
      this.camera.position.copy(this.savedCamPos);
      this.camera.quaternion.copy(this.savedCamQuat);
      this.camera.rotation.order = "XYZ";
    }
  }

  async enterVR(): Promise<void> {
    this.ensureAudioUnlocked();

    // If already in VR, end session cleanly
    const currentSession = this.renderer.xr.getSession();
    if (currentSession) {
      await currentSession.end();
      return;
    }

    if (!("xr" in navigator) || !navigator.xr) {
      this.enableFirstPerson("WebXR недоступен в этом браузере — включён режим 1-го лица (WASD)");
      return;
    }

    try {
      const supported = await navigator.xr.isSessionSupported("immersive-vr");
      if (!supported) {
        this.enableFirstPerson("VR-шлем не обнаружен — включён режим 1-го лица (WASD)");
        return;
      }
      const session = await navigator.xr.requestSession("immersive-vr", {
        optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
      });
      await this.renderer.xr.setSession(session);
    } catch {
      this.enableFirstPerson("Не удалось запустить VR-сессию — включён режим 1-го лица (WASD)");
    }
  }

  enableFirstPerson(statusMsg?: string): void {
    if (this.isInVR) return;
    this.ensureAudioUnlocked();
    this.fpMode = true;
    this.clock.getDelta();
    this.attachCameraToRig(false);

    this.hoseGroup.visible = true;
    this.hoseParticles.visible = true;
    this.dosimeterGroup.visible = true;

    // Attach dosimeter to bottom-left of FP view tilted cleanly toward viewer
    this.camera.add(this.dosimeterGroup);
    this.dosimeterGroup.position.set(-0.34, -0.2, -0.58);
    this.dosimeterGroup.rotation.set(-0.18, 0.36, 0.04);

    // Attach fire hose nozzle to bottom-right of FP view
    this.camera.add(this.hoseGroup);
    this.hoseGroup.position.set(0.24, -0.2, -0.35);
    this.hoseGroup.rotation.set(0.04, 0.06, 0);

    this.renderer.domElement.style.cursor = "crosshair";
    this.opts.onModeChange?.({ isInVR: false, fpMode: true, statusMsg });
  }

  disableFirstPerson(): void {
    if (!this.fpMode && !this.isInVR) return;
    this.fpMode = false;
    this.mouseFireDown = false;
    this.hoseGroup.visible = false;
    this.hoseParticles.visible = false;
    this.dosimeterGroup.visible = false;
    this.stopAlarm();

    if (this.dosimeterGroup.parent) this.dosimeterGroup.parent.remove(this.dosimeterGroup);
    if (this.hoseGroup.parent) this.hoseGroup.parent.remove(this.hoseGroup);
    this.scene.add(this.dosimeterGroup);
    this.scene.add(this.hoseGroup);

    this.detachCameraToScene();
    this.renderer.domElement.style.cursor = "";
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock?.();
    }
    this.opts.onModeChange?.({ isInVR: false, fpMode: false });
  }

  private onVRSessionStart = () => {
    this.fpMode = false;
    this.isInVR = true;
    this.clock.getDelta();
    this.attachCameraToRig(true);

    this.hoseGroup.visible = true;
    this.hoseParticles.visible = true;
    this.dosimeterGroup.visible = true;

    // Attach hose to right hand grip (1), dosimeter to left hand grip (0)
    if (this.controllers[1]) {
      this.controllers[1].grip.add(this.hoseGroup);
      this.hoseGroup.position.set(0, -0.02, -0.08);
      this.hoseGroup.rotation.set(0, 0, 0);
    }
    if (this.controllers[0]) {
      this.controllers[0].grip.add(this.dosimeterGroup);
      this.dosimeterGroup.position.set(0, 0.02, -0.04);
      this.dosimeterGroup.rotation.set(-0.65, 0.15, 0.08);
    }

    this.opts.onModeChange?.({ isInVR: true, fpMode: false });
  };

  private onVRSessionEnd = () => {
    this.isInVR = false;
    this.isTeleporting = false;
    this.hasTeleportTarget = false;
    this.teleportIndicator.visible = false;
    this.teleportRay.visible = false;
    this.hoseGroup.visible = false;
    this.hoseParticles.visible = false;
    this.dosimeterGroup.visible = false;
    this.stopAlarm();

    if (this.hoseGroup.parent) this.hoseGroup.parent.remove(this.hoseGroup);
    if (this.dosimeterGroup.parent) this.dosimeterGroup.parent.remove(this.dosimeterGroup);
    this.scene.add(this.hoseGroup);
    this.scene.add(this.dosimeterGroup);

    this.detachCameraToScene();
    this.opts.onModeChange?.({ isInVR: false, fpMode: false });
  };

  private updateGamepads(): void {
    const session = this.renderer.xr.getSession();
    if (!session) return;
    let idx = 0;
    for (const source of session.inputSources) {
      const targetIdx = source.handedness === "left" ? 0 : source.handedness === "right" ? 1 : idx;
      const ctrl = this.controllers[targetIdx];
      if (ctrl && source.gamepad) {
        const axes = source.gamepad.axes;
        const buttons = source.gamepad.buttons;
        ctrl.thumbstick.x = axes[2] ?? axes[0] ?? 0;
        ctrl.thumbstick.y = axes[3] ?? axes[1] ?? 0;
        ctrl.triggerValue = buttons[0]?.value ?? 0;
        ctrl.gripValue = buttons[1]?.value ?? 0;
      }
      idx++;
    }
  }

  private updateLocomotion(dt: number): void {
    if (this.isInVR) {
      const left = this.controllers[0];
      const right = this.controllers[1];

      // Left thumbstick: smooth locomotion along horizontal camera direction
      if (left && (Math.abs(left.thumbstick.x) > 0.15 || Math.abs(left.thumbstick.y) > 0.15)) {
        this.camera.getWorldDirection(this._vecA);
        this._vecA.y = 0;
        if (this._vecA.lengthSq() > 1e-6) {
          this._vecA.normalize();
          // Right vector = forward x up = (-fz, 0, fx)
          this._vecB.set(-this._vecA.z, 0, this._vecA.x);
          const moveX = left.thumbstick.x;
          const moveForward = -left.thumbstick.y;
          this.playerRig.position.x +=
            (this._vecB.x * moveX + this._vecA.x * moveForward) * MOVE_SPEED * dt;
          this.playerRig.position.z +=
            (this._vecB.z * moveX + this._vecA.z * moveForward) * MOVE_SPEED * dt;
        }
      }

      // Right thumbstick: 30° snap turn with hysteresis
      if (right) {
        if (Math.abs(right.thumbstick.x) > 0.68) {
          if (!right.turned) {
            right.turned = true;
            this.playerRig.rotateY(
              THREE.MathUtils.degToRad(right.thumbstick.x > 0 ? -SNAP_TURN_DEG : SNAP_TURN_DEG),
            );
          }
        } else if (Math.abs(right.thumbstick.x) < 0.3) {
          right.turned = false;
        }
      }
    } else if (this.fpMode) {
      this.camera.getWorldDirection(this._vecA);
      this._vecA.y = 0;
      if (this._vecA.lengthSq() > 1e-6) {
        this._vecA.normalize();
      } else {
        this._vecA.set(0, 0, -1);
      }
      this._vecB.set(-this._vecA.z, 0, this._vecA.x);

      let mx = 0;
      let mz = 0;
      if (this.keys["KeyW"] || this.keys["ArrowUp"]) mz += 1;
      if (this.keys["KeyS"] || this.keys["ArrowDown"]) mz -= 1;
      if (this.keys["KeyD"] || this.keys["ArrowRight"]) mx += 1;
      if (this.keys["KeyA"] || this.keys["ArrowLeft"]) mx -= 1;

      const sprint = this.keys["ShiftLeft"] || this.keys["ShiftRight"] ? 2.2 : 1.0;
      const speed = MOVE_SPEED * sprint * dt;
      this.playerRig.position.x += (this._vecB.x * mx + this._vecA.x * mz) * speed;
      this.playerRig.position.z += (this._vecB.z * mx + this._vecA.z * mz) * speed;

      this.playerRig.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
    }

    // Clamp player rig strictly to ground level y = 0 and site bounds
    this.playerRig.position.y = 0;
    this.playerRig.position.x = THREE.MathUtils.clamp(this.playerRig.position.x, -4500, 4500);
    this.playerRig.position.z = THREE.MathUtils.clamp(this.playerRig.position.z, -4500, 4500);
  }

  private updateTeleport(): void {
    if (!this.isInVR || !this.isTeleporting) return;
    const left = this.controllers[0];
    if (!left) return;

    left.controller.getWorldPosition(this._vecA); // origin
    left.controller.getWorldQuaternion(this._quatA);
    this._vecB.set(0, 0, -1).applyQuaternion(this._quatA).normalize(); // world forward

    // Parabolic velocity
    this._vecC.copy(this._vecB).multiplyScalar(45);
    this._vecC.y += 14;
    const gravity = -28;
    const stepDt = 0.05;

    this._vecD.copy(this._vecA); // current pos
    let hit = false;
    let count = 0;

    for (let i = 0; i < TELEPORT_STEPS; i++) {
      this.teleportPositions[i * 3] = this._vecD.x;
      this.teleportPositions[i * 3 + 1] = Math.max(0.05, this._vecD.y);
      this.teleportPositions[i * 3 + 2] = this._vecD.z;
      count++;

      const prevY = this._vecD.y;
      this._vecE.copy(this._vecD);
      this._vecD.addScaledVector(this._vecC, stepDt);
      this._vecC.y += gravity * stepDt;

      if (this._vecD.y <= 0.05 && i > 0) {
        const denom = Math.max(1e-4, prevY - this._vecD.y);
        const frac = THREE.MathUtils.clamp(prevY / denom, 0, 1);
        this.teleportTarget.lerpVectors(this._vecE, this._vecD, frac);
        this.teleportTarget.y = 0;
        if (count < TELEPORT_STEPS) {
          this.teleportPositions[count * 3] = this.teleportTarget.x;
          this.teleportPositions[count * 3 + 1] = 0.08;
          this.teleportPositions[count * 3 + 2] = this.teleportTarget.z;
          count++;
        }
        hit = true;
        break;
      }
    }

    const posAttr = this.teleportRay.geometry.attributes.position as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    this.teleportRay.geometry.setDrawRange(0, count);
    this.teleportRay.visible = count > 1;

    if (hit && this.teleportTarget.distanceTo(this._vecA) <= TELEPORT_MAX_DIST) {
      this.hasTeleportTarget = true;
      this.teleportIndicator.position.set(this.teleportTarget.x, 0.12, this.teleportTarget.z);
      this.teleportIndicator.visible = true;
    } else {
      this.hasTeleportTarget = false;
      this.teleportIndicator.visible = false;
    }
  }

  private updateFireHose(dt: number): void {
    const right = this.controllers[1];
    const spraying = this.isInVR
      ? Boolean(right && (right.triggerValue > 0.45 || right.isSelecting))
      : this.fpMode && (this.keys["Space"] || this.keys["KeyF"] || this.mouseFireDown);

    this.hoseHitFireId = null;

    if (spraying) {
      this.hoseNozzleTip.getWorldPosition(this._vecA); // spawn origin at nozzle tip
      if (this.isInVR && right) {
        right.controller.getWorldQuaternion(this._quatA);
        this._vecB.set(0, 0, -1).applyQuaternion(this._quatA).normalize();
      } else {
        this.camera.getWorldDirection(this._vecB);
      }

      const fires = this.opts.getFires();
      let bestDist = FIRE_HOSE_RANGE;
      for (const fire of fires) {
        if (fire.extinguished) continue;
        this._vecC.copy(fire.position).sub(this._vecA);
        const proj = this._vecC.dot(this._vecB);
        if (proj < 0 || proj > bestDist) continue;
        this._vecD.copy(this._vecB).multiplyScalar(proj);
        const perpDist = this._vecC.sub(this._vecD).length();
        if (perpDist < 22) {
          bestDist = proj;
          this.hoseHitFireId = fire.id;
        }
      }

      if (this.hoseHitFireId) {
        this.opts.onExtinguishProgress(this.hoseHitFireId, FIRE_EXTINGUISH_RATE * dt);
      }

      this.emitHoseParticles(this._vecA, this._vecB);
    }

    this.updateHoseParticles(dt);
  }

  private emitHoseParticles(origin: THREE.Vector3, dir: THREE.Vector3): void {
    let emitted = 0;
    for (let i = 0; i < this.hoseLife.length && emitted < 10; i++) {
      if (this.hoseLife[i] < 0) {
        this.hosePositions[i * 3] = origin.x + (Math.random() - 0.5) * 0.18;
        this.hosePositions[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.18;
        this.hosePositions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.18;
        this.hoseVelocities[i * 3] = dir.x * 38 + (Math.random() - 0.5) * 3.5;
        this.hoseVelocities[i * 3 + 1] = dir.y * 38 + (Math.random() - 0.5) * 2.5;
        this.hoseVelocities[i * 3 + 2] = dir.z * 38 + (Math.random() - 0.5) * 3.5;
        this.hoseLife[i] = 1.0;
        emitted++;
      }
    }
  }

  private updateHoseParticles(dt: number): void {
    const posAttr = this.hoseParticles.geometry.attributes.position as THREE.BufferAttribute;
    let anyAlive = false;
    for (let i = 0; i < this.hoseLife.length; i++) {
      if (this.hoseLife[i] > 0) {
        anyAlive = true;
        this.hoseLife[i] -= dt * 1.35;
        this.hoseVelocities[i * 3 + 1] -= 14 * dt;
        this.hosePositions[i * 3] += this.hoseVelocities[i * 3] * dt;
        this.hosePositions[i * 3 + 1] += this.hoseVelocities[i * 3 + 1] * dt;
        this.hosePositions[i * 3 + 2] += this.hoseVelocities[i * 3 + 2] * dt;
        if (this.hoseLife[i] <= 0 || this.hosePositions[i * 3 + 1] < 0) {
          this.hoseLife[i] = -1;
          this.hosePositions[i * 3] = 0;
          this.hosePositions[i * 3 + 1] = -9999;
          this.hosePositions[i * 3 + 2] = 0;
        }
      }
    }
    if (anyAlive) {
      posAttr.needsUpdate = true;
    }
  }

  private updateEvacInteraction(): void {
    const right = this.controllers[1];
    const actionPressed = this.isInVR
      ? Boolean(right && (right.triggerValue > 0.45 || right.gripValue > 0.45 || right.isSelecting))
      : Boolean(this.fpMode && this.keys["KeyE"]);

    this.playerRig.getWorldPosition(this._vecA);
    if (this.isInVR && right) {
      right.controller.getWorldPosition(this._vecB);
      right.controller.getWorldQuaternion(this._quatA);
      this._vecC.set(0, 0, -1).applyQuaternion(this._quatA).normalize();
    } else {
      this.camera.getWorldPosition(this._vecB);
      this.camera.getWorldDirection(this._vecC);
    }

    const evacs = this.opts.getEvacs();
    for (const evac of evacs) {
      if (evac.status !== "waiting") continue;

      const dx = evac.position.x - this._vecA.x;
      const dz = evac.position.z - this._vecA.z;
      const horizDist = Math.hypot(dx, dz);

      // 1) Automatic dispatch when approaching closely
      if (horizDist <= EVAC_AUTO_RADIUS) {
        this.opts.onDispatchEvac(evac.id);
        continue;
      }

      if (!actionPressed) continue;

      // 2) Action button near squad
      if (horizDist <= EVAC_ACTION_RADIUS) {
        this.opts.onDispatchEvac(evac.id);
        continue;
      }

      // 3) Action button while aiming ray at squad
      this._vecD.copy(evac.position).sub(this._vecB);
      const proj = this._vecD.dot(this._vecC);
      if (proj > 0 && proj <= EVAC_RAY_RADIUS) {
        this._vecE.copy(this._vecC).multiplyScalar(proj);
        if (this._vecD.sub(this._vecE).length() < 16) {
          this.opts.onDispatchEvac(evac.id);
        }
      }
    }
  }

  private computeDoseRate(): number {
    const ctx = this.opts.getDoseContext();
    this.dosimeterGroup.getWorldPosition(this._vecA);

    const windRad = (ctx.windDirDeg * Math.PI) / 180;
    const wx = Math.sin(windRad);
    const wz = -Math.cos(windRad);
    const cx = -wz;
    const cz = wx;

    const dx = this._vecA.x - ctx.stackTipWorld.x;
    const dz = this._vecA.z - ctx.stackTipWorld.z;
    const along = dx * wx + dz * wz;
    const cross = dx * cx + dz * cz;
    const dist = Math.hypot(along, cross);

    let rate = 0.08; // Natural background ~0.08 uSv/h

    // 1. Gaussian plume with ground reflection at breathing height z
    if (along > -25) {
      const effAlong = Math.max(15, along);
      const sigmaY = 22 + Math.pow(effAlong, 0.82) * 0.45;
      const sigmaZ = 18 + Math.pow(effAlong, 0.75) * 0.28;
      const z = Math.max(0.5, this._vecA.y);
      const H = Math.max(15, ctx.stackTipWorld.y * 0.42); // building-wake mixed effective height

      const expY = Math.exp(-(cross * cross) / (2 * sigmaY * sigmaY));
      const expZ =
        Math.exp(-((z - H) * (z - H)) / (2 * sigmaZ * sigmaZ)) +
        Math.exp(-((z + H) * (z + H)) / (2 * sigmaZ * sigmaZ));
      const windFactor = Math.max(1, ctx.windSpeedMs);
      const scenarioGain =
        ctx.scenario === "shortTerm" ? 3.2 : ctx.scenario === "longTerm" ? 0.85 : 1.35;

      rate += (2.4e5 * scenarioGain * expY * expZ) / (windFactor * sigmaY * sigmaZ);
    }

    // 2. Scenario-specific fields
    if (ctx.scenario === "puff" && ctx.puffCenterWorld) {
      const pDist = this._vecA.distanceTo(ctx.puffCenterWorld);
      const pRad = Math.max(40, ctx.puffRadius ?? 80);
      rate += 4500 * Math.exp(-(pDist * pDist) / (2 * pRad * pRad));
    } else if (ctx.scenario === "shortTerm") {
      // Touchdown acute peak zone around ~420m downwind
      const peakX = ctx.stackTipWorld.x + wx * 420;
      const peakZ = ctx.stackTipWorld.z + wz * 420;
      const dPeak = Math.hypot(this._vecA.x - peakX, this._vecA.z - peakZ);
      rate += 3200 * Math.exp(-(dPeak * dPeak) / (2 * 130 * 130));
    } else if (ctx.scenario === "longTerm" && along > 0) {
      // Cumulative ground fallout sector deposition
      const sectorSigma = 90 + along * 0.24;
      const sectorExp = Math.exp(-(cross * cross) / (2 * sectorSigma * sectorSigma));
      rate += 650 * sectorExp * Math.exp(-dist / 1200);
    }

    // 3. Reactor building proximity skyshine / near-field gradient
    const reactorDist = Math.hypot(this._vecA.x, this._vecA.z);
    if (reactorDist < 260) {
      rate += Math.pow((260 - reactorDist) / 260, 2) * 180;
    }

    return Math.max(0.05, rate);
  }

  private updateDosimeterDisplay(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastDisplayUpdate < 80) return;
    this.lastDisplayUpdate = now;

    const ctx = this.dosimeterCtx;
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, 256, 128);

    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, 252, 124);

    ctx.font = "bold 13px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("ДКС-96  РАДИОМЕТР", 10, 20);

    // Dose rate
    ctx.fillStyle =
      this.hazardLevel === "danger"
        ? "#fca5a5"
        : this.hazardLevel === "elevated"
          ? "#fde68a"
          : "#e2e8f0";
    ctx.font = "bold 22px monospace";
    const rateStr =
      this.currentDoseRate < 1000
        ? `${this.currentDoseRate.toFixed(1)} мкЗв/ч`
        : `${(this.currentDoseRate / 1000).toFixed(2)} мЗв/ч`;
    ctx.fillText(rateStr, 10, 50);

    // Accumulated dose
    ctx.font = "12px monospace";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(`Накопл: ${this.accumulatedDose.toFixed(4)} мЗв`, 10, 70);

    // Hazard bar
    const barY = 84;
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(10, barY, 236, 18);
    const barColor =
      this.hazardLevel === "normal"
        ? "#10b981"
        : this.hazardLevel === "elevated"
          ? "#f59e0b"
          : "#ef4444";
    ctx.fillStyle = barColor;
    const barFrac = Math.min(1, Math.log10(Math.max(1, this.currentDoseRate)) / 4);
    ctx.fillRect(10, barY, Math.max(8, 236 * barFrac), 18);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px monospace";
    const levelText =
      this.hazardLevel === "normal"
        ? "НОРМА"
        : this.hazardLevel === "elevated"
          ? "ПОВЫШЕННЫЙ"
          : "ОПАСНО!";
    ctx.fillText(levelText, 16, 97);

    // Geiger indicator pulse LED
    const blink = Math.sin(now * 0.015) > 0;
    ctx.fillStyle =
      this.hazardLevel === "danger"
        ? blink
          ? "#ef4444"
          : "#7f1d1d"
        : blink
          ? "#22d3ee"
          : "#1e293b";
    ctx.beginPath();
    ctx.arc(238, 16, 5, 0, Math.PI * 2);
    ctx.fill();

    this.dosimeterTexture.needsUpdate = true;
  }

  private updateGeigerAudio(): void {
    if (!this.geigerAudioCtx || this.geigerAudioCtx.state !== "running") return;

    const clickInterval = Math.max(0.035, 1.8 / Math.max(0.25, Math.sqrt(this.currentDoseRate)));
    const now = this.geigerAudioCtx.currentTime;
    if (now - this.lastGeigerClick > clickInterval) {
      this.lastGeigerClick = now;
      this.playGeigerClick();
    }

    if (this.hazardLevel === "danger" && !this.alarmActive) {
      this.alarmActive = true;
      this.playAlarm();
    } else if (this.hazardLevel !== "danger" && this.alarmActive) {
      this.alarmActive = false;
      this.stopAlarm();
    }
  }

  private playGeigerClick(): void {
    if (!this.geigerAudioCtx) return;
    const now = this.geigerAudioCtx.currentTime;
    const osc = this.geigerAudioCtx.createOscillator();
    const gain = this.geigerAudioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = 1800 + Math.random() * 650;
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.009);
    osc.connect(gain);
    gain.connect(this.geigerAudioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.011);
  }

  private playAlarm(): void {
    if (!this.geigerAudioCtx) return;
    this.stopAlarm();
    this.alarmOsc = this.geigerAudioCtx.createOscillator();
    this.alarmGain = this.geigerAudioCtx.createGain();
    this.alarmOsc.type = "sawtooth";
    this.alarmOsc.frequency.value = 880;
    this.alarmGain.gain.value = 0.025;
    this.alarmOsc.connect(this.alarmGain);
    this.alarmGain.connect(this.geigerAudioCtx.destination);
    this.alarmOsc.start();
    this.alarmTimerId = window.setInterval(() => {
      if (this.alarmOsc && this.geigerAudioCtx) {
        this.alarmOsc.frequency.setValueAtTime(
          this.alarmOsc.frequency.value > 600 ? 440 : 880,
          this.geigerAudioCtx.currentTime,
        );
      }
    }, 450);
  }

  private stopAlarm(): void {
    if (this.alarmTimerId !== null) {
      window.clearInterval(this.alarmTimerId);
      this.alarmTimerId = null;
    }
    if (this.alarmOsc) {
      try {
        this.alarmOsc.stop();
      } catch {
        // already stopped
      }
      this.alarmOsc.disconnect();
      this.alarmOsc = null;
    }
    if (this.alarmGain) {
      this.alarmGain.disconnect();
      this.alarmGain = null;
    }
    this.alarmActive = false;
  }

  update(): void {
    const dt = Math.min(0.1, this.clock.getDelta());
    this.updateGamepads();
    this.updateLocomotion(dt);
    this.updateTeleport();
    this.updateFireHose(dt);
    this.updateEvacInteraction();

    this.currentDoseRate = this.computeDoseRate();
    this.accumulatedDose += (this.currentDoseRate / 3600 / 1000) * dt; // uSv/h * dt -> mSv
    this.hazardLevel =
      this.currentDoseRate >= 1000 ? "danger" : this.currentDoseRate >= 10 ? "elevated" : "normal";

    this.updateDosimeterDisplay();
    this.updateGeigerAudio();
  }

  getTelemetry(): VRTelemetry {
    return {
      doseRate: this.currentDoseRate,
      accumulatedDose: this.accumulatedDose,
      hazardLevel: this.hazardLevel,
    };
  }

  isActive(): boolean {
    return this.isInVR || this.fpMode;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    this.renderer.domElement.removeEventListener("click", this.onCanvasClick);
    this.renderer.xr.removeEventListener("sessionstart", this.onVRSessionStart);
    this.renderer.xr.removeEventListener("sessionend", this.onVRSessionEnd);

    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock?.();
    }

    this.stopAlarm();
    if (this.geigerAudioCtx) {
      this.geigerAudioCtx.close().catch(() => {});
      this.geigerAudioCtx = null;
    }

    this.detachCameraToScene();
    this.scene.remove(this.playerRig);
    this.scene.remove(this.teleportIndicator);
    this.scene.remove(this.teleportRay);
    this.scene.remove(this.hoseGroup);
    this.scene.remove(this.hoseParticles);
    this.scene.remove(this.dosimeterGroup);

    this.dosimeterTexture.dispose();
    for (const g of this.disposableGeos) g.dispose();
    for (const m of this.disposableMats) m.dispose();
  }
}
