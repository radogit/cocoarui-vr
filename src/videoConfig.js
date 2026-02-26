/**
 * Video URL configuration.
 * When R2_VIDEO_BASE_URL is set (e.g. in .env.production), videos are loaded from R2.
 * Otherwise, local bundled assets are used.
 */

import videoFile from "./assets/city_webgl.mp4";
import VRAscentVideo from "./assets/VRAscentVideo.mp4";
import VRDescentVideo from "./assets/VRDescentVideo.mp4";
import PPAscentVideo from "./assets/final-PPA-70s,20kph,400m,60mRise.mp4";
import PPDescentVideo from "./assets/final-PPD-35s,36kph,350m,15mDrop.mp4";

/** R2 object keys (filenames as stored in bucket). Update if you rename when uploading. */
const R2_KEYS = {
  default: "city_webgl.mp4",
  "vr-uphill": "VRAscentVideo.mp4",
  "vr-downhill": "VRDescentVideo.mp4",
  "base-uphill": "final-PPA-70s,20kph,400m,60mRise.mp4",
  "base-downhill": "final-PPD-35s,36kph,350m,15mDrop.mp4",
};

// Direct access so Parcel can replace at build time
const base = process.env.R2_VIDEO_BASE_URL;
const useR2 = Boolean(base && String(base).trim());

function r2Url(key) {
  if (!base) return null;
  const filename = R2_KEYS[key] || R2_KEYS.default;
  const encoded = filename.split("/").map(encodeURIComponent).join("/");
  return `${base.replace(/\/$/, "")}/${encoded}`;
}

/** Default/fallback video URL. */
export const defaultVideoUrl = useR2 ? r2Url("default") : videoFile;

/** Maps bgPreset key (from D3/QR) to video URL. "none" = no video. */
export const BG_PRESET_VIDEOS = useR2
  ? {
      "vr-uphill": r2Url("vr-uphill"),
      "vr-downhill": r2Url("vr-downhill"),
      "base-downhill": r2Url("base-downhill"),
      "base-uphill": r2Url("base-uphill"),
      "none": null,
    }
  : {
      "vr-uphill": VRAscentVideo,
      "vr-downhill": VRDescentVideo,
      "base-downhill": PPDescentVideo,
      "base-uphill": PPAscentVideo,
      "none": null,
    };

/** True when using cross-origin (R2) URLs. Set video.crossOrigin = "anonymous" before src. */
export const useCrossOrigin = useR2;
