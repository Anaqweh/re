"""Regenerate INEXC logo PNGs from the official brand lockup (white on navy)."""
from PIL import Image, ImageChops
import os

ROOT = os.path.join(os.path.dirname(__file__), '..')
ASSETS = os.path.join(ROOT, 'assets')
IMAGES = os.path.join(ASSETS, 'images')

SRC = os.path.join(ASSETS, 'inexc-logo-official-source.png')
OUT_MAIN = os.path.join(ASSETS, 'inexc-logo-white.png')
OUT_MAIN_ALT = os.path.join(ASSETS, 'inexc-logo.png')
OUT_IMAGES = os.path.join(IMAGES, 'inexc-logo-white.png')
OUT_SM = os.path.join(ASSETS, 'inexc-logo-white-sm.png')
OUT_SM_ALT = os.path.join(ASSETS, 'inexc-logo-sm.png')
OUT_ICON = os.path.join(ASSETS, 'inexc-icon.png')


def remove_navy_background(im: Image.Image, tolerance: int = 42) -> Image.Image:
    """Make dark navy background pixels fully transparent; keep white logo."""
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size

    samples = [
        im.getpixel((0, 0)),
        im.getpixel((w - 1, 0)),
        im.getpixel((0, h - 1)),
        im.getpixel((w - 1, h - 1)),
        im.getpixel((w // 2, 0)),
    ]
    bg_r = sum(s[0] for s in samples) // len(samples)
    bg_g = sum(s[1] for s in samples) // len(samples)
    bg_b = sum(s[2] for s in samples) // len(samples)

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            dist = abs(r - bg_r) + abs(g - bg_g) + abs(b - bg_b)
            if dist <= tolerance:
                px[x, y] = (0, 0, 0, 0)
            elif r > 210 and g > 210 and b > 210:
                px[x, y] = (255, 255, 255, a)

    return im


def trim(im: Image.Image) -> Image.Image:
    bg = Image.new('RGBA', im.size, (0, 0, 0, 0))
    diff = ImageChops.difference(im.convert('RGBA'), bg)
    bbox = diff.getbbox()
    return im.crop(bbox) if bbox else im


def upscale_if_small(im: Image.Image, min_width: int = 1260) -> Image.Image:
    if im.width >= min_width:
        return im
    scale = min_width / im.width
    return im.resize(
        (int(im.width * scale), int(im.height * scale)),
        Image.Resampling.LANCZOS,
    )


def crop_icon(im: Image.Image) -> Image.Image:
    w, h = im.size
    icon = im.crop((0, 0, int(w * 0.30), h))
    icon = trim(icon)
    side = max(icon.width, icon.height)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    ox = (side - icon.width) // 2
    oy = (side - icon.height) // 2
    canvas.paste(icon, (ox, oy), icon)
    return canvas.resize((256, 256), Image.Resampling.LANCZOS)


def main():
    os.makedirs(IMAGES, exist_ok=True)
    im = Image.open(SRC).convert('RGBA')
    im = remove_navy_background(im)
    full = upscale_if_small(trim(im))
    sm = full.resize((630, int(630 * full.height / full.width)), Image.Resampling.LANCZOS)
    icon = crop_icon(full)

    full.save(OUT_MAIN, format='PNG', optimize=True)
    full.save(OUT_MAIN_ALT, format='PNG', optimize=True)
    full.save(OUT_IMAGES, format='PNG', optimize=True)
    sm.save(OUT_SM, format='PNG', optimize=True)
    sm.save(OUT_SM_ALT, format='PNG', optimize=True)
    icon.save(OUT_ICON, format='PNG', optimize=True)
    print('official logo preserved:', full.size)
    print('wrote:', OUT_MAIN)
    print('wrote:', OUT_IMAGES)
    print('icon:', icon.size)


if __name__ == '__main__':
    main()
