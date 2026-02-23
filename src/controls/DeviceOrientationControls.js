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

class DeviceOrientationControls extends EventDispatcher {

  constructor(object) {
    super();
    this.object = object;
    this.object.rotation.reorder('YXZ');
    this.enabled = true;
    this.deviceOrientation = {};
    this.screenOrientation = 0;
    this.alphaOffset = 0; // radians
    this.alphaForward = null; // compass heading (rad) for "straight ahead" — set on first orientation
    this.orientAtCapture = null; // screen orientation (rad) when alphaForward was captured

    this.onDeviceOrientationChangeEvent = (event) => {
      this.deviceOrientation = event;
    };

    this.onScreenOrientationChangeEvent = () => {
      this.screenOrientation = this._getScreenOrientation();
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
    // iOS standalone PWA: when opened in landscape, orientation APIs often report 0.
    // That causes 90° roll. Infer landscape from viewport and override.
    const isStandalone =
      (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)')?.matches) ||
      (typeof navigator !== 'undefined' && !!navigator.standalone);
    const isLandscape =
      typeof window !== 'undefined' && window.matchMedia?.('(orientation: landscape)')?.matches;
    if (isStandalone && isLandscape && angle === 0) {
      return 90; // landscape-right; if wrong, try -90
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
    // Standalone PWA: orientationchange may not fire; resize often does on rotate
    this._isStandalone =
      (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)')?.matches) ||
      (typeof navigator !== 'undefined' && !!navigator.standalone);
    if (this._isStandalone) {
      window.addEventListener('resize', this.onScreenOrientationChangeEvent);
    }
    window.addEventListener('deviceorientation', this.onDeviceOrientationChangeEvent);
    this.enabled = true;
  }

  disconnect() {
    if (this._useScreenOrientationAPI && screen?.orientation) {
      screen.orientation.removeEventListener('change', this.onScreenOrientationChangeEvent);
    } else {
      window.removeEventListener('orientationchange', this.onScreenOrientationChangeEvent);
    }
    if (this._isStandalone) {
      window.removeEventListener('resize', this.onScreenOrientationChangeEvent);
    }
    window.removeEventListener('deviceorientation', this.onDeviceOrientationChangeEvent);
    this.enabled = false;
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
      this.alphaOffset = this.alphaForward - MathUtils.degToRad(alphaDeg);
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

    const alpha =
      alphaDeg != null ? MathUtils.degToRad(alphaDeg) + this.alphaOffset + orientDelta : 0; // Z
    const beta = device.beta ? MathUtils.degToRad(device.beta) : 0; // X'
    const gamma = device.gamma ? MathUtils.degToRad(device.gamma) : 0; // Y''
    const orient = this.screenOrientation ? MathUtils.degToRad(this.screenOrientation) : 0; // O

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
