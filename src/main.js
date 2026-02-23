import * as THREE from "three";
import { DeviceOrientationControls } from "./controls/DeviceOrientationControls.js";
import { StereoEffect } from "three/examples/jsm/effects/StereoEffect.js";
import videoFile from "./assets/city_webgl.mp4";

const ui = document.getElementById("ui");
const enterBtn = document.getElementById("enter");
const hud = document.getElementById("hud");
const recenterBtn = document.getElementById("recenter");
const fullscreenBtn = document.getElementById("fullscreen");
const playPauseBtn = document.getElementById("playpause");

const appRoot = document.getElementById('app-root');

let scene, camera, renderer, effect, controls;
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

function parseMarkersFromURL() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("markers");
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    if (trimmed.startsWith("[")) {
      const arr = JSON.parse(trimmed);
      return arr.map((m) => {
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
    }
    return trimmed.split("|").map((part) => {
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
  } catch {
    return [];
  }
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
 */
function createMarkerSphere({ yaw, pitch, size, distance = 400, color = 0xff0000, opacity = 1, name }) {
  const cappedDist = Math.min(distance, VIDEO_SPHERE_RADIUS - 1);
  const azimuth = THREE.MathUtils.degToRad(yaw);
  const elevation = THREE.MathUtils.degToRad(pitch);
  const angularRadiusRad = THREE.MathUtils.degToRad(size) / 2;
  const radius = cappedDist * Math.tan(angularRadiusRad);
  const geom = new THREE.SphereGeometry(radius, 32, 32);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
  });
  const mesh = new THREE.Mesh(geom, mat);
  const pos = new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation) * cappedDist,
    Math.sin(elevation) * cappedDist,
    -Math.cos(azimuth) * Math.cos(elevation) * cappedDist
  );
  mesh.position.copy(pos);
  if (name && name.trim()) {
    const label = createLabelMesh(name.trim(), radius, pos, cappedDist);
    return new THREE.Group().add(mesh).add(label);
  }
  return mesh;
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
  renderer.domElement.style.width = "100vw";
  renderer.domElement.style.height = "100vh";
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none"; // prevent pull-to-refresh


  effect = new StereoEffect(renderer);
  effect.setSize(window.innerWidth, window.innerHeight);

  // ---------- VIDEO ----------
  video = document.createElement("video");
  video.src = videoFile;
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

  // --- Markers from URL param ---
  // Format: ?markers=yaw,pitch,size|yaw,pitch,size|...
  //   yaw, pitch: degrees (matches D3 simulation: x=yaw, y=pitch)
  //   size: angular diameter in degrees (same units as yaw/pitch — "angular size")
  // Optional 4th value: distance from camera (default 400)
  // Optional 5th: color hex (default 0xff0000)
  // Example: ?markers=-30,10,2|0,0,5,300
  const markers = parseMarkersFromURL();
  if (markers.length > 0) {
    markers.forEach((m) => scene.add(createMarkerSphere(m)));
  } else {
    // Fallback: one red sphere (same as before)
    scene.add(
      createMarkerSphere({ yaw: -30, pitch: 10, size: 1.4, distance: 400, color: 0xff0000 })
    );
  }








    // Sphere rotation for 360 video orientation (same for Safari and standalone PWA).
    // Standalone PWA landscape orientation fix is handled in DeviceOrientationControls.
    sphere.rotation.y = Math.PI;


  //   // ------- wireframe helper -------
  //   const wire = new THREE.WireframeGeometry(geom);
  //   const wireMat = new THREE.LineBasicMaterial({ color: 0xff00ff });
  //   const line = new THREE.LineSegments(wire, wireMat);
  //   sphere.add(line);

  // ------- small center reticle -------
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.02, 0.024, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
    })
  );
  reticle.position.z = -1;
  camera.add(reticle);
  scene.add(camera);

  enterBtn.addEventListener("click", enterVR);
  recenterBtn.addEventListener("click", recenter);
  fullscreenBtn.addEventListener("click", goFullscreen);
  playPauseBtn.addEventListener("click", playpause);
  window.addEventListener("resize", onResize);

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
    hud.hidden = false;

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
    if (
      visibleCanvas.width !== video.videoWidth ||
      visibleCanvas.height !== video.videoHeight
    ) {
      visibleCanvas.width = video.videoWidth;
      visibleCanvas.height = video.videoHeight;
    }
    visibleCtx.drawImage(video, 0, 0, visibleCanvas.width, visibleCanvas.height);
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
      if (visibleCanvas.width !== video.videoWidth || visibleCanvas.height !== video.videoHeight) {
        visibleCanvas.width = video.videoWidth;
        visibleCanvas.height = video.videoHeight;
      }
      visibleCtx.drawImage(video, 0, 0, visibleCanvas.width, visibleCanvas.height);
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
      video.requestVideoFrameCallback(() => {
        drawFrame();
        loop();
      });
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
  //controls.alphaOffset = -camera.rotation.y;
    if (video.paused) {
        video.play();
        {console.log("Video played");}
    } else {
        video.pause();
        {console.log("Video paused");}
    }
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

  // Keep a CSS var for the fallback route (old iOS)
  document.documentElement.style.setProperty('--vh', `${h / 100}px`);

  // For old iOS that ignores dvh: mark the container to use the --vh calc
  // Newer Safari will ignore the data-attr thanks to 100dvh @supports above.
  if (!CSS.supports('height: 100dvh')) {
    appRoot.setAttribute('data-use-vh', '1');
  }

  // Size Three without letting it also scale the DOM canvas; CSS controls pixels.
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


