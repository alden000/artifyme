# ArtifyMe — Become the Masterpiece

A Progressive Web App for Android and iOS that redraws your photos in the hand of famous artists, with **AI that runs entirely on the device**. Nothing gets uploaded. It installs to the home screen and works offline.

## Features

- **Masterpiece+ redraws your photo** with on‑device generative AI. It is not a colour filter: brushwork, forms and palette move toward the chosen artist, while your scene, pose and people stay recognisable.
- **21 Masters**, including Van Gogh (*Starry Night*, *Sunflowers*, *Wheat Field with Cypresses*), Hokusai, Klimt, Munch, Monet, Kandinsky, Mondrian, Seurat, Juan Gris, Mucha, Franz Marc, Schiele, Hiroshige, Rousseau, Rembrandt, Vermeer, Da Vinci and Bosch.
- **6 Reimagine styles**: anime, 3D cartoon, comic, pencil sketch, watercolour and pop art.
- **Protect people** (on by default): people and pets are found, then repainted separately at a faithful strength so they keep their face, outfit and pose.
- **Fine‑tune**: a Faithful ↔ Artistic slider and *Keep my colours*. Use *Paint again* for another variation.
- **Save**: on phones, the native share sheet opens ("Save Image" to Photos). On desktop, the file downloads.
- **Private Collection**: every creation is kept in IndexedDB on the device, with a swipeable lightbox and delete.
- **Production feel**: WebGL "living oil paint" backdrop, film grain, a logo‑drawing splash, View Transitions, 3D tilt cards, a lens‑style carousel, a gilded CTA, a before/after slider with an auto sweep, gold‑leaf confetti, haptics and museum‑placard typography (Fraunces + Manrope, bundled offline).

## How Masterpiece+ works

Masterpiece+ uses image‑to‑image generation with a Latent Consistency Model.

- **Model:** [LCM‑DreamShaper‑v7](https://huggingface.co/SimianLuo/LCM_Dreamshaper_v7) UNet, released under MIT. It derives from Stable Diffusion 1.5, so the CreativeML OpenRAIL use restrictions apply; see `public/models/mp2/LICENSE-MODEL.txt`. It is paired with the SDXS tiny autoencoder (5 MB each way).
- **Pipeline:** at up to 640 px (capped so the UNet's largest attention buffer fits the GPU's per-binding limit — beyond it phone GPUs silently return a smudge), encode the photo, re‑noise it to the chosen strength (0.25 is faithful, 0.65 is artistic; Reimagine styles get +0.1), then run 4 LCM steps (`src/ai/lcm.ts`, a port of diffusers' `LCMScheduler`) and decode. Style‑only prompts (*how* to paint, never *what*) are precomputed as CLIP embeddings, so the text encoder never ships and the model doesn't invent new content. The result is upscaled 2× with an unsharp mask.
- **Protect people** (`src/ai/split.ts`): whole‑image img2img gives a small subject only a few latent pixels, so the model tends to invent a new person.
  - DeepLabV3‑MobileNetV3 (torchvision, BSD‑3; 44 MB; `seg.onnx`) finds people, dogs and cats.
  - Each compact group is cropped from the full‑resolution photo with some margin, repainted at 512 px a notch more gently than the scene (strength − 0.12, 0.25–0.5) and blended back through a grown, feathered mask.
  - Subjects too large or too spread out to gain from a crop, such as portraits and crowds, get a second, gentler full‑frame pass, blended in through the same kind of mask.
- **Size:** the guidance embedding (w = 7.5) is baked into the ONNX graph. Weights are stored as 8‑bit per‑channel values (861 MB, in 26 chunks of 32 MB), streamed by a Web Worker, cached in Cache Storage (`artifyme-mp-v2`) and expanded to fp16 (1.7 GB on the GPU).
- **Memory:** the engine runs in a Web Worker (`src/ai/mp-engine.worker.ts`) that is terminated 60 s after the last paint, when you return home or when the app is backgrounded. That is the only way to give the GPU buffers and WebAssembly memory back to the phone.
- **Runtime:** onnxruntime‑web on WebGPU with `shader-f16`, on devices with ≥ 8 GB RAM, such as recent Android flagships or iOS 26+ on newer iPhones.
- **Rebuilding:** `scripts/masterpiece/` (Python with torch, diffusers and onnx): `export_lcm.py` → `pack2.py` (fp16 conversion with the timestep path kept in fp32, a strict type check and 8‑bit packing). Embeddings come from `stylep.py`; `export_seg.py` produces `seg.onnx`.
- **Hosting note:** the published site is about 0.95 GB, close to GitHub Pages' 1 GB limit. Pages also has a soft limit of 100 GB/month bandwidth, which is about 100 first‑time downloads per month. Move `public/models/mp2/` to a CDN (Hugging Face, Cloudflare R2) if usage grows.

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
npm run icons:build   # app icons from public/icons/logo.svg
```

## Project layout

```
src/
  ai/        masterpiece.ts (engine), lcm.ts (scheduler), split.ts (protect people), mp-worker.ts (weight loader)
  media/     load.ts (decode photo), save.ts (share/download)
  screens/   home, studio, render overlay, result, gallery, viewer, about, mpflow (download sheet)
  store/     gallery.ts (IndexedDB)
  ui/        dom helpers, icons, fx (aurora shader, tilt, ripple, toast, confetti), controls
  css/app.css  design system
public/models/mp2  Masterpiece+ graph, packed weights, autoencoder, people finder, style embeddings
public/styles      style thumbnails (artworks: public domain, via Wikimedia Commons)
```

## Credits

- LCM‑DreamShaper‑v7 (Luo et al. 2023; DreamShaper by Lykon; based on Stable Diffusion 1.5), SDXS tiny autoencoder: CreativeML OpenRAIL.
- DeepLabV3‑MobileNetV3 from torchvision: BSD‑3.
- Artworks: public‑domain works, via Wikimedia Commons.
