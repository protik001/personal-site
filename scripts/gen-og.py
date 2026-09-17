#!/usr/bin/env python3
"""Generate OG card PNGs for any essay missing one. Run from site root:
   python3 scripts/gen-og.py            (needs: pip install pillow)
Reads site-data.json; writes images/og/<slug>.png for missing/changed titles."""
import json, textwrap, os
from PIL import Image, ImageDraw, ImageFont

SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
# macOS fallbacks
if not os.path.exists(SERIF):
    SERIF = "/System/Library/Fonts/Supplemental/Georgia.ttf"
    SANS = "/System/Library/Fonts/Supplemental/Arial.ttf"
BG, TXT, MUT, ACC = "#fafaf8", "#111111", "#8a8a8a", "#2a7d6e"

def make(slug, title, label):
    img = Image.new("RGB", (1200, 630), BG); d = ImageDraw.Draw(img)
    d.ellipse([80, 84, 96, 100], fill=ACC)
    d.text((114, 78), "Protik Roychowdhury", font=ImageFont.truetype(SANS, 26), fill=TXT)
    size = 72
    while size > 40:
        f = ImageFont.truetype(SERIF, size)
        lines = textwrap.wrap(title, width=int(1040 / (size * 0.52)))
        if len(lines) <= 3: break
        size -= 6
    y = 200
    for ln in lines:
        d.text((80, y), ln, font=f, fill=TXT); y += int(size * 1.25)
    d.line([80, 510, 1120, 510], fill="#e5e5e0", width=2)
    d.text((80, 540), label.upper(), font=ImageFont.truetype(SANS, 22), fill=MUT)
    sf = ImageFont.truetype(SANS, 24)
    d.text((1200 - 80 - d.textlength("protik.info", font=sf), 538), "protik.info", font=sf, fill=ACC)
    os.makedirs("images/og", exist_ok=True)
    img.save(f"images/og/{slug}.png", optimize=True)
    print("generated:", slug)

data = json.load(open("site-data.json"))
for e in data["essays"]:
    if not os.path.exists(f"images/og/{e['slug']}.png"):
        make(e["slug"], e["title"], e["pillarLabel"])
print("done")
