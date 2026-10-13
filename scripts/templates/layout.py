"""Slot geometry detection for converted templates.

Coordinates are PDF points with a TOP-LEFT origin (PyMuPDF convention);
the TypeScript engine converts them to pdf-lib's bottom-left origin.
"""
from __future__ import annotations

import re

import pymupdf as fitz

MARKER_RE = re.compile(r"QZ(\d+)ZQ")


def find_markers(doc: "fitz.Document") -> dict[str, dict]:
    """Return {marker_text: {page, bbox, baseline, size}} for every QZnZQ marker."""
    found: dict[str, dict] = {}
    for page in doc:
        raw = page.get_text("rawdict")
        for b in raw["blocks"]:
            for line in b.get("lines", []):
                for span in line["spans"]:
                    chars = span["chars"]
                    text = "".join(c["c"] for c in chars)
                    for m in MARKER_RE.finditer(text):
                        cs = chars[m.start():m.end()]
                        x0 = min(c["bbox"][0] for c in cs)
                        x1 = max(c["bbox"][2] for c in cs)
                        y0 = min(c["bbox"][1] for c in cs)
                        y1 = max(c["bbox"][3] for c in cs)
                        found[m.group(0)] = {
                            "page": page.number,
                            "bbox": [round(v, 2) for v in (x0, y0, x1, y1)],
                            "baseline": round(cs[0]["origin"][1], 2),
                            "size": round(span["size"], 2),
                        }
    return found


def _segments(page: "fitz.Page"):
    """Horizontal and vertical line segments from vector drawings (table borders)."""
    hs, vs = [], []
    for d in page.get_drawings():
        for item in d["items"]:
            kind = item[0]
            if kind == "l":
                p, q = item[1], item[2]
                if abs(p.y - q.y) < 0.8:
                    hs.append((min(p.x, q.x), max(p.x, q.x), (p.y + q.y) / 2))
                elif abs(p.x - q.x) < 0.8:
                    vs.append((min(p.y, q.y), max(p.y, q.y), (p.x + q.x) / 2))
            elif kind == "re":
                r = item[1]
                if r.height < 2.5 and r.width > 2:
                    hs.append((r.x0, r.x1, (r.y0 + r.y1) / 2))
                elif r.width < 2.5 and r.height > 2:
                    vs.append((r.y0, r.y1, (r.x0 + r.x1) / 2))
                elif r.width >= 2.5 and r.height >= 2.5:
                    hs += [(r.x0, r.x1, r.y0), (r.x0, r.x1, r.y1)]
                    vs += [(r.y0, r.y1, r.x0), (r.y0, r.y1, r.x1)]
            elif kind == "qu":
                r = item[1].rect
                hs += [(r.x0, r.x1, r.y0), (r.x0, r.x1, r.y1)]
                vs += [(r.y0, r.y1, r.x0), (r.y0, r.y1, r.x1)]
    return hs, vs


def enclosing_cell(page: "fitz.Page", x: float, y: float, eps: float = 1.0):
    """Smallest box formed by table border lines around point (x, y)."""
    hs, vs = _segments(page)
    lefts = [vx for (y0, y1, vx) in vs if vx < x and y0 - eps <= y <= y1 + eps]
    rights = [vx for (y0, y1, vx) in vs if vx > x and y0 - eps <= y <= y1 + eps]
    tops = [hy for (x0, x1, hy) in hs if hy < y and x0 - eps <= x <= x1 + eps]
    bottoms = [hy for (x0, x1, hy) in hs if hy > y and x0 - eps <= x <= x1 + eps]
    if not (lefts and rights and tops and bottoms):
        return None
    return [round(max(lefts), 2), round(max(tops), 2), round(min(rights), 2), round(min(bottoms), 2)]


def compare_geometry(clean: "fitz.Document", marked: "fitz.Document", dpi: int = 72) -> float:
    """Fraction of pixels that differ between the two conversions.

    Markers are white, so if inserting them did not move anything the two
    renders are (nearly) identical. Text comparison is unreliable for Arabic,
    hence the raster comparison.
    """
    if len(clean) != len(marked):
        raise ValueError(f"page count differs: clean={len(clean)} marked={len(marked)}")
    worst = 0.0
    for pa, pb in zip(clean, marked):
        a = pa.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
        b = pb.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
        sa, sb = a.samples, b.samples
        if len(sa) != len(sb):
            return 1.0
        diff = sum(1 for x, y in zip(sa, sb) if abs(x - y) > 40)
        worst = max(worst, diff / len(sa))
    return worst


def find_text_rect(page: "fitz.Page", text: str, occurrence: int = 0):
    hits = page.search_for(text)
    hits.sort(key=lambda r: (round(r.y0), r.x0))
    if len(hits) <= occurrence:
        return None
    r = hits[occurrence]
    return [round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2)]
