/**
 * Icon mapping for representation values. Matches D3_experiment/js/icons.js.
 * Used by VRPreview to show node icons on markers.
 * Parcel 2.14+ returns empty object for SVG imports by default; use url: to get URL string.
 */
import * as THREE from "three";
import icon01 from "url:./assets/icons/icon_01.svg";
import icon02 from "url:./assets/icons/icon_02.svg";
import icon03 from "url:./assets/icons/icon_03.svg";
import icon04 from "url:./assets/icons/icon_04.svg";
import iconCount from "url:./assets/icons/icon_count.svg";
import iconFill from "url:./assets/icons/icon_fill.svg";
import iconGraph from "url:./assets/icons/icon_graph.svg";
import iconLinear1 from "url:./assets/icons/icon_linear1.svg";
import iconLinear2 from "url:./assets/icons/icon_linear2.svg";
import iconMap from "url:./assets/icons/icon_map.svg";
import iconNavigation from "url:./assets/icons/icon_navigation.svg";
import iconNumber from "url:./assets/icons/icon_number.svg";
import iconRadial from "url:./assets/icons/icon_radial.svg";
import iconSound from "url:./assets/icons/icon_sound.svg";
import iconSymbol from "url:./assets/icons/icon_symbol.svg";
import iconText from "url:./assets/icons/icon_text.svg";

export const iconByKey = {
  "01": icon01,
  "02": icon02,
  "03": icon03,
  "04": icon04,
  count: iconCount,
  fill: iconFill,
  graph: iconGraph,
  linear1: iconLinear1,
  linear2: iconLinear2,
  map: iconMap,
  navigation: iconNavigation,
  number: iconNumber,
  radial: iconRadial,
  sound: iconSound,
  symbol: iconSymbol,
  text: iconText,
};

const textureCache = new Map();

/**
 * Load an icon URL as a Three.js texture (rasterizes SVG to canvas).
 * @param {string} url - Icon URL (from iconByKey)
 * @returns {Promise<THREE.Texture>}
 */
export function loadIconTexture(url) {
  const resolved = typeof url === "string" ? url : (url?.default ?? url?.href ?? "");
  if (!resolved) return Promise.reject(new Error("Invalid icon URL"));
  if (textureCache.has(resolved)) return Promise.resolve(textureCache.get(resolved));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d", { alpha: true });
      ctx.clearRect(0, 0, 256, 256);
      ctx.drawImage(img, 0, 0, 256, 256);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      textureCache.set(resolved, tex);
      resolve(tex);
    };
    img.onerror = (e) => {
      console.warn("Icon load failed:", resolved, e);
      reject(e);
    };
    img.src = resolved;
  });
}
