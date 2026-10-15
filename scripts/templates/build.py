#!/usr/bin/env python3
"""Build sanitized base PDFs + slot layouts for every template definition.

    python3 scripts/templates/build.py            # all templates
    python3 scripts/templates/build.py --only takleef

Inputs : templates/definitions/*.json, reference-documents/* (originals, read-only)
Outputs: templates/dist/<key>.pdf           sanitized base PDF used by the generator
         templates/dist/<key>.layout.json   slot geometry (top-left origin, points)
         templates/dist/manifest.json
         templates/sanitized/<key>.docx     sanitized editable DOCX (docx templates)
         templates/.qa/<key>.removed.json   historical values removed (git-ignored!)

Optional high-fidelity path: export templates/sanitized/<key>.docx and
templates/sanitized/<key>.marked.docx from Microsoft Word as PDF into
templates/word-exports/<key>.pdf and <key>.marked.pdf; they are then used
instead of the LibreOffice conversion.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sys
from pathlib import Path

import pymupdf as fitz

sys.path.insert(0, str(Path(__file__).resolve().parent))
from convert import docx_to_pdf, soffice_version  # noqa: E402
from docx_ops import sanitize_docx  # noqa: E402
from layout import compare_geometry, enclosing_cell, find_markers, find_text_rect  # noqa: E402
from pdf_ops import finalize_pdf, sanitize_pdf  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DEFS = ROOT / "templates" / "definitions"
DIST = ROOT / "templates" / "dist"
SANITIZED = ROOT / "templates" / "sanitized"
QA = ROOT / "templates" / ".qa"
WORD_EXPORTS = ROOT / "templates" / "word-exports"
SOURCES = ROOT / "reference-documents"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


PRIVATE_OPS = SOURCES / "private" / "sanitize"


def load_definitions(only: list[str] | None = None) -> list[dict]:
    defs = []
    for f in sorted(DEFS.glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        if only and d["key"] not in only:
            continue
        if d.get("sanitize") == "private":
            # operations that name historical client values are kept next to the private originals
            ops = PRIVATE_OPS / f"{d['key']}.json"
            if not ops.exists():
                print(f"[skip] {d['key']:<34} private sanitize operations not available here", file=sys.stderr)
                continue
            d["sanitize"] = json.loads(ops.read_text(encoding="utf-8"))
        defs.append(d)
    return defs


def resolve_slot(name: str, spec: dict, markers_by_slot: dict, base: "fitz.Document") -> dict:
    kind = spec.get("kind", "cell")
    if kind == "rect":
        return {"page": spec["page"], "rect": spec["rect"], **({"baseline": spec["baseline"]} if "baseline" in spec else {})}
    if kind == "find_text":
        page = base[spec.get("page", 0)]
        r = find_text_rect(page, spec["text"], spec.get("occurrence", 0))
        if r is None:
            raise RuntimeError(f"slot {name}: text {spec['text']!r} not found")
        return {"page": page.number, "rect": r}
    m = markers_by_slot.get(name)
    if m is None:
        raise RuntimeError(f"slot {name}: marker not found in converted PDF")
    x0, y0, x1, y1 = m["bbox"]
    out = {"page": m["page"], "baseline": m["baseline"], "size": m["size"]}
    if kind == "cell":
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        cell = enclosing_cell(base[m["page"]], cx, cy)
        if cell is None:
            raise RuntimeError(f"slot {name}: no enclosing table cell found")
        out["rect"] = cell
    elif kind == "inline":
        width = spec["width"]
        pad = spec.get("pad", 2)
        if spec.get("dir", "rtl") == "rtl":
            right = x1 + spec.get("shift", 0)
            out["rect"] = [round(right - width, 2), round(y0 - pad, 2), round(right, 2), round(y1 + pad, 2)]
        else:
            left = x0 + spec.get("shift", 0)
            out["rect"] = [round(left, 2), round(y0 - pad, 2), round(left + width, 2), round(y1 + pad, 2)]
    elif kind == "gap":
        # blank gap reserved inside running text (op "text" with "reserve"): from the zero-width
        # marker to the next word on the same line (left for RTL, right for LTR)
        page = base[m["page"]]
        chars = []
        for b in page.get_text("rawdict")["blocks"]:
            for line in b.get("lines", []):
                for span in line["spans"]:
                    for c in span["chars"]:
                        if c["c"].strip() and abs(c["origin"][1] - m["baseline"]) < 2.5:
                            chars.append((c["bbox"], span["size"]))
        size = max((sz for _, sz in chars), default=12)
        rtl = spec.get("dir", "rtl") == "rtl"
        if rtl:
            right = x1
            lefts = [bb[2] for bb, _ in chars if bb[2] <= x0 + 0.5]
            left = max(lefts) + 1 if lefts else right - spec.get("width", 150)
        else:
            left = x0
            rights = [bb[0] for bb, _ in chars if bb[0] >= x1 - 0.5]
            right = min(rights) - 1 if rights else left + spec.get("width", 150)
        out["rect"] = [round(left, 2), round(m["baseline"] - size * 0.95, 2), round(right, 2), round(m["baseline"] + size * 0.3, 2)]
        out["size"] = round(size, 2)
    elif kind == "line_leftmost":
        # leftmost word group on the marker's line (e.g. the consultant signature label)
        page = base[m["page"]]
        allc = []
        for b in page.get_text("rawdict")["blocks"]:
            for line in b.get("lines", []):
                for span in line["spans"]:
                    for c in span["chars"]:
                        if c["c"].strip() and "QZ" not in "".join(ch["c"] for ch in span["chars"]):
                            allc.append((c["origin"][1], c["bbox"]))
        # the marker may wrap onto its own line: use the nearest text line at or above it
        bases = sorted({round(b_, 1) for b_, _ in allc if m["baseline"] - 40 <= b_ <= m["baseline"] + 2.5}, reverse=True)
        chars = [r for b_, r in allc if bases and abs(b_ - bases[0]) < 2.5]
        if not chars:
            raise RuntimeError(f"slot {name}: no text on the marker line")
        chars.sort(key=lambda r: r[0])
        group = [chars[0]]
        for r in chars[1:]:
            if r[0] - max(g[2] for g in group) > spec.get("gap", 14):
                break
            group.append(r)
        out["rect"] = [round(min(g[0] for g in group), 2), round(min(g[1] for g in group), 2),
                       round(max(g[2] for g in group), 2), round(max(g[3] for g in group), 2)]
    else:
        raise RuntimeError(f"slot {name}: unknown kind {kind}")
    return out


def build_docx(defn: dict, src: bytes) -> tuple[bytes, dict, list[str], dict]:
    ops = defn["sanitize"]
    clean = sanitize_docx(src, ops, with_markers=False)
    marked = sanitize_docx(src, ops, with_markers=True)
    SANITIZED.mkdir(parents=True, exist_ok=True)
    (SANITIZED / f"{defn['key']}.docx").write_bytes(clean.data)
    (SANITIZED / f"{defn['key']}.marked.docx").write_bytes(marked.data)

    word_clean = WORD_EXPORTS / f"{defn['key']}.pdf"
    word_marked = WORD_EXPORTS / f"{defn['key']}.marked.pdf"
    if word_clean.exists() and word_marked.exists():
        clean_pdf, marked_pdf, engine = word_clean.read_bytes(), word_marked.read_bytes(), "word-export"
    else:
        clean_pdf, marked_pdf, engine = docx_to_pdf(clean.data), docx_to_pdf(marked.data), soffice_version()

    base = fitz.open(stream=clean_pdf, filetype="pdf")
    mdoc = fitz.open(stream=marked_pdf, filetype="pdf")
    drift = compare_geometry(base, mdoc)
    # a zero-width marker inside a line of labels may nudge the next words by a point or two
    if drift > defn.get("layoutTolerance", 0.002):
        raise RuntimeError(f"marker variant changed the layout ({drift:.4%} of pixels differ)")
    found = find_markers(mdoc)
    markers_by_slot = {marked.markers[t]: info for t, info in found.items() if t in marked.markers}
    missing = sorted(set(marked.markers.values()) - set(markers_by_slot))
    if missing:
        raise RuntimeError(f"markers not rendered for slots: {missing}")
    slots = {name: resolve_slot(name, spec, markers_by_slot, base) for name, spec in defn["slots"].items()}
    pdf_bytes = finalize_pdf(base)
    # editable Word output: the marked DOCX is the template, markers are replaced at generation time
    DIST.mkdir(parents=True, exist_ok=True)
    (DIST / f"{defn['key']}.docx").write_bytes(marked.data)
    info = {"engine": engine, "layoutDiff": round(drift, 6), "docxMarkers": marked.markers}
    return pdf_bytes, slots, clean.removed_values, info


def build_pdf(defn: dict, src: bytes) -> tuple[bytes, dict, list[str], dict]:
    pdf_bytes, removed = sanitize_pdf(src, defn["sanitize"])
    base = fitz.open(stream=pdf_bytes, filetype="pdf")
    slots = {name: resolve_slot(name, spec, {}, base) for name, spec in defn["slots"].items()}
    return pdf_bytes, slots, removed, {"engine": f"pymupdf {fitz.VersionBind}"}


def build_one(defn: dict) -> dict:
    src_path = SOURCES / defn["source"]
    src = src_path.read_bytes()
    if defn["format"] == "docx":
        pdf_bytes, slots, removed, info = build_docx(defn, src)
    else:
        pdf_bytes, slots, removed, info = build_pdf(defn, src)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    layout = {
        "key": defn["key"],
        "version": defn["version"],
        "format": defn["format"],
        "sourceSha256": sha256(src),
        "baseSha256": sha256(pdf_bytes),
        "pageCount": len(doc),
        "pages": [{"width": round(p.rect.width, 2), "height": round(p.rect.height, 2)} for p in doc],
        "slots": slots,
        "docx": {"markers": info.pop("docxMarkers")} if "docxMarkers" in info else None,
        "build": info,
    }
    DIST.mkdir(parents=True, exist_ok=True)
    (DIST / f"{defn['key']}.pdf").write_bytes(pdf_bytes)
    (DIST / f"{defn['key']}.layout.json").write_text(json.dumps(layout, ensure_ascii=False, indent=1), encoding="utf-8")
    QA.mkdir(parents=True, exist_ok=True)
    (QA / f"{defn['key']}.removed.json").write_text(json.dumps(removed, ensure_ascii=False, indent=1), encoding="utf-8")
    return layout


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()
    defs = load_definitions(args.only)
    if not defs:
        print("no definitions matched", file=sys.stderr)
        return 1
    ok = True
    for d in defs:
        try:
            lay = build_one(d)
            print(f"[ok]   {d['key']:<34} pages={lay['pageCount']} slots={len(lay['slots'])} {lay['build']}")
        except Exception as e:  # report and continue with the others
            ok = False
            print(f"[FAIL] {d['key']:<34} {e}", file=sys.stderr)
    manifest = []
    for f in sorted(DIST.glob("*.layout.json")):
        lay = json.loads(f.read_text(encoding="utf-8"))
        manifest.append({"key": lay["key"], "version": lay["version"], "baseSha256": lay["baseSha256"], "pageCount": lay["pageCount"]})
    (DIST / "manifest.json").write_text(json.dumps({"generated": dt.date.today().isoformat(), "templates": manifest}, indent=1), encoding="utf-8")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
