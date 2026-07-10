#!/usr/bin/env python3
"""
design_extractor.py  —  lightweight visual analysis of a reference screenshot.

Deliberately depends ONLY on Pillow + numpy (no OpenCV / no tesseract) so it stays
small and reliable to deploy. It extracts the two things classical CV does well:

  • palette : the dominant colours, role-tagged (bg / text / accent / muted)
  • regions : horizontal content bands (navbar / hero / body sections / footer)

Semantics (what each band *is*, and the text copy) are left to the LLM step in
referenceController.js — that division is what makes the pipeline both accurate
and cheap to run.

Usage:   python design_extractor.py <image_path>
Output:  a single JSON object on stdout. On failure: {"error": "..."} (exit 0).
"""

import sys
import json

def fail(msg):
    sys.stdout.write(json.dumps({"error": str(msg)}))
    sys.exit(0)

try:
    import numpy as np
    from PIL import Image
except Exception as e:  # pragma: no cover
    fail("Missing Python deps (need pillow, numpy): %s" % e)


MAX_W = 1000  # downscale width for speed; positions are reported as fractions


def lum(rgb):
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def sat(rgb):
    r, g, b = [c / 255.0 for c in rgb]
    mx, mn = max(r, g, b), min(r, g, b)
    return 0.0 if mx == 0 else (mx - mn) / mx


def hexof(rgb):
    return "#%02x%02x%02x" % (int(rgb[0]), int(rgb[1]), int(rgb[2]))


def load(path):
    im = Image.open(path).convert("RGB")
    if im.width > MAX_W:
        im = im.resize((MAX_W, max(1, int(im.height * MAX_W / im.width))))
    return im


def extract_palette(im):
    # Quantize to a small palette, then count area share of each colour.
    q = im.quantize(colors=8, method=Image.MEDIANCUT).convert("RGB")
    arr = np.asarray(q).reshape(-1, 3)
    colors, counts = np.unique(arr, axis=0, return_counts=True)
    order = np.argsort(-counts)
    pal = [(tuple(int(c) for c in colors[i]), int(counts[i])) for i in order]
    total = float(arr.shape[0]) or 1.0

    bg = pal[0][0]
    bg_lum = lum(bg)
    dark = bg_lum < 128

    # text = the frequent colour with the most contrast against the background.
    text = max(pal[:6], key=lambda kv: abs(lum(kv[0]) - bg_lum))[0]

    # accent = the most saturated colour that still occupies a real area and is
    # clearly different from bg/text.
    def distinct(c):
        return abs(lum(c) - bg_lum) > 12 and c != text
    cand = [kv for kv in pal if (kv[1] / total) > 0.003 and distinct(kv[0])]
    accent = max(cand, key=lambda kv: sat(kv[0]))[0] if cand else (99, 102, 241)
    if sat(accent) < 0.18:  # nothing colourful found → sensible default
        accent = (99, 102, 241)

    # muted = a mid-luminance colour for secondary text.
    mids = sorted(pal[:6], key=lambda kv: abs(lum(kv[0]) - 128))
    muted = mids[0][0] if mids else (148, 163, 184)

    return {
        "bg": hexof(bg),
        "text": hexof(text),
        "accent": hexof(accent),
        "muted": hexof(muted),
        "dark": bool(dark),
        "swatches": [hexof(c) for c, _ in pal[:6]],
    }


def extract_regions(im):
    g = np.asarray(im.convert("L"), dtype=np.float32)
    rgb = np.asarray(im, dtype=np.float32)
    h = g.shape[0]
    row_std = g.std(axis=1)  # rows with text/images vary a lot; flat bg ~ 0

    thr = max(6.0, float(row_std.mean()) * 0.45)
    content = row_std > thr

    # Merge content rows into bands, bridging small (<2%) gaps.
    bands = []
    gap_tol = max(4, int(h * 0.02))
    i = 0
    n = h
    while i < n:
        if not content[i]:
            i += 1
            continue
        start = i
        gap = 0
        while i < n and (content[i] or gap < gap_tol):
            if content[i]:
                gap = 0
            else:
                gap += 1
            i += 1
        end = min(i, n)
        if end - start < max(8, int(h * 0.012)):  # ignore tiny slivers
            continue
        seg = rgb[start:end]
        mean_color = seg.reshape(-1, 3).mean(axis=0)
        density = float(row_std[start:end].mean())
        bands.append({
            "yFrac": round(start / h, 4),
            "hFrac": round((end - start) / h, 4),
            "meanColor": hexof(mean_color),
            "meanLum": round(float(lum(mean_color)), 1),
            "density": round(density, 1),
        })

    # Normalise density to 0..1 for the LLM.
    if bands:
        dmax = max(b["density"] for b in bands) or 1.0
        for b in bands:
            b["density"] = round(b["density"] / dmax, 3)

    return bands[:14]


def main():
    if len(sys.argv) < 2:
        fail("No image path provided.")
    try:
        im = load(sys.argv[1])
    except Exception as e:
        fail("Could not open image: %s" % e)

    try:
        out = {
            "meta": {"width": im.width, "height": im.height},
            "palette": extract_palette(im),
            "regions": extract_regions(im),
        }
    except Exception as e:
        fail("Analysis failed: %s" % e)

    # Save a small JPEG copy for the Node vision step (keeps the base64 payload
    # well under Groq's image limit). Best-effort — analysis still works without it.
    try:
        resized = sys.argv[1] + ".vz.jpg"
        im.save(resized, "JPEG", quality=82)
        out["resized"] = resized
    except Exception:
        pass

    sys.stdout.buffer.write(json.dumps(out, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    main()
