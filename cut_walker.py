"""把参考立绘的灰底抠成透明 PNG，裁到人物外框，输出 public/garden/walker.png。

参考图背景不是纯色（有从 180 到 205 的渐变），按"和角色同色"的容差抠不干净。
改用**判据 + 连通**：
  · 背景像素 = 低饱和（sat < .05）且够亮（luma > 162）；
  · 只有「与画布边缘连通」的背景才抠掉 —— 眼镜片/高光那种内部浅灰点不会被挖穿；
  · 边缘 alpha 模糊 0.8px 当抗锯齿，再缩到 600 高；
  · 鞋底以下那圈灰色投影（低饱和中灰）单独抹掉。
"""

from PIL import Image, ImageDraw, ImageFilter
import numpy as np

SRC = "walker-src.png"
OUT = "public/garden/walker.png"
OUT_H = 600

im = Image.open(SRC).convert("RGB")
w, h = im.size
rgb = np.array(im).astype(np.float32)

lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
mx = rgb.max(axis=2)
mn = rgb.min(axis=2)
sat = (mx - mn) / np.maximum(mx, 1)

bgpred = (sat < 0.05) & (lum > 162)
# 注意：Pillow 12 里 Image.fromarray 出来的图是 readonly 的，ImageDraw.floodfill 会**静默不动**
mask = Image.fromarray((bgpred * 255).astype(np.uint8), "L").copy()
for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
    ImageDraw.floodfill(mask, seed, 0, thresh=0)

after = np.array(mask)
outside = bgpred & (after == 0)
print("bg removed", int(outside.sum()), "enclosed kept", int((bgpred & ~outside).sum()))

alpha = np.where(outside, 0, 255).astype(np.uint8)

# 底部投影：中间 50% 宽度里最暗那一行 = 鞋底；往下抹掉低饱和中灰
mid = lum[:, int(w * 0.28) : int(w * 0.72)]
dark_rows = np.where((mid < 78).sum(axis=1) > w * 0.03)[0]
shoe_bottom = int(dark_rows.max()) if len(dark_rows) else h - 1
shadow = (sat < 0.13) & (lum > 60) & (lum < 190)
shadow[: shoe_bottom - 2, :] = False
alpha[shadow] = 0

# 边缘抗锯齿
alpha = np.array(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.8)))
alpha[alpha < 30] = 0

img = Image.fromarray(np.dstack([np.array(im), alpha]), "RGBA")

# 按「哪几列/行真的有实体」裁外框（阈值放宽是因为发丝很细）
a = np.array(img.getchannel("A")).astype(np.int32)
col = (a > 60).sum(axis=0)
row = (a > 60).sum(axis=1)
xs = np.where(col > 3)[0]
ys = np.where(row > 3)[0]
x0, x1 = int(xs.min()), int(xs.max()) + 1
y0, y1 = int(ys.min()), int(ys.max()) + 1
print("trim", (x0, y0, x1, y1), "shoe_bottom", shoe_bottom)
img = img.crop((x0, y0, x1, y1))

kw = int(round(OUT_H * img.width / img.height))
img = img.resize((kw, OUT_H), Image.LANCZOS)
img.save(OUT)
print("out", img.size, "ratio", round(img.width / img.height, 3))

# 预览：贴到花园底图的目标位置
base = Image.open("public/garden/base.jpg").convert("RGB").resize((780, 1688))
px, py = int(780 * 0.72), int(1688 * 0.70)
prev = base.copy()
sprite = img.resize((max(1, int(img.width * 300 / img.height)), 300), Image.LANCZOS)
prev.paste(sprite, (px - sprite.width // 2, py - sprite.height), sprite)
prev.crop((max(0, px - 300), max(0, py - 480), min(780, px + 300), min(1688, py + 80))).save("walker-preview.png")

onwhite = Image.new("RGB", img.size, (255, 255, 255))
onwhite.paste(img, (0, 0), img)
onwhite.save("walker-on-white.png")
print("preview ok")
