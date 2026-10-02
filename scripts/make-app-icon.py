#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
画栖岛的 App 图标与启动图。

样子照 App 自己的品牌来：深色玻璃底 + 暖陶土色的八芒星
（主色取自 src/styles.css 的 --aster-accent: #c17b5a / #d49274）。

产出（给 @capacitor/assets 用）：
  assets/icon.png             1024×1024  图标（有底，用于传统图标）
  assets/icon-foreground.png  1024×1024  前景（透明底，用于自适应图标）
  assets/icon-background.png  1024×1024  背景（深色渐变）
  assets/splash.png           2732×2732  启动图
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets")
os.makedirs(OUT, exist_ok=True)

BG_TOP = (13, 16, 21)
BG_BOT = (27, 36, 46)
ASTER = (214, 150, 118)
ASTER_HOT = (232, 178, 145)

SS = 4  # 超采样倍数，画完缩回去，边缘更干净


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size), BG_TOP)
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        d.line(
            [(0, y), (size, y)],
            fill=tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)),
        )
    return img


def aster(size: int, color) -> Image.Image:
    """八芒星：四根长轴 + 四根略短的斜轴，圆头。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cx = cy = size / 2
    long_len = size * 0.60
    diag_len = size * 0.46
    width = size * 0.072

    for i in range(8):
        angle = i * 45
        length = long_len if angle % 90 == 0 else diag_len
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        d.rounded_rectangle(
            [cx - width / 2, cy - length / 2, cx + width / 2, cy + length / 2],
            radius=width / 2,
            fill=color,
        )
        layer = layer.rotate(angle, resample=Image.BICUBIC, center=(cx, cy))
        img = Image.alpha_composite(img, layer)
    return img


def compose(size: int, with_bg: bool) -> Image.Image:
    big = size * SS
    base = gradient(big).convert("RGBA") if with_bg else Image.new("RGBA", (big, big), (0, 0, 0, 0))

    mark = aster(big, ASTER + (255,))
    # 柔光：把星模糊一层垫在下面
    glow = mark.filter(ImageFilter.GaussianBlur(big * 0.035))
    glow = glow.point(lambda v: int(v * 0.55))
    base = Image.alpha_composite(base, glow)
    # 中心一点高光
    hot = aster(int(big * 0.52), ASTER_HOT + (70,))
    hot = hot.resize((big, big), Image.BICUBIC)
    base = Image.alpha_composite(base, hot)
    base = Image.alpha_composite(base, mark)

    return base.resize((size, size), Image.LANCZOS)


def splash(size: int) -> Image.Image:
    img = gradient(size).convert("RGBA")
    mark_size = int(size * 0.30)
    mark = compose(mark_size, with_bg=False)
    img.alpha_composite(mark, (int((size - mark_size) / 2), int(size * 0.34)))

    text = "栖岛"
    font = None
    for path in (
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\msyhbd.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
    ):
        if os.path.exists(path):
            try:
                from PIL import ImageFont

                font = ImageFont.truetype(path, int(size * 0.075))
                break
            except Exception:
                continue
    if font:
        d = ImageDraw.Draw(img)
        box = d.textbbox((0, 0), text, font=font)
        w = box[2] - box[0]
        d.text(
            ((size - w) / 2 - box[0], size * 0.68),
            text,
            font=font,
            fill=(238, 226, 216, 235),
        )
    return img.convert("RGB")


def android_assets() -> None:
    """直接铺到安卓工程的各分辨率目录。

    为什么自己写而不用 @capacitor/assets：那个工具依赖 sharp（原生模块），
    在这台机器上因为 npm 的安装脚本策略装不上。Pillow 已经画好了，
    按官方要求的尺寸逐个缩放反而更可控。
    """
    res = os.path.join(ROOT, "android", "app", "src", "main", "res")
    if not os.path.isdir(res):
        print("[icon] 找不到安卓 res 目录，跳过")
        return

    # 传统图标 + 圆形图标：尺寸按官方 mipmap 规范
    launcher = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    # 自适应图标的前景：108dp 基准（内容只占中间约 2/3，外面会被裁）
    foreground = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
    # 启动图：照工程里原有的尺寸做，方向与分辨率一一对应
    splash_port = {"mdpi": (320, 480), "hdpi": (480, 800), "xhdpi": (720, 1280), "xxhdpi": (960, 1600), "xxxhdpi": (1280, 1920)}
    splash_land = {"mdpi": (480, 320), "hdpi": (800, 480), "xhdpi": (1280, 720), "xxhdpi": (1600, 960), "xxxhdpi": (1920, 1280)}

    icon_master = compose(1024, with_bg=True).convert("RGB")

    for dpi, size in launcher.items():
        d = os.path.join(res, f"mipmap-{dpi}")
        os.makedirs(d, exist_ok=True)
        big = icon_master.resize((size * 4, size * 4), Image.LANCZOS)
        # 圆形版：裁成圆
        mask = Image.new("L", (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
        round_img = Image.new("RGBA", (size * 4, size * 4), (0, 0, 0, 0))
        round_img.paste(big.convert("RGBA"), (0, 0), mask)
        big.resize((size, size), Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"))
        round_img.resize((size, size), Image.LANCZOS).save(os.path.join(d, "ic_launcher_round.png"))

    for dpi, size in foreground.items():
        d = os.path.join(res, f"mipmap-{dpi}")
        os.makedirs(d, exist_ok=True)
        # 前景只占中间 ~66%：自适应图标外面一圈会被系统裁掉
        mark = compose(int(size * 0.66), with_bg=False)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        off = (size - mark.size[0]) // 2
        canvas.alpha_composite(mark, (off, off))
        canvas.save(os.path.join(d, "ic_launcher_foreground.png"))

    for dpi, (w, h) in splash_port.items():
        d = os.path.join(res, f"drawable-port-{dpi}")
        os.makedirs(d, exist_ok=True)
        splash_for(w, h).save(os.path.join(d, "splash.png"))
    for dpi, (w, h) in splash_land.items():
        d = os.path.join(res, f"drawable-land-{dpi}")
        os.makedirs(d, exist_ok=True)
        splash_for(w, h).save(os.path.join(d, "splash.png"))
    # 兜底目录（工程里原本就有一张）
    splash_for(480, 320).save(os.path.join(res, "drawable", "splash.png"))

    print("[icon] 已铺到安卓工程：")
    print("  图标      mipmap-* ×5（含圆形与自适应前景）")
    print("  启动图    drawable-port-* / drawable-land-* / drawable")


def splash_for(w: int, h: int) -> Image.Image:
    """按目标尺寸画一张启动图（星居中，大小随短边走，横竖都不难看）。"""
    img = gradient(max(w, h)).convert("RGBA")
    img = img.resize((w, h), Image.LANCZOS)
    mark_size = int(min(w, h) * 0.38)
    mark = compose(mark_size, with_bg=False)
    img.alpha_composite(mark, ((w - mark_size) // 2, (h - mark_size) // 2))
    return img.convert("RGB")


def main() -> None:
    compose(1024, with_bg=True).convert("RGB").save(os.path.join(OUT, "icon.png"))
    compose(1024, with_bg=False).save(os.path.join(OUT, "icon-foreground.png"))
    gradient(1024).save(os.path.join(OUT, "icon-background.png"))
    splash(2732).save(os.path.join(OUT, "splash.png"))
    print("[icon] 已生成：")
    for name in ("icon.png", "icon-foreground.png", "icon-background.png", "splash.png"):
        p = os.path.join(OUT, name)
        print(f"  {name}  {os.path.getsize(p) // 1024} KB")
    android_assets()


if __name__ == "__main__":
    main()
