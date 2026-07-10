#!/usr/bin/env python3
"""
image_cropper.py — slice real image regions out of an uploaded screenshot.

Used by the "Design from Reference" freeform pipeline: the vision model returns
bounding boxes for the images it sees (hero photo, logos, cards…); we crop those
exact pixels from the user's upload so the rebuilt page actually looks like the
original. Crops are returned as base64 data URLs so they persist in MongoDB with
the site (no file storage needed) and survive save/reload/deploy.

Usage:
    python image_cropper.py <image_path>
    stdin  = JSON list: [{"id":"el_1","fx":0.5,"fy":0.1,"fw":0.4,"fh":0.6}, ...]
             (fx/fy/fw/fh are fractions 0..1 of the image width/height)
    stdout = JSON object: {"el_1":"data:image/jpeg;base64,...", ...}
On any failure prints {} so the caller falls back to stock images. Exit 0.
"""

import sys
import json
import base64
import io

def emit(obj):
    sys.stdout.write(json.dumps(obj))
    sys.exit(0)

try:
    from PIL import Image
except Exception:
    emit({})

MAX_W = 900       # downscale crops so the base64 stays small
QUALITY = 72


def clamp01(v):
    try:
        v = float(v)
    except Exception:
        return 0.0
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def main():
    if len(sys.argv) < 2:
        emit({})
    try:
        im = Image.open(sys.argv[1]).convert("RGB")
    except Exception:
        emit({})

    raw = sys.stdin.read()
    try:
        boxes = json.loads(raw) if raw.strip() else []
    except Exception:
        boxes = []
    if not isinstance(boxes, list):
        emit({})

    W, H = im.width, im.height
    out = {}
    for b in boxes[:8]:  # safety cap
        try:
            bid = str(b.get("id"))
            fx, fy = clamp01(b.get("fx")), clamp01(b.get("fy"))
            fw, fh = clamp01(b.get("fw")), clamp01(b.get("fh"))
            if fw <= 0.01 or fh <= 0.01:
                continue
            left, top = int(fx * W), int(fy * H)
            right = min(W, int((fx + fw) * W))
            bottom = min(H, int((fy + fh) * H))
            if right - left < 8 or bottom - top < 8:
                continue
            crop = im.crop((left, top, right, bottom))
            if crop.width > MAX_W:
                crop = crop.resize((MAX_W, max(1, int(crop.height * MAX_W / crop.width))))
            buf = io.BytesIO()
            crop.save(buf, "JPEG", quality=QUALITY)
            data = base64.b64encode(buf.getvalue()).decode("ascii")
            out[bid] = "data:image/jpeg;base64," + data
        except Exception:
            continue

    emit(out)


if __name__ == "__main__":
    main()
