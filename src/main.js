import * as THREE from 'three';
import { DeviceOrientationControls } from './controls/DeviceOrientationControls.js';
import { StereoEffect } from 'three/examples/jsm/effects/StereoEffect.js';
import videoFile from './assets/city_safe_safe.mp4';

// ---------- DOM ----------
const ui = document.getElementById('ui');
const enterBtn = document.getElementById('enter');
const hud = document.getElementById('hud');
const recenterBtn = document.getElementById('recenter');
const fullscreenBtn = document.getElementById('fullscreen');

// ---------- Three basics ----------
let scene, camera, renderer, effect, controls, video, videoTex, sphere;

init();

function init() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 1000);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  // color management: support both older and newer three versions
  if ('outputColorSpace' in renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } else if ('outputEncoding' in renderer) {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }

  renderer.setPixelRatio(Math.max(1, window.devicePixelRatio / 1.25));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  effect = new StereoEffect(renderer);
  effect.setSize(window.innerWidth, window.innerHeight);

  // ---------- 360 VIDEO ----------
  video = document.createElement('video');
  video.src = videoFile;                 // same-origin (Parcel will rewrite), safe for WebGL
  // DO NOT set crossOrigin for same-origin assets; it can force CORS mode and taint textures on some hosts.
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  // DEBUG PREVIEW (you can remove later)
  document.body.appendChild(video);
  video.style.position = 'fixed';
  video.style.bottom = '110px';
  video.style.left = '10px';
  video.style.width = '200px';
  video.style.zIndex = '9999';

  video.addEventListener('play', () => console.log('Video playing…'));
  video.addEventListener('pause', () => console.log('Video paused.'));
  video.addEventListener('error', (e) => console.error('Video error:', e));
  video.addEventListener('canplay', () => console.log('Video can play.'));

  // Create the video texture (NO custom UV matrix — that was the culprit)
  videoTex = new THREE.VideoTexture(video);
  videoTex.colorSpace = THREE.SRGBColorSpace;
  videoTex.minFilter = THREE.LinearFilter;
  videoTex.magFilter = THREE.LinearFilter;
  videoTex.generateMipmaps = false;
  videoTex.wrapS = THREE.ClampToEdgeWrapping;
  videoTex.wrapT = THREE.ClampToEdgeWrapping;
  // Leave the default flipY; the inside-out sphere + BackSide handles orientation

  // Inside-out sphere to view equirectangular content
  const geom = new THREE.SphereGeometry(500, 64, 64);
  geom.scale(-1, 1, 1);

  const mat = new THREE.MeshBasicMaterial({
    map: videoTex,
    side: THREE.BackSide
  });

  sphere = new THREE.Mesh(geom, mat);
  scene.add(sphere);

  // small center reticle
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.02, 0.024, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
  );
  reticle.position.z = -1;
  camera.add(reticle);
  scene.add(camera);

  controls = new DeviceOrientationControls(camera, true);

  enterBtn.addEventListener('click', enterVR);
  recenterBtn.addEventListener('click', recenter);
  fullscreenBtn.addEventListener('click', goFullscreen);
  window.addEventListener('resize', onResize);
}

// ---------- ENTER VR ----------
async function enterVR() {
  try {
    // iOS motion permission
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') {
        alert('Motion permission was denied.');
        return;
      }
    }

    // ensure first frame is ready
    await new Promise((resolve, reject) => {
      const onCanPlay = () => { video.removeEventListener('error', onError); resolve(); };
      const onError = (e) => reject(e);
      video.addEventListener('canplay', onCanPlay, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.load();
    });

    // start playback in gesture
    const playPromise = video.play();
    if (playPromise) await playPromise;
    console.log('Video started:', video.readyState, video.currentTime);

    // small settle delay — some iOS builds need a tick before the first frame hits the GPU
    await new Promise(r => setTimeout(r, 250));

    if (screen.orientation?.lock) {
      try { await screen.orientation.lock('landscape'); } catch {}
    }

    ui.style.display = 'none';
    hud.hidden = false;

    animate();
    setTimeout(recenter, 100);

  } catch (err) {
    console.error('enterVR error:', err);
    alert('Could not start VR/video. See console.');
  }
}

// ---------- RENDER LOOP ----------
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // make sure the texture uploads the latest frame each tick
  if (video.readyState >= video.HAVE_CURRENT_DATA) {
    videoTex.needsUpdate = true;
  }

  effect.render(scene, camera);

  // DEBUG: watch state advancing
  // console.log(video.readyState, video.currentTime, videoTex.needsUpdate);
}

// ---------- UTILITIES ----------
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  effect.setSize(window.innerWidth, window.innerHeight);
}

function recenter() {
  controls.alphaOffset = -camera.rotation.y;
}

async function goFullscreen() {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch (e) {
    console.warn('Fullscreen failed', e);
  }
}
