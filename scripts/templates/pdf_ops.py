"""PDF sanitization operations (PyMuPDF).

Historical values are *removed* from the content streams (true redaction /
object deletion), not painted over, so they cannot be extracted afterwards.
Logos, letterheads, table borders and fixed legal wording are left untouched.
"""
from __future__ import annotations

import pymupdf as fitz


class PdfSanitizeError(Exception):
    pass


def _close(a, b, tol=3.0) -> bool:
    return all(abs(x - y) <= tol for x, y in zip(a, b))


class PdfSanitizer:
    def __init__(self, data: bytes):
        self.doc = fitz.open(stream=data, filetype="pdf")
        self.removed: list[str] = []
        self.pending_redactions: dict[int, list[tuple]] = {}

    # --------------------------------------------------------------- ops
    def op_remove_image(self, op: dict):
        """Delete an image (stamp / signature / pasted text image) identified by its bbox."""
        page = self.doc[op["page"]]
        hits = [
            info for info in page.get_image_info(xrefs=True)
            if _close(info["bbox"], op["bbox"], op.get("tol", 3.0))
        ]
        if not hits:
            raise PdfSanitizeError(f"image not found on page {op['page']} at {op['bbox']}")
        # remove the drawing instruction itself (no placeholder left behind);
        # only images overlapping this bbox are affected and logos are far away
        for info in hits:
            self.pending_redactions.setdefault(op["page"], []).append((fitz.Rect(info["bbox"]), "image"))
        self.removed.append(f"[image p{op['page']} {op['label'] if 'label' in op else ''}]")

    def op_redact_spans(self, op: dict):
        """Remove text spans by font name (and optional substring / region)."""
        pages = [op["page"]] if "page" in op else range(len(self.doc))
        n = 0
        for pno in pages:
            page = self.doc[pno]
            for b in page.get_text("dict")["blocks"]:
                for line in b.get("lines", []):
                    for s in line["spans"]:
                        if op.get("font") and s["font"] != op["font"]:
                            continue
                        if op.get("contains") and op["contains"] not in s["text"]:
                            continue
                        if op.get("color") is not None and s["color"] != op["color"]:
                            continue
                        if "region" in op and not fitz.Rect(op["region"]).contains(fitz.Rect(s["bbox"])):
                            continue
                        if not s["text"].strip():
                            continue
                        r = fitz.Rect(s["bbox"])
                        # shrink vertically so neighbouring lines are never touched
                        h = r.height
                        r.y0 += h * 0.25
                        r.y1 -= h * 0.25
                        self.pending_redactions.setdefault(pno, []).append((r, "text"))
                        self.removed.append(s["text"].strip())
                        n += 1
        if n == 0 and not op.get("optional"):
            raise PdfSanitizeError(f"no spans matched {op}")

    def op_redact_text_rect(self, op: dict):
        page = self.doc[op["page"]]
        r = fitz.Rect(op["rect"])
        txt = page.get_text("text", clip=r).strip()
        if txt:
            self.removed.append(txt)
        self.pending_redactions.setdefault(op["page"], []).append((r, "text"))

    def op_remove_line_art(self, op: dict):
        """Remove vector drawings (e.g. hand-placed tick marks) fully inside the given rects."""
        page = self.doc[op["page"]]
        for rect in op["rects"]:
            r = fitz.Rect(rect)
            inside = [d for d in page.get_drawings() if r.contains(d["rect"])]
            if not inside and not op.get("optional"):
                raise PdfSanitizeError(f"no drawing inside {rect} on page {op['page']}")
            self.pending_redactions.setdefault(op["page"], []).append((r, "lineart"))
        self.removed.append(f"[line art p{op['page']} x{len(op['rects'])}]")

    def op_flatten_form(self, op: dict):
        """Reset every form field to empty/Off and bake the empty appearance into the page.

        The generator writes values as page content, so no interactive fields
        remain (this also removes the field JavaScript).
        """
        for page in self.doc:
            for wdg in page.widgets() or []:
                if wdg.field_type in (fitz.PDF_WIDGET_TYPE_RADIOBUTTON, fitz.PDF_WIDGET_TYPE_CHECKBOX):
                    if wdg.field_value not in (False, "Off", None):
                        self.removed.append(f"[{wdg.field_name}={wdg.field_value}]")
                    wdg.field_value = False
                else:
                    if wdg.field_value:
                        self.removed.append(str(wdg.field_value))
                    wdg.field_value = ""
                wdg.update()
        self.doc.bake(annots=False, widgets=True)
        cat = self.doc.pdf_catalog()
        for key in ("AcroForm", "Names", "OpenAction", "AA"):
            if self.doc.xref_get_key(cat, key)[0] != "null":
                self.doc.xref_set_key(cat, key, "null")

    # --------------------------------------------------------------- run
    def _apply_redactions(self):
        for pno, items in self.pending_redactions.items():
            page = self.doc[pno]
            text_rects = [r for r, kind in items if kind == "text"]
            art_rects = [r for r, kind in items if kind == "lineart"]
            img_rects = [r for r, kind in items if kind == "image"]
            if img_rects:
                for r in img_rects:
                    page.add_redact_annot(r, fill=False)
                page.apply_redactions(
                    images=fitz.PDF_REDACT_IMAGE_REMOVE,
                    graphics=fitz.PDF_REDACT_LINE_ART_NONE,
                    text=fitz.PDF_REDACT_TEXT_NONE,
                )
            if text_rects:
                for r in text_rects:
                    page.add_redact_annot(r, fill=False)
                page.apply_redactions(
                    images=fitz.PDF_REDACT_IMAGE_NONE,
                    graphics=fitz.PDF_REDACT_LINE_ART_NONE,
                    text=fitz.PDF_REDACT_TEXT_REMOVE,
                )
            if art_rects:
                for r in art_rects:
                    page.add_redact_annot(r, fill=False)
                page.apply_redactions(
                    images=fitz.PDF_REDACT_IMAGE_NONE,
                    graphics=fitz.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
                    text=fitz.PDF_REDACT_TEXT_NONE,
                )

    def apply(self, ops: list[dict]) -> tuple[bytes, list[str]]:
        for op in ops:
            fn = getattr(self, "op_" + op["op"], None)
            if fn is None:
                raise PdfSanitizeError(f"unknown pdf op {op['op']}")
            fn(op)
        self._apply_redactions()
        return finalize_pdf(self.doc), self.removed


def finalize_pdf(doc: "fitz.Document") -> bytes:
    """Strip metadata/XMP, drop unused objects and return the cleaned bytes."""
    doc.set_metadata({
        "title": "", "author": "", "subject": "", "keywords": "",
        "creator": "ACAD Document Generator (template build)", "producer": "",
        "creationDate": "", "modDate": "",
    })
    doc.del_xml_metadata()
    for page in doc:
        for annot in list(page.annots() or []):
            page.delete_annot(annot)
    return doc.tobytes(garbage=4, deflate=True, clean=True, no_new_id=True)


def sanitize_pdf(data: bytes, ops: list[dict]) -> tuple[bytes, list[str]]:
    return PdfSanitizer(data).apply(ops)
