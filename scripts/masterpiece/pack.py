# Pack the UNet+ControlNet graph for the web:
#   weights.q8   : all initializers; big float tensors int8 per-output-channel, rest fp16/raw
#   manifest.json: tensor table (order defines the in-memory layout the graphs reference)
#   graph.f16.onnx / graph.f32.onnx : weight-less graphs whose initializers point into
#                                     the dequantised buffer ("w"), for fp16 / fp32 GPUs.
import onnx, numpy as np, json, sys, os
from onnx import numpy_helper, TensorProto
from onnxconverter_common import float16
src, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
m32 = onnx.load(src)
print("loaded fp32")
import copy
m16 = float16.convert_float_to_float16(copy.deepcopy(m32), keep_io_types=True, disable_shape_infer=True)
print("converted fp16")
FLOAT = {TensorProto.FLOAT, TensorProto.FLOAT16}
inits32 = {t.name: t for t in m32.graph.initializer}
blob = bytearray(); manifest = []
def align(n=16):
    while len(blob) % n: blob.append(0)
for name, t in inits32.items():
    a = numpy_helper.to_array(t)
    e = {"n": name, "s": list(a.shape)}
    if t.data_type in FLOAT:
        a = a.astype(np.float32)
        if a.ndim >= 2 and a.size >= 16384:
            oc = a.shape[0]; flat = a.reshape(oc, -1)
            scale = np.abs(flat).max(axis=1) / 127.0; scale[scale == 0] = 1e-8
            q = np.clip(np.round(flat / scale[:, None]), -127, 127).astype(np.int8)
            align(); e["k"] = "q8"; e["o"] = len(blob); blob += q.tobytes()
            align(); e["so"] = len(blob); blob += scale.astype(np.float32).tobytes()
        else:
            align(); e["k"] = "f16"; e["o"] = len(blob); blob += a.astype(np.float16).tobytes()
    else:
        align(); e["k"] = "raw"; e["dt"] = int(t.data_type); e["o"] = len(blob); b = a.tobytes(); e["b"] = len(b); blob += b
    manifest.append(e)
with open(f"{out}/weights.q8", "wb") as f: f.write(blob)
print("blob", len(blob) / 1e6, "MB", len(manifest), "tensors")

def strip(model, key, path):
    # Element width per tensor comes from the graph itself (a converter may keep some fp32).
    width = {t.name: (2 if t.data_type == TensorProto.FLOAT16 else 4 if t.data_type == TensorProto.FLOAT else 0) for t in model.graph.initializer}
    off = {}; cur = 0
    for e in manifest:
        wb = width.get(e["n"], 4 if e["k"] != "raw" else 0)
        if e["k"] != "raw": e[key] = wb
        n = e["b"] if e["k"] == "raw" else int(np.prod(e["s"])) * wb
        cur = (cur + 15) // 16 * 16; off[e["n"]] = (cur, n); cur += n
    for t in model.graph.initializer:
        if t.name not in off: raise SystemExit(f"initializer {t.name} not in manifest")
        o, n = off[t.name]
        t.ClearField("raw_data"); t.ClearField("float_data"); t.ClearField("int64_data"); t.ClearField("int32_data")
        t.data_location = TensorProto.EXTERNAL
        del t.external_data[:]
        for k, v in (("location", "w"), ("offset", str(o)), ("length", str(n))):
            kv = t.external_data.add(); kv.key = k; kv.value = v
    onnx.save(model, path)
    return cur
total16 = strip(m16, "w16", f"{out}/graph.f16.onnx")
total32 = strip(m32, "w32", f"{out}/graph.f32.onnx")
json.dump({"tensors": manifest, "total16": total16, "total32": total32}, open(f"{out}/manifest.json", "w"), separators=(",", ":"))
print("graphs ok", total16 / 1e6, total32 / 1e6)
