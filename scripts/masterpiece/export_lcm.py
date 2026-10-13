# Export the LCM-DreamShaper-v7 UNet with the guidance embedding (w=7.5) baked in.
#   (sample[1,4,h,w], timestep[1] int64, emb[1,77,768]) -> eps
import torch, sys, os
from diffusers import UNet2DConditionModel, LatentConsistencyModelPipeline
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
torch.set_grad_enabled(False)
unet = UNet2DConditionModel.from_pretrained("SimianLuo/LCM_Dreamshaper_v7", subfolder="unet", torch_dtype=torch.float32).eval()
w = torch.tensor([7.5 - 1.0])
wcond = LatentConsistencyModelPipeline.get_guidance_scale_embedding(None, w, embedding_dim=unet.config.time_cond_proj_dim)
class U(torch.nn.Module):
    def __init__(s): super().__init__(); s.u = unet; s.register_buffer("wc", wcond)
    def forward(s, sample, timestep, emb):
        return s.u(sample, timestep, encoder_hidden_states=emb, timestep_cond=s.wc, return_dict=False)[0]
torch.onnx.export(U(), (torch.randn(1, 4, 64, 48), torch.tensor([499], dtype=torch.int64), torch.randn(1, 77, 768)), f"{out}/unet.onnx",
                  input_names=["sample", "timestep", "emb"], output_names=["eps"],
                  dynamic_axes={"sample": {2: "lh", 3: "lw"}, "eps": {2: "lh", 3: "lw"}}, opset_version=17, dynamo=False)
print("ok")
