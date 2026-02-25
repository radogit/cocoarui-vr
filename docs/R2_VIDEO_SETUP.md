# Cloudflare R2 Video Hosting Setup

This guide walks you through uploading VR videos to Cloudflare R2, configuring CORS, and wiring them into the VRPreview app.

## 1. Create a Bucket

1. Go to [Cloudflare Dashboard → R2](https://dash.cloudflare.com/?to=/:account/r2/overview)
2. Click **Create bucket**
3. Name it (e.g. `vr-videos`)
4. Click **Create bucket**

## 2. Enable Public Access

1. Open your bucket
2. Go to **Settings**
3. Under **Public access**, find **Public Development URL**
4. Click **Enable**
5. Confirm by typing `allow` and clicking **Allow**
6. Copy the **Public Bucket URL** (e.g. `https://pub-xxxxxxxx.r2.dev`) — you’ll need it later

> **Note:** The `r2.dev` subdomain is rate-limited and intended for development. For production, use a [custom domain](https://developers.cloudflare.com/r2/buckets/public-buckets/#connect-a-bucket-to-a-custom-domain).

## 3. Configure CORS

Because the app draws video to a canvas (WebGL texture), the browser requires CORS headers.

1. In your bucket, go to **Settings**
2. Under **CORS Policy**, click **Add CORS policy**
3. Choose the **JSON** tab and paste:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:1235",
      "http://localhost:5173",
      "https://radogit.github.io",
      "https://your-custom-domain.com"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

4. Add your real origins (GitHub Pages URL, custom domain, etc.)
5. Click **Save**

> **Tip:** CORS changes can take up to ~30 seconds to propagate.

## 4. Upload Videos

### Option A: Dashboard (simple)

1. Open your bucket
2. Click **Upload**
3. Drag and drop or select files from `src/assets/`:
   - `city_webgl.mp4`
   - `VRAscentVideo.mp4`
   - `VRDescentVideo.mp4`
   - `final-PPA-70s,20kph,400m,60mRise.mp4`
   - `final-PPD-35s,36kph,350m,15mDrop.mp4`

**Filenames with commas:** R2 accepts them, but URLs may need encoding. For fewer issues, consider renaming when uploading, e.g.:
- `final-PPA-70s-20kph-400m-60mRise.mp4`
- `final-PPD-35s-36kph-350m-15mDrop.mp4`

If you rename, update the keys in `src/videoConfig.js` to match.

### Option B: Wrangler CLI (bulk upload)

```bash
# Install wrangler if needed
npm install -g wrangler

# Login
npx wrangler login

# Upload (replace BUCKET_NAME and paths)
npx wrangler r2 object put BUCKET_NAME/city_webgl.mp4 --file=src/assets/city_webgl.mp4
npx wrangler r2 object put BUCKET_NAME/VRAscentVideo.mp4 --file=src/assets/VRAscentVideo.mp4
# ... repeat for each file
```

## 5. Wire URLs Into the App

1. Copy `.env.production.example` to `.env.production` in the project root (or set the variable in your CI/CD):

```
R2_VIDEO_BASE_URL=https://pub-xxxxxxxx.r2.dev
```

Replace `pub-xxxxxxxx.r2.dev` with your actual Public Bucket URL (no trailing slash).

2. Build and deploy:

```bash
npm run build
npm run deploy
```

The app uses local video imports when `R2_VIDEO_BASE_URL` is unset (e.g. `npm run start`), and R2 URLs when it’s set (e.g. production build).

## 6. Verify

1. Open the deployed app
2. Enter VR mode and switch between video presets
3. Check the browser console for CORS or loading errors
4. If videos fail: confirm CORS origins include your app’s URL and that the bucket URL is correct
