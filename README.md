# ArtifyMe — Become the Masterpiece

A Progressive Web App for Android and iOS that repaints your photos and short videos in the style of famous artists, with **AI that runs entirely on the device**. Nothing gets uploaded. It installs to the home screen and works offline.

## Features

- **21 Masters styles**, including Van Gogh (*Starry Night*, *Sunflowers*, *Wheat Field with Cypresses*), Hokusai, Klimt, Munch, Monet, Kandinsky, Mondrian, Seurat, Juan Gris (Cubism), Mucha, Franz Marc, Schiele, Hiroshige, Rousseau, Rembrandt, Vermeer, Da Vinci and Bosch.
- **Pixel Worlds styles**: *Blockcraft* (Minecraft‑inspired block mosaic using procedurally generated 16×16 textures), *8‑Bit Arcade* (16‑colour palette, Bayer dithering, CRT scanlines) and *Brick Builder* (studded toy‑brick mosaic).
- **Your Style**: pick any image and ArtifyMe learns its look on the device. Only a 100‑number embedding is stored.
- **Live preview** of the selected style, plus press‑and‑hold to compare with the original.
- **Fine‑tune**: intensity, *keep original colours*, Pixel World detail level, and render quality (Swift 512 / Studio 896 / Gallery 1280).
- **Video**: up to 15 s at 12 or 24 fps and 360/540/720p. Encoded to **MP4 (H.264 + AAC, original audio kept)** with WebCodecs. Browsers without WebCodecs fall back to MediaRecorder.
- **Save**: on phones, the native share sheet opens ("Save Image" / "Save Video" to Photos). On desktop, the file downloads.
- **Private Collection**: every creation is kept in IndexedDB on the device, with a swipeable lightbox and delete.
- **Production feel**: WebGL "living oil paint" backdrop tinted to the selected artwork, film grain, a logo‑drawing splash, View Transitions between screens, 3D tilt cards with specular gloss, a lens‑style carousel, a gilded CTA with a shine sweep, a radial "paint‑in" reveal, a before/after slider with an auto sweep, gold‑leaf confetti, haptics and museum‑placard typography (Fraunces + Manrope, bundled offline).

## Masterpiece+ (generative, newer phones)

The Classic engine only transfers an artwork's texture and colour onto the photo. **Masterpiece+** repaints the photo itself. It uses image‑to‑image generation with a Latent Consistency Model, so the result keeps your scene (layout, pose, people, lighting) while the brushwork, forms and palette move toward the chosen master. The Reimagine styles do the same for anime, a 3D cartoon, a comic, a pencil sketch, watercolour and pop art.

- **Model:** [LCM‑DreamShaper‑v7](https://huggingface.co/SimianLuo/LCM_Dreamshaper_v7) UNet, released under MIT. It derives from Stable Diffusion 1.5, so the CreativeML OpenRAIL use restrictions apply; see `public/models/mp2/LICENSE-MODEL.txt`. It is paired with the SDXS tiny autoencoder (5 MB each way).
- **Pipeline:** encode the photo, re‑noise it to the chosen strength (0.3 is faithful, 0.7 is artistic), then run 4 LCM steps (`src/ai/lcm.ts`, a port of diffusers' `LCMScheduler`) and decode. Style‑only prompts (*how* to paint, never *what*) are precomputed as CLIP embeddings, so the text encoder never ships and the model doesn't invent new content.
- **Size:** the guidance embedding (w = 7.5) is baked into the ONNX graph. Weights are stored as 8‑bit per‑channel values (861 MB, in 26 chunks of 32 MB), streamed by a Web Worker, cached in Cache Storage and expanded to fp16 (1.7 GB on the GPU).
- **Runtime:** onnxruntime‑web on WebGPU with `shader-f16`, on devices with ≥ 8 GB RAM, such as recent Android flagships or iOS 26+ on newer iPhones. Other devices keep the Classic engine.
- **Rebuilding:** `scripts/masterpiece/` (Python with torch, diffusers and onnx): `export_lcm.py` → `pack2.py` (fp16 conversion with the timestep path kept in fp32, a strict type check and 8‑bit packing). Embeddings come from `stylep.py`.
- **Hosting note:** the published site is about 0.9 GB, close to GitHub Pages' 1 GB limit. Pages also has a soft limit of 100 GB/month bandwidth, which is about 110 first‑time Masterpiece+ downloads per month. Move `public/models/mp2/` to a CDN (Hugging Face, Cloudflare R2) if usage grows.

## How the AI works

Neural styles use Magenta's *Arbitrary Image Stylization* network (Ghiasi et al. 2017), through the TensorFlow.js port by Reiichiro Nakano (Apache 2.0). Inference runs on the GPU through WebGL.

- Each built‑in artwork's 100‑d style embedding is **precomputed at build time** with the high‑quality Inception predictor (`scripts/build-styles.mjs`). Phones therefore never download that 35 MB model.
- The client only loads the style transformers: `transformer-fast` (2.4 MB, used for previews and video) and `transformer-hq` (7.6 MB, used for stills).
- The MobileNet style predictor (9.3 MB) loads only when someone uses **Your Style**.
- The service worker caches the models the first time they are used, so they work offline afterwards. *About → Download all for offline* fetches all of them up front.

## Development

```bash
npm install
npm run dev        # http://localhost:5173 (use --host to test on a phone on your LAN)
npm run build      # type-check + production build into dist/
npm run preview
```

Service workers need HTTPS (or localhost). Deploy `dist/` to any static host, for example GitHub Pages, Netlify, Vercel or Cloudflare Pages. The build uses relative paths, so it also works from a sub‑folder.

### Regenerating assets

```bash
# Style embeddings + thumbnails from scripts/assets/art/*.jpg
node scripts/build-styles.mjs path/to/saved_model_style_inception_js   # best quality
node scripts/build-styles.mjs                                          # bundled MobileNet predictor

# App icons from public/icons/logo.svg
npm run icons:build
```

The Inception predictor is in [reiinakano/arbitrary-image-stylization-tfjs](https://github.com/reiinakano/arbitrary-image-stylization-tfjs) (`saved_model_style_inception_js`).

## Project layout

```
src/
  ai/        engine.ts (TF.js + models), pipeline.ts (quality/intensity/colour), procedural.ts (Pixel Worlds)
  media/     load.ts (decode photo/video), video.ts (frame pipeline + MP4 encode), save.ts (share/download)
  screens/   home, studio, render overlay, result, gallery, viewer, about
  store/     gallery.ts (IndexedDB), custom.ts (Your Style)
  ui/        dom helpers, icons, fx (aurora shader, tilt, ripple, toast, confetti), controls
  css/app.css  design system
public/models  TF.js graph models (Apache 2.0)
public/styles  artwork thumbnails (public domain, via Wikimedia Commons)
```

## Credits

- Model: Magenta, Apache 2.0. TF.js conversion by Reiichiro Nakano.
- Artworks: public‑domain works, via Wikimedia Commons.
- Minecraft is a trademark of Mojang Synergies AB. ArtifyMe is not affiliated with Mojang or Microsoft.
