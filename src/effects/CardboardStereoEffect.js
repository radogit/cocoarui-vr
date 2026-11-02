import { StereoCamera, Vector2 } from "three";

/**
 * Side-by-side stereo renderer with adjustable lens distance.
 *
 * three.js's StereoEffect always centres each eye's image in its half of the
 * screen, so the image centres are (screen width / 2) apart. On large phones
 * that is wider than the fixed lens spacing of many Cardboard viewers (~60–64 mm),
 * and the eyes cannot fuse the two images.
 *
 * Here the distance between the two image centres is configurable as a fraction
 * of the screen width (0.5 = identical to StereoEffect). Each eye viewport is as
 * wide as it can be without overlapping the other eye or leaving the screen;
 * the remaining area is cleared to black.
 */
export class CardboardStereoEffect {
  constructor(renderer) {
    this.renderer = renderer;
    this.stereo = new StereoCamera();
    this.lensSeparation = 0.5; // fraction of screen width between image centres
    this._size = new Vector2();
  }

  setEyeSeparation(eyeSep) {
    this.stereo.eyeSep = eyeSep;
  }

  /** @param {number} fraction - image-centre distance / screen width, clamped to [0.2, 0.8]. */
  setLensSeparation(fraction) {
    const f = Number(fraction);
    if (Number.isFinite(f)) this.lensSeparation = Math.min(0.8, Math.max(0.2, f));
  }

  setSize(width, height) {
    this.renderer.setSize(width, height);
  }

  render(scene, camera) {
    const renderer = this.renderer;
    if (scene.matrixWorldAutoUpdate === true) scene.updateMatrixWorld();
    if (camera.parent === null && camera.matrixWorldAutoUpdate === true) camera.updateMatrixWorld();

    renderer.getSize(this._size);
    const w = this._size.x;
    const h = this._size.y;

    const sep = w * this.lensSeparation;      // distance between image centres
    const vw = Math.min(sep, w - sep);         // eye viewport width (no overlap, stays on screen)
    const leftX = w / 2 - sep / 2 - vw / 2;
    const rightX = w / 2 + sep / 2 - vw / 2;

    // StereoCamera uses camera.aspect * stereo.aspect; make that equal the eye viewport's aspect.
    this.stereo.aspect = vw / h / camera.aspect;
    this.stereo.update(camera);

    const currentAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.clear(); // black bars around the eye viewports

    renderer.setScissorTest(true);
    renderer.setScissor(leftX, 0, vw, h);
    renderer.setViewport(leftX, 0, vw, h);
    renderer.render(scene, this.stereo.cameraL);

    renderer.setScissor(rightX, 0, vw, h);
    renderer.setViewport(rightX, 0, vw, h);
    renderer.render(scene, this.stereo.cameraR);

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.autoClear = currentAutoClear;
  }
}
