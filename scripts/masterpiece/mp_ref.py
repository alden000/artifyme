# Reference Masterpiece+ pipeline on the packed graph (numpy + onnxruntime) — mirrors the TS port.
import numpy as np, onnxruntime as ort, sys, os
from PIL import Image, ImageFilter
gdir, graph, emb_path, photo, style, subj, outp = sys.argv[1:8]
cscale = float(sys.argv[8]) if len(sys.argv) > 8 else 0.85
so = ort.SessionOptions(); so.intra_op_num_threads = 4
unet = ort.InferenceSession(f"{gdir}/{graph}", so)
dec = ort.InferenceSession(f"{gdir}/../onnx32/vae_decoder.onnx", so)
emb = np.load(emb_path)[f"{subj}|{style}" if subj else style][None].astype(np.float32)
img = Image.open(photo).convert("RGB"); w, h = img.size; s = 512 / max(w, h)
W, H = round(w * s / 64) * 64, round(h * s / 64) * 64
img = img.resize((W, H), Image.LANCZOS)
sys.path.insert(0, os.path.dirname(__file__)); from cn_lines import lines
cond = np.repeat(lines(img)[None, None], 3, axis=1).astype(np.float32)
ac999 = np.cumprod(1 - np.linspace(0.00085 ** 0.5, 0.012 ** 0.5, 1000) ** 2)[999]
x = np.random.default_rng(7).standard_normal((1, 4, H // 8, W // 8)).astype(np.float32)
hint = float(os.environ.get("HINT", "0"))
if hint > 0:
    enc = ort.InferenceSession(f"{gdir}/../onnx32/vae_encoder.onnx", so)
    z0 = enc.run(None, {"image": (np.asarray(img, np.float32) / 127.5 - 1).transpose(2, 0, 1)[None]})[0]
    a = np.sqrt(ac999) * hint
    x = (np.sqrt(1 - a * a) * x + a * z0).astype(np.float32)
eps = unet.run(None, {"sample": x, "timestep": np.array([999], np.int64), "emb": emb, "cond": cond, "cscale": np.array([cscale], np.float32)})[0]
z = ((x - np.sqrt(1 - ac999) * eps) / np.sqrt(ac999)).astype(np.float32)
y = dec.run(None, {"latent": z})[0][0]
Image.fromarray(((np.clip(y, -1, 1) + 1) * 127.5).astype(np.uint8).transpose(1, 2, 0)).save(outp, quality=92); print("ok", outp)
