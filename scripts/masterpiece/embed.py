import torch, numpy as np, sys, json
from transformers import CLIPTokenizer, CLIPTextModel
sys.path.insert(0, sys.argv[1]); from prompts import P, SUBJECTS
repo = "IDKiro/sdxs-512-dreamshaper"
tok = CLIPTokenizer.from_pretrained(repo, subfolder="tokenizer"); te = CLIPTextModel.from_pretrained(repo, subfolder="text_encoder").eval()
out = {}
with torch.no_grad():
    for k, p in P.items():
        for sk, sp in SUBJECTS.items():
            ids = tok(sp + ", " + p, padding="max_length", max_length=77, truncation=True, return_tensors="pt").input_ids
            out[f"{sk}|{k}"] = te(ids)[0][0].numpy().astype(np.float32)
np.savez(sys.argv[2], **out); print(len(out), out['scream'].shape)
