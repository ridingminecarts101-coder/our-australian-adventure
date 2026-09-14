# -*- coding: utf-8 -*-
"""Launcher icons and splash screens for both native shells.

@capacitor/assets is the usual tool for this and it needs sharp, which has no
prebuilt binary for Node 24 and so wants a C++ toolchain. Pillow does the same
work in about a hundred lines and needs nothing, so this is that.

Everything comes from icons/icon-512.png - the Southern Cross on a rust
gradient - so there is one source of truth and the web icons, the Android
launcher and the iOS app icon cannot drift apart.

Adaptive icons are the fiddly part. Android draws a 108dp square and then
crops it to whatever shape the launcher wants, guaranteeing only the middle
72dp survives. So the foreground layer is the stars alone, keyed out of the
gradient by brightness, scaled to sit inside that safe circle, on a
transparent field; the rust becomes a flat background colour underneath.
Handing Android the flat 512 would get the corners of the artwork shaved off.
"""
import io, os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = Image.open(os.path.join(ROOT, 'icons', 'icon-512.png')).convert('RGBA')

RUST = (140, 61, 31)          # #8c3d1f - the brand rust, also the splash ground
CREAM = (246, 239, 230)       # #f6efe6


def out(*parts):
    p = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def square(img, size):
    return img.resize((size, size), Image.LANCZOS)


def rounded(img, size):
    """Circular crop, for launchers that ask for ic_launcher_round."""
    im = square(img, size)
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    im.putalpha(mask.resize((size, size), Image.LANCZOS))
    return im


def rounded_square(img, size):
    """Legacy launcher icon with a small transparent margin and soft corners."""
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    margin = max(1, round(size * 0.04))
    art_size = size - 2 * margin
    art = square(img, art_size)
    mask = Image.new('L', (art_size * 4, art_size * 4), 0)
    radius = round(art_size * 0.20 * 4)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, art_size * 4 - 1, art_size * 4 - 1), radius=radius, fill=255)
    art.putalpha(mask.resize((art_size, art_size), Image.LANCZOS))
    canvas.paste(art, (margin, margin), art)
    return canvas


def stars_only(img):
    """Key the cream artwork out of the gradient by brightness.

    The stars are near-white and the background never rises above mid rust, so
    a luminance threshold separates them cleanly. The ramp rather than a hard
    cut keeps the anti-aliased edges of the star points from turning jagged.
    """
    px = img.convert('RGB').load()
    w, h = img.size
    a = Image.new('L', (w, h))
    ap = a.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            ap[x, y] = 0 if lum < 150 else (255 if lum > 200 else int((lum - 150) * 5.1))
    fg = Image.new('RGBA', (w, h), CREAM + (0,))
    fg.putalpha(a)
    return fg


stars = stars_only(SRC)


def inset(layer_size, frac):
    """The stars centred on a transparent square, at frac of its width."""
    layer = Image.new('RGBA', (layer_size, layer_size), (0, 0, 0, 0))
    art = max(1, int(layer_size * frac))
    s = square(stars, art)
    layer.paste(s, ((layer_size - art) // 2, (layer_size - art) // 2), s)
    return layer


# -- Android launcher -------------------------------------------------
MIPMAP = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
FOREGROUND = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}

for dpi, size in MIPMAP.items():
    d = ('android', 'app', 'src', 'main', 'res', 'mipmap-' + dpi)
    rounded_square(SRC, size).save(out(*d, 'ic_launcher.png'))
    rounded(SRC, size).save(out(*d, 'ic_launcher_round.png'))
    # 108dp canvas, artwork at 60% of it so nothing important leaves the
    # 72dp safe circle no matter how aggressively the launcher masks.
    inset(FOREGROUND[dpi], 0.60).save(out(*d, 'ic_launcher_foreground.png'))

with io.open(out('android', 'app', 'src', 'main', 'res', 'values',
                 'ic_launcher_background.xml'), 'w', encoding='utf-8', newline='\n') as fh:
    fh.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
             '    <color name="ic_launcher_background">#8c3d1f</color>\n</resources>\n')

# The status bar notification icon, which Android draws as a silhouette:
# only the alpha channel survives, so a white-on-transparent glyph is the
# only thing that renders as intended.
for dpi, size in {'mdpi': 24, 'hdpi': 36, 'xhdpi': 48,
                  'xxhdpi': 72, 'xxxhdpi': 96}.items():
    alpha = inset(size, 0.85).getchannel('A')
    mono = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    mono.putalpha(alpha)
    mono.save(out('android', 'app', 'src', 'main', 'res',
                  'drawable-' + dpi, 'ic_stat_icon.png'))


# -- Splash -----------------------------------------------------------
#
# One square image, centred and cropped by Android whatever the orientation.
# The logo is kept small: a splash that fills the screen looks like a mistake
# when it is replaced a third of a second later by the map.
def splash(size, logo_frac=0.28):
    im = Image.new('RGBA', (size, size), RUST + (255,))
    art = int(size * logo_frac)
    s = square(stars, art)
    im.paste(s, ((size - art) // 2, (size - art) // 2), s)
    return im.convert('RGB')


SPLASH_DPI = {'mdpi': 480, 'hdpi': 720, 'xhdpi': 960, 'xxhdpi': 1440, 'xxxhdpi': 1920}
for dpi, size in SPLASH_DPI.items():
    splash(size).save(out('android', 'app', 'src', 'main', 'res',
                          'drawable-' + dpi, 'splash.png'))

# Android 12 draws its own splash from the same adaptive foreground used by
# the launcher, referenced directly from styles.xml. Avoid a byte-identical
# second resource so the two can never drift.

# -- iOS --------------------------------------------------------------
#
# Xcode 14 and later take a single 1024 icon and derive the rest. It must be
# fully opaque with no alpha channel at all or App Store Connect rejects the
# build on upload, which is a slow way to find that out.
icon = Image.new('RGB', (1024, 1024), RUST)
icon.paste(square(SRC, 1024), (0, 0), square(SRC, 1024))
icon.save(out('ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset',
              'AppIcon-512@2x.png'))

for name in ('splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'):
    splash(2732).save(out('ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset', name))

# -- Web --------------------------------------------------------------
#
# Regenerated from the same source so the installed PWA and the store builds
# are the same picture.
square(SRC, 192).save(out('icons', 'icon-192.png'))
square(SRC, 180).save(out('icons', 'icon-180.png'))

# Maskable needs the artwork inside the 80% safe zone, same reasoning as the
# adaptive foreground.
maskable = Image.new('RGB', (512, 512), RUST)
art = square(SRC, 410)
maskable.paste(art, (51, 51), art)
maskable.save(out('icons', 'icon-512-maskable.png'))

print('icons and splashes built for android, ios and web')
