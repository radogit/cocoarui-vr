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

let scene, camera, renderer, effect, controls;
let video, visibleCanvas, visibleCtx, panoTex, sphere;
let insideView = true; // 🔹 start inside

init();

function init() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.01,
    2000
  );

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.max(1, window.devicePixelRatio / 1.25));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

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

  controls = new DeviceOrientationControls(camera, true);

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

    //startTextureUpdates();  // <- drive canvas & texture from video frames
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

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  effect.setSize(window.innerWidth, window.innerHeight);
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
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: "hide" });
      await safePlay;
    }
  } catch (e) {
    console.warn("Fullscreen failed", e);
  }
}

async function safePlay() {
  try {
    if (video.paused) {
      const p = video.play();
      if (p && typeof p.then === "function") await p;
    }
  } catch (e) {
    // ignore; user may need to tap again if autoplay is blocked
  }
}