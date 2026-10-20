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


def _box_sum(a, r):
    """Sum of a over the (2r+1)² square around each pixel (integral image)."""
    import numpy as np

    h, w = a.shape
    c = np.pad(a, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    y0 = np.clip(np.arange(h) - r, 0, h)
    y1 = np.clip(np.arange(h) + r + 1, 0, h)
    x0 = np.clip(np.arange(w) - r, 0, w)
    x1 = np.clip(np.arange(w) + r + 1, 0, w)
    return c[y1][:, x1] - c[y0][:, x1] - c[y1][:, x0] + c[y0][:, x0]


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

    def op_image_edit(self, op: dict):
        """Edit a scanned page image (forms delivered as screenshots).

        ``fill``: rectangles (page points) painted with the cell's own background colour
        (sampled just inside the rectangle's edge), which removes typed values.
        ``erase_text``: rectangles where letter-like blobs are erased (lines and dots kept).
        ``empty_box``: ticked boxes redrawn empty. ``draw``: lines / dotted leaders redrawn.
        ``remove_ink``: rectangles where bluish stamp / signature ink is turned white;
        black and red print inside them is kept.
        """
        import io
        from collections import Counter

        from PIL import Image

        page = self.doc[op["page"]]
        xref = page.get_images(full=True)[op.get("image", 0)][0]
        rect = page.get_image_rects(xref)[0]
        pix = fitz.Pixmap(self.doc, xref)
        img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        sx, sy = img.width / rect.width, img.height / rect.height

        def box(r):
            # clamped to the image: a rectangle may run past the scan's edge
            return (max(0, round((r[0] - rect.x0) * sx)), max(0, round((r[1] - rect.y0) * sy)),
                    min(img.width, round((r[2] - rect.x0) * sx)), min(img.height, round((r[3] - rect.y0) * sy)))

        px = img.load()
        for r in op.get("fill", []):
            x0, y0, x1, y1 = box(r)
            edge = [px[x, y] for x in range(x0, x1) for y in (y0, y0 + 1, y1 - 2, y1 - 1)]
            edge += [px[x, y] for y in range(y0, y1) for x in (x0, x0 + 1, x1 - 2, x1 - 1)]
            colour = Counter(edge).most_common(1)[0][0]
            for y in range(y0, y1):
                for x in range(x0, x1):
                    px[x, y] = colour
        for r in op.get("erase_text", []):
            # typed / handwritten values: dark blobs that look like letters are turned into the
            # background colour; thin long strokes (table lines, underlines) and the small dots of
            # dotted leaders are kept
            self._erase_text(img, box(r["rect"] if isinstance(r, dict) else r),
                             r.get("dark", 140) if isinstance(r, dict) else 140)
        for r in op.get("empty_box", []):
            # a ticked check box (■) becomes empty (□): fill white, redraw the border
            x0, y0, x1, y1 = box(r)
            for y in range(y0, y1):
                for x in range(x0, x1):
                    edge = x in (x0, x1 - 1) or y in (y0, y1 - 1)
                    px[x, y] = (40, 40, 40) if edge else (255, 255, 255)
        for r in op.get("remove_ink", []):
            # {"rect": [...], "keep_pure_blue": true} keeps saturated blue print (a link-coloured
            # label) and removes only the greyish-blue stamp / signature ink around it
            # {"rect": [...], "light": 170} also whitens the pale anti-aliased rim the ink leaves
            # (any pixel whose darkest channel is above 170; black print is far darker)
            keep_pure = isinstance(r, dict) and r.get("keep_pure_blue")
            light = r.get("light", 256) if isinstance(r, dict) else 256
            x0, y0, x1, y1 = box(r["rect"] if isinstance(r, dict) else r)
            for y in range(y0, y1):
                for x in range(x0, x1):
                    cr, cg, cb = px[x, y]
                    if (cb > cr + 8 and cb > cg - 5 and cb > 60 and not (keep_pure and max(cr, cg) < 70)) \
                            or min(cr, cg, cb) > light:
                        px[x, y] = (255, 255, 255)
        for r in op.get("draw", []):
            # redraw a table line / dotted leader that ran through an erased value:
            # {"rect": [...]} solid, {"rect": [...], "dotted": true} a row of dots
            x0, y0, x1, y1 = box(r["rect"])
            step = max(4, round(2.4 * sx)) if r.get("dotted") else 1
            dot = max(1, round(0.6 * sx))
            for y in range(y0, max(y1, y0 + 1)):
                for x in range(x0, max(x1, x0 + 1)):
                    if (x - x0) % step < dot:
                        px[x, y] = (60, 60, 60)
        out = io.BytesIO()
        if page.get_images(full=True)[op.get("image", 0)][8] == "DCTDecode":
            img.save(out, "JPEG", quality=90)  # a photographed / scanned page stays a JPEG (small file)
        else:
            img.save(out, "PNG")
        page.replace_image(xref, stream=out.getvalue())
        self.removed.append(f"[image edit p{op['page']}]")

    @staticmethod
    def _erase_text(img, rect, dark=140):
        """Whiten letter-like connected components inside rect (pixels)."""
        import numpy as np
        from PIL import Image

        x0, y0, x1, y1 = max(0, rect[0]), max(0, rect[1]), min(img.width, rect[2]), min(img.height, rect[3])
        a = np.asarray(img.crop((x0, y0, x1, y1)).convert("L"))
        mask = a < dark
        h, w = mask.shape
        seen = np.zeros_like(mask)
        crop = np.asarray(img.crop((x0, y0, x1, y1)).convert("RGB")).copy()
        # background colour of the area: the median of its light pixels
        light = crop[a > 200]
        bg = np.median(light, axis=0).astype(np.uint8) if light.size else np.array([255, 255, 255], np.uint8)
        comps = []
        for sy in range(h):
            row = mask[sy]
            for sx in np.nonzero(row & ~seen[sy])[0]:
                if seen[sy, sx]:
                    continue
                stack = [(sy, sx)]
                seen[sy, sx] = True
                pts = []
                while stack:
                    cy, cx = stack.pop()
                    pts.append((cy, cx))
                    for ny in (cy - 1, cy, cy + 1):
                        for nx in (cx - 1, cx, cx + 1):
                            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                                seen[ny, nx] = True
                                stack.append((ny, nx))
                ys = [p[0] for p in pts]
                xs = [p[1] for p in pts]
                comps.append((min(xs), min(ys), max(xs), max(ys), pts))
        big = []
        for cx0, cy0, cx1, cy1, pts in comps:
            cw, ch = cx1 - cx0 + 1, cy1 - cy0 + 1
            line = (cw >= 60 and ch <= 7) or (ch >= 60 and cw <= 7)  # table / underline strokes
            if (cw >= 6 or ch >= 6) and not line:  # letters, digits, dashes (not leader dots)
                big.append((cx0, cy0, cx1, cy1, pts))
        near = []
        for cx0, cy0, cx1, cy1, pts in comps:
            cw, ch = cx1 - cx0 + 1, cy1 - cy0 + 1
            if cw < 6 or ch < 6:
                # letter dots next to removed letters (not leader dots on their own)
                if any(b[0] - 6 <= cx0 and cx1 <= b[2] + 6 and b[1] - 14 <= cy0 and cy1 <= b[3] + 14 for b in big):
                    near.append(pts)
        erase = np.zeros_like(mask)
        for pts in [b[4] for b in big] + near:
            ys, xs = zip(*pts)
            erase[list(ys), list(xs)] = True
        # grow by 3 px: the grey anti-aliased / JPEG halo around the strokes goes too
        grown = erase.copy()
        for dy in range(-3, 4):
            for dx in range(-3, 4):
                if dy * dy + dx * dx > 10:
                    continue
                shifted = np.zeros_like(erase)
                shifted[max(0, dy):h + min(0, dy), max(0, dx):w + min(0, dx)] = \
                    erase[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)]
                grown |= shifted
        grown &= ~(mask & ~erase)  # kept strokes and leader dots stay
        # fill with the surrounding paper colour (a faint watermark under a value carries on)
        valid = ~grown & ~mask
        out = np.zeros(crop.shape, float)
        todo = grown.copy()
        for r in (6, 12, 24, 48):
            if not todo.any():
                break
            den = _box_sum(valid.astype(float), r)
            ok = todo & (den > 0)
            for c in range(3):
                num = _box_sum(np.where(valid, crop[..., c], 0).astype(float), r)
                out[..., c][ok] = num[ok] / den[ok]
            todo &= ~ok
        crop[grown] = out[grown].round().clip(0, 255).astype(np.uint8)
        crop[todo] = bg
        img.paste(Image.fromarray(crop), (x0, y0))

    def op_remove_annots(self, op: dict):
        """Delete annotations (e.g. values typed into a scanned form as FreeText boxes)."""
        n = 0
        for page in self.doc:
            for a in list(page.annots() or []):
                content = (a.info.get("content") or "").strip()
                if content:
                    self.removed.append(content)
                page.delete_annot(a)
                n += 1
        if n == 0 and not op.get("optional"):
            raise PdfSanitizeError("no annotations found")

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
