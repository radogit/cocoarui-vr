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


    // --- 3D reference sphere (red) ---
    const refGeometry = new THREE.SphereGeometry(5, 32, 32); // radius 5 units
    const refMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const refSphere = new THREE.Mesh(refGeometry, refMaterial);

    // place it slightly above horizon and to the left
    // (e.g. 30° to the left, 10° up, 400 units away from camera center)
    const distance = 400;
    const azimuth = THREE.MathUtils.degToRad(-30); // left/right
    const elevation = THREE.MathUtils.degToRad(10); // up/down
    refSphere.position.set(
    Math.sin(azimuth) * Math.cos(elevation) * distance,
    Math.sin(elevation) * distance,
    -Math.cos(azimuth) * Math.cos(elevation) * distance
    );

    scene.add(refSphere);








    // --- iOS standalone PWA orientation correction ---
    const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone;

    if (isStandalone) {
    // sphere.rotation.order = "YXZ";
    sphere.rotation.z = -Math.PI / 2; // rotate 90° clockwise
    sphere.rotation.x = Math.PI; // rotate
    // sphere.rotation.x = Math.PI / 2; // rotate 90° clockwise
    console.log("Applied PWA orientation fix (sphere rotated)");
    } else {
        sphere.rotation.y = Math.PI; // rotate
    }


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
    setTimeout(recenter, 100);
  } catch (err) {
    console.error("enterVR error:", err);
    alert("Could not start VR/video. See console.");
  }
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();

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
  controls.alphaOffset = -camera.rotation.y;
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


