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
# The sinusoidal timestep embedding needs fp32 (sin/cos of t*freq with t up to 999 is garbage in fp16).
keep32 = [n.name for n in m32.graph.node if "/time_proj/" in n.name]
m16 = float16.convert_float_to_float16(copy.deepcopy(m32), keep_io_types=True, disable_shape_infer=True, node_block_list=keep32)
# The converter leaves the graph's own Cast(to=FLOAT) nodes alone; inside the fp16 region they must emit fp16.
graph_outputs = {o.name for o in m16.graph.output}
fixed = 0
for n in m16.graph.node:
    if n.op_type == "Cast" and n.name not in keep32 and not any(o in graph_outputs for o in n.output):
        for a in n.attribute:
            if a.name == "to" and a.i == TensorProto.FLOAT:
                a.i = TensorProto.FLOAT16; fixed += 1
# Resize 'scales' (and 'roi') must stay float32 per the ONNX spec.
from onnx import numpy_helper as nh
producers = {o: n for n in m16.graph.node for o in n.output}
inits16 = {t.name: t for t in m16.graph.initializer}
rescued = 0
for n in m16.graph.node:
    if n.op_type != "Resize": continue
    for idx in (1, 2):
        if len(n.input) <= idx or not n.input[idx]: continue
        name = n.input[idx]
        if name in inits16 and inits16[name].data_type == TensorProto.FLOAT16:
            arr = nh.to_array(inits16[name]).astype(np.float32); inits16[name].CopyFrom(nh.from_array(arr, name)); rescued += 1
        elif name in producers and producers[name].op_type == "Constant":
            for a in producers[name].attribute:
                if a.name == "value" and a.t.data_type == TensorProto.FLOAT16:
                    arr = nh.to_array(a.t).astype(np.float32); a.t.CopyFrom(nh.from_array(arr)); rescued += 1
print("converted fp16; kept fp32:", len(keep32), "casts fixed:", fixed, "resize params rescued:", rescued)
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
# Strict type check of both graphs before anything ships (catches fp16/fp32 mixing).
for name, mm in (("fp16", m16), ("fp32", m32)):
    g = copy.deepcopy(mm.graph); probe = onnx.helper.make_model(g, opset_imports=mm.opset_import)
    for t in probe.graph.initializer:  # shape inference only needs dtypes/shapes
        t.ClearField("raw_data")
    onnx.shape_inference.infer_shapes(probe, strict_mode=True, check_type=True, data_prop=False)
    print("strict type check ok:", name)
total16 = strip(m16, "w16", f"{out}/graph.f16.onnx")
total32 = strip(m32, "w32", f"{out}/graph.f32.onnx")
json.dump({"tensors": manifest, "total16": total16, "total32": total32}, open(f"{out}/manifest.json", "w"), separators=(",", ":"))
print("graphs ok", total16 / 1e6, total32 / 1e6)
