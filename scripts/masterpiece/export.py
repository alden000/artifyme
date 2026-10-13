# Export SDXS-512-DreamShaper (UNet + tiny VAE) to ONNX (fp32) for the web.
import torch, os, sys
from diffusers import UNet2DConditionModel, AutoencoderTiny
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
repo = "IDKiro/sdxs-512-dreamshaper"
torch.set_grad_enabled(False)

vae = AutoencoderTiny.from_pretrained(repo, subfolder="vae").eval()
class Enc(torch.nn.Module):
    def __init__(s, v): super().__init__(); s.v = v
    def forward(s, img):  # img in [-1,1], NCHW
        return s.v.encode(img).latents
class Dec(torch.nn.Module):
    def __init__(s, v): super().__init__(); s.v = v
    def forward(s, lat):
        return s.v.decode(lat).sample  # [-1,1]
H = W = 512
torch.onnx.export(Enc(vae), (torch.randn(1, 3, H, W),), f"{out}/vae_encoder.onnx", input_names=["image"], output_names=["latent"],
                  dynamic_axes={"image": {2: "h", 3: "w"}, "latent": {2: "lh", 3: "lw"}}, opset_version=17, dynamo=False)
torch.onnx.export(Dec(vae), (torch.randn(1, 4, H // 8, W // 8),), f"{out}/vae_decoder.onnx", input_names=["latent"], output_names=["image"],
                  dynamic_axes={"latent": {2: "lh", 3: "lw"}, "image": {2: "h", 3: "w"}}, opset_version=17, dynamo=False)
print("vae ok")

unet = UNet2DConditionModel.from_pretrained(repo, subfolder="unet").eval()
class U(torch.nn.Module):
    def __init__(s, u): super().__init__(); s.u = u
    def forward(s, sample, timestep, emb):
        return s.u(sample, timestep, encoder_hidden_states=emb, return_dict=False)[0]
torch.onnx.export(U(unet), (torch.randn(1, 4, 64, 64), torch.tensor([999], dtype=torch.int64), torch.randn(1, 77, 768)),
                  f"{out}/unet.onnx", input_names=["sample", "timestep", "emb"], output_names=["eps"],
                  dynamic_axes={"sample": {2: "lh", 3: "lw"}, "eps": {2: "lh", 3: "lw"}}, opset_version=17, dynamo=False)
print("unet ok")
