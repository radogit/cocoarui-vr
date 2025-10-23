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

    this.onDeviceOrientationChangeEvent = (event) => {
      this.deviceOrientation = event;
    };

    this.onScreenOrientationChangeEvent = () => {
      this.screenOrientation = window.orientation || 0;
    };

    this.connect();
  }

  connect() {
    this.onScreenOrientationChangeEvent(); // run once
    window.addEventListener('orientationchange', this.onScreenOrientationChangeEvent);
    window.addEventListener('deviceorientation', this.onDeviceOrientationChangeEvent);
    this.enabled = true;
  }

  disconnect() {
    window.removeEventListener('orientationchange', this.onScreenOrientationChangeEvent);
    window.removeEventListener('deviceorientation', this.onDeviceOrientationChangeEvent);
    this.enabled = false;
  }

  update() {
    if (this.enabled === false) return;

    const device = this.deviceOrientation;
    if (!device) return;

    const alpha = device.alpha ? MathUtils.degToRad(device.alpha) + this.alphaOffset : 0; // Z
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
