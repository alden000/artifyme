# Reference loader: rebuild the dequantised buffer exactly as the browser will.
import numpy as np, json, sys
d, key, outp = sys.argv[1], sys.argv[2], sys.argv[3]   # key: w16|w32
man = json.load(open(f"{d}/manifest.json")); blob = np.fromfile(f"{d}/weights.q8", dtype=np.uint8)
total = man["total16" if key == "w16" else "total32"]
buf = np.zeros(total, dtype=np.uint8); cur = 0
for e in man["tensors"]:
    cur = (cur + 15) // 16 * 16
    n = int(np.prod(e["s"])) if e["s"] else 1
    if e["k"] == "raw":
        buf[cur:cur + e["b"]] = blob[e["o"]:e["o"] + e["b"]]; cur += e["b"]; continue
    if e["k"] == "q8":
        oc = e["s"][0]; q = blob[e["o"]:e["o"] + n].view(np.int8).astype(np.float32).reshape(oc, -1)
        sc = blob[e["so"]:e["so"] + oc * 4].view(np.float32)
        a = (q * sc[:, None]).reshape(-1)
    else:
        a = blob[e["o"]:e["o"] + n * 2].view(np.float16).astype(np.float32)
    dt = np.float16 if e[key] == 2 else np.float32
    b = a.astype(dt).tobytes(); buf[cur:cur + len(b)] = np.frombuffer(b, dtype=np.uint8); cur += len(b)
buf.tofile(outp); print("ok", total)
