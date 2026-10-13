# Export the "Informative Drawings" line-art generator (ControlNet annotator, coarse variant) to ONNX.
# Input: [1,3,H,W] RGB in [0,1]; output: [1,1,H,W] in [0,1] (1 = paper, 0 = ink).
import torch, sys
from controlnet_aux.lineart import Generator
from huggingface_hub import hf_hub_download
out = sys.argv[1]
m = Generator(3, 1, 3)
m.load_state_dict(torch.load(hf_hub_download("lllyasviel/Annotators", "sk_model2.pth"), map_location="cpu")); m.eval()
torch.onnx.export(m, (torch.rand(1, 3, 512, 384),), out, input_names=["image"], output_names=["lines"],
                  dynamic_axes={"image": {2: "h", 3: "w"}, "lines": {2: "h", 3: "w"}}, opset_version=17, dynamo=False)
print("ok")
