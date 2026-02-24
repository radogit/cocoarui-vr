import {
  Euler,
  EventDispatcher,
  MathUtils,
  Quaternion,
  Vector3
} from 'three';

const _zee = new Vector3(0, 0, 1);
const _euler = new Euler();
const _q0 = new Quaternion();
const _q1 = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // - PI/2 around the x-axis

const _changeEvent = { type: 'change' };

// DeviceOrientation: alpha=yaw (compass), beta=pitch (tilt fwd/back), gamma=roll (tilt left/right)
// screenOrientation: rotation of screen UI (portrait/landscape) — separate from device tilt
function formatOrientationDebug(yawDeg, pitchDeg, rollDeg, screenOrientationDeg) {
  const desc = (val, label, fn) =>
    val != null ? `${label}=${Math.round(val)}° (${fn(val)})` : `${label}=—`;
  const pitchDesc = (p) => {
    if (Math.abs(p) < 25) return 'upright';
    if (p > 60) return 'flat, screen up';
    if (p < -60) return 'flat, screen down';
    return p > 0 ? 'tilted back' : 'tilted forward';
  };
  const rollDesc = (r) => {
    if (r == null) return '—';
    if (Math.abs(r) < 10) return 'level';
    return r > 0 ? 'tilted right' : 'tilted left';
  };
  const screenDesc = (o) => {
    if (o == null) return '—';
    if (o === 0) return 'portrait';
    if (o === 90) return 'landscape-right';
    if (o === -90) return 'landscape-left';
    if (Math.abs(o) === 180) return 'portrait upside-down';
    return `${o}°`;
  };
  return [
    desc(yawDeg, 'yaw', () => 'compass'),
    desc(pitchDeg, 'pitch', pitchDesc),
    desc(rollDeg, 'roll', rollDesc),
    screenOrientationDeg != null
      ? `screenOrientation=${Math.round(screenOrientationDeg)}° (${screenDesc(screenOrientationDeg)})`
      : 'screenOrientation=—',
  ].join(' | ');
}

class DeviceOrientationControls extends EventDispatcher {

  constructor(object, options = {}) {
    super();
    this.object = object;
    const opts = typeof options === 'boolean' ? { debug: options } : options;
    this.object.rotation.reorder('YXZ');
    this.enabled = true;
    this.deviceOrientation = {};
    this.screenOrientation = 0;
    this.alphaOffset = 0; // radians
    this.alphaForward = null; // compass heading (rad) for "straight ahead" — set on first orientation
    this.orientAtCapture = null; // screen orientation (rad) when alphaForward was captured
    this.alphaLaunchCorrection = 0; // yaw correction when launched in landscape (rad)
    this._launchedInLandscape = null; // set on first update: true if landscape, false if portrait
    this._alphaLaunchCorrectionFixed = null; // set once at first frame when launched in landscape
    this.debugLog = opts.debug || (typeof window !== 'undefined' &&
      (/[?&]debug=orientation/i.test(window.location.search) ||
       /[?&]debug=orientation/i.test(window.location.hash)));
    this._hasLoggedLaunch = false;
    this._shouldLogScreenChange = false;
    this._prevScreenOrientationForLog = null;
    this._resizeDebounceTimer = null;

    this.onDeviceOrientationChangeEvent = (event) => {
      this.deviceOrientation = event;
    };

    this.onScreenOrientationChangeEvent = () => {
      const prev = this.screenOrientation;
      this.screenOrientation = this._getScreenOrientation();
      if (this.debugLog && prev !== this.screenOrientation) {
        this._shouldLogScreenChange = true;
        this._prevScreenOrientationForLog = prev;
      }
    };

    // Prefer Screen Orientation API; fallback to deprecated window.orientation (e.g. iOS Safari)
    this._useScreenOrientationAPI =
      typeof screen !== 'undefined' &&
      screen.orientation &&
      typeof screen.orientation.angle === 'number';

    this.connect();
  }

  _getScreenOrientation() {
    let angle = 0;
    if (this._useScreenOrientationAPI && screen.orientation) {
      angle = screen.orientation.angle;
    } else {
      angle = window.orientation || 0;
    }
    const isLandscape =
      typeof window !== 'undefined' && window.innerWidth > window.innerHeight;
    const isPortrait = typeof window !== 'undefined' && window.innerWidth <= window.innerHeight;
    // iOS: orientation APIs often report wrong values. Use viewport as source of truth.
    if (isLandscape && (angle === 0 || angle === 180)) {
      return 90; // landscape-right
    }
    if (isPortrait && (angle === 90 || angle === -90)) {
      return 0; // portrait
    }
    return angle;
  }

  connect() {
    this.onScreenOrientationChangeEvent(); // run once
    if (this._useScreenOrientationAPI && screen.orientation) {
      screen.orientation.addEventListener('change', this.onScreenOrientationChangeEvent);
    } else {
      window.addEventListener('orientationchange', this.onScreenOrientationChangeEvent);
    }
    // orientationchange often doesn't fire when rotating back to portrait on iOS Safari.
    // resize fires more reliably; use it for all modes. Debounce to reduce jumpiness.
    this._isStandalone =
      (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)')?.matches) ||
      (typeof navigator !== 'undefined' && !!navigator.standalone);
    this._onResize = () => {
      if (this._resizeDebounceTimer) clearTimeout(this._resizeDebounceTimer);
      this._resizeDebounceTimer = setTimeout(() => {
        this._resizeDebounceTimer = null;
        this.onScreenOrientationChangeEvent();
      }, 80);
    };
    window.addEventListener('resize', this._onResize);
    window.addEventListener('deviceorientation', this.onDeviceOrientationChangeEvent);
    this.enabled = true;
  }

  disconnect() {
    if (this._useScreenOrientationAPI && screen?.orientation) {
      screen.orientation.removeEventListener('change', this.onScreenOrientationChangeEvent);
    } else {
      window.removeEventListener('orientationchange', this.onScreenOrientationChangeEvent);
    }
    window.removeEventListener('resize', this._onResize);
    if (this._resizeDebounceTimer) clearTimeout(this._resizeDebounceTimer);
    window.removeEventListener('deviceorientation', this.onDeviceOrientationChangeEvent);
    this.enabled = false;
  }

  _logOrientation(reason, yawDeg, pitchDeg, rollDeg, alpha, beta, gamma, orient, prevScreenOrientation) {
    if (!this.debugLog) return;
    const raw = {
      device_alpha: yawDeg,
      device_beta: pitchDeg,
      device_gamma: rollDeg,
      screenOrientation: this.screenOrientation,
      innerWidth: window?.innerWidth,
      innerHeight: window?.innerHeight,
    };
    console.log(`[orientation ${reason}] raw device:`, raw);
    console.log(`[orientation ${reason}] device:`, formatOrientationDebug(
      yawDeg, pitchDeg, rollDeg, this.screenOrientation
    ));
    if (alpha != null) {
      const toWorld = {
        alpha: Math.round(MathUtils.radToDeg(alpha)),
        beta: Math.round(MathUtils.radToDeg(beta)),
        gamma: Math.round(MathUtils.radToDeg(gamma)),
        orient: Math.round(MathUtils.radToDeg(orient)),
      };
      console.log(`[orientation ${reason}] passed to setObjectQuaternion:`, toWorld,
        '| euler(beta,alpha,-gamma) YXZ, then -orient around Z');
      console.log(`[orientation ${reason}] world:`, formatOrientationDebug(
        toWorld.alpha, toWorld.beta, toWorld.gamma, toWorld.orient
      ));
      // Mapping: device axes → world axes. orient rotates device frame to screen frame.
      const mapping = [
        'device.alpha → world yaw (compass)',
        'device.beta → world pitch (euler X)',
        'device.gamma → world roll (euler -Z)',
        `orient=${toWorld.orient}° → -orient around Z aligns device to screen`,
      ];
      console.log(`[orientation ${reason}] mapping:`, mapping.join('; '));
      if (reason === 'SCREEN_CHANGE' && prevScreenOrientation != null) {
        const prev = prevScreenOrientation === 0 ? 'portrait' :
          prevScreenOrientation === 90 ? 'landscape-right' :
          prevScreenOrientation === -90 ? 'landscape-left' : prevScreenOrientation + '°';
        const curr = this.screenOrientation === 0 ? 'portrait' :
          this.screenOrientation === 90 ? 'landscape-right' :
          this.screenOrientation === -90 ? 'landscape-left' : this.screenOrientation + '°';
        console.log(`[orientation ${reason}] screen: ${prev} → ${curr} | device beta/gamma axes fixed to phone; orient should swap their effect on world pitch/roll`);
      }
    }
  }

  /**
   * Set "forward" reference from user action (recenter). Never called at launch.
   * alphaOffset is set once here and stays constant — recomputing per-frame would freeze yaw.
   */
  setForwardReference() {
    const device = this.deviceOrientation;
    const alphaDeg = device?.alpha;
    if (typeof alphaDeg === 'number') {
      this.alphaForward = MathUtils.degToRad(alphaDeg);
      this.orientAtCapture = this.screenOrientation ? MathUtils.degToRad(this.screenOrientation) : 0;
      this.alphaOffset = (this.alphaForward - MathUtils.degToRad(alphaDeg)) + (this.alphaLaunchCorrection || 0);
      const orient = this.screenOrientation ? MathUtils.degToRad(this.screenOrientation) : 0;
      const beta = device.beta != null ? MathUtils.degToRad(device.beta) : 0;
      const gamma = device.gamma != null ? MathUtils.degToRad(device.gamma) : 0;
      const alpha = MathUtils.degToRad(alphaDeg) + this.alphaOffset;
      this._logOrientation('RECENTER', alphaDeg, device.beta, device.gamma, alpha, beta, gamma, orient);
      this.alphaLaunchCorrection = 0; // baked into alphaOffset
      this._alphaLaunchCorrectionFixed = null; // reset so next launch can recompute
    }
  }

  update() {
    if (this.enabled === false) return;

    const device = this.deviceOrientation;
    if (!device) return;

    const orientRad = this.screenOrientation ? MathUtils.degToRad(this.screenOrientation) : 0;
    const orientAtCapture = this.orientAtCapture ?? 0;
    const orientDelta = this.alphaForward != null ? orientRad - orientAtCapture : 0;
    const alphaDeg = device.alpha;
    const betaDeg = device.beta;
    const gammaDeg = device.gamma;
    const beta = betaDeg != null ? MathUtils.degToRad(betaDeg) : 0;

    // When alphaForward is null (no recenter): apply corrections based on launch vs rotate.
    if (this.alphaForward == null && typeof window !== 'undefined') {
      const inLandscape = window.innerWidth > window.innerHeight;
      if (this._launchedInLandscape === null) {
        this._launchedInLandscape = inLandscape; // capture at first update
      }
      if (inLandscape) {
        if (this._launchedInLandscape) {
          // Launched in landscape: device.alpha needs -90°; when beta near 0 add 180° (fix reversed).
          // Set correction ONCE at first frame — recomputing per-frame causes flip when beta crosses 90°
          // (e.g. phone in VR headset at horizon cusp, beta oscillates).
          if (this._alphaLaunchCorrectionFixed == null) {
            const betaAbs = Math.abs(betaDeg ?? 0);
            this._alphaLaunchCorrectionFixed = -Math.PI / 2;
            if (betaAbs < 90) this._alphaLaunchCorrectionFixed += Math.PI;
          }
          this.alphaLaunchCorrection = this._alphaLaunchCorrectionFixed;
        } else {
          // Rotated portrait→landscape: device.alpha is correct, no correction
          this.alphaLaunchCorrection = 0;
        }
      } else {
        this.alphaLaunchCorrection = 0;
      }
    }

    const alpha =
      alphaDeg != null
        ? MathUtils.degToRad(alphaDeg) + this.alphaOffset + orientDelta + (this.alphaLaunchCorrection || 0)
        : 0; // Z
    const gamma = gammaDeg != null ? MathUtils.degToRad(gammaDeg) : 0; // Y''
    const orient = this.screenOrientation ? MathUtils.degToRad(this.screenOrientation) : 0; // O

    // Log only when orientation is set or corrected (launch, screen change, recenter)
    if (this.debugLog) {
      if (!this._hasLoggedLaunch && alphaDeg != null) {
        this._hasLoggedLaunch = true;
        this._logOrientation('LAUNCH', alphaDeg, betaDeg, gammaDeg, alpha, beta, gamma, orient);
      } else if (this._shouldLogScreenChange) {
        this._shouldLogScreenChange = false;
        const prev = this._prevScreenOrientationForLog;
        this._prevScreenOrientationForLog = null;
        this._logOrientation('SCREEN_CHANGE', alphaDeg, betaDeg, gammaDeg, alpha, beta, gamma, orient, prev);
      }
    }

    this.setObjectQuaternion(this.object.quaternion, alpha, beta, gamma, orient);
    this.dispatchEvent(_changeEvent);
  }

  setObjectQuaternion(quaternion, alpha, beta, gamma, orient) {
    _euler.set(beta, alpha, -gamma, 'YXZ'); // 'ZXY' for the device, but 'YXZ' for us
    quaternion.setFromEuler(_euler);
    quaternion.multiply(_q1); // camera looks out the back of the device, not the top
    quaternion.multiply(_q0.setFromAxisAngle(_zee, -orient)); // orient the device
  }

  dispose() {
    this.disconnect();
  }
}

export { DeviceOrientationControls };
