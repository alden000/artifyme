// Precomputes the 100‑d style bottleneck for every bundled artwork and
// renders the gallery thumbnails. Run once whenever artworks change:
//
//   node scripts/build-styles.mjs [path/to/style-model-dir]
//
// Pass the Magenta *Inception* style predictor for best quality (35 MB, not
// shipped to clients). Defaults to the bundled MobileNet predictor.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import * as tf from '@tensorflow/tfjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const artDir = path.join(root, 'scripts/assets/art');
const thumbDir = path.join(root, 'public/styles');
const outFile = path.join(root, 'src/data/bottlenecks.json');
const modelDir = path.resolve(process.argv[2] ?? path.join(root, 'public/models/style-mobile'));

function fileHandler(dir) {
  return {
    async load() {
      const json = JSON.parse(await fs.readFile(path.join(dir, 'model.json'), 'utf8'));
      const specs = [];
      const buffers = [];
      for (const group of json.weightsManifest) {
        specs.push(...group.weights);
        for (const p of group.paths) buffers.push(await fs.readFile(path.join(dir, p)));
      }
      const all = Buffer.concat(buffers);
      return {
        modelTopology: json.modelTopology,
        format: json.format,
        generatedBy: json.generatedBy,
        convertedBy: json.convertedBy,
        weightSpecs: specs,
        weightData: all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength),
      };
    },
  };
}

await tf.setBackend('cpu');
console.log('Loading style model from', modelDir);
const net = await tf.loadGraphModel(fileHandler(modelDir));

await fs.mkdir(thumbDir, { recursive: true });
const files = (await fs.readdir(artDir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
const result = {};
for (const file of files) {
  const id = path.parse(file).name;
  const src = path.join(artDir, file);
  const { data, info } = await sharp(src)
    .resize(256, 256, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const vec = tf.tidy(() => {
    const img = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3]).toFloat().div(255).expandDims();
    return net.predict(img).reshape([100]);
  });
  result[id] = Array.from(await vec.data()).map((v) => +v.toFixed(5));
  vec.dispose();

  await sharp(src).resize(480, 640, { fit: 'cover', position: 'attention' }).webp({ quality: 78 }).toFile(path.join(thumbDir, `${id}.webp`));
  console.log('✓', id);
}
await fs.writeFile(outFile, JSON.stringify(result));
console.log(`Wrote ${Object.keys(result).length} styles → ${path.relative(root, outFile)}`);
