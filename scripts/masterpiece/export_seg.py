# DeepLabV3-MobileNetV3 (torchvision, BSD-3, COCO/VOC labels) -> ONNX returning one
# "subject" probability map (person + dog + cat). Input: [1,3,H,W] RGB in [0,1].
import torch, sys
from torchvision.models.segmentation import deeplabv3_mobilenet_v3_large, DeepLabV3_MobileNet_V3_Large_Weights
m = deeplabv3_mobilenet_v3_large(weights=DeepLabV3_MobileNet_V3_Large_Weights.DEFAULT).eval()
class S(torch.nn.Module):
    def __init__(s): super().__init__(); s.m = m; s.register_buffer("mu", torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)); s.register_buffer("sd", torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))
    def forward(s, image):
        p = s.m((image - s.mu) / s.sd)["out"].softmax(1)
        return p[:, 15:16] + p[:, 12:13] + p[:, 8:9]
torch.onnx.export(S(), (torch.rand(1, 3, 512, 384),), sys.argv[1], input_names=["image"], output_names=["mask"],
                  dynamic_axes={"image": {2: "h", 3: "w"}, "mask": {2: "h", 3: "w"}}, opset_version=17, dynamo=False)
print("ok")
