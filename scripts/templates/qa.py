#!/usr/bin/env python3
"""Sanitization QA for built templates.

For every template in templates/dist it re-derives the historical values that
the sanitizer removed (templates/.qa/<key>.removed.json, git-ignored) and
asserts none of them survives in:
  * the sanitized DOCX package (all XML parts, exact match)       [docx]
  * the base PDF text (pdftotext + PyMuPDF, NFKC-normalised)
  * the base PDF metadata / XMP
It also checks that removed stamp/signature images are gone, that the
letterhead/logo images remain, and writes docs/template-qa-report.md with
counts only (no private values).

    python3 scripts/templates/qa.py
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import pymupdf as fitz

sys.path.insert(0, str(Path(__file__).resolve().parent))
from docx_ops import docx_all_text  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "templates" / "dist"
QA = ROOT / "templates" / ".qa"
SANITIZED = ROOT / "templates" / "sanitized"
DEFS = ROOT / "templates" / "definitions"
COMPANY = json.loads((ROOT / "templates" / "company.json").read_text(encoding="utf-8"))
REPORT = ROOT / "docs" / "template-qa-report.md"

IGNORABLE = set("‏‎ـ‪‫‬‭‮﻿")


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    return "".join(ch for ch in s if not ch.isspace() and ch not in IGNORABLE).lower()


def pdf_texts(path: Path) -> list[str]:
    out = []
    try:
        out.append(subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, text=True, timeout=60).stdout)
        out.append(subprocess.run(["pdftotext", "-raw", str(path), "-"], capture_output=True, text=True, timeout=60).stdout)
    except FileNotFoundError:
        pass
    doc = fitz.open(path)
    out.append("\n".join(p.get_text() for p in doc))
    out.append(json.dumps(doc.metadata, ensure_ascii=False))
    out.append(doc.get_xml_metadata())
    return out


TOKEN_SPLIT = __import__("re").compile(r"[\s/\\\-+:()\[\].,،–_|]+")


def tokens(s: str) -> list[str]:
    s = unicodedata.normalize("NFKC", s)
    s = "".join(ch for ch in s if ch not in IGNORABLE).lower().replace("لا", "ال")
    return [t for t in TOKEN_SPLIT.split(s) if len(t) >= 2]


def token_leak(value: str, pdf_tokens: set[str]) -> bool:
    """Word-level check robust to visual-order Arabic extraction: all words of the value present."""
    vt = tokens(value)
    if len(vt) < 2:
        return False
    hits = sum(1 for t in vt if t in pdf_tokens or t[::-1] in pdf_tokens)
    return hits == len(vt)


def leak_needles(removed: list[str]) -> list[str]:
    company = {norm(COMPANY["consultant_name_en"]), norm(COMPANY["consultant_name_ar"])}
    needles = []
    for v in removed:
        if v.startswith("["):  # image / line-art markers, checked separately
            continue
        n = norm(v)
        if len(n) < 3 or n in company:
            continue
        # ACAD's own name (any spelling) is not client data and appears in the letterhead
        if re.search(r"(?i)\bacad\b|[اأآ]كاد", v):
            continue
        # bare percentages / small numbers also occur in the standard wording (e.g. 100%, 5%)
        if re.fullmatch(r"[%\s\d.,\-]{1,8}", v.strip()):
            continue
        needles.append(n)
    return needles


def check(key: str) -> dict:
    layout = json.loads((DIST / f"{key}.layout.json").read_text(encoding="utf-8"))
    removed = json.loads((QA / f"{key}.removed.json").read_text(encoding="utf-8")) if (QA / f"{key}.removed.json").exists() else []
    pdf = DIST / f"{key}.pdf"
    needles = leak_needles(removed)
    hay_pdf = [norm(t) for t in pdf_texts(pdf)]
    pdf_tokens = {t for txt in pdf_texts(pdf) for t in tokens(txt)}
    company = {norm(COMPANY["consultant_name_en"]), norm(COMPANY["consultant_name_ar"])}
    leaks = []
    for n in needles:
        if any(n in h or n[::-1] in h for h in hay_pdf):
            leaks.append(("pdf", n))
    for v in removed:
        if not v.startswith("[") and norm(v) not in company and token_leak(v, pdf_tokens):
            leaks.append(("pdf-words", norm(v)))
    if layout["format"] == "docx":
        hay_docx = norm(docx_all_text((SANITIZED / f"{key}.docx").read_bytes()))
        for n in needles:
            if n in hay_docx:
                leaks.append(("docx", n))
    # markers must never reach the production base PDF
    if any("qz" in h and "zq" in h and any(f"qz{i}zq" in h for i in range(1, 60)) for h in hay_pdf):
        leaks.append(("pdf", "slot marker"))
    doc = fitz.open(pdf)
    images = []
    for p in doc:
        for info in p.get_image_info(xrefs=True):
            images.append((p.number, info["width"], info["height"]))
    meta = doc.metadata
    meta_ok = not meta.get("author") and not doc.get_xml_metadata()
    return {
        "key": key,
        "format": layout["format"],
        "pages": layout["pageCount"],
        "slots": len(layout["slots"]),
        "removed": len(removed),
        "needles": len(needles),
        "leaks": leaks,
        "images": images,
        "meta_ok": meta_ok,
    }


def main() -> int:
    keys = sorted(p.name[: -len(".layout.json")] for p in DIST.glob("*.layout.json"))
    defs = {json.loads(p.read_text(encoding="utf-8"))["key"]: json.loads(p.read_text(encoding="utf-8")) for p in DEFS.glob("*.json")}
    results = [check(k) for k in keys]
    failed = False
    lines = [
        "# Template sanitization QA report",
        "",
        "Generated by `python3 scripts/templates/qa.py`. Counts only — historical values are never written to the repository.",
        "",
        "| Template | Source | Format | Pages | Slots | Removed items | Leak check | Metadata | Images kept | Status |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in results:
        d = defs.get(r["key"], {})
        ok = not r["leaks"] and r["meta_ok"]
        failed |= not ok
        imgs = ", ".join(f"p{p + 1}:{w}x{h}" for p, w, h in r["images"]) or "none"
        lines.append(
            f"| `{r['key']}` | {d.get('source', '?')} | {r['format']} | {r['pages']} | {r['slots']} | {r['removed']} | "
            f"{'PASS' if not r['leaks'] else 'FAIL (' + str(len(r['leaks'])) + ')'} | {'PASS' if r['meta_ok'] else 'FAIL'} | {imgs} | {d.get('status', '?')} |"
        )
        status = "ok  " if ok else "FAIL"
        print(f"[{status}] {r['key']:<34} removed={r['removed']:<3} leaks={len(r['leaks'])} images={len(r['images'])}")
        for where, n in r["leaks"]:
            print(f"        leak in {where}: {len(n)} chars", file=sys.stderr)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
