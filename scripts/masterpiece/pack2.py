# Pack an ONNX UNet (any size, external data OK) for ArtifyMe Masterpiece+.
#   weights.q8 + manifest.json + graph.f16.onnx / graph.f32.onnx (weights external at "w")
import onnx, numpy as np, json, sys, os
from onnx import numpy_helper as nh, TensorProto
from onnxconverter_common import float16
src, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
FLOAT = {TensorProto.FLOAT, TensorProto.FLOAT16}

# 1) quantised blob + manifest from the fp32 model
m32 = onnx.load(src)
blob = bytearray(); manifest = []
def align(n=16):
    while len(blob) % n: blob.append(0)
for t in m32.graph.initializer:
    a = nh.to_array(t); e = {"n": t.name, "s": list(a.shape)}
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
        for f in ("raw_data", "float_data", "int64_data", "int32_data"): t.ClearField(f)
        t.data_location = TensorProto.EXTERNAL
        del t.external_data[:]
        for k, v in (("location", "w"), ("offset", str(o)), ("length", str(n))):
            kv = t.external_data.add(); kv.key = k; kv.value = v
    onnx.save(model, path)
    onnx.shape_inference.infer_shapes_path(path, path + ".chk", check_type=True, strict_mode=True)
    os.remove(path + ".chk")
    print("strict type check ok:", os.path.basename(path))
    return cur

total32 = strip(m32, "w32", f"{out}/graph.f32.onnx")
del m32

# 2) fp16 graph (fresh load; >2 GB protos can't be deep-copied)
m16 = onnx.load(src)
keep32 = [n.name for n in m16.graph.node if "/time_proj/" in n.name]
m16 = float16.convert_float_to_float16(m16, keep_io_types=True, disable_shape_infer=True, node_block_list=keep32)
outs = {o.name for o in m16.graph.output}
fixed = 0
for n in m16.graph.node:
    if n.op_type == "Cast" and n.name not in keep32 and not any(o in outs for o in n.output):
        for a in n.attribute:
            if a.name == "to" and a.i == TensorProto.FLOAT: a.i = TensorProto.FLOAT16; fixed += 1
producers = {o: n for n in m16.graph.node for o in n.output}
inits = {t.name: t for t in m16.graph.initializer}
rescued = 0
for n in m16.graph.node:
    if n.op_type != "Resize": continue
    for idx in (1, 2):
        if len(n.input) <= idx or not n.input[idx]: continue
        nm = n.input[idx]
        if nm in inits and inits[nm].data_type == TensorProto.FLOAT16:
            inits[nm].CopyFrom(nh.from_array(nh.to_array(inits[nm]).astype(np.float32), nm)); rescued += 1
        elif nm in producers and producers[nm].op_type == "Constant":
            for a in producers[nm].attribute:
                if a.name == "value" and a.t.data_type == TensorProto.FLOAT16:
                    a.t.CopyFrom(nh.from_array(nh.to_array(a.t).astype(np.float32))); rescued += 1
print("fp16: kept fp32", len(keep32), "casts fixed", fixed, "resize rescued", rescued)
total16 = strip(m16, "w16", f"{out}/graph.f16.onnx")
json.dump({"tensors": manifest, "total16": total16, "total32": total32}, open(f"{out}/manifest.json", "w"), separators=(",", ":"))
print("done", total16 / 1e6, total32 / 1e6)
