import * as THREE from "three";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * VR + first-person emergency response system for the AURA-RAD NPP inspector.
 *
 * Features:
 *  - WebXR VR session with player rig (camera + two controllers + hand models)
 *  - Smooth locomotion (left stick) + snap-turn (right stick)
 *  - Arc teleport with landing indicator
 *  - Keyboard / mouse fallback (WASD + pointer-lock look)
 *  - Fire hose on right controller: trigger to spray, reduces fire intensity
 *  - Evacuation: grip/trigger near a squad starts guided movement to safe zone
 *  - 3D dosimeter on left controller / screen corner with live CanvasTexture display,
 *    dose-rate + accumulated dose computation from plume concentration, and
 *    synthesized Geiger clicks + alarm via Web Audio API.
 */

const EYE_HEIGHT = 1.7;
const SNAP_TURN_DEG = 30;
const MOVE_SPEED = 8.0; // m/s
const TELEPORT_MAX_DIST = 400;
const FIRE_HOSE_RANGE = 60;
const FIRE_EXTINGUISH_RATE = 22; // progress points per second
const EVAC_TRIGGER_RADIUS = 18;

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

export interface VREmergencySystemOptions {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  groundPlane: THREE.Mesh;
  gltfLoader: GLTFLoader;
  getFires: () => FireTarget[];
  getEvacs: () => EvacTarget[];
  onExtinguishProgress: (id: string, delta: number) => void;
  onDispatchEvac: (id: string) => void;
  getDoseContext: () => DoseContext;
  onEnterVR?: () => void;
  onExitVR?: () => void;
}

export interface DoseContext {
  scenario: "plume" | "puff" | "shortTerm" | "longTerm";
  stackTipWorld: THREE.Vector3;
  windDirDeg: number;
  windSpeedMs: number;
  stackHeightM: number;
}

interface VRController {
  controller: THREE.Group;
  grip: THREE.Group;
  rayLine: THREE.Line;
  isSelecting: boolean;
  triggerValue: number;
  gripValue: number;
  thumbstick: { x: number; y: number };
  gamepadIndex: number;
}

export class VREmergencySystem {
  private opts: VREmergencySystemOptions;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private ground: THREE.Mesh;

  private playerRig: THREE.Group;
  private controllers: VRController[] = [];

  private vrButton: HTMLElement | null = null;
  private isInVR = false;
  private fpMode = false; // non-VR first-person mode

  // Keyboard/mouse state
  private keys: Record<string, boolean> = {};
  private pointerLocked = false;
  private yaw = 0;
  private pitch = 0;

  // Teleport
  private teleportIndicator: THREE.Mesh;
  private teleportRay: THREE.Line;
  private isTeleporting = false;
  private teleportTarget: THREE.Vector3 | null = null;

  // Fire hose
  private hoseGroup: THREE.Group;
  private hoseParticles: THREE.Points;
  private hosePositions: Float32Array;
  private hoseVelocities: Float32Array;
  private hoseLife: Float32Array;
  private hoseActive = false;
  private hoseHitFireId: string | null = null;

  // Dosimeter
  private dosimeterGroup: THREE.Group;
  private dosimeterCanvas: HTMLCanvasElement;
  private dosimeterCtx: CanvasRenderingContext2D;
  private dosimeterTexture: THREE.CanvasTexture;
  private accumulatedDose = 0; // mSv
  private currentDoseRate = 0; // uSv/h
  private hazardLevel: "normal" | "elevated" | "danger" = "normal";
  private geigerAudioCtx: AudioContext | null = null;
  private geigerOscillator: OscillatorNode | null = null;
  private geigerGain: GainNode | null = null;
  private lastGeigerClick = 0;
  private alarmActive = false;

  private clock = new THREE.Clock();
  private tmpVec = new THREE.Vector3();
  private tmpVec2 = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();

  constructor(options: VREmergencySystemOptions) {
    this.opts = options;
    this.renderer = options.renderer;
    this.camera = options.camera;
    this.scene = options.scene;
    this.ground = options.groundPlane;

    // ---- Player Rig ----
    this.playerRig = new THREE.Group();
    this.playerRig.position.set(0, 0, 200);
    this.scene.add(this.playerRig);
    this.camera.position.set(0, EYE_HEIGHT, 0);
    this.camera.near = 0.05;
    this.camera.far = 25000;
    this.camera.updateProjectionMatrix();
    this.playerRig.add(this.camera);

    // ---- Teleport indicator ----
    const telGeo = new THREE.RingGeometry(2.5, 3.5, 32);
    const telMat = new THREE.MeshBasicMaterial({
      color: "#06b6d4",
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    this.teleportIndicator = new THREE.Mesh(telGeo, telMat);
    this.teleportIndicator.rotation.x = -Math.PI / 2;
    this.teleportIndicator.visible = false;
    this.scene.add(this.teleportIndicator);

    const tRayGeo = new THREE.BufferGeometry();
    tRayGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(60 * 3), 3));
    this.teleportRay = new THREE.Line(
      tRayGeo,
      new THREE.LineBasicMaterial({ color: "#06b6d4", transparent: true, opacity: 0.5 }),
    );
    this.teleportRay.visible = false;
    this.scene.add(this.teleportRay);

    // ---- Fire hose ----
    this.hoseGroup = new THREE.Group();
    this.scene.add(this.hoseGroup);

    const HOSE_PARTICLES = 300;
    this.hosePositions = new Float32Array(HOSE_PARTICLES * 3);
    this.hoseVelocities = new Float32Array(HOSE_PARTICLES * 3);
    this.hoseLife = new Float32Array(HOSE_PARTICLES);
    for (let i = 0; i < HOSE_PARTICLES; i++) this.hoseLife[i] = -1;

    const hoseGeo = new THREE.BufferGeometry();
    hoseGeo.setAttribute("position", new THREE.BufferAttribute(this.hosePositions, 3));
    const hoseMat = new THREE.PointsMaterial({
      size: 1.8,
      color: "#38bdf8",
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    this.hoseParticles = new THREE.Points(hoseGeo, hoseMat);
    this.hoseParticles.frustumCulled = false;
    this.hoseGroup.add(this.hoseParticles);

    const hoseBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 1.2, 8),
      new THREE.MeshStandardMaterial({ color: "#dc2626", roughness: 0.5, metalness: 0.3 }),
    );
    hoseBody.rotation.x = Math.PI / 2;
    hoseBody.position.z = -0.4;
    this.hoseGroup.add(hoseBody);

    const nozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.1, 0.4, 8),
      new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 0.4, metalness: 0.5 }),
    );
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = -1.1;
    this.hoseGroup.add(nozzle);
    this.hoseGroup.visible = false;

    // ---- Dosimeter ----
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

    this.setupControllers();
    this.setupVRButton();
    this.setupKeyboardMouse();

    this.renderer.xr.addEventListener("sessionstart", this.onVRSessionStart);
    this.renderer.xr.addEventListener("sessionend", this.onVRSessionEnd);

    this.updateDosimeterDisplay();
  }

  private buildDosimeterModel(screenTex: THREE.CanvasTexture): THREE.Group {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: "#334155",
      roughness: 0.45,
      metalness: 0.4,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.06), bodyMat);
    group.add(body);

    const screenMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.18, 0.09),
      new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }),
    );
    screenMesh.position.z = 0.031;
    group.add(screenMesh);

    const gripMat = new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 0.6 });
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.05), gripMat);
    grip.position.y = -0.14;
    group.add(grip);

    const probeMat = new THREE.MeshStandardMaterial({
      color: "#94a3b8",
      roughness: 0.3,
      metalness: 0.7,
    });
    const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 8), probeMat);
    probe.rotation.x = Math.PI / 2;
    probe.position.set(0, 0, 0.18);
    group.add(probe);

    return group;
  }

  private setupControllers(): void {
    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      const grip = this.renderer.xr.getControllerGrip(i);

      const rayGeo = new THREE.BufferGeometry();
      rayGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array([-0.005, 0, 0, 0, 0, -10]), 3),
      );
      const rayLine = new THREE.Line(
        rayGeo,
        new THREE.LineBasicMaterial({
          color: i === 0 ? "#06b6d4" : "#f97316",
          transparent: true,
          opacity: 0.6,
        }),
      );
      controller.add(rayLine);

      // Simple controller body
      const ctrlBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.12),
        new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 0.5 }),
      );
      ctrlBody.position.z = -0.04;
      controller.add(ctrlBody);

      this.playerRig.add(controller);
      this.playerRig.add(grip);

      const entry: VRController = {
        controller,
        grip,
        rayLine,
        isSelecting: false,
        triggerValue: 0,
        gripValue: 0,
        thumbstick: { x: 0, y: 0 },
        gamepadIndex: i,
      };

      controller.addEventListener("selectstart", () => {
        entry.isSelecting = true;
      });
      controller.addEventListener("selectend", () => {
        entry.isSelecting = false;
      });

      if (i === 0) {
        // Left controller: teleport with trigger
        controller.addEventListener("selectstart", () => {
          this.isTeleporting = true;
        });
        controller.addEventListener("selectend", () => {
          if (this.teleportTarget) {
            this.playerRig.position.x = this.teleportTarget.x;
            this.playerRig.position.z = this.teleportTarget.z;
          }
          this.isTeleporting = false;
          this.teleportIndicator.visible = false;
          this.teleportRay.visible = false;
        });
      }

      this.controllers.push(entry);
    }
  }

  private setupVRButton(): void {
    // Create custom VR button
    const btn = document.createElement("button");
    btn.textContent = "Войти в VR";
    btn.style.cssText = `
      position:absolute; bottom:60px; right:16px; z-index:10;
      padding:8px 16px; border-radius:8px; font-size:13px; font-weight:600;
      background:#0891b2; color:white; border:1px solid #06b6d4;
      cursor:pointer; transition:background 0.2s;
    `;
    btn.onmouseenter = () => (btn.style.background = "#06b6d4");
    btn.onmouseleave = () => (btn.style.background = "#0891b2");
    btn.onclick = () => this.enterVR();
    this.vrButton = btn;

    const container = this.renderer.domElement.parentElement;
    if (container) container.appendChild(btn);

    // Hide if WebXR unavailable
    if ("xr" in navigator) {
      navigator.xr?.isSessionSupported("immersive-vr").then((supported) => {
        btn.style.display = supported ? "block" : "none";
      }).catch(() => {
        btn.style.display = "none";
      });
    } else {
      btn.style.display = "none";
    }
  }

  private setupKeyboardMouse(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    const canvas = this.renderer.domElement;
    canvas.addEventListener("click", () => {
      if (!this.isInVR && this.fpMode) {
        canvas.requestPointerLock?.();
      }
    });
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    canvas.addEventListener("mousemove", this.onMouseMove);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys[e.code] = true;
    if (e.code === "KeyF" && this.fpMode) {
      // Quick extinguish nearest fire
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked || this.isInVR) return;
    this.yaw -= e.movementX * 0.002;
    this.pitch -= e.movementY * 0.002;
    this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
  };

  async enterVR(): Promise<void> {
    if (!("xr" in navigator) || !navigator.xr) return;
    try {
      const session = await navigator.xr.requestSession("immersive-vr", {
        optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
      });
      this.renderer.xr.setSession(session);
    } catch {
      // VR not available, enable first-person fallback
      this.enableFirstPerson();
    }
  }

  enableFirstPerson(): void {
    this.fpMode = true;
    this.hoseGroup.visible = true;
    this.dosimeterGroup.visible = true;
    this.dosimeterGroup.position.set(0.35, -0.25, -0.6);
    this.dosimeterGroup.rotation.set(0.3, 0.4, 0);
    this.camera.add(this.dosimeterGroup);
    this.camera.add(this.hoseGroup);
    this.hoseGroup.position.set(0.2, -0.2, -0.5);
    this.renderer.domElement.style.cursor = "crosshair";
  }

  disableFirstPerson(): void {
    this.fpMode = false;
    this.hoseGroup.visible = false;
    this.dosimeterGroup.visible = false;
    if (this.dosimeterGroup.parent) this.dosimeterGroup.parent.remove(this.dosimeterGroup);
    if (this.hoseGroup.parent) this.hoseGroup.parent.remove(this.hoseGroup);
    this.scene.add(this.dosimeterGroup);
    this.scene.add(this.hoseGroup);
    this.renderer.domElement.style.cursor = "";
    document.exitPointerLock?.();
  }

  private onVRSessionStart = () => {
    this.isInVR = true;
    this.hoseGroup.visible = true;
    this.dosimeterGroup.visible = true;
    this.opts.onEnterVR?.();
    // Attach hose to right controller (index 1), dosimeter to left (index 0)
    if (this.controllers[1]) {
      this.controllers[1].grip.add(this.hoseGroup);
      this.hoseGroup.position.set(0, -0.05, -0.15);
    }
    if (this.controllers[0]) {
      this.controllers[0].grip.add(this.dosimeterGroup);
      this.dosimeterGroup.position.set(0, -0.08, 0.06);
      this.dosimeterGroup.rotation.set(-0.5, 0, 0.3);
    }
  };

  private onVRSessionEnd = () => {
    this.isInVR = false;
    this.hoseGroup.visible = this.fpMode;
    this.dosimeterGroup.visible = this.fpMode;
    if (this.hoseGroup.parent) this.hoseGroup.parent.remove(this.hoseGroup);
    if (this.dosimeterGroup.parent) this.dosimeterGroup.parent.remove(this.dosimeterGroup);
    this.scene.add(this.hoseGroup);
    this.scene.add(this.dosimeterGroup);
    this.opts.onExitVR?.();
  };

  private updateGamepads(): void {
    const session = this.renderer.xr.getSession();
    if (!session) return;
    for (let i = 0; i < this.controllers.length; i++) {
      const ctrl = this.controllers[i];
      const gp = session.inputSources[i]?.gamepad;
      if (!gp) continue;
      const axes = gp.axes;
      const buttons = gp.buttons;
      ctrl.thumbstick.x = axes[2] ?? 0;
      ctrl.thumbstick.y = axes[3] ?? 0;
      ctrl.triggerValue = buttons[0]?.value ?? 0;
      ctrl.gripValue = buttons[1]?.value ?? 0;
    }
  }

  private updateLocomotion(dt: number): void {
    if (this.isInVR) {
      // Left stick: move
      const left = this.controllers[0];
      const right = this.controllers[1];
      if (left && (Math.abs(left.thumbstick.x) > 0.15 || Math.abs(left.thumbstick.y) > 0.15)) {
        const moveX = left.thumbstick.x;
        const moveZ = left.thumbstick.y;
        // Direction relative to camera yaw
        const camDir = new THREE.Vector3();
        this.camera.getWorldDirection(camDir);
        camDir.y = 0;
        camDir.normalize();
        const camRight = new THREE.Vector3(camDir.z, 0, -camDir.x);
        this.playerRig.position.x += (camRight.x * moveX + camDir.x * (-moveZ)) * MOVE_SPEED * dt;
        this.playerRig.position.z += (camRight.z * moveX + camDir.z * (-moveZ)) * MOVE_SPEED * dt;
      }
      // Right stick: snap turn
      if (right && Math.abs(right.thumbstick.x) > 0.7) {
        if (!(right as VRController & { _turned?: boolean })._turned) {
          (right as VRController & { _turned?: boolean })._turned = true;
          this.playerRig.rotateY(
            THREE.MathUtils.degToRad(right.thumbstick.x > 0 ? -SNAP_TURN_DEG : SNAP_TURN_DEG),
          );
        }
      } else if (right) {
        (right as VRController & { _turned?: boolean })._turned = false;
      }
    } else if (this.fpMode) {
      // WASD
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3(forward.z, 0, -forward.x);
      let mx = 0;
      let mz = 0;
      if (this.keys["KeyW"]) mz += 1;
      if (this.keys["KeyS"]) mz -= 1;
      if (this.keys["KeyD"]) mx += 1;
      if (this.keys["KeyA"]) mx -= 1;
      this.playerRig.position.x += (right.x * mx + forward.x * mz) * MOVE_SPEED * dt;
      this.playerRig.position.z += (right.z * mx + forward.z * mz) * MOVE_SPEED * dt;

      // Apply yaw/pitch to camera
      this.playerRig.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
    }

    // Clamp to ground
    this.playerRig.position.y = 0;
  }

  private updateTeleport(): void {
    if (!this.isInVR || !this.isTeleporting) return;
    const left = this.controllers[0];
    if (!left) return;

    const origin = new THREE.Vector3();
    left.controller.getWorldPosition(origin);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(left.controller.quaternion).multiplyScalar(-1);
    // Arc teleport: sample parabolic path
    const positions = this.teleportRay.geometry.attributes.position as THREE.BufferAttribute;
    let hitPoint: THREE.Vector3 | null = null;
    const up = new THREE.Vector3(0, 1, 0);
    const vel = dir.clone().multiplyScalar(40);
    vel.y += 20;
    const gravity = -30;
    let pos = origin.clone();
    for (let i = 0; i < 20; i++) {
      positions.setXYZ(i, pos.x, pos.y, pos.z);
      pos.add(vel.clone().multiplyScalar(0.05));
      vel.y += gravity * 0.05;
      if (pos.y <= 0.1) {
        hitPoint = pos.clone();
        hitPoint.y = 0;
        for (let j = i + 1; j < 20; j++) {
          positions.setXYZ(j, pos.x, 0, pos.z);
        }
        break;
      }
    }
    positions.needsUpdate = true;
    this.teleportRay.visible = true;

    if (hitPoint) {
      const dist = hitPoint.distanceTo(origin);
      if (dist <= TELEPORT_MAX_DIST) {
        this.teleportIndicator.position.copy(hitPoint);
        this.teleportIndicator.position.y = 0.1;
        this.teleportIndicator.visible = true;
        this.teleportTarget = hitPoint;
      } else {
        this.teleportIndicator.visible = false;
        this.teleportTarget = null;
      }
    } else {
      this.teleportIndicator.visible = false;
      this.teleportTarget = null;
    }
  }

  private updateFireHose(dt: number): void {
    const right = this.controllers[1];
    const spraying = this.isInVR
      ? right && right.triggerValue > 0.5
      : this.fpMode && (this.keys["Space"] || this.keys["KeyF"]);

    this.hoseActive = spraying;

    // Find fire being aimed at
    let aimOrigin: THREE.Vector3 | null = null;
    let aimDir: THREE.Vector3 | null = null;

    if (this.isInVR && right) {
      aimOrigin = new THREE.Vector3();
      right.controller.getWorldPosition(aimOrigin);
      aimDir = new THREE.Vector3(0, 0, -1).applyQuaternion(right.controller.quaternion);
    } else if (this.fpMode) {
      aimOrigin = new THREE.Vector3();
      this.camera.getWorldPosition(aimOrigin);
      aimDir = new THREE.Vector3();
      this.camera.getWorldDirection(aimDir);
    }

    this.hoseHitFireId = null;
    if (aimOrigin && aimDir && spraying) {
      const fires = this.opts.getFires();
      let bestDist = FIRE_HOSE_RANGE;
      for (const fire of fires) {
        if (fire.extinguished) continue;
        this.tmpVec.copy(fire.position).sub(aimOrigin);
        const proj = this.tmpVec.dot(aimDir);
        if (proj < 0 || proj > bestDist) continue;
        this.tmpVec2.copy(aimDir).multiplyScalar(proj);
        const perpDist = this.tmpVec.sub(this.tmpVec2).length();
        if (perpDist < 15) {
          bestDist = proj;
          this.hoseHitFireId = fire.id;
        }
      }

      if (this.hoseHitFireId) {
        this.opts.onExtinguishProgress(this.hoseHitFireId, FIRE_EXTINGUISH_RATE * dt);
      }

      // Emit hose particles
      this.emitHoseParticles(aimOrigin, aimDir);
    }

    this.updateHoseParticles(dt);
  }

  private emitHoseParticles(origin: THREE.Vector3, dir: THREE.Vector3): void {
    let emitted = 0;
    for (let i = 0; i < this.hoseLife.length && emitted < 8; i++) {
      if (this.hoseLife[i] < 0) {
        this.hosePositions[i * 3] = origin.x + (Math.random() - 0.5) * 0.3;
        this.hosePositions[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.3;
        this.hosePositions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.3;
        this.hoseVelocities[i * 3] = dir.x * 25 + (Math.random() - 0.5) * 3;
        this.hoseVelocities[i * 3 + 1] = dir.y * 25 + (Math.random() - 0.5) * 2;
        this.hoseVelocities[i * 3 + 2] = dir.z * 25 + (Math.random() - 0.5) * 3;
        this.hoseLife[i] = 1.0;
        emitted++;
      }
    }
  }

  private updateHoseParticles(dt: number): void {
    const posAttr = this.hoseParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.hoseLife.length; i++) {
      if (this.hoseLife[i] > 0) {
        this.hoseLife[i] -= dt * 1.5;
        this.hoseVelocities[i * 3 + 1] -= 15 * dt; // gravity
        this.hosePositions[i * 3] += this.hoseVelocities[i * 3] * dt;
        this.hosePositions[i * 3 + 1] += this.hoseVelocities[i * 3 + 1] * dt;
        this.hosePositions[i * 3 + 2] += this.hoseVelocities[i * 3 + 2] * dt;
        if (this.hoseLife[i] <= 0) {
          this.hosePositions[i * 3] = 0;
          this.hosePositions[i * 3 + 1] = -1000;
          this.hosePositions[i * 3 + 2] = 0;
        }
      }
    }
    posAttr.needsUpdate = true;
  }

  private updateEvacInteraction(): void {
    const right = this.controllers[1];
    let triggerPressed = false;
    let gripPressed = false;

    if (this.isInVR && right) {
      triggerPressed = right.triggerValue > 0.5;
      gripPressed = right.gripValue > 0.5;
    } else if (this.fpMode) {
      triggerPressed = !!this.keys["KeyE"];
    }

    if (!triggerPressed && !gripPressed) return;

    const playerPos = new THREE.Vector3();
    this.playerRig.getWorldPosition(playerPos);

    const evacs = this.opts.getEvacs();
    for (const evac of evacs) {
      if (evac.status !== "waiting") continue;
      if (evac.position.distanceTo(playerPos) < EVAC_TRIGGER_RADIUS) {
        this.opts.onDispatchEvac(evac.id);
      }
    }
  }

  private computeDoseRate(): number {
    const ctx = this.opts.getDoseContext();
    const dosePos = new THREE.Vector3();
    this.dosimeterGroup.getWorldPosition(dosePos);

    const windRad = (ctx.windDirDeg * Math.PI) / 180;
    const wx = Math.sin(windRad);
    const wz = -Math.cos(windRad);
    const cx = -wz;
    const cz = wx;

    // Vector from stack to dosimeter
    const dx = dosePos.x - ctx.stackTipWorld.x;
    const dz = dosePos.z - ctx.stackTipWorld.z;
    const dy = dosePos.y - ctx.stackTipWorld.y;

    // Along-wind distance and crosswind offset
    const along = dx * wx + dz * wz;
    const cross = dx * cx + dz * cz;
    const dist = Math.sqrt(along * along + cross * cross);

    if (dist < 1) return 0;

    // Gaussian plume concentration at point (simplified Pasquill-Gifford)
    const stabilityFactor = ctx.scenario === "shortTerm" ? 1.8 : ctx.scenario === "longTerm" ? 0.6 : 1.0;
    const sigmaY = 18 + Math.pow(Math.max(1, along), 0.82) * 0.42;
    const sigmaZ = 10 + Math.pow(Math.max(1, along), 0.72) * 0.22;

    if (along < 0) {
      // Upwind — negligible
      return 0.05;
    }

    const expY = Math.exp(-(cross * cross) / (2 * sigmaY * sigmaY));
    const expZ = Math.exp(-(dy * dy) / (2 * sigmaZ * sigmaZ));
    const windFactor = Math.max(1, ctx.windSpeedMs);

    // Base dose rate in uSv/h — scaled to be meaningful
    let rate = (1e5 * stabilityFactor * expY * expZ) / (windFactor * sigmaZ * Math.sqrt(2 * Math.PI));

    // Puff scenario: pulsed dose
    if (ctx.scenario === "puff") {
      rate *= 1.5 * Math.exp(-dist / 800);
    } else if (ctx.scenario === "shortTerm") {
      rate *= 2.5 * Math.exp(-dist / 600);
    }

    // Surface contamination for chronic
    if (ctx.scenario === "longTerm") {
      rate += 5.0 * Math.exp(-dist / 500);
    }

    // Proximity to reactor building bonus
    const reactorDist = Math.sqrt(dosePos.x * dosePos.x + dosePos.z * dosePos.z);
    if (reactorDist < 200) {
      rate += (200 - reactorDist) * 0.5;
    }

    return Math.max(0.03, rate);
  }

  private updateDosimeterDisplay(): void {
    const ctx = this.dosimeterCtx;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 256, 128);

    ctx.font = "bold 14px monospace";
    ctx.textAlign = "left";

    ctx.fillStyle = "#94a3b8";
    ctx.fillText("ДКС-96  ДОЗИМЕТР", 8, 18);

    // Dose rate
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 22px monospace";
    const rateStr =
      this.currentDoseRate < 1000
        ? `${this.currentDoseRate.toFixed(1)} μЗв/ч`
        : `${(this.currentDoseRate / 1000).toFixed(2)} мЗв/ч`;
    ctx.fillText(rateStr, 8, 48);

    // Accumulated dose
    ctx.font = "12px monospace";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(`Накопл: ${this.accumulatedDose.toFixed(3)} мЗв`, 8, 68);

    // Hazard bar
    const barY = 82;
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(8, barY, 240, 16);
    const barColor =
      this.hazardLevel === "normal"
        ? "#10b981"
        : this.hazardLevel === "elevated"
          ? "#f59e0b"
          : "#ef4444";
    ctx.fillStyle = barColor;
    const barFrac = Math.min(1, this.currentDoseRate / 10000);
    ctx.fillRect(8, barY, 240 * barFrac, 16);

    ctx.fillStyle = "#e2e8f0";
    ctx.font = "10px monospace";
    const levelText =
      this.hazardLevel === "normal"
        ? "НОРМА"
        : this.hazardLevel === "elevated"
          ? "ПОВЫШЕННЫЙ"
          : "ОПАСНО!";
    ctx.fillText(levelText, 12, 93);

    // Geiger indicator dot
    const blink = Math.sin(performance.now() * 0.01) > 0;
    ctx.fillStyle = blink ? "#22d3ee" : "#1e293b";
    ctx.beginPath();
    ctx.arc(240, 14, 5, 0, Math.PI * 2);
    ctx.fill();

    this.dosimeterTexture.needsUpdate = true;
  }

  private updateGeigerAudio(): void {
    if (!this.geigerAudioCtx) {
      try {
        this.geigerAudioCtx = new AudioContext();
        this.geigerGain = this.geigerAudioCtx.createGain();
        this.geigerGain.gain.value = 0;
        this.geigerGain.connect(this.geigerAudioCtx.destination);
      } catch {
        return;
      }
    }

    if (!this.geigerAudioCtx) return;

    // Click frequency proportional to dose rate
    const clickInterval = Math.max(0.03, 2.0 / Math.max(0.1, this.currentDoseRate + 0.1));
    const now = this.geigerAudioCtx.currentTime;
    if (now - this.lastGeigerClick > clickInterval) {
      this.lastGeigerClick = now;
      this.playGeigerClick();
    }

    // Alarm tone if danger
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
    const osc = this.geigerAudioCtx.createOscillator();
    const gain = this.geigerAudioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = 2000 + Math.random() * 500;
    gain.gain.value = 0;
    gain.gain.setValueAtTime(0.08, this.geigerAudioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.geigerAudioCtx.currentTime + 0.008);
    osc.connect(gain);
    gain.connect(this.geigerAudioCtx.destination);
    osc.start();
    osc.stop(this.geigerAudioCtx.currentTime + 0.01);
  }

  private alarmOsc: OscillatorNode | null = null;
  private alarmGain: GainNode | null = null;

  private playAlarm(): void {
    if (!this.geigerAudioCtx) return;
    this.alarmOsc = this.geigerAudioCtx.createOscillator();
    this.alarmGain = this.geigerAudioCtx.createGain();
    this.alarmOsc.type = "sawtooth";
    this.alarmOsc.frequency.value = 880;
    this.alarmGain.gain.value = 0.04;
    this.alarmOsc.connect(this.alarmGain);
    this.alarmGain.connect(this.geigerAudioCtx.destination);
    this.alarmOsc.start();
    // Beep pattern
    setInterval(() => {
      if (this.alarmOsc && this.alarmGain && this.geigerAudioCtx) {
        this.alarmOsc.frequency.setValueAtTime(
          this.alarmOsc.frequency.value > 600 ? 440 : 880,
          this.geigerAudioCtx.currentTime,
        );
      }
    }, 500);
  }

  private stopAlarm(): void {
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
  }

  update(): void {
    const dt = Math.min(0.1, this.clock.getDelta());
    this.updateGamepads();
    this.updateLocomotion(dt);
    this.updateTeleport();
    this.updateFireHose(dt);
    this.updateEvacInteraction();

    // Dose calculation
    this.currentDoseRate = this.computeDoseRate();
    this.accumulatedDose += (this.currentDoseRate / 1e6) * dt; // uSv/h -> mSv per second
    this.hazardLevel =
      this.currentDoseRate > 1000
        ? "danger"
        : this.currentDoseRate > 10
          ? "elevated"
          : "normal";
    this.updateDosimeterDisplay();
    this.updateGeigerAudio();
  }

  isActive(): boolean {
    return this.isInVR || this.fpMode;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.renderer.domElement.removeEventListener("mousemove", this.onMouseMove);
    this.renderer.xr.removeEventListener("sessionstart", this.onVRSessionStart);
    this.renderer.xr.removeEventListener("sessionend", this.onVRSessionEnd);
    this.stopAlarm();
    if (this.geigerAudioCtx) {
      this.geigerAudioCtx.close();
    }
    this.vrButton?.remove();
    this.scene.remove(this.playerRig);
    this.scene.remove(this.teleportIndicator);
    this.scene.remove(this.teleportRay);
    this.scene.remove(this.hoseGroup);
    this.scene.remove(this.dosimeterGroup);
    this.dosimeterTexture.dispose();
    this.teleportIndicator.geometry.dispose();
    this.hoseParticles.geometry.dispose();
    (this.hoseParticles.material as THREE.Material).dispose();
  }
}
