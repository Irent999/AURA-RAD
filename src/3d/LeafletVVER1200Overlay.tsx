import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import * as THREE from "three";
import {
  DEFAULT_PLANT_BEARING_DEG,
  DEFAULT_PLANT_MODEL_SCALE,
  PLANT_FOOTPRINT_SPAN_METERS,
  generateVVER1200Plant,
  disposeVVER1200Plant,
  getVVER1200StackWorldPosition,
  type VVER1200PlantMetadata,
} from "./generateVVER1200Plant";
import { leafletMetersPerPixel } from "./geoPlantAdapter";

export interface LeafletVVER1200OverlayProps {
  lat: number;
  lon: number;
  stackHeight?: number;
  bearingDeg?: number;
  scaleMultiplier?: number;
  windDirectionDeg?: number;
  visible?: boolean;
  /** Optional minimum screen width in px before collapsing; 0 = always render at true meter scale */
  minScreenSizePx?: number;
  onDetailVisibilityChange?: (isDetailed3DVisible: boolean) => void;
  onPlantClick?: () => void;
  onPlantHoverChange?: (hovered: boolean) => void;
}

const _stackTipPx = new THREE.Vector3();
const _hitRaycaster = new THREE.Raycaster();
const _hitPointer = new THREE.Vector2();

/**
 * Synchronized WebGL Three.js overlay for React-Leaflet that anchors the L-shaped
 * 3D VVER-1200 NPP (~1920m) at [lat, lon] in real-world meters, scales strictly with
 * `1 / leafletMetersPerPixel(lat, zoom) * scaleMultiplier` on every zoom/move/rotate/pitch
 * event (zero fixed-pixel clamping), and avoids near/far clipping even under deep zoom.
 */
export function LeafletVVER1200Overlay({
  lat,
  lon,
  stackHeight = 185,
  bearingDeg = DEFAULT_PLANT_BEARING_DEG,
  scaleMultiplier = DEFAULT_PLANT_MODEL_SCALE,
  windDirectionDeg = 90,
  visible = true,
  minScreenSizePx = 0,
  onDetailVisibilityChange,
  onPlantClick,
  onPlantHoverChange,
}: LeafletVVER1200OverlayProps) {
  const map = useMap();

  const propsRef = useRef({
    lat,
    lon,
    stackHeight,
    bearingDeg,
    scaleMultiplier,
    windDirectionDeg,
    visible,
    minScreenSizePx,
    onDetailVisibilityChange,
    onPlantClick,
    onPlantHoverChange,
  });
  propsRef.current = {
    lat,
    lon,
    stackHeight,
    bearingDeg,
    scaleMultiplier,
    windDirectionDeg,
    visible,
    minScreenSizePx,
    onDetailVisibilityChange,
    onPlantClick,
    onPlantHoverChange,
  };

  const renderFnRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = map.getContainer();
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
      alpha: true,
      antialias: !isSoftwareGl,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const canvas = renderer.domElement;
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    // Place above tilePane (200) and strictly BELOW overlayPane (400) so smoke heatmap & contours draw over the 3D NPP
    canvas.style.zIndex = "350";
    container.appendChild(canvas);

    const scene = new THREE.Scene();

    // Perspective camera dynamically calibrated so 1 world unit = 1 CSS pixel on y = 0 ground plane
    const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 100000);
    camera.up.set(0, 0, -1);

    let plantGroup = generateVVER1200Plant({
      bearingDeg: propsRef.current.bearingDeg,
      scaleMultiplier: 1.0,
      stackHeight: propsRef.current.stackHeight,
      includeLighting: true,
      enableShadows: false,
    });
    scene.add(plantGroup);

    // Wind plume ray originating directly from the ventilation stack tip in true map meters
    const plumeRayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    const plumeRayMat = new THREE.LineBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.85,
    });
    const plumeRay = new THREE.Line(plumeRayGeo, plumeRayMat);
    scene.add(plumeRay);

    let currentBuiltStackHeight = propsRef.current.stackHeight;
    let lastSizeW = 0;
    let lastSizeH = 0;
    let lastReportedDetailed: boolean | null = null;

    let zoomAnimState: {
      startZoom: number;
      targetZoom: number;
      startPtX: number;
      startPtY: number;
      targetPtX: number;
      targetPtY: number;
      startTime: number;
      durationMs: number;
    } | null = null;
    let zoomAnimRaf = 0;

    const renderWithPose = (zoom: number, containerPtX: number, containerPtY: number) => {
      const {
        lat: curLat,
        stackHeight: curStackH,
        bearingDeg: curBearing,
        scaleMultiplier: curScale,
        windDirectionDeg: curWindDeg,
        visible: isVisible,
        minScreenSizePx: minPx,
        onDetailVisibilityChange: reportDetail,
      } = propsRef.current;

      const size = map.getSize();
      const width = Math.max(1, size.x);
      const height = Math.max(1, size.y);

      if (width !== lastSizeW || height !== lastSizeH) {
        lastSizeW = width;
        lastSizeH = height;
        renderer.setSize(width, height, false);
      }

      if (!isVisible) {
        canvas.style.display = "none";
        if (lastReportedDetailed !== false) {
          lastReportedDetailed = false;
          reportDetail?.(false);
        }
        return;
      }

      if (Math.abs(curStackH - currentBuiltStackHeight) > 0.5) {
        scene.remove(plantGroup);
        disposeVVER1200Plant(plantGroup);
        plantGroup = generateVVER1200Plant({
          bearingDeg: curBearing,
          scaleMultiplier: 1.0,
          stackHeight: curStackH,
          includeLighting: true,
          enableShadows: false,
        });
        scene.add(plantGroup);
        currentBuiltStackHeight = curStackH;
      }

      const metersPerPx = leafletMetersPerPixel(curLat, zoom);
      const pxPerMeter = 1 / Math.max(metersPerPx, 1e-6);
      const safeScale = Number.isFinite(curScale) && curScale > 0 ? curScale : 1.0;
      const worldScale = pxPerMeter * safeScale;

      const meta = plantGroup.userData?.vver1200 as VVER1200PlantMetadata | undefined;
      const spanMeters = meta?.footprintSpanMeters ?? PLANT_FOOTPRINT_SPAN_METERS;
      const screenSpanPx = spanMeters * worldScale;
      const showDetailed = minPx <= 0 || screenSpanPx >= minPx;

      if (lastReportedDetailed !== showDetailed) {
        lastReportedDetailed = showDetailed;
        reportDetail?.(showDetailed);
      }

      if (!showDetailed) {
        canvas.style.display = "none";
        return;
      }

      canvas.style.display = "block";
      plantGroup.visible = true;
      plumeRay.visible = true;

      // Anchor plant strictly to [curLat, curLon] in container CSS pixel space
      const worldX = containerPtX - width / 2;
      const worldZ = containerPtY - height / 2;

      plantGroup.position.set(worldX, 0, worldZ);
      plantGroup.rotation.y = -THREE.MathUtils.degToRad(curBearing);
      plantGroup.scale.setScalar(worldScale);

      // Update dynamic near/far & camera height so 185m towers/stack never clip at deep zoom
      const maxStructureHeightPx = Math.max(185, curStackH) * worldScale;
      const camHeight = Math.max(height * 1.4, maxStructureHeightPx * 5.0, 1200);
      const fovRad = 2 * Math.atan(height / 2 / camHeight);

      camera.fov = THREE.MathUtils.radToDeg(fovRad);
      camera.aspect = width / height;
      camera.near = 0.5;
      camera.far = camHeight * 8 + 10000;
      camera.position.set(0, camHeight, 0);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();

      // Anchor plume direction line to exact stack tip in scene pixel coordinates (scaled in real meters)
      getVVER1200StackWorldPosition(plantGroup, _stackTipPx);
      const windRad = (curWindDeg * Math.PI) / 180;
      const rayLengthPx = 1200 * worldScale;
      const dwX = Math.sin(windRad) * rayLengthPx;
      const dwZ = -Math.cos(windRad) * rayLengthPx;
      const posAttr = plumeRay.geometry.attributes.position as THREE.BufferAttribute;
      posAttr.setXYZ(0, _stackTipPx.x, _stackTipPx.y, _stackTipPx.z);
      posAttr.setXYZ(1, _stackTipPx.x + dwX, _stackTipPx.y, _stackTipPx.z + dwZ);
      posAttr.needsUpdate = true;

      if (meta?.beaconMeshes) {
        const blinkHex = performance.now() % 1000 < 500 ? 0xff2222 : 0x660000;
        meta.beaconMeshes.forEach((b) => {
          (b.material as THREE.MeshBasicMaterial).color.setHex(blinkHex);
        });
      }

      renderer.render(scene, camera);
    };

    const syncSceneAndRender = () => {
      zoomAnimState = null;
      if (zoomAnimRaf) {
        cancelAnimationFrame(zoomAnimRaf);
        zoomAnimRaf = 0;
      }
      const { lat: curLat, lon: curLon } = propsRef.current;
      const pt = map.latLngToContainerPoint([curLat, curLon]);
      renderWithPose(map.getZoom(), pt.x, pt.y);
    };

    const handleZoomAnim = (ev: { center: { lat: number; lng: number }; zoom: number }) => {
      const { lat: curLat, lon: curLon } = propsRef.current;
      const size = map.getSize();
      const startPt = map.latLngToContainerPoint([curLat, curLon]);
      const targetWorldPt = map.project([curLat, curLon], ev.zoom);
      const targetCenterWorldPt = map.project([ev.center.lat, ev.center.lng], ev.zoom);
      const targetPtX = size.x / 2 + (targetWorldPt.x - targetCenterWorldPt.x);
      const targetPtY = size.y / 2 + (targetWorldPt.y - targetCenterWorldPt.y);

      zoomAnimState = {
        startZoom: map.getZoom(),
        targetZoom: ev.zoom,
        startPtX: startPt.x,
        startPtY: startPt.y,
        targetPtX,
        targetPtY,
        startTime: performance.now(),
        durationMs: 250,
      };

      const stepAnim = () => {
        if (!zoomAnimState) return;
        const elapsed = performance.now() - zoomAnimState.startTime;
        const rawT = Math.min(1, elapsed / zoomAnimState.durationMs);
        const ease = 1 - Math.pow(1 - rawT, 3);
        const curZoom = THREE.MathUtils.lerp(
          zoomAnimState.startZoom,
          zoomAnimState.targetZoom,
          ease,
        );
        const curX = THREE.MathUtils.lerp(zoomAnimState.startPtX, zoomAnimState.targetPtX, ease);
        const curY = THREE.MathUtils.lerp(zoomAnimState.startPtY, zoomAnimState.targetPtY, ease);
        renderWithPose(curZoom, curX, curY);
        if (rawT < 1) {
          zoomAnimRaf = requestAnimationFrame(stepAnim);
        } else {
          zoomAnimState = null;
          zoomAnimRaf = 0;
        }
      };

      if (zoomAnimRaf) cancelAnimationFrame(zoomAnimRaf);
      zoomAnimRaf = requestAnimationFrame(stepAnim);
    };

    renderFnRef.current = syncSceneAndRender;

    let rafId = 0;
    const scheduleRender = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        syncSceneAndRender();
      });
    };

    const anyMap = map as unknown as {
      on(ev: string, fn: () => void): void;
      off(ev: string, fn: () => void): void;
    };

    let lastHoverCheck = 0;
    let isHovered = false;

    const hitTestPlantAtContainerPt = (ptX: number, ptY: number): boolean => {
      if (!propsRef.current.visible || canvas.style.display === "none") return false;
      const size = map.getSize();
      if (size.x <= 0 || size.y <= 0) return false;
      _hitPointer.x = (ptX / size.x) * 2 - 1;
      _hitPointer.y = -(ptY / size.y) * 2 + 1;
      plantGroup.updateMatrixWorld(true);
      _hitRaycaster.setFromCamera(_hitPointer, camera);
      const hits = _hitRaycaster.intersectObject(plantGroup, true);
      return hits.length > 0;
    };

    const handlePointerMove = (ev: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverCheck < 60) return;
      lastHoverCheck = now;
      const rect = container.getBoundingClientRect();
      const hit = hitTestPlantAtContainerPt(ev.clientX - rect.left, ev.clientY - rect.top);
      if (hit !== isHovered) {
        isHovered = hit;
        container.style.cursor = hit ? "pointer" : "";
        propsRef.current.onPlantHoverChange?.(hit);
      }
    };

    const handlePointerLeave = () => {
      if (isHovered) {
        isHovered = false;
        container.style.cursor = "";
        propsRef.current.onPlantHoverChange?.(false);
      }
    };

    const handleMapClick = (ev: { containerPoint?: { x: number; y: number } }) => {
      if (!ev.containerPoint) return;
      if (hitTestPlantAtContainerPt(ev.containerPoint.x, ev.containerPoint.y)) {
        propsRef.current.onPlantClick?.();
      }
    };

    map.on("move", syncSceneAndRender);
    map.on("moveend", syncSceneAndRender);
    map.on("zoom", syncSceneAndRender);
    map.on("zoomend", scheduleRender);
    map.on("zoomanim", handleZoomAnim as unknown as () => void);
    map.on("viewreset", syncSceneAndRender);
    map.on("resize", syncSceneAndRender);
    map.on("click", handleMapClick as unknown as () => void);
    anyMap.on("rotate", syncSceneAndRender);
    anyMap.on("pitch", syncSceneAndRender);
    container.addEventListener("pointermove", handlePointerMove, { passive: true });
    container.addEventListener("pointerleave", handlePointerLeave);

    const resizeObserver = new ResizeObserver(scheduleRender);
    resizeObserver.observe(container);

    syncSceneAndRender();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (zoomAnimRaf) cancelAnimationFrame(zoomAnimRaf);
      resizeObserver.disconnect();
      container.style.cursor = "";
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerleave", handlePointerLeave);
      map.off("move", syncSceneAndRender);
      map.off("moveend", syncSceneAndRender);
      map.off("zoom", syncSceneAndRender);
      map.off("zoomend", scheduleRender);
      map.off("zoomanim", handleZoomAnim as unknown as () => void);
      map.off("viewreset", syncSceneAndRender);
      map.off("resize", syncSceneAndRender);
      map.off("click", handleMapClick as unknown as () => void);
      anyMap.off("rotate", syncSceneAndRender);
      anyMap.off("pitch", syncSceneAndRender);
      renderFnRef.current = null;
      plumeRayGeo.dispose();
      plumeRayMat.dispose();
      disposeVVER1200Plant(plantGroup);
      renderer.dispose();
      if (container.contains(canvas)) {
        container.removeChild(canvas);
      }
    };
  }, [map]);

  useEffect(() => {
    renderFnRef.current?.();
  }, [lat, lon, stackHeight, bearingDeg, scaleMultiplier, windDirectionDeg, visible]);

  return null;
}
