import * as THREE from 'three';
import { DeviceOrientationControls } from './controls/DeviceOrientationControls.js';
import { StereoEffect } from 'three/examples/jsm/effects/StereoEffect.js';
import videoFile from './assets/city_safe.mp4';

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
  renderer.setPixelRatio(Math.max(1, window.devicePixelRatio / 1.25));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  effect = new StereoEffect(renderer);
  effect.setSize(window.innerWidth, window.innerHeight);

  // ---------- 360 VIDEO ----------
//   video = document.createElement('video');
//   video.src = './assets/city_safe.mp4',
  //video.src = 'https://raw.githubusercontent.com/aframevr/assets/master/360-video-boilerplate/video/city.mp4';
  video = document.createElement('video');
  video.src = videoFile;
  //video.crossOrigin = 'anonymous';
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  document.body.appendChild(video);
video.style.position = 'fixed';
video.style.bottom = '110px';
video.style.width = '200px';

  video.addEventListener('play', () => console.log('Video playing…'));
  video.addEventListener('pause', () => console.log('Video paused.'));
  video.addEventListener('error', (e) => console.error('Video error:', e));
  video.addEventListener('canplay', () => console.log('Video can play.'));

  videoTex = new THREE.VideoTexture(video);
  videoTex.colorSpace = THREE.SRGBColorSpace;
  /*** 🔹 Force dynamic updating each frame ***/
  videoTex.minFilter = THREE.LinearFilter;
  videoTex.magFilter = THREE.LinearFilter;
  videoTex.generateMipmaps = false;
  //videoTex.encoding = THREE.sRGBEncoding;

  const geom = new THREE.SphereGeometry(500, 64, 64);
  geom.scale(-1, 1, 1);

  const mat = new THREE.MeshBasicMaterial({
    map: videoTex,
    side: THREE.BackSide
  });

  sphere = new THREE.Mesh(geom, mat);
  scene.add(sphere);

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
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') {
        alert('Motion permission was denied.');
        return;
      }
    }

    await new Promise((resolve, reject) => {
      const onCanPlay = () => {
        video.removeEventListener('error', onError);
        resolve();
      };
      const onError = (e) => reject(e);
      video.addEventListener('canplay', onCanPlay, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.load();
    });

    const playPromise = video.play();
    if (playPromise) await playPromise;
    console.log('Video started:', video.readyState, video.currentTime);

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
  /*** 🔹 ensure Safari updates texture ***/
  if (video.readyState >= video.HAVE_CURRENT_DATA) {
    videoTex.needsUpdate = true;
  }
  effect.render(scene, camera);
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
