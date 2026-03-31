# BubblesVR

Mobile-first web app for viewing information bubbles in immersive VR. Renders marker spheres, icons, and labels on a 360° video background inside a head-mounted display (e.g., Google Cardboard). Load configurations by scanning a QR code from BubblesConfigurator or by loading the built-in demo dataset.

**Live version:** [https://radogit.github.io/cocoarui-vr/](https://radogit.github.io/cocoarui-vr/)

**Companion app:** [BubblesConfigurator](https://radogit.github.io/cocoarui/) — design and arrange your bubble layouts on desktop. Generate a QR code there, then scan it in BubblesVR to load the configuration on your phone.

---

## Instructions

1. **Live version** — The public version is available at [https://radogit.github.io/cocoarui-vr/](https://radogit.github.io/cocoarui-vr/).
2. **BubblesConfigurator** — Create layouts at [https://radogit.github.io/cocoarui/](https://radogit.github.io/cocoarui/), then use the [VR] button to generate a QR code. Scan it in BubblesVR to load the layout.
3. **Demo** — Use “Load demo dataset” in the QR scanner overlay to try a sample layout without scanning.

---

## Functionality

- **VR view**: Stereo-rendered 3D scene with 360° video sphere, marker nodes (spheres, icons, labels), optional axis and grid. Device orientation controls the view; landscape required for VR.
- **Configuration loading**: QR code scan (camera), URL parameters, or localStorage. Supports bridge format v1/v2 JSON (`{ v, nodes, settings }`).
- **Video presets**: Switchable background videos (VR ascent/descent, paper pano ascent/descent, or none). Opacity slider.
- **HUD controls**: Toggle axis, vertical/horizontal grid, node circles, icons, labels. Recenter, fullscreen, play/pause.
- **Demo dataset**: Built-in sample layout for testing without QR.

## Key Concepts

### Coordinate system

- **Yaw, pitch (degrees)**: Spherical coordinates. Yaw = longitude (−90 to 90); pitch = latitude (−90 to 90).
- **Size (angular diameter)**: `size` in degrees = angular diameter in the visual field. Sphere radius: `R = D * sin(θ/2)`.
- **Distance**: Optional per-marker depth (default 400). Controls layering when markers overlap.

### Bridge format

- **v1**: `{ v: 1, nodes: [{ yaw, pitch, size, color, name }], settings }`
- **v2**: Adds `representation`, `opacity` per node; `settings` includes `bg`, `bgPreset`, `axis`, `gridV`, `gridH`, `nodeCircles`, `nodeIcon`, `nodeLabel`.

---

## Technical Details (for HCI / academic writing)

### Rectangular hotspots → spheres (area-preserving)

Configurations originate in [BubblesConfigurator](https://radogit.github.io/cocoarui/) with **rectangular hotspots**. Each node is rendered as a **sphere** in VR. The mapping preserves **area**:

- In the configurator: radius = √(avgArea / π) where avgArea is the mean effective area of the node’s hotspots (with intensityFactor/divisor for shared rectangles).
- The sphere’s angular diameter = 2×radius (in degrees). This area-equivalent circle/sphere representation preserves the relative significance of nodes.

### Angular diameter preservation (2D → 3D)

- **2D (BubblesConfigurator)**: Diameter in degrees = 2×radius; 1 data unit = 1 degree.
- **3D (BubblesVR)**: size = 2×radius (angular diameter in degrees). Sphere radius R = D×sin(θ/2) where θ = size, D = distance to sphere center. The sphere subtends θ in the visual field.
- **Formula**: For a 3D sphere, angular diameter α = 2×asin(R/D). With R = D×sin(θ/2), we get α = θ. Angular extent is preserved.

### Pitch inversion

**Yes, pitch inversion is required.** The bridge stores pitch = −y because:

- **BubblesConfigurator**: Y-down (positive Y = down in SVG).
- **BubblesVR**: Pitch-up (positive pitch = up in the view).
- **Mapping**: pitch = −y aligns the coordinate systems. A node at y = 30 in 2D appears at pitch = −30 in VR (below center).

### Mathematical continuity with BubblesConfigurator

| Quantity | BubblesConfigurator (2D) | BubblesVR (3D) |
|----------|--------------------------|----------------|
| Longitude | x (degrees) | yaw = x |
| Latitude | y (degrees, Y-down) | pitch = −y |
| Angular diameter | 2×radius (data units) | size = 2×radius (degrees) |

Both use the same degree-based coordinate system. The bridge JSON `{ v, nodes, settings }` carries (yaw, pitch, size) so layouts transfer without rescaling. Icons and labels are inscribed in the circle and perspective-corrected for depth.

## Technologies

| Technology | Purpose |
|------------|---------|
| **Three.js** | 3D scene, WebGL renderer, stereo effect, geometries, materials |
| **DeviceOrientationControls** | Head tracking from device motion |
| **StereoEffect** | Side-by-side stereo for Cardboard |
| **jsQR** | QR code decoding from camera stream |
| **Parcel** | Build, bundling |

## Project Structure

| Path | Role |
|------|------|
| `src/main.js` | Init, scene setup, marker creation, render loop, QR scan, HUD |
| `src/videoConfig.js` | Video URLs (local/R2), preset mapping |
| `src/icons.js` | Icon key → URL, texture loading |
| `src/controls/DeviceOrientationControls.js` | Device orientation → camera rotation |
| `src/demoDataset.json` | Sample markers for demo |
