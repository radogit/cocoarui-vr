import * as THREE from "three";
import { DeviceOrientationControls } from "./controls/DeviceOrientationControls.js";
import { iconByKey, loadIconTexture } from "./icons.js";
import { StereoEffect } from "three/examples/jsm/effects/StereoEffect.js";
import jsQR from "jsqr";
import { BG_PRESET_VIDEOS, defaultVideoUrl, useCrossOrigin } from "./videoConfig.js";

const ui = document.getElementById("ui");
const uiButtons = document.getElementById("ui-buttons");
const vrLandscapeOverlay = document.getElementById("vr-landscape-overlay");
const enterBtn = document.getElementById("enter");
const hud = document.getElementById("hud");
const recenterBtn = document.getElementById("recenter");
const fullscreenBtn = document.getElementById("fullscreen");
const playPauseBtn = document.getElementById("playpause");
const addToHomescreenTip = document.getElementById("add-to-homescreen-tip");
const addToHomescreenTipClose = document.getElementById("add-to-homescreen-tip-close");
const scanQrBtn = document.getElementById("scan-qr");
const qrScanner = document.getElementById("qr-scanner");
const qrScannerClose = document.getElementById("qr-scanner-close");
const qrVideo = document.getElementById("qr-video");
const qrCanvas = document.getElementById("qr-canvas");
const qrClearStored = document.getElementById("qr-clear-stored");
const clearQrBtn = document.getElementById("clear-qr");
const toggleAxisBtn = document.getElementById("toggle-axis");
const toggleGridVBtn = document.getElementById("toggle-grid-v");
const toggleGridHBtn = document.getElementById("toggle-grid-h");
const toggleNodeCirclesBtn = document.getElementById("toggle-node-circles");
const toggleNodeLabelsBtn = document.getElementById("toggle-node-labels");
const toggleNodeIconsBtn = document.getElementById("toggle-node-icons");
const hudDrawer = document.getElementById("hud-drawer");
const hudDrawerHandle = document.getElementById("hud-drawer-handle");
const bgOpacitySlider = document.getElementById("bg-opacity-slider");

const appRoot = document.getElementById('app-root');

const STORAGE_KEY_QR_MARKERS = "qr_scanned_markers";

function isLandscape() {
  return typeof window !== "undefined" && window.innerWidth > window.innerHeight;
}

function updateOrientationUI() {
  const landscape = isLandscape();
  if (!inVRMode) {
    // Initial screen: always show buttons, hide HUD until user enters VR
    if (uiButtons) uiButtons.hidden = false;
    if (hud) hud.classList.add("hidden");
  } else {
    // VR mode: landscape = show VR, portrait = show landscape-required overlay
    if (vrLandscapeOverlay) vrLandscapeOverlay.hidden = landscape;
    if (appRoot) appRoot.style.visibility = landscape ? "" : "hidden";
    if (hud) (landscape ? hud.classList.remove("hidden") : hud.classList.add("hidden"));
    if (addToHomescreenTip && !landscape) addToHomescreenTip.classList.remove("visible");
  }
}

let scene, camera, renderer, effect, controls;
let inVRMode = false; // true after user has entered VR
let axisGroup = null;
let gridVGroup = null;
let gridHGroup = null;
/** Marker groups (each has children with userData.type: 'sphere'|'label'|'icon'). */
const markerGroups = [];
/** Current node visibility settings, updated by HUD toggles. */
let nodeSettings = { nodeCircles: 1, nodeLabel: 1, nodeIcon: 1 };
let wakeLockSentinel = null;
let video, visibleCanvas, visibleCtx, panoTex, sphere;
let insideView = true; // 🔹 start inside
let stopUpdates = false;

/** Arrow-key camera control for desktop troubleshooting. Radians per frame. Read from URL params at init. */
let arrowYawSpeed = THREE.MathUtils.degToRad(90);
let arrowPitchSpeed = THREE.MathUtils.degToRad(90);
const arrowKeys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
/** Accumulated arrow-key rotation (quaternion). Persists so controls.update() doesn't overwrite. */
const arrowKeyQuat = new THREE.Quaternion();
let lastArrowUrlUpdate = 0;
let lastVideoTime = -1; // for detecting loop restart (ended doesn't fire when loop=true)
const labelPlanes = []; // billboard labels, updated each frame to face camera

/** Parse arrow-key params from URL: arrowYaw, arrowPitch (deg), arrowYawSpeed, arrowPitchSpeed (deg/frame). */
function parseArrowParamsFromURL() {
  const p = new URLSearchParams(window.location.search);
  const yaw = parseFloat(p.get("arrowYaw"));
  const pitch = parseFloat(p.get("arrowPitch"));
  const yawSpeed = parseFloat(p.get("arrowYawSpeed"));
  const pitchSpeed = parseFloat(p.get("arrowPitchSpeed"));
  return {
    yaw: Number.isFinite(yaw) ? yaw : 0,
    pitch: Number.isFinite(pitch) ? pitch : 0,
    yawSpeed: Number.isFinite(yawSpeed) ? THREE.MathUtils.degToRad(yawSpeed) : THREE.MathUtils.degToRad(-90),
    pitchSpeed: Number.isFinite(pitchSpeed) ? THREE.MathUtils.degToRad(pitchSpeed) : THREE.MathUtils.degToRad(-90),
  };
}

/** Update URL with current arrow correction (throttled). */
function updateArrowParamsInURL() {
  const now = performance.now();
  if (now - lastArrowUrlUpdate < 300) return;
  lastArrowUrlUpdate = now;
  const e = new THREE.Euler().setFromQuaternion(arrowKeyQuat, "XYZ");
  const yawDeg = Math.round(THREE.MathUtils.radToDeg(e.y) * 10) / 10;
  const pitchDeg = Math.round(THREE.MathUtils.radToDeg(e.x) * 10) / 10;
  const yawSpeedDeg = Math.round(THREE.MathUtils.radToDeg(arrowYawSpeed) * 100) / 100;
  const pitchSpeedDeg = Math.round(THREE.MathUtils.radToDeg(arrowPitchSpeed) * 100) / 100;
  const url = new URL(window.location.href);
  url.searchParams.set("arrowYaw", String(yawDeg));
  url.searchParams.set("arrowPitch", String(pitchDeg));
  url.searchParams.set("arrowYawSpeed", String(yawSpeedDeg));
  url.searchParams.set("arrowPitchSpeed", String(pitchSpeedDeg));
  window.history.replaceState({}, "", url);
}

/** Whether to flip the video texture left-to-right on each loop. Controlled by #flip-on-loop checkbox. */
function getFlipOnLoop() {
  const el = document.getElementById("flip-on-loop");
  return el ? el.checked : true;
}
const VIDEO_SPHERE_RADIUS = 500;

/**
 * Parse markers from URL param. Format: markers=yaw,pitch,size|yaw,pitch,size|...
 * Optional: yaw,pitch,size,color,distance — color and distance are last, both optional.
 * Or JSON: markers=[{"yaw":-30,"pitch":10,"size":2}]
 *
 * D3 simulation mapping (scaleUnit = minDim/180, 1 data unit = 1 degree):
 *   - yaw = node.x (degrees, longitude)
 *   - pitch = node.y (degrees, latitude; D3 y-down, VR y-up — layout export flips)
 *   - size = angular diameter in degrees = 2 * node.radius
 *   - exportMetricsCSV outputs: x, y, diameter (use diameter as size)
 *   - exportLayoutJSON hotspots: width/height = side = r*sqrt(π); angular diameter = 2*side/sqrt(π)
 *
 * Distance: optional, last. Controls depth when spheres overlap at same yaw/pitch (closer = foreground).
 *
 * Color: hex RRGGBB or RRGGBBAA (8 hex with alpha). Alpha 00=transparent, ff=opaque.
 */
function parseHexColor(hex) {
  const s = String(hex || "").replace(/^#/, "");
  if (s.length === 8) {
    const color = parseInt(s.slice(0, 6), 16);
    const a = parseInt(s.slice(6, 8), 16);
    return { color: isNaN(color) ? 0xff0000 : color, opacity: isNaN(a) ? 1 : a / 255 };
  }
  if (s.length === 6) {
    const color = parseInt(s, 16);
    return { color: isNaN(color) ? 0xff0000 : color, opacity: 1 };
  }
  if (s.length === 4) {
    const r = parseInt(s[0] + s[0], 16), g = parseInt(s[1] + s[1], 16), b = parseInt(s[2] + s[2], 16), a = parseInt(s[3] + s[3], 16);
    return { color: (r << 16) | (g << 8) | b, opacity: isNaN(a) ? 1 : a / 255 };
  }
  return { color: 0xff0000, opacity: 1 };
}

const DEFAULT_SETTINGS = {
  bg: 1,
  bgPreset: "vr-downhill", // TODO: revert to "base-downhill" after troubleshooting
  bgOpacity: 100,
  axis: 0,
  gridV: 0,
  gridH: 0,
  nodeCircles: 1,
  nodeIcon: 1,
  nodeLabel: 1,
};

/** Bridge format versions supported by VRPreview. Bump when adding new parsers. */
const SUPPORTED_BRIDGE_VERSIONS = [1, 2];

/**
 * Parse bridge format v1: { v: 1, nodes: [...], settings: {...} }
 * Node: { yaw, pitch, size, color, name }
 */
function parseBridgeV1(obj) {
  const arr = obj.nodes ?? [];
  const settings = { ...DEFAULT_SETTINGS, ...(obj.settings ?? {}) };
  const markers = arr.map((m) => {
    const colorStr = m.color ?? m[3] ?? "ff0000";
    const { color, opacity } = typeof colorStr === "number" ? { color: colorStr, opacity: 1 } : parseHexColor(colorStr);
    return {
      yaw: Number(m.yaw ?? m[0] ?? 0),
      pitch: Number(m.pitch ?? m[1] ?? 0),
      size: Number(m.size ?? m[2] ?? 2),
      color,
      opacity: m.opacity != null ? Number(m.opacity) : opacity,
      distance: Number(m.distance ?? m[4] ?? 400),
      name: m.name ?? m[5] ?? "",
      representation: m.representation ?? "number",
    };
  });
  return { markers, settings };
}

/**
 * Parse bridge format v2: { v: 2, nodes: [...], settings: {...} }
 * Node: { yaw, pitch, size, color, name, representation, opacity }
 */
function parseBridgeV2(obj) {
  const arr = obj.nodes ?? [];
  const settings = { ...DEFAULT_SETTINGS, ...(obj.settings ?? {}) };
  const markers = arr.map((m) => {
    const colorStr = m.color ?? m[3] ?? "ff0000";
    const { color, opacity: colorOpacity } = typeof colorStr === "number" ? { color: colorStr, opacity: 1 } : parseHexColor(colorStr);
    const opacity = m.opacity != null ? Math.max(0, Math.min(1, Number(m.opacity))) : colorOpacity;
    return {
      yaw: Number(m.yaw ?? m[0] ?? 0),
      pitch: Number(m.pitch ?? m[1] ?? 0),
      size: Number(m.size ?? m[2] ?? 2),
      color,
      opacity,
      distance: Number(m.distance ?? m[4] ?? 400),
      name: m.name ?? m[5] ?? "",
      representation: m.representation ?? "number",
    };
  });
  return { markers, settings };
}

/**
 * Dispatch to version-specific parser for bridge format { v, nodes, settings }.
 * Legacy (no v) is treated as v1.
 */
function parseBridgeByVersion(obj) {
  const v = obj.v;
  const version = v != null ? Number(v) : 1; // legacy = v1
  if (!SUPPORTED_BRIDGE_VERSIONS.includes(version)) {
    console.warn(`VRPreview: QR bridge format v${version} not supported. Supported: ${SUPPORTED_BRIDGE_VERSIONS.join(", ")}. Update VRPreview or re-scan a newer QR.`);
    return { markers: [], settings: { ...DEFAULT_SETTINGS } };
  }
  if (version === 1) return parseBridgeV1(obj);
  if (version === 2) return parseBridgeV2(obj);
  return { markers: [], settings: { ...DEFAULT_SETTINGS } };
}

/**
 * Parse markers from a raw string (value of markers param).
 * Supports: bridge JSON { v, nodes, settings }, JSON array [{}], or pipe-separated yaw,pitch,size|...
 * Returns { markers: [], settings: {} }
 */
function parseMarkersFromRawString(raw) {
  const empty = { markers: [], settings: { ...DEFAULT_SETTINGS } };
  if (!raw || typeof raw !== "string") return empty;
  const trimmed = raw.trim();
  if (!trimmed) return empty;
  try {
    if (trimmed.startsWith("{")) {
      const obj = JSON.parse(trimmed);
      if (obj.nodes != null || obj.settings != null) {
        return parseBridgeByVersion(obj);
      }
      return empty;
    }
    if (trimmed.startsWith("[")) {
      const arr = JSON.parse(trimmed);
      const markers = arr.map((m) => {
        const colorStr = m.color ?? m[3] ?? "ff0000";
        const { color, opacity } = typeof colorStr === "number" ? { color: colorStr, opacity: 1 } : parseHexColor(colorStr);
        return {
          yaw: Number(m.yaw ?? m[0] ?? 0),
          pitch: Number(m.pitch ?? m[1] ?? 0),
          size: Number(m.size ?? m[2] ?? 2),
          color,
          opacity: m.opacity != null ? Number(m.opacity) : opacity,
          distance: Number(m.distance ?? m[4] ?? 400),
          name: m.name ?? m[5] ?? "",
        };
      });
      return { markers, settings: { ...DEFAULT_SETTINGS } };
    }
    const markers = trimmed.split("|").map((part) => {
      const v = part.split(",").map((s) => s.trim());
      const { color, opacity } = parseHexColor(v[3]);
      const distanceRaw = v[4];
      const distance = distanceRaw ? parseFloat(distanceRaw) || 400 : 400;
      const name = v.length > 5 ? v.slice(5).join(",").trim() : "";
      return {
        yaw: parseFloat(v[0]) || 0,
        pitch: parseFloat(v[1]) || 0,
        size: parseFloat(v[2]) || 2,
        color,
        opacity,
        distance,
        name,
      };
    });
    return { markers, settings: { ...DEFAULT_SETTINGS } };
  } catch {
    return empty;
  }
}

/**
 * Extract markers from URL, QR-scanned string, or localStorage.
 * Scanned string can be: full URL, query string, or raw markers value.
 */
function parseMarkersFromURL() {
  // 1. URL params
  const params = new URLSearchParams(window.location.search);
  let raw = params.get("markers");
  if (raw) return parseMarkersFromRawString(raw);

  // 2. localStorage (from QR scan)
  try {
    raw = localStorage.getItem(STORAGE_KEY_QR_MARKERS);
    if (raw) {
      if (raw.includes("?") || raw.includes("markers=")) {
        const url = raw.startsWith("http") ? raw : "https://x?" + (raw.startsWith("?") ? raw.slice(1) : raw);
        const u = new URL(url);
        raw = u.searchParams.get("markers") || raw;
      }
      return parseMarkersFromRawString(raw);
    }
  } catch {}
  return { markers: [], settings: { ...DEFAULT_SETTINGS } };
}

/**
 * Create a text label as a billboard plane, scaled to fit within a circle of given radius.
 * Positioned in front of the icon (between camera and icon) so it sits proud of the node.
 */
function createLabelMesh(text, radius, position, distance) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, size, size);
  ctx.font = "bold 48px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "white";
  ctx.strokeStyle = "black";
  ctx.lineWidth = 6;
  const lines = text.split("\n");
  const lineHeight = 56;
  const startY = size / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    ctx.strokeText(line, size / 2, y);
    ctx.fillText(line, size / 2, y);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
  });
  const side = radius * 1.2;
  const geom = new THREE.PlaneGeometry(side, side);
  const plane = new THREE.Mesh(geom, mat);
  const iconOffset = Math.max(2, radius * 0.15);
  const labelProudOfIcon = 2;
  const frontDist = Math.max(0.1, distance - radius - iconOffset - labelProudOfIcon);
  plane.position.copy(position).multiplyScalar(frontDist / distance);
  labelPlanes.push(plane);
  return plane;
}

/**
 * Create an icon plane (billboard) in front of the sphere. Uses loaded texture.
 * Offset from sphere surface to avoid z-fighting (representations sit proud of the sphere).
 */
function createIconPlane(texture, radius, position, distance) {
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
  });
  const iconSize = radius * 1.4;
  const geom = new THREE.PlaneGeometry(iconSize, iconSize);
  const plane = new THREE.Mesh(geom, mat);
  const offset = Math.max(2, radius * 0.15);
  const frontDist = Math.max(0.1, distance - radius - offset);
  plane.position.copy(position).multiplyScalar(frontDist / distance);
  labelPlanes.push(plane);
  return plane;
}

/**
 * Apply node visibility settings to all marker groups.
 */
function applyNodeVisibility() {
  const showCircle = (nodeSettings.nodeCircles ?? 1) === 1;
  const showLabel = (nodeSettings.nodeLabel ?? 1) === 1;
  const showIcon = (nodeSettings.nodeIcon ?? 1) === 1;
  for (const group of markerGroups) {
    for (const child of group.children) {
      const t = child.userData?.type;
      if (t === "sphere") child.visible = showCircle;
      else if (t === "label") child.visible = showLabel;
      else if (t === "icon") child.visible = showIcon;
    }
  }
}

/**
 * Create a sphere marker at polar coords (yaw, pitch) with angular size.
 * Always creates sphere; label and icon when data exists. Visibility controlled by settings (toggleable via HUD).
 * @param {Object} settings - { nodeCircles, nodeLabel, nodeIcon } from QR payload
 */
async function createMarkerSphere({ yaw, pitch, size, distance = 400, color = 0xff0000, opacity = 1, name, representation }, settings = {}) {
  const showCircle = (settings.nodeCircles ?? 1) === 1;
  const showLabel = (settings.nodeLabel ?? 1) === 1;
  const showIcon = (settings.nodeIcon ?? 1) === 1;
  const cappedDist = Math.min(distance, VIDEO_SPHERE_RADIUS - 1);
  const azimuth = THREE.MathUtils.degToRad(yaw);
  const elevation = THREE.MathUtils.degToRad(pitch);
  const angularRadiusRad = THREE.MathUtils.degToRad(size) / 2;
  const radius = cappedDist * Math.tan(angularRadiusRad);
  const pos = new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation) * cappedDist,
    Math.sin(elevation) * cappedDist,
    -Math.cos(azimuth) * Math.cos(elevation) * cappedDist
  );
  const group = new THREE.Group();
  // Sphere (always)
  const geom = new THREE.SphereGeometry(radius, 32, 32);
  const clampedOpacity = Math.max(0, Math.min(1, opacity));
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: clampedOpacity,
    depthWrite: clampedOpacity >= 1,
    depthTest: true,
  });
  const sphereMesh = new THREE.Mesh(geom, mat);
  sphereMesh.position.copy(pos);
  sphereMesh.userData = { type: "sphere" };
  sphereMesh.visible = showCircle;
  group.add(sphereMesh);
  group.renderOrder = 1;
  // Label (if name)
  if (name && name.trim()) {
    const label = createLabelMesh(name.trim(), radius, pos, cappedDist);
    label.userData = { type: "label" };
    label.visible = showLabel;
    group.add(label);
  }
  // Icon (if representation)
  if (representation && representation !== "none") {
    const url = iconByKey[representation];
    if (url) {
      try {
        const tex = await loadIconTexture(url);
        const iconPlane = createIconPlane(tex, radius, pos, cappedDist);
        iconPlane.userData = { type: "icon" };
        iconPlane.visible = showIcon;
        group.add(iconPlane);
      } catch (_) {
        // ignore load errors
      }
    }
  }
  return group;
}

/** Convert (yaw, pitch) in degrees to Vector3 at given distance. Same convention as createMarkerSphere. */
function yawPitchToPosition(yawDeg, pitchDeg, distance) {
  const azimuth = THREE.MathUtils.degToRad(yawDeg);
  const elevation = THREE.MathUtils.degToRad(pitchDeg);
  return new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation) * distance,
    Math.sin(elevation) * distance,
    -Math.cos(azimuth) * Math.cos(elevation) * distance
  );
}

/** Create axis tick label. offsetYaw, offsetPitch: degrees to shift label from tick (e.g. -12 for below/left). */
function createAxisTickLabel(text, yaw, pitch, distance, offsetYaw = 0, offsetPitch = 0) {
  const pos = yawPitchToPosition(yaw + offsetYaw, pitch + offsetPitch, distance);
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, size, size);
  ctx.font = "normal 180px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "black";
  ctx.strokeStyle = "white";
  ctx.lineWidth = 3;
  ctx.strokeText(text, size / 2, size / 2);
  ctx.fillText(text, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.98,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
  });
  const labelSize = 40;
  const geom = new THREE.PlaneGeometry(labelSize, labelSize);
  const plane = new THREE.Mesh(geom, mat);
  plane.position.copy(pos).multiplyScalar((distance + 15) / distance);
  labelPlanes.push(plane);
  return plane;
}

/** X-axis tick: stripe below axis (pitch -1.5 to 0). Y-axis tick: stripe left of axis (yaw -1.5 to 0). */
function createTickStripe(yaw, pitch, dist, axisType, stripeLength = 1.5) {
  const p1 = axisType === "x"
    ? yawPitchToPosition(yaw, pitch - stripeLength, dist)
    : yawPitchToPosition(yaw - stripeLength, pitch, dist);
  const p2 = axisType === "x"
    ? yawPitchToPosition(yaw, pitch, dist)
    : yawPitchToPosition(yaw, pitch, dist);
  const geom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
  return new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0x000000 }));
}

/** Create grid lines every 10° from -90 to +90. Returns { group, gridVGroup, gridHGroup } for independent visibility toggling. */
function createGridLines() {
  const dist = 450;
  const steps = 36;
  const lineMat = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.7 });
  const group = new THREE.Group();
  const gridVGroup = new THREE.Group();
  const gridHGroup = new THREE.Group();
  for (let yaw = -90; yaw <= 90; yaw += 10) {
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const pitch = -90 + (180 * i) / steps;
      points.push(yawPitchToPosition(yaw, pitch, dist));
    }
    gridVGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMat));
  }
  for (let pitch = -90; pitch <= 90; pitch += 10) {
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const yaw = -90 + (180 * i) / steps;
      points.push(yawPitchToPosition(yaw, pitch, dist));
    }
    gridHGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMat));
  }
  group.add(gridVGroup);
  group.add(gridHGroup);
  return { group, gridVGroup, gridHGroup };
}

/** Create axis lines (-90 to 90 yaw and pitch) with tick stripes every 20°. Always returns a group; visibility set by caller. */
function createAxisLines() {
  const dist = 600; // inside video sphere (radius 500)
  const steps = 36; // points per line
  const tickValues = [-80, -60, -40, -20, 20, 40, 60, 80];
  const labelOffset = 3; // degrees to place label below/left of tick
  const horizPoints = [];
  const vertPoints = [];
  for (let i = 0; i <= steps; i++) {
    const yaw = -90 + (180 * i) / steps;
    horizPoints.push(yawPitchToPosition(yaw, 0, dist));
  }
  for (let i = 0; i <= steps; i++) {
    const pitch = -90 + (180 * i) / steps;
    vertPoints.push(yawPitchToPosition(0, pitch, dist));
  }
  const horizGeom = new THREE.BufferGeometry().setFromPoints(horizPoints);
  const vertGeom = new THREE.BufferGeometry().setFromPoints(vertPoints);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.9 });
  const group = new THREE.Group();
  const horizLine = new THREE.Line(horizGeom, lineMat);
  const vertLine = new THREE.Line(vertGeom, lineMat);
  horizLine.renderOrder = 1;
  vertLine.renderOrder = 1;
  group.add(horizLine);
  group.add(vertLine);
  for (const v of tickValues) {
    group.add(createTickStripe(v, 0, dist, "x")); // x-axis: tick below
    group.add(createAxisTickLabel(String(v), v, 0, dist, 0, -labelOffset)); // label below tick
  }
  for (const v of tickValues) {
    if (v === 0) continue; // center already labeled by horizontal axis
    group.add(createTickStripe(0, v, dist, "y")); // y-axis: tick to the left
    group.add(createAxisTickLabel(String(v), 0, v, dist, -labelOffset, 0)); // label left of tick
  }
  return group;
}

let qrStream = null;
let qrAnimationId = null;

async function startQrScan() {
  if (!qrScanner || !qrVideo || !qrCanvas) return;
  try {
    qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    qrVideo.srcObject = qrStream;
    await qrVideo.play();
    qrScanner.hidden = false;
    qrAnimationId = requestAnimationFrame(tickQrScan);
  } catch (err) {
    console.error("QR scan camera error:", err);
    alert("Could not access camera. Grant permission and try again.");
  }
}

function stopQrScan() {
  if (qrAnimationId) {
    cancelAnimationFrame(qrAnimationId);
    qrAnimationId = null;
  }
  if (qrStream) {
    qrStream.getTracks().forEach((t) => t.stop());
    qrStream = null;
  }
  if (qrVideo) qrVideo.srcObject = null;
  if (qrScanner) qrScanner.hidden = true;
}

function showQrScanSuccess(nodeCount) {
  const overlay = document.createElement("div");
  overlay.className = "qr-overlay qr-scan-success";
  overlay.style.cssText = "display:flex; flex-direction:column; justify-content:center; align-items:center; gap:16px; background:rgba(0,0,0,.9); color:#fff; font-family:ui-sans-serif,system-ui,-apple-system,Arial; text-align:center; padding:24px;";
  const msg = document.createElement("div");
  msg.style.fontSize = "20px";
  msg.style.fontWeight = "600";
  msg.textContent = "Scan successful!";
  const count = document.createElement("div");
  count.style.fontSize = "16px";
  count.style.opacity = "0.9";
  count.textContent = `${nodeCount} node${nodeCount === 1 ? "" : "s"} loaded.`;
  overlay.appendChild(msg);
  overlay.appendChild(count);
  document.body.appendChild(overlay);
  setTimeout(() => {
    overlay.remove();
    window.location.reload();
  }, 2000);
}

function tickQrScan() {
  if (!qrVideo || !qrCanvas || qrVideo.readyState !== qrVideo.HAVE_ENOUGH_DATA) {
    qrAnimationId = requestAnimationFrame(tickQrScan);
    return;
  }
  const ctx = qrCanvas.getContext("2d");
  qrCanvas.width = qrVideo.videoWidth;
  qrCanvas.height = qrVideo.videoHeight;
  ctx.drawImage(qrVideo, 0, 0);
  const imageData = ctx.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
  const code = jsQR(imageData.data, imageData.width, imageData.height);
  if (code && code.data) {
    const data = code.data.trim();
    let rawMarkers = data;
    if (data.includes("?") || data.includes("markers=")) {
      try {
        const url = data.startsWith("http") ? data : "https://x?" + data.replace(/^\?/, "");
        const u = new URL(url);
        rawMarkers = u.searchParams.get("markers") || data;
      } catch {}
    }
    const { markers } = parseMarkersFromRawString(rawMarkers);
    if (markers.length > 0 || data.startsWith("[") || data.startsWith("{") || data.includes("|") || data.includes("markers=")) {
      localStorage.setItem(STORAGE_KEY_QR_MARKERS, data);
      stopQrScan();
      showQrScanSuccess(markers.length);
      return;
    }
  }
  qrAnimationId = requestAnimationFrame(tickQrScan);
}

init().catch((e) => console.error("Init error:", e));

async function init() {
  // --- keep video alive on PWA focus / rotation ---
    document.addEventListener("visibilitychange", () => {
    if (!document.hidden) safePlay();
    });
    window.addEventListener("focus", safePlay);
    window.addEventListener("orientationchange", () => {
    setTimeout(safePlay, 500);
    });


  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff); // white behind video when opacity < 1

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.01,
    2000
  );

  controls = new DeviceOrientationControls(camera, true);
  

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.max(1, window.devicePixelRatio / 1.25));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.className = "webgl";
  appRoot.appendChild(renderer.domElement);
//   renderer.domElement.style.position = "fixed";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none"; // prevent pull-to-refresh


  effect = new StereoEffect(renderer);
  effect.setSize(window.innerWidth, window.innerHeight);

  // --- Parse markers/settings early (needed for video selection) ---
  const { markers, settings } = parseMarkersFromURL();
  const videoSrc = BG_PRESET_VIDEOS[settings.bgPreset] ?? defaultVideoUrl;

  // --- Arrow-key params from URL ---
  const arrowParams = parseArrowParamsFromURL();
  arrowYawSpeed = arrowParams.yawSpeed;
  arrowPitchSpeed = arrowParams.pitchSpeed;
  arrowKeyQuat.setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(arrowParams.pitch),
    THREE.MathUtils.degToRad(arrowParams.yaw),
    0,
    "XYZ"
  ));

  // ---------- VIDEO ----------
  video = document.createElement("video");
  if (useCrossOrigin) video.crossOrigin = "anonymous";
  video.src = videoSrc;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute("webkit-playsinline", "true");
  video.preload = "auto";
Object.assign(video.style, {
    position: "fixed",
    width: "2px",
    height: "2px",
    opacity: "0.01",          // <- NOT 0, to prevent optimization
    left: "2px",
    bottom: "2px",
    zIndex: "9997",
    pointerEvents: "none"
  });
  document.body.appendChild(video);

  // ---------- Visible canvas - mini 2D player ----------
  visibleCanvas = document.createElement("canvas");
  visibleCanvas.id = "2DVideoCanvas";
  visibleCtx = visibleCanvas.getContext("2d", {alpha: false});
  visibleCanvas.style.position = "fixed";
  visibleCanvas.style.top = "-370px";
  visibleCanvas.style.left = "10px";
  visibleCanvas.style.width = "2px";
  visibleCanvas.style.height = "2px";
  visibleCanvas.style.opacity = "0.01";
  visibleCanvas.style.zIndex = "9999";
  visibleCanvas.style.pointerEvents = "none";
  document.body.appendChild(visibleCanvas);

  panoTex = new THREE.CanvasTexture(visibleCanvas);
  panoTex.colorSpace = THREE.SRGBColorSpace;
  panoTex.minFilter = THREE.LinearFilter;
  panoTex.magFilter = THREE.LinearFilter;
  panoTex.generateMipmaps = false;
  panoTex.wrapS = THREE.RepeatWrapping;
  panoTex.repeat.x = -1; // mirror texture left-to-right

  // ---------- 360 sphere --------------------

  const geom = new THREE.SphereGeometry(1000, 64, 64);

  const mat = new THREE.MeshBasicMaterial({
    map: panoTex,
    side: THREE.BackSide,
  });

  sphere = new THREE.Mesh(geom, mat);
  sphere.renderOrder = 0;

  // --- Axis and grid added before sphere so they render in front (closer to camera at 450 vs sphere at 500) ---
  axisGroup = createAxisLines();
  axisGroup.renderOrder = 2;
  axisGroup.visible = (settings.axis ?? 0) === 1;
  scene.add(axisGroup);
  const { group: gridGroup, gridVGroup: gV, gridHGroup: gH } = createGridLines();
  gridVGroup = gV;
  gridHGroup = gH;
  gridGroup.renderOrder = 2;
  gridVGroup.visible = (settings.gridV ?? 0) === 1;
  gridHGroup.visible = (settings.gridH ?? 0) === 1;
  scene.add(gridGroup);

  scene.add(sphere);

  // --- Markers from URL param / QR scan (parsed above) ---
  nodeSettings = {
    nodeCircles: (settings.nodeCircles ?? 1) === 1 ? 1 : 0,
    nodeLabel: (settings.nodeLabel ?? 1) === 1 ? 1 : 0,
    nodeIcon: (settings.nodeIcon ?? 1) === 1 ? 1 : 0,
  };
  if (markers.length > 0) {
    for (const m of markers) {
      const mesh = await createMarkerSphere(m, settings);
      if (mesh) {
        markerGroups.push(mesh);
        scene.add(mesh);
      }
    }
  } else {
    // Fallback: one red sphere (same as before)
    // const mesh = createMarkerSphere({ yaw: -30, pitch: 10, size: 1.4, distance: 400, color: 0xff0000 }, settings);
    // if (mesh) scene.add(mesh);
  }
  // Apply settings: background sphere visibility and opacity
  if (sphere && sphere.material) {
    sphere.visible = (settings.bg ?? 1) === 1;
    const bgOpacity = Math.max(0, Math.min(1, (settings.bgOpacity ?? 100) / 100));
    sphere.material.transparent = true; // always allow opacity changes for slider
    sphere.material.opacity = bgOpacity;
  }








    // Sphere rotation for 360 video orientation (same for Safari and standalone PWA).
    // Standalone PWA landscape orientation fix is handled in DeviceOrientationControls.
    sphere.rotation.y = Math.PI - Math.PI / 2; // 180° + 90° yaw


  //   // ------- wireframe helper -------
  //   const wire = new THREE.WireframeGeometry(geom);
  //   const wireMat = new THREE.LineBasicMaterial({ color: 0xff00ff });
  //   const line = new THREE.LineSegments(wire, wireMat);
  //   sphere.add(line);

  // ------- small center reticle -------
  // const reticle = new THREE.Mesh(
  //   new THREE.RingGeometry(0.02, 0.024, 32),
  //   new THREE.MeshBasicMaterial({
  //     color: 0xffffff,
  //     transparent: true,
  //     opacity: 0.5,
  //   })
  // );
  // reticle.position.z = -1;
  // camera.add(reticle);
  // scene.add(camera);

  enterBtn.addEventListener("click", enterVR);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !inVRMode && enterBtn.offsetParent !== null) {
      const active = document.activeElement;
      if (!active || !/^(INPUT|TEXTAREA|SELECT)$/i.test(active.tagName)) {
        e.preventDefault();
        enterBtn.click();
      }
    }
  });
  recenterBtn.addEventListener("click", recenter);
  fullscreenBtn.addEventListener("click", goFullscreen);
  playPauseBtn.addEventListener("click", playpause);
  document.querySelectorAll(".video-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchVideo(btn.dataset.preset));
    if (btn.dataset.preset === settings.bgPreset) btn.style.fontWeight = "bold";
  });
  const scanQrHudBtn = document.getElementById("scan-qr-hud");
  if (scanQrBtn) scanQrBtn.addEventListener("click", startQrScan);
  if (scanQrHudBtn) scanQrHudBtn.addEventListener("click", startQrScan);
  if (qrScannerClose) qrScannerClose.addEventListener("click", stopQrScan);
  if (qrClearStored) qrClearStored.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY_QR_MARKERS);
    stopQrScan();
    window.location.reload();
  });
  if (clearQrBtn) {
    if (localStorage.getItem(STORAGE_KEY_QR_MARKERS)) clearQrBtn.style.display = "";
    clearQrBtn.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY_QR_MARKERS);
      window.location.reload();
    });
  }
  if (addToHomescreenTipClose) {
    addToHomescreenTipClose.addEventListener("click", () => {
      addToHomescreenTip?.classList.remove("visible");
      sessionStorage.setItem("addToHomescreenTipDismissed", "1");
    });
  }
  if (hudDrawerHandle && hudDrawer) {
    hudDrawerHandle.addEventListener("click", () => hudDrawer.classList.toggle("collapsed"));
  }
  if (bgOpacitySlider && sphere?.material) {
    const initialOpacity = Math.max(0, Math.min(100, settings.bgOpacity ?? 100));
    bgOpacitySlider.value = String(initialOpacity);
    bgOpacitySlider.addEventListener("input", () => {
      const v = Math.max(0, Math.min(1, Number(bgOpacitySlider.value) / 100));
      sphere.material.opacity = v;
    });
  }
  // Axis / grid toggle buttons
  function syncToggleButton(btn, visible) {
    if (btn) btn.classList.toggle("active", !!visible);
  }
  syncToggleButton(toggleAxisBtn, axisGroup?.visible);
  syncToggleButton(toggleGridVBtn, gridVGroup?.visible);
  syncToggleButton(toggleGridHBtn, gridHGroup?.visible);
  syncToggleButton(toggleNodeCirclesBtn, nodeSettings.nodeCircles === 1);
  syncToggleButton(toggleNodeLabelsBtn, nodeSettings.nodeLabel === 1);
  syncToggleButton(toggleNodeIconsBtn, nodeSettings.nodeIcon === 1);
  if (toggleAxisBtn) {
    toggleAxisBtn.addEventListener("click", () => {
      if (axisGroup) {
        axisGroup.visible = !axisGroup.visible;
        syncToggleButton(toggleAxisBtn, axisGroup.visible);
      }
    });
  }
  if (toggleGridVBtn) {
    toggleGridVBtn.addEventListener("click", () => {
      if (gridVGroup) {
        gridVGroup.visible = !gridVGroup.visible;
        syncToggleButton(toggleGridVBtn, gridVGroup.visible);
      }
    });
  }
  if (toggleGridHBtn) {
    toggleGridHBtn.addEventListener("click", () => {
      if (gridHGroup) {
        gridHGroup.visible = !gridHGroup.visible;
        syncToggleButton(toggleGridHBtn, gridHGroup.visible);
      }
    });
  }
  if (toggleNodeCirclesBtn) {
    toggleNodeCirclesBtn.addEventListener("click", () => {
      nodeSettings.nodeCircles = nodeSettings.nodeCircles === 1 ? 0 : 1;
      applyNodeVisibility();
      syncToggleButton(toggleNodeCirclesBtn, nodeSettings.nodeCircles === 1);
    });
  }
  if (toggleNodeLabelsBtn) {
    toggleNodeLabelsBtn.addEventListener("click", () => {
      nodeSettings.nodeLabel = nodeSettings.nodeLabel === 1 ? 0 : 1;
      applyNodeVisibility();
      syncToggleButton(toggleNodeLabelsBtn, nodeSettings.nodeLabel === 1);
    });
  }
  if (toggleNodeIconsBtn) {
    toggleNodeIconsBtn.addEventListener("click", () => {
      nodeSettings.nodeIcon = nodeSettings.nodeIcon === 1 ? 0 : 1;
      applyNodeVisibility();
      syncToggleButton(toggleNodeIconsBtn, nodeSettings.nodeIcon === 1);
    });
  }
  updateOrientationUI();
  const onOrientationOrResize = () => {
    updateOrientationUI();
    onResize();
  };
  window.addEventListener("resize", onOrientationOrResize);
  window.addEventListener("orientationchange", () => setTimeout(onOrientationOrResize, 100));

  // Arrow-key camera control for desktop troubleshooting
  const onKeyDown = (e) => {
    if (arrowKeys.hasOwnProperty(e.key)) {
      e.preventDefault();
      arrowKeys[e.key] = true;
    }
  };
  const onKeyUp = (e) => {
    if (arrowKeys.hasOwnProperty(e.key)) arrowKeys[e.key] = false;
  };
  const clearArrowKeys = () => {
    Object.keys(arrowKeys).forEach((k) => { arrowKeys[k] = false; });
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", clearArrowKeys);

//   // 🔹 toggle inside/outside - to check whether the sphere mesh flipped
//   window.addEventListener("keydown", (e) => {
//     if (e.key.toLowerCase() === "o") {
//       insideView = !insideView;
//       console.log("View toggled:", insideView ? "inside" : "outside");
//       if (insideView) {
//         sphere.material.side = THREE.BackSide;
//         camera.position.set(0, 0, 0);
//       } else {
//         sphere.material.side = THREE.FrontSide;
//         camera.position.set(0, 0, 600);
//       }
//     }
//   });

  // Keep video alive across visibility changes (PWA & Safari quirks)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      safePlay();
      if (inVRMode) requestWakeLock();
    } else {
      releaseWakeLock();
    }
  });
  window.addEventListener("pageshow", safePlay);
  window.addEventListener("focus", safePlay);

}

async function requestWakeLock() {
  if (typeof navigator?.wakeLock?.request !== "function") return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
    wakeLockSentinel.addEventListener("release", () => { wakeLockSentinel = null; });
  } catch {}
}

function releaseWakeLock() {
  if (wakeLockSentinel) {
    try {
      wakeLockSentinel.release();
    } catch {}
    wakeLockSentinel = null;
  }
}

async function enterVR() {

  try {
    await goFullscreen();

    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== "granted") {
        alert("Motion permission was denied.");
        return;
      }
    }

    await new Promise((resolve, reject) => {
      const onCanPlay = () => {
        video.removeEventListener("error", onError);
        resolve();
      };
      const onError = (e) => reject(e);
      video.addEventListener("canplay", onCanPlay, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.load();
    });

    // start playback (user gesture)
    await safePlay();

    await video.play();
    console.log("Video started:", video.readyState, video.currentTime);

    if (screen.orientation?.lock) {
      try {
        await screen.orientation.lock("landscape");
      } catch {}
    }

    // try fullscreen (ignored in standalone PWAs, but fine in Safari)
    await goFullscreen();

    ui.style.display = "none";
    inVRMode = true;
    updateOrientationUI();

    await requestWakeLock();

    // Show "Add to Home Screen" tip only in Safari (not in PWA/standalone) and when in landscape
    const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches || !!navigator.standalone;
    const tipDismissed = sessionStorage.getItem("addToHomescreenTipDismissed");
    if (addToHomescreenTip && !isStandalone && !tipDismissed && isLandscape()) {
      addToHomescreenTip.classList.add("visible");
    }

    startTextureUpdates();  // <- drive canvas & texture from video frames
    animate();
  } catch (err) {
    console.error("enterVR error:", err);
    alert("Could not start VR/video. See console.");
  }
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  // Arrow-key camera control for desktop troubleshooting (accumulate so controls.update() doesn't overwrite)
  const dyaw = (arrowKeys.ArrowRight ? 1 : 0) - (arrowKeys.ArrowLeft ? 1 : 0);
  const dpitch = (arrowKeys.ArrowDown ? 1 : 0) - (arrowKeys.ArrowUp ? 1 : 0);
  if (dyaw !== 0 || dpitch !== 0) {
    const e = new THREE.Euler(dpitch * arrowPitchSpeed, dyaw * arrowYawSpeed, 0, "XYZ");
    const deltaQ = new THREE.Quaternion().setFromEuler(e);
    arrowKeyQuat.multiply(deltaQ);
    const e2 = new THREE.Euler().setFromQuaternion(arrowKeyQuat, "XYZ");
    e2.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, e2.x));
    arrowKeyQuat.setFromEuler(e2);
    updateArrowParamsInURL();
  }
  camera.quaternion.multiply(arrowKeyQuat);
  labelPlanes.forEach((p) => p.lookAt(camera.position));

  if (
    video.readyState >= video.HAVE_CURRENT_DATA &&
    video.videoWidth &&
    video.videoHeight
  ) {
    // Equirectangular 360° sphere expects 2:1 texture (360°×180°). Stretch any aspect to fill.
    const h = video.videoHeight;
    const w = 2 * h;
    if (visibleCanvas.width !== w || visibleCanvas.height !== h) {
      visibleCanvas.width = w;
      visibleCanvas.height = h;
    }
    visibleCtx.drawImage(video, 0, 0, w, h);
    panoTex.needsUpdate = true;
  }

  effect.render(scene, camera);
}

function startTextureUpdates() {
  stopUpdates = false;

  const hasRVFC = typeof video.requestVideoFrameCallback === "function";

  const drawFrame = () => {
    if (stopUpdates) return;

    if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
      const h = video.videoHeight;
      const w = 2 * h;
      const dimsChanged = visibleCanvas.width !== w || visibleCanvas.height !== h;
      if (dimsChanged) {
        visibleCanvas.width = w;
        visibleCanvas.height = h;
        // Recreate texture when dimensions change - avoids WebGL texSubImage error
        // (Three.js uses texSubImage for updates; uploading different size into existing texture fails)
        if (panoTex) {
          panoTex.dispose();
        }
        panoTex = new THREE.CanvasTexture(visibleCanvas);
        panoTex.colorSpace = THREE.SRGBColorSpace;
        panoTex.minFilter = THREE.LinearFilter;
        panoTex.magFilter = THREE.LinearFilter;
        panoTex.generateMipmaps = false;
        panoTex.wrapS = THREE.RepeatWrapping;
        panoTex.repeat.x = -1;
        if (sphere && sphere.material) {
          sphere.material.map = panoTex;
        }
      }
      visibleCtx.drawImage(video, 0, 0, w, h);
      panoTex.needsUpdate = true;

      // Detect loop restart (ended doesn't fire when video.loop=true)
      if (getFlipOnLoop()) {
        const t = video.currentTime;
        const d = video.duration;
        if (d > 0 && lastVideoTime >= d - 0.15 && t < 0.15) {
          panoTex.repeat.x = -panoTex.repeat.x;
        }
        lastVideoTime = t;
      } else {
        lastVideoTime = video.currentTime;
      }
    }

    if (!hasRVFC) {
      // fallback to rAF if RVFC not available
      requestAnimationFrame(drawFrame);
    }
  };

  if (hasRVFC) {
    const loop = () => {
      if (stopUpdates) return;
      // When video is loading (e.g. after switch), RVFC won't fire - use rAF to keep polling
      const ready = video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth;
      if (ready) {
        video.requestVideoFrameCallback(() => {
          drawFrame();
          loop();
        });
      } else {
        requestAnimationFrame(() => {
          drawFrame();
          loop();
        });
      }
    };
    loop();
  } else {
    drawFrame();
  }
}

function stopTextureUpdates() {
  stopUpdates = true;
}



function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  effect.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}


function recenter() {
  // User decides "forward" when pressing recenter. Reference is never captured at launch.
  // Forward = horizontal direction (yaw); gravity defines DOWN.
  controls.setForwardReference();
  if (controls.alphaForward == null) {
    controls.alphaOffset = -camera.rotation.y;
  }
}

function playpause() {
  if (video.paused) {
    video.play();
  } else {
    video.pause();
  }
}

function switchVideo(presetKey) {
  const src = BG_PRESET_VIDEOS[presetKey];
  if (!src || !video) return;
  lastVideoTime = -1; // reset so new video starts from default orientation
  if (useCrossOrigin) video.crossOrigin = "anonymous";
  video.src = src;
  video.load();
  // Clear canvas so the old video doesn't persist. When the new video loads, drawFrame will resize and redraw.
  // Recreate texture when clearing to 1×1 to avoid WebGL texSubImage dimension mismatch.
  if (visibleCanvas && visibleCtx) {
    visibleCanvas.width = 1;
    visibleCanvas.height = 1;
    visibleCtx.fillStyle = "#000";
    visibleCtx.fillRect(0, 0, 1, 1);
    if (panoTex) {
      panoTex.dispose();
      panoTex = new THREE.CanvasTexture(visibleCanvas);
      panoTex.colorSpace = THREE.SRGBColorSpace;
      panoTex.minFilter = THREE.LinearFilter;
      panoTex.magFilter = THREE.LinearFilter;
      panoTex.generateMipmaps = false;
      panoTex.wrapS = THREE.RepeatWrapping;
      panoTex.repeat.x = -1;
      if (sphere && sphere.material) sphere.material.map = panoTex;
    }
    panoTex.needsUpdate = true;
  }
  safePlay();
  document.querySelectorAll(".video-btn").forEach((btn) => {
    btn.style.fontWeight = btn.dataset.preset === presetKey ? "bold" : "";
  });
}


async function goFullscreen() {
  const el = document.documentElement; // or document.body
  try {
    if (el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: "hide" });
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    }
  } catch (e) {
    console.warn("Fullscreen failed", e);
  }
}




async function safePlay() {
  try {
    if (video && video.paused) {
      const p = video.play();
      if (p && typeof p.then === "function") await p;
    }
  } catch (e) {
    // ignore; user may need to tap again if autoplay is blocked
    console.warn("Video play retry failed:", e);
  }
}

// --- auto-enter fullscreen in landscape on Safari ---
window.addEventListener("orientationchange", async () => {
  if (Math.abs(window.orientation) === 90) {
    try {
      await goFullscreen();
    } catch (e) {
      console.warn("Fullscreen request failed:", e);
    }
  }
});

function sizeToViewport() {
  const vv = window.visualViewport;
  const w = vv ? Math.round(vv.width)  : window.innerWidth;
  const h = vv ? Math.round(vv.height) : window.innerHeight;

  // Size Three; CSS controls canvas display
  renderer.setSize(w, h, false);
  effect.setSize(w, h);

  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

sizeToViewport();

window.addEventListener('resize', sizeToViewport, { passive: true });
window.addEventListener('orientationchange', () => {
  // give Safari a tick to settle the new bars, then recalc
  setTimeout(sizeToViewport, 250);
}, { passive: true });

// Live updates when Safari collapses/expands chrome
if (window.visualViewport) {
  visualViewport.addEventListener('resize', sizeToViewport, { passive: true });
  visualViewport.addEventListener('scroll', sizeToViewport,  { passive: true });
}
window.addEventListener("orientationchange", () => {
  if (Math.abs(window.orientation) === 90) {
    window.scrollTo(0, 1); // tiny scroll to nudge Safari to hide bars
  }
});


