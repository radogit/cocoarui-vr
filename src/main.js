import * as THREE from "three";
import { DeviceOrientationControls } from "./controls/DeviceOrientationControls.js";
import { StereoEffect } from "three/examples/jsm/effects/StereoEffect.js";
import jsQR from "jsqr";
import videoFile from "./assets/city_webgl.mp4";
import VRAscentVideo from "./assets/VRAscentVideo.mp4";
import VRDescentVideo from "./assets/VRDescentVideo.mp4";
import PPAscentVideo from "./assets/final-PPA-70s,20kph,400m,60mRise.mp4";
import PPDescentVideo from "./assets/final-PPD-35s,36kph,350m,15mDrop.mp4";

/** Maps bgPreset key (from D3/QR) to video asset URL. */
const BG_PRESET_VIDEOS = {
  "vr-uphill": VRAscentVideo,
  "vr-downhill": VRDescentVideo,
  "base-downhill": PPDescentVideo,
  "base-uphill": PPAscentVideo,
};

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

const appRoot = document.getElementById('app-root');

const STORAGE_KEY_QR_MARKERS = "qr_scanned_markers";

function isLandscape() {
  return typeof window !== "undefined" && window.innerWidth > window.innerHeight;
}

function updateOrientationUI() {
  const landscape = isLandscape();
  if (!inVRMode) {
    // Initial screen: always show buttons
    if (uiButtons) uiButtons.hidden = false;
  } else {
    // VR mode: landscape = show VR, portrait = show landscape-required overlay
    if (vrLandscapeOverlay) vrLandscapeOverlay.hidden = landscape;
    if (appRoot) appRoot.style.visibility = landscape ? "" : "hidden";
    if (hud) hud.hidden = !landscape;
    if (addToHomescreenTip && !landscape) addToHomescreenTip.classList.remove("visible");
  }
}

let scene, camera, renderer, effect, controls;
let inVRMode = false; // true after user has entered VR
let video, visibleCanvas, visibleCtx, panoTex, sphere;
let insideView = true; // 🔹 start inside
let stopUpdates = false;
const labelPlanes = []; // billboard labels, updated each frame to face camera
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

/**
 * Parse markers from a raw string (value of markers param).
 * Supports: JSON array [{}], JSON object { nodes: [], settings: {} }, or pipe-separated yaw,pitch,size|...
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
        };
      });
      return { markers, settings };
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
 * Positioned in front of the sphere (between camera and sphere surface) so it's visible.
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
  const frontDist = Math.max(0.1, distance - radius - 0.02);
  plane.position.copy(position).multiplyScalar(frontDist / distance);
  labelPlanes.push(plane);
  return plane;
}

/**
 * Create a sphere marker at polar coords (yaw, pitch) with angular size.
 * size = angular diameter in degrees. radius = distance * tan(size/2).
 * Optional name: displayed as billboard label inside the sphere.
 * @param {Object} settings - { nodeCircles, nodeLabel } from QR payload
 */
function createMarkerSphere({ yaw, pitch, size, distance = 400, color = 0xff0000, opacity = 1, name }, settings = {}) {
  const showCircle = (settings.nodeCircles ?? 1) === 1;
  const showLabel = (settings.nodeLabel ?? 1) === 1;
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
  if (showCircle) {
    const geom = new THREE.SphereGeometry(radius, 32, 32);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(pos);
    group.add(mesh);
  }
  if (showLabel && name && name.trim()) {
    const label = createLabelMesh(name.trim(), radius, pos, cappedDist);
    group.add(label);
  }
  return group.children.length > 0 ? group : null;
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
      window.location.reload();
      return;
    }
  }
  qrAnimationId = requestAnimationFrame(tickQrScan);
}

init();

function init() {
  // --- keep video alive on PWA focus / rotation ---
    document.addEventListener("visibilitychange", () => {
    if (!document.hidden) safePlay();
    });
    window.addEventListener("focus", safePlay);
    window.addEventListener("orientationchange", () => {
    setTimeout(safePlay, 500);
    });


  scene = new THREE.Scene();

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
  const videoSrc = BG_PRESET_VIDEOS[settings.bgPreset] ?? videoFile;

  // ---------- VIDEO ----------
  video = document.createElement("video");
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


  // ---------- 360 sphere --------------------

  const geom = new THREE.SphereGeometry(500, 64, 64);
  //geom.scale(-1, 1, 1);

  const mat = new THREE.MeshBasicMaterial({
    map: panoTex,
    side: THREE.BackSide,
  });

  sphere = new THREE.Mesh(geom, mat);
  scene.add(sphere);

  // --- Markers from URL param / QR scan (parsed above) ---
  if (markers.length > 0) {
    markers.forEach((m) => {
      const mesh = createMarkerSphere(m, settings);
      if (mesh) scene.add(mesh);
    });
  } else {
    // Fallback: one red sphere (same as before)
    // const mesh = createMarkerSphere({ yaw: -30, pitch: 10, size: 1.4, distance: 400, color: 0xff0000 }, settings);
    // if (mesh) scene.add(mesh);
  }
  // Apply settings: background sphere visibility and opacity
  if (sphere && sphere.material) {
    sphere.visible = (settings.bg ?? 1) === 1;
    const bgOpacity = Math.max(0, Math.min(1, (settings.bgOpacity ?? 100) / 100));
    sphere.material.transparent = bgOpacity < 1;
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
  updateOrientationUI();
  const onOrientationOrResize = () => {
    updateOrientationUI();
    onResize();
  };
  window.addEventListener("resize", onOrientationOrResize);
  window.addEventListener("orientationchange", () => setTimeout(onOrientationOrResize, 100));

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
    if (!document.hidden) safePlay();
  });
  window.addEventListener("pageshow", safePlay);
  window.addEventListener("focus", safePlay);

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
        if (sphere && sphere.material) {
          sphere.material.map = panoTex;
        }
      }
      visibleCtx.drawImage(video, 0, 0, w, h);
      panoTex.needsUpdate = true;
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


