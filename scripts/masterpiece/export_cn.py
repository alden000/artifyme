# Export UNet + sketch ControlNet as one ONNX graph:
#   (sample[1,4,h,w], timestep[1] int64, emb[1,77,768], cond[1,3,8h,8w] in [0,1], cscale[1]) -> eps
import torch, sys, os
from diffusers import UNet2DConditionModel, ControlNetModel
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
torch.set_grad_enabled(False)
unet = UNet2DConditionModel.from_pretrained("IDKiro/sdxs-512-dreamshaper", subfolder="unet", torch_dtype=torch.float32).eval()
cn = ControlNetModel.from_pretrained("IDKiro/sdxs-512-dreamshaper-sketch", torch_dtype=torch.float32).float().eval()
class M(torch.nn.Module):
    def __init__(s): super().__init__(); s.u = unet; s.c = cn
    def forward(s, sample, timestep, emb, cond, cscale):
        down, mid = s.c(sample, timestep, encoder_hidden_states=emb, controlnet_cond=cond, conditioning_scale=1.0, return_dict=False)
        down = [d * cscale for d in down]; mid = mid * cscale
        return s.u(sample, timestep, encoder_hidden_states=emb, down_block_additional_residuals=down, mid_block_additional_residual=mid, return_dict=False)[0]
args = (torch.randn(1, 4, 64, 48), torch.tensor([999], dtype=torch.int64), torch.randn(1, 77, 768), torch.rand(1, 3, 512, 384), torch.tensor([0.8]))
torch.onnx.export(M(), args, f"{out}/unet_cn.onnx", input_names=["sample", "timestep", "emb", "cond", "cscale"], output_names=["eps"],
                  dynamic_axes={"sample": {2: "lh", 3: "lw"}, "cond": {2: "h", 3: "w"}, "eps": {2: "lh", 3: "lw"}}, opset_version=17, dynamo=False)
print("ok")
