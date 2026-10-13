import numpy as np
from PIL import Image, ImageFilter
def xdog(img, sigma=1.3, k=1.6, p=20.0, eps=0.02, phi=60.0):
    g = np.asarray(img.convert("L"), dtype=np.float32) / 255
    # Local contrast normalisation so dark/low-contrast subjects still yield lines.
    mu = np.asarray(Image.fromarray((g*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(24)), dtype=np.float32)/255
    sd = np.sqrt(np.asarray(Image.fromarray((np.clip((g-mu)**2*4,0,1)*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(24)), dtype=np.float32)/255/4)
    g = np.clip(0.5 + (g - mu) / (4*sd + 0.04) * 0.5, 0, 1)
    def blur(s): return np.asarray(Image.fromarray((g*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(s)), dtype=np.float32)/255
    a, b = blur(sigma), blur(sigma*k)
    d = (1+p)*a - p*b
    e = np.where(d >= eps, 1.0, 1.0 + np.tanh(phi*(d-eps)))
    e = np.clip(e, 0, 1)
    e = np.asarray(Image.fromarray((e*255).astype(np.uint8)).filter(ImageFilter.MedianFilter(3)), dtype=np.float32)/255
    return e  # 1 = paper, 0 = ink


def lines(img):
    return xdog(img)  # 1 = paper, 0 = ink
