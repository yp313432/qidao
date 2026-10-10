#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
画通知用的小图标（`ic_stat_qidao`）与大图标（`ic_notif_large`）。

── 为什么单独一个脚本、不塞进 make-app-icon.py ────────────────────
那个脚本画的是桌面图标（八芒星那套，见它的文件头），这个是**通知栏图标**，
两件事的规矩完全不同，混在一起迟早互相覆盖：

  · 通知小图标必须**单色剪影**（纯白 + 透明）。安卓拿它当遮罩，只保留 alpha，
    再按系统规则染色 —— 所以塞彩色进去只会得到一块白疙瘩。
  · 通知小图标实际显示尺寸是 24dp，**细节全丢**：轨道线、光晕、星云这种
    在 App 图标里好看的东西，缩到 24 像素就是一团噪点。所以这里**重画**：
    只留「月牙 + 四角星」两个形，加粗，留出间隙（两个形粘在一起就是一个饼）。

── 产出 ────────────────────────────────────────────────────────
  android/app/src/main/res/drawable-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_stat_qidao.png
      小图标（24dp 基准：24/36/48/72/96 px），纯白 + 透明
  android/app/src/main/res/drawable-xxhdpi/ic_notif_large.png
      大图标（通知右边那张彩图）。用的是 App 图标本身，**不跟头像走** ——
      头像那条路走不通：Capacitor 的通知插件只认「res/drawable 里的资源名」，
      给文件路径它会解析成 0 → 大图标空着（`LocalNotification.resolveLargeIcon`）。
      而后台唤醒那条（background-runner 的 `Notifications.kt`）连大图标都没实现。

── 跑法 ───────────────────────────────────────────────────────
  python scripts/make-notification-icon.py            # 出正式资源
  python scripts/make-notification-icon.py --sheet    # 额外出对比/放大预览图
"""
import argparse
import math
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")
SHOTS = os.path.join(os.path.dirname(ROOT), "preview-shots")
APP_ICON = os.path.join(ROOT, "public", "icon-512.png")

# 通知栏小图标的各 dpi 尺寸（24dp 基准）
SMALL = {"mdpi": 24, "hdpi": 36, "xhdpi": 48, "xxhdpi": 72, "xxxhdpi": 96}
# 大图标：一张就够（通知里显示约 64dp，xxhdpi 下 3 倍 = 192px）
LARGE_DP = 64
LARGE_DPI = "xxhdpi"
LARGE_SCALE = 3

BOX = 108.0  # 画布逻辑尺寸（跟 dp 解耦，所有坐标按它写）
SS = 8  # 超采样倍数：先画大再缩回来，边缘才干净

# ── 候选造型 ──────────────────────────────────────────────────
# 每个候选 = (月牙, 四角星)。选中哪个由下面的 CHOSEN 决定，其余只留在 --sheet 里作对照。
#
# 月牙参数（外圆挖掉一个平移过的圆，剩下的就是月牙）：
#   r_out 外圆半径 / cx,cy 圆心 / cut_dx,cut_dy 挖洞圆的偏移 / thickness 最粗处厚度
#   ⚠️ thickness 别低于 16：13 的时候 24px 下只剩一根细括号，风一吹就断
# 星参数：cx,cy 星心（放在月牙缺口里，不碰月牙）/ r 半径 / power 尖度（3=星形线很瘦，
#   2=椭圆没尖）/ core 中心补圆的占比（纯尖角缩到 24px 会消失）
CANDIDATES = [
    (
        "A 现在的（星略小、偏上）",
        dict(r_out=36.0, cx=47.0, cy=57.0, cut_dx=15.0, cut_dy=-8.0, thickness=18.0),
        dict(cx=74.0, cy=41.0, r=15.0, power=2.6, core=0.22),
    ),
    (
        "B 星更大、整体更满（选中）",
        # cx,cy 已经把整体挪到"墨迹包围盒居中"（少了这一步，状态栏里会明显偏左）
        dict(r_out=37.0, cx=52.0, cy=54.0, cut_dx=15.0, cut_dy=-9.0, thickness=19.0),
        dict(cx=77.0, cy=41.0, r=17.0, power=2.6, core=0.24),
    ),
    (
        "C 月亮更圆、星更靠右上",
        dict(r_out=36.0, cx=46.0, cy=59.0, cut_dx=14.0, cut_dy=-7.0, thickness=20.0),
        dict(cx=73.0, cy=38.0, r=16.0, power=2.5, core=0.22),
    ),
]
CHOSEN = 1  # ← 选中的那个（写索引，改这里就是改造型）


def crescent_mask(px: int, c: dict) -> Image.Image:
    s = px / BOX
    r_out = c["r_out"]
    # 想要的最粗处厚度 → 反推挖洞圆的半径：最粗处 = r_out + d - r_cut，
    # d 是两圆心的距离（别只按 cut_dx 算，那样带竖直偏移时会算胖）
    d = math.hypot(c["cut_dx"], c["cut_dy"])
    r_cut = r_out + d - c["thickness"]
    cut_cx, cut_cy = c["cx"] + c["cut_dx"], c["cy"] + c["cut_dy"]

    layer = Image.new("L", (px, px), 0)
    dr = ImageDraw.Draw(layer)
    dr.ellipse(
        [
            (c["cx"] - r_out) * s,
            (c["cy"] - r_out) * s,
            (c["cx"] + r_out) * s,
            (c["cy"] + r_out) * s,
        ],
        fill=255,
    )
    dr.ellipse(
        [
            (cut_cx - r_cut) * s,
            (cut_cy - r_cut) * s,
            (cut_cx + r_cut) * s,
            (cut_cy + r_cut) * s,
        ],
        fill=0,
    )
    return layer


def star_mask(px: int, st: dict) -> Image.Image:
    """四角星（超椭圆 n<1 那一族，比星形线胖一点、比椭圆尖）。"""
    s = px / BOX
    layer = Image.new("L", (px, px), 0)
    dr = ImageDraw.Draw(layer)

    pts = []
    steps = 1440
    for i in range(steps):
        t = 2 * math.pi * i / steps
        ct, sn = math.cos(t), math.sin(t)
        x = st["r"] * math.copysign(abs(ct) ** st["power"], ct)
        y = st["r"] * math.copysign(abs(sn) ** st["power"], sn)
        pts.append(((st["cx"] + x) * s, (st["cy"] + y) * s))
    dr.polygon(pts, fill=255)

    # 中心补一点圆：真星光的芯有厚度，纯尖角缩到 24px 就没了
    r = st["r"] * st["core"]
    dr.ellipse(
        [
            (st["cx"] - r) * s,
            (st["cy"] - r) * s,
            (st["cx"] + r) * s,
            (st["cy"] + r) * s,
        ],
        fill=255,
    )
    return layer


def render(size: int, c: dict, st: dict) -> Image.Image:
    """白 + 透明的通知小图标。"""
    px = size * SS
    mask = Image.new("L", (px, px), 0)
    moon = crescent_mask(px, c)
    mask.paste(moon, (0, 0), moon)
    star = star_mask(px, st)
    mask.paste(star, (0, 0), star)
    mask = mask.resize((size, size), Image.LANCZOS)

    out = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    out.putalpha(mask)
    return out


def nearest(img: Image.Image, k: int) -> Image.Image:
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


def _font(size: int):
    for path in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def sheet() -> str:
    """预览：① 每个候选放大 + 24px 真实像素 ② 选中那个贴到假状态栏上。"""
    os.makedirs(SHOTS, exist_ok=True)
    dark, light = (27, 27, 31), (242, 242, 244)
    pad, gap = 32, 20
    cell = 132  # 放大格
    W = pad * 2 + 60 + cell * 3 + gap * 3
    H = pad + 60 + (cell + 52) * len(CANDIDATES) + 40 + 84 * 2 + pad
    img = Image.new("RGB", (W, H), (18, 18, 20))
    d = ImageDraw.Draw(img)
    f_title, f_small, f_label = _font(28), _font(18), _font(20)

    d.text((pad, pad), "栖岛通知小图标 ic_stat_qidao —— 纯白剪影（安卓只留 alpha 再染色）", font=f_title, fill=(240, 236, 232))
    y = pad + 52
    x0 = pad

    d.text((x0, y), "放大看造型", font=f_small, fill=(150, 148, 154))
    d.text((x0 + cell + gap, y), "24px 真实像素 ×6（深）", font=f_small, fill=(150, 148, 154))
    d.text((x0 + (cell + gap) * 2, y), "24px 真实像素 ×6（浅）", font=f_small, fill=(150, 148, 154))
    y += 30

    for name, c, st in CANDIDATES:
        icon96, icon24 = render(96, c, st), render(24, c, st)
        big, px6 = nearest(icon96, 1), nearest(icon24, 6)
        d.rectangle([x0, y, x0 + cell, y + cell], fill=dark)
        img.paste(big, (x0 + (cell - big.width) // 2, y + (cell - big.height) // 2), big)
        for i, bg in ((1, dark), (2, light)):
            cx = x0 + (cell + gap) * i
            d.rectangle([cx, y, cx + cell, y + cell], fill=bg)
            img.paste(px6, (cx + (cell - px6.width) // 2, y + (cell - px6.height) // 2), px6)
        d.text((x0 + cell + gap + 4, y + cell + 6), name, font=f_label, fill=(200, 196, 200))
        y += cell + 48

    # 贴到假状态栏上（真实尺寸，不放大）
    y += 8
    chosen_name, c, st = CANDIDATES[CHOSEN]
    for bg, fg in ((light, (40, 40, 44)), (dark, (240, 240, 240))):
        d.rectangle([pad, y, W - pad, y + 64], fill=bg)
        icon = render(24, c, st)
        img.paste(icon, (W - pad - 56, y + 20), icon)
        d.text((pad + 18, y + 20), "4G   12:30       状态栏里的真实大小（不放大）", font=f_label, fill=fg)
        y += 84
    d.text((pad, y - 12), f"当前选中：{chosen_name}（改脚本里的 CHOSEN）", font=f_small, fill=(150, 148, 154))

    out = os.path.join(SHOTS, "ic_stat_qidao-preview.png")
    img.save(out)
    return out


def mock() -> str:
    """模拟一张通知长什么样（2 倍放大）：状态栏的小图标 + 通知列表的大图标。

    为什么值得画：这两个图标只有装到手机上才看得到，而重打包一次要等一趟 CI。
    这里把「哪块是哪个」并在图上标出来，省一轮来回。
    """
    os.makedirs(SHOTS, exist_ok=True)
    S = 2  # 整体放大倍数
    W, H = 400 * S, 332 * S
    img = Image.new("RGB", (W, H), (12, 12, 15))
    d = ImageDraw.Draw(img)
    f_title, f_body, f_note, f_small = _font(17 * S), _font(13 * S), _font(11 * S), _font(12 * S)

    _, c, st = CANDIDATES[CHOSEN]
    small = render(24, c, st)

    # ② 通知卡片（深色通知栏）
    card = [12 * S, 44 * S, W - 12 * S, 190 * S]
    d.rounded_rectangle(card, radius=18 * S, fill=(38, 38, 43))
    large = Image.open(os.path.join(RES, f"drawable-{LARGE_DPI}", "ic_notif_large.png")).convert("RGBA")
    large = large.resize((48 * S, 48 * S), Image.LANCZOS)
    img.paste(large, (26 * S, 60 * S), large)
    d.text((86 * S, 58 * S), "栖岛", font=f_title, fill=(238, 238, 242))
    d.text((86 * S, 82 * S), "外面下雨了，记得带伞", font=f_body, fill=(198, 198, 206))
    d.text((86 * S, 104 * S), "他说了一句 · 刚刚", font=f_small, fill=(140, 140, 150))

    # ③ 右上角那个小图标（安卓 12+ 的通知里会再出现一次，系统按 alpha 染色）
    tint = Image.new("RGBA", small.size, (150, 130, 235, 255))
    tinted = Image.composite(tint, Image.new("RGBA", small.size, (0, 0, 0, 0)), small.getchannel("A"))
    tinted = tinted.resize((20 * S, 20 * S), Image.LANCZOS)
    img.paste(tinted, (W - 44 * S, 56 * S), tinted)

    # ① 状态栏（纯净模式下用户看不到它，这里只是把位置标出来）
    d.rectangle([0, 232 * S, W, 262 * S], fill=(24, 24, 28))
    d.text((16 * S, 239 * S), "12:30", font=f_body, fill=(200, 200, 208))
    sb = small.resize((24 * S, 24 * S), Image.LANCZOS)
    img.paste(sb, (W - 40 * S, 234 * S), sb)
    d.text((110 * S, 240 * S), "① 状态栏的小图标（你说开纯净模式看不到它）", font=f_note, fill=(150, 150, 160))

    d.text((16 * S, 12 * S), "② 通知列表：左边那张彩图 = 大图标（App 图标本身）", font=f_note, fill=(150, 150, 160))
    d.text((16 * S, 198 * S), "③ 右上角这个白形 = 小图标（同一张图，系统只取 alpha 再染色）", font=f_note, fill=(150, 150, 160))

    out = os.path.join(SHOTS, "notif-mock.png")
    img.save(out)
    return out


def build() -> None:
    if not os.path.isdir(RES):
        raise SystemExit("[notif-icon] 找不到安卓 res 目录")
    _, c, st = CANDIDATES[CHOSEN]
    for dpi, size in SMALL.items():
        d = os.path.join(RES, f"drawable-{dpi}")
        os.makedirs(d, exist_ok=True)
        render(size, c, st).save(os.path.join(d, "ic_stat_qidao.png"))
    print("[notif-icon] 小图标已铺到 drawable-* ×%d（纯白 + 透明，24dp 基准）" % len(SMALL))

    if not os.path.exists(APP_ICON):
        print("[notif-icon] 找不到 public/icon-512.png，跳过大图标")
        return
    d = os.path.join(RES, f"drawable-{LARGE_DPI}")
    os.makedirs(d, exist_ok=True)
    side = LARGE_DP * LARGE_SCALE
    app = Image.open(APP_ICON).convert("RGBA").resize((side, side), Image.LANCZOS)
    app.save(os.path.join(d, "ic_notif_large.png"))
    print(f"[notif-icon] 大图标 = App 图标（{side}px）→ drawable-{LARGE_DPI}/ic_notif_large.png")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", action="store_true", help="额外出一张对比预览图")
    ap.add_argument("--mock", action="store_true", help="额外出一张通知模拟图")
    args = ap.parse_args()
    build()
    if args.sheet:
        print("[notif-icon] 预览图：" + sheet())
    if args.mock:
        print("[notif-icon] 通知模拟图：" + mock())


if __name__ == "__main__":
    main()
