#!/usr/bin/env python3
"""Template inspector for native PDF forms (developer tool).

Prints every dotted fill-in line (merged across right-to-left text runs),
checkbox bullets ("o"), form widgets and images, so slot rectangles for a new
template definition can be written quickly:

    python3 scripts/templates/inspect_pdf.py "reference-documents/<file>.pdf"
"""
from __future__ import annotations

import sys

import pymupdf as fitz


def dotted_lines(page: "fitz.Page", min_width: float = 15.0):
    dots = []
    for b in page.get_text("rawdict")["blocks"]:
        for line in b.get("lines", []):
            for span in line["spans"]:
                for c in span["chars"]:
                    if c["c"] in ".…":
                        x0, y0, x1, y1 = c["bbox"]
                        dots.append([x0, y0, x1, y1, c["origin"][1]])
    dots.sort(key=lambda t: t[4])
    groups: list[list] = []
    for t in dots:
        if groups and abs(groups[-1][-1][4] - t[4]) < 2.0:
            groups[-1].append(t)
        else:
            groups.append([t])
    segs = []
    for g in groups:
        g.sort(key=lambda t: t[0])
        cur = None
        for t in g:
            if cur and t[0] - cur[2] < 6:
                cur[2] = max(cur[2], t[2]); cur[1] = min(cur[1], t[1]); cur[3] = max(cur[3], t[3])
            else:
                if cur:
                    segs.append(cur)
                cur = list(t)
        if cur:
            segs.append(cur)
    return [s for s in segs if s[2] - s[0] >= min_width]


def bullets(page: "fitz.Page"):
    out = []
    for b in page.get_text("rawdict")["blocks"]:
        for line in b.get("lines", []):
            for span in line["spans"]:
                text = "".join(c["c"] for c in span["chars"])
                if text.strip() == "o" or text.startswith("o "):
                    c = next(ch for ch in span["chars"] if ch["c"] == "o")
                    out.append(((c["bbox"][0] + c["bbox"][2]) / 2, c["origin"][1], span["font"]))
    return out


def main(path: str):
    doc = fitz.open(path)
    for page in doc:
        print(f"=== page {page.number} {page.rect}")
        for s in dotted_lines(page):
            print(f"  dots base={s[4]:6.1f}  x {s[0]:6.1f} -> {s[2]:6.1f}  top {s[1]:.1f} bot {s[3]:.1f}")
        for cx, base, font in bullets(page):
            print(f"  bullet cx={cx:6.1f} base={base:6.1f} {font}")
        for w in page.widgets() or []:
            print(f"  widget {w.field_name!r} {w.field_type_string} {[round(v, 1) for v in w.rect]}")
        for info in page.get_image_info(xrefs=True):
            print(f"  image xref={info['xref']} bbox={[round(v) for v in info['bbox']]} {info['width']}x{info['height']}")


if __name__ == "__main__":
    main(sys.argv[1])
