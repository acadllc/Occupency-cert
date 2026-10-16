"""DOCX sanitization operations.

Each template definition lists declarative `sanitize` operations. They remove
historical project data (values typed into cells, auto-updating DATE fields,
stamps/signature images) from a *copy* of the original document and, when
`with_markers=True`, insert short white marker strings where the generator
will later place new values. Markers are only used to measure positions in the
converted PDF; the production base PDF is converted from the marker-free copy.

The originals in reference-documents/ are never modified.
"""
from __future__ import annotations

import copy
import io
import re
import zipfile
from dataclasses import dataclass, field

from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
V = "urn:schemas-microsoft-com:vml"
PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"w": W, "r": R, "a": A, "v": V}


def w(tag: str) -> str:
    return f"{{{W}}}{tag}"


def marker_text(index: int) -> str:
    """Short ASCII marker; short so it never forces an extra line wrap."""
    return f"QZ{index}ZQ"


MARKER_RE = re.compile(r"QZ(\d+)ZQ")


class SanitizeError(Exception):
    pass


@dataclass
class DocxResult:
    data: bytes
    removed_values: list[str] = field(default_factory=list)
    markers: dict[str, str] = field(default_factory=dict)  # marker text -> slot name


def _text_of(el) -> str:
    return "".join(el.itertext(tag=w("t")))


def _norm(s: str) -> str:
    return re.sub(r"[\s:\u200f\u200e]+", "", s)


def _row_cells(tr):
    return tr.xpath("./w:tc | ./w:sdt/w:sdtContent/w:tc", namespaces=NS)


# blank space reserved for a value inside running text (removed again in Word output)
FILLER = "\u2002"


def _make_marker_run(rpr_source, text: str, use_cs_size: bool = True, default_cs: str = "Times New Roman"):
    run = etree.Element(w("r"))
    rpr = copy.deepcopy(rpr_source) if rpr_source is not None else etree.Element(w("rPr"))
    rpr.tag = w("rPr")
    fonts = rpr.find(w("rFonts"))
    if fonts is None:
        fonts = etree.Element(w("rFonts"))
        rpr.insert(0, fonts)
    if not fonts.get(w("cs")):
        fonts.set(w("cs"), default_cs)
    for tag in ("color", "highlight", "shd", "vanish", "webHidden", "rStyle", "u"):
        for el in rpr.findall(w(tag)):
            rpr.remove(el)
    # values are mostly Arabic: measure with the complex-script size (szCs) when present
    szcs = rpr.find(w("szCs"))
    if use_cs_size and szcs is not None:
        for el in rpr.findall(w("sz")):
            rpr.remove(el)
        sz = etree.SubElement(rpr, w("sz"))
        sz.set(w("val"), szcs.get(w("val")))
    # Latin marker letters must use the complex-script font so that the marker
    # (Latin) and the clean placeholder (neutral NBSP) get the same line height.
    fonts = rpr.find(w("rFonts"))
    if fonts is not None and fonts.get(w("cs")):
        for attr in ("ascii", "hAnsi", "eastAsia"):
            fonts.set(w(attr), fonts.get(w("cs")))
        for attr in ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "hint"):
            fonts.attrib.pop(w(attr), None)
    color = etree.SubElement(rpr, w("color"))
    color.set(w("val"), "FFFFFF")
    # keep element order loosely valid: Word tolerates order; LibreOffice too
    run.append(rpr)
    t = etree.SubElement(run, w("t"))
    t.text = text
    t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    return run


def _first_rpr(el):
    for r in el.iter(w("r")):
        rpr = r.find(w("rPr"))
        if rpr is not None and _text_of(r).strip():
            return rpr
    ppr_rpr = el.find(f"{w('pPr')}/{w('rPr')}")
    return ppr_rpr


class DocxSanitizer:
    def __init__(self, source_bytes: bytes, with_markers: bool):
        self.with_markers = with_markers
        zin = zipfile.ZipFile(io.BytesIO(source_bytes))
        self.parts: dict[str, bytes] = {n: zin.read(n) for n in zin.namelist()}
        self.infos = {i.filename: i for i in zin.infolist()}
        self.order = zin.namelist()
        self.trees: dict[str, etree._ElementTree] = {}
        self.removed: list[str] = []
        self.markers: dict[str, str] = {}
        self._marker_index = 0

    # ------------------------------------------------------------ helpers
    def tree(self, name: str):
        if name not in self.trees:
            self.trees[name] = etree.ElementTree(etree.fromstring(self.parts[name]))
        return self.trees[name]

    def default_cs_font(self) -> str:
        """Complex-script font a run without explicit rFonts/@cs would use."""
        if getattr(self, "_default_cs", None):
            return self._default_cs
        font = None
        if "word/styles.xml" in self.parts:
            st = etree.fromstring(self.parts["word/styles.xml"])
            normal = st.find(f".//{w('style')}[@{w('styleId')}='Normal']/{w('rPr')}/{w('rFonts')}")
            dflt = st.find(f"{w('docDefaults')}/{w('rPrDefault')}/{w('rPr')}/{w('rFonts')}")
            for el in (normal, dflt):
                if el is not None and el.get(w("cs")):
                    font = el.get(w("cs"))
                    break
            if font is None and "word/theme/theme1.xml" in self.parts:
                theme = self.parts["word/theme/theme1.xml"].decode("utf-8", "replace")
                m = re.search(r'<a:minorFont>.*?<a:font script="Arab" typeface="([^"]+)"', theme, flags=re.S)
                if m:
                    font = m.group(1)
        self._default_cs = font or "Times New Roman"
        return self._default_cs

    def story_parts(self) -> list[str]:
        names = ["word/document.xml"]
        names += sorted(n for n in self.parts if re.match(r"word/(header|footer)\d*\.xml$", n))
        return names

    def new_marker(self, slot: str) -> str:
        self._marker_index += 1
        text = marker_text(self._marker_index)
        self.markers[text] = slot
        return text

    def _insert_marker(self, parent, index: int, rpr_source, slot: str, use_cs_size: bool = True):
        text = self.new_marker(slot)
        if not self.with_markers:
            # Clean variant: an invisible no-break space with the very same run
            # properties, so both variants have identical line heights.
            text = "\u00a0"
        run = _make_marker_run(rpr_source, text, use_cs_size, self.default_cs_font())
        style = getattr(self, "_marker_style", None)
        if style:
            # per-op override (e.g. a historical value typed in a larger font than the form's text)
            rpr = run.find(w("rPr"))
            if style.get("font"):
                fonts = rpr.find(w("rFonts"))
                for attr in ("ascii", "hAnsi", "eastAsia", "cs"):
                    fonts.set(w(attr), style["font"])
            if style.get("size"):
                for tag in ("sz", "szCs"):
                    for el in rpr.findall(w(tag)):
                        el.set(w("val"), str(int(style["size"] * 2)))
        parent.insert(index, run)

    # ------------------------------------------------------------ operations
    def op_cell(self, op: dict):
        """Clear a table cell located relative to a label cell and mark it."""
        label = _norm(op["label"])
        offset = int(op["offset"])
        occurrence = int(op.get("occurrence", 0))
        doc = self.tree("word/document.xml")
        found = []
        for tr in doc.iter(w("tr")):
            cells = _row_cells(tr)
            for i, tc in enumerate(cells):
                if _norm(_text_of(tc)) == label:
                    found.append((cells, i))
        if len(found) <= occurrence:
            raise SanitizeError(f"label cell not found: {op['label']!r}")
        cells, i = found[occurrence]
        j = i + offset
        if not 0 <= j < len(cells):
            raise SanitizeError(f"offset {offset} out of range for label {op['label']!r}")
        self._clear_cell(cells[j], op.get("slot"))

    def op_cell_containing(self, op: dict):
        """Clear the (first) table cell whose text contains a phrase and mark it."""
        target = _norm(op["contains"])
        for tc in self.tree("word/document.xml").getroot().iter(w("tc")):
            if target in _norm(_text_of(tc)) and not tc.findall(f".//{w('tc')}"):
                self._clear_cell(tc, op.get("slot"))
                return
        raise SanitizeError(f"cell containing {op['contains']!r} not found")

    def _clear_cell(self, tc, slot: str | None, record: bool = True):
        paras = tc.findall(w("p"))
        old = "\n".join(_text_of(p) for p in paras).strip()
        if old and record:
            self.removed.append(old)
        p = paras[0]
        rpr = _first_rpr(tc)
        self._fix_table_layout(tc)
        for extra in paras[1:]:
            tc.remove(extra)
        for child in list(p):
            if child.tag != w("pPr"):
                p.remove(child)
        if slot:
            self._insert_marker(p, len(p), rpr, slot)

    @staticmethod
    def _fix_table_layout(tc):
        """Freeze column widths to the grid Word saved with the original content.

        Auto-fit tables would otherwise resize when cell content changes (and the
        marked/clean variants would differ); the saved grid is also the most
        faithful reproduction of the original Word layout.
        """
        tbl = next((a for a in tc.iterancestors() if a.tag == w("tbl")), None)
        if tbl is None:
            return
        tblpr = tbl.find(w("tblPr"))
        if tblpr is None:
            tblpr = etree.SubElement(tbl, w("tblPr"))
            tbl.insert(0, tblpr)
        layout = tblpr.find(w("tblLayout"))
        if layout is None:
            layout = etree.SubElement(tblpr, w("tblLayout"))
        layout.set(w("type"), "fixed")

    def op_date_field(self, op: dict):
        """Remove an auto-updating DATE/TIME field (and its cached result)."""
        count = 0
        for name in self.story_parts():
            root = self.tree(name).getroot()
            for p in list(root.iter(w("p"))):
                runs = list(p.iter(w("r")))
                k = 0
                while k < len(runs):
                    fc = runs[k].find(w("fldChar"))
                    if fc is not None and fc.get(w("fldCharType")) == "begin":
                        # collect until matching end
                        depth, end = 0, None
                        for m in range(k, len(runs)):
                            f = runs[m].find(w("fldChar"))
                            if f is not None:
                                t = f.get(w("fldCharType"))
                                depth += 1 if t == "begin" else (-1 if t == "end" else 0)
                                if depth == 0:
                                    end = m
                                    break
                        if end is None:
                            break
                        group = runs[k:end + 1]
                        instr = "".join(x.text or "" for r in group for x in r.findall(w("instrText")))
                        if re.search(r"\b(DATE|TIME|CREATEDATE|SAVEDATE|PRINTDATE)\b", instr):
                            result = "".join(_text_of(r) for r in group)
                            if result.strip():
                                self.removed.append(result.strip())
                            parent = group[0].getparent()
                            idx = parent.index(group[0])
                            rpr = None
                            for r in group:
                                if _text_of(r).strip():
                                    rpr = r.find(w("rPr"))
                            rpr = rpr if rpr is not None else group[0].find(w("rPr"))
                            for r in group:
                                r.getparent().remove(r)
                            if op.get("slot") and count == 0:
                                self._insert_marker(parent, idx, rpr, op["slot"])
                            count += 1
                            runs = list(p.iter(w("r")))
                            continue
                        k = end + 1
                        continue
                    k += 1
            # also fldSimple
            for fs in list(root.iter(w("fldSimple"))):
                if re.search(r"\bDATE|TIME\b", fs.get(w("instr"), "")):
                    self.removed.append(_text_of(fs))
                    fs.getparent().remove(fs)
                    count += 1
        if count == 0 and not op.get("optional"):
            raise SanitizeError("no DATE field found")

    def _find_paragraph(self, contains: str, occurrence: int = 0):
        target = _norm(contains)
        hits = []
        for name in self.story_parts():
            for p in self.tree(name).getroot().iter(w("p")):
                # a paragraph anchoring a text box also holds the box's text: take the innermost
                if target in _norm(_text_of(p)) and not any(
                    target in _norm(_text_of(q)) for q in p.iter(w("p")) if q is not p
                ):
                    hits.append(p)
        if not hits or len(hits) <= occurrence:
            raise SanitizeError(f"paragraph not found: {contains!r}")
        return hits[occurrence]  # negative occurrence counts from the end

    def op_insert_after(self, op: dict):
        """Insert a marker right after the run that ends a given label."""
        p = self._find_paragraph(op["contains"], int(op.get("occurrence", 0)))
        target = _norm(op["contains"])
        acc = ""
        for r in p.iter(w("r")):
            acc += _text_of(r)
            if target in _norm(acc):
                parent = r.getparent()
                self._insert_marker(parent, parent.index(r) + 1, r.find(w("rPr")), op["slot"])
                return
        raise SanitizeError(f"run not found for {op['contains']!r}")

    def op_drop_fallback(self, op: dict):
        """Remove the legacy VML copies (mc:Fallback) of text boxes and shapes.

        Word and LibreOffice draw the DrawingML version (mc:Choice); the fallback
        would otherwise keep a second copy of every historical value.
        """
        MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
        n = 0
        for name in self.story_parts():
            for fb in list(self.tree(name).getroot().iter(f"{{{MC}}}Fallback")):
                fb.getparent().remove(fb)
                n += 1
        if n == 0 and not op.get("optional"):
            raise SanitizeError("drop_fallback: no mc:Fallback found")

    def op_textbox_nowrap(self, op: dict):
        """Keep a text box value on one line (Word output): a value longer than the
        historical one would otherwise wrap and be clipped by the fixed box height."""
        WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
        for contains in op["contains"]:
            p = self._find_paragraph(contains)
            shape = next((a for a in p.iterancestors() if a.tag == f"{{{WPS}}}wsp"), None)
            body = shape.find(f"{{{WPS}}}bodyPr") if shape is not None else None
            if body is None:
                raise SanitizeError(f"textbox_nowrap: {contains!r} is not in a text box")
            body.set("wrap", "none")

    def op_textbox_move(self, op: dict):
        """Move the text box holding a phrase vertically by ``dy`` points (e.g. to put values on
        the same line as their labels when the original boxes were placed too low)."""
        WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
        p = self._find_paragraph(op["contains"])
        anchor = next((a for a in p.iterancestors() if a.tag == f"{{{WP}}}anchor"), None)
        off = anchor.find(f"{{{WP}}}positionV/{{{WP}}}posOffset") if anchor is not None else None
        if off is None:
            raise SanitizeError(f"textbox_move: {op['contains']!r} is not in a positioned text box")
        off.text = str(int(off.text) + round(float(op.get("dy", 0)) * 12700))
        if op.get("dx"):
            offx = anchor.find(f"{{{WP}}}positionH/{{{WP}}}posOffset")
            if offx is None:
                raise SanitizeError(f"textbox_move: {op['contains']!r} has no horizontal offset")
            offx.text = str(int(offx.text) + round(float(op["dx"]) * 12700))

    def op_textbox_para(self, op: dict):
        """Align the paragraphs of the text box holding a phrase: left-to-right, ``jc`` and an
        optional left indent (points), so text can start at a given x without moving the box."""
        WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
        p = self._find_paragraph(op["contains"])
        box = next((a for a in p.iterancestors() if a.tag == f"{{{W}}}txbxContent"), None)
        if box is None:
            raise SanitizeError(f"textbox_para: {op['contains']!r} is not in a text box")
        for para in box.iter(w("p")):
            ppr = para.find(w("pPr"))
            if ppr is None:
                ppr = etree.Element(w("pPr"))
                para.insert(0, ppr)
            for tag in ("bidi", "jc", "ind"):
                for el in ppr.findall(w(tag)):
                    ppr.remove(el)
            # schema order: ... bidi, ..., ind, ..., jc, ... (before rPr); the explicit bidi="0"
            # overrides right-to-left paragraph styles (where "left" would mean the start side)
            rpr = ppr.find(w("rPr"))
            later = {w(t) for t in ("adjustRightInd", "snapToGrid", "spacing", "contextualSpacing",
                                    "mirrorIndents", "suppressOverlap", "textDirection", "textAlignment",
                                    "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange")}
            bidi = etree.Element(w("bidi"))
            bidi.set(w("val"), "0")
            nxt = next((c for c in ppr if c.tag in later), None)
            if nxt is not None:
                nxt.addprevious(bidi)
            else:
                ppr.append(bidi)
            items = []
            if op.get("ind_left") is not None:
                ind = etree.Element(w("ind"))
                ind.set(w("left"), str(round(float(op["ind_left"]) * 20)))
                items.append(ind)
            jc = etree.Element(w("jc"))
            jc.set(w("val"), op.get("jc", "left"))
            items.append(jc)
            for el in items:
                if rpr is not None:
                    rpr.addprevious(el)
                else:
                    ppr.append(el)

    def op_textbox_resize(self, op: dict):
        """Set the width (points) of the text box holding a phrase, keeping its left edge."""
        WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
        A = "http://schemas.openxmlformats.org/drawingml/2006/main"
        p = self._find_paragraph(op["contains"])
        anchor = next((a for a in p.iterancestors() if a.tag == f"{{{WP}}}anchor"), None)
        if anchor is None:
            raise SanitizeError(f"textbox_resize: {op['contains']!r} is not in a text box")
        cx = str(round(float(op["width"]) * 12700))
        anchor.find(f"{{{WP}}}extent").set("cx", cx)
        for ext in anchor.iter(f"{{{A}}}ext"):
            if ext.get("cx") is not None:
                ext.set("cx", cx)

    def op_mark_word(self, op: dict):
        """Put a zero-width marker right after a word (e.g. the signature label «الاستشاري»).

        The word may share a run with other labels ("الاستشاري    المقاول    المالك"),
        so the run is split exactly at the end of the word. ``occurrence`` counts over
        all body paragraphs (negative = from the end).
        """
        words = op["words"]
        hits = []
        for p in self.tree("word/document.xml").getroot().iter(w("p")):
            runs = [r for r in p.iter(w("r")) if r.find(w("t")) is not None]
            full = "".join(_text_of(r) for r in runs)
            for word in words:
                for m in re.finditer(re.escape(word), full):
                    hits.append((p, runs, m.end()))
        if not hits:
            raise SanitizeError(f"mark_word: none of {words} found")
        hits.sort(key=lambda h: 0)  # document order is kept by iteration
        p, runs, end = hits[int(op.get("occurrence", -1))]
        pos = 0
        for r in runs:
            txt = _text_of(r)
            if pos + len(txt) >= end:
                cut = end - pos
                t_el = r.findall(w("t"))
                head, tail_txt = txt[:cut], txt[cut:]
                for extra in t_el[1:]:
                    r.remove(extra)
                t_el[0].text = head
                t_el[0].set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                parent = r.getparent()
                idx = parent.index(r)
                text = self.new_marker(op["slot"]) if self.with_markers else "\u00a0" * 6
                mrun = _make_marker_run(r.find(w("rPr")), text, True, self.default_cs_font())
                mrpr = mrun.find(w("rPr"))
                for tag in ("sz", "szCs", "spacing"):
                    for el in mrpr.findall(w(tag)):
                        mrpr.remove(el)
                for tag, val in (("spacing", "-20"), ("sz", "2"), ("szCs", "2")):
                    el = etree.SubElement(mrpr, w(tag))
                    el.set(w("val"), val)
                parent.insert(idx + 1, mrun)
                if tail_txt:
                    tail = copy.deepcopy(r)
                    for tt in tail.findall(w("t")):
                        tail.remove(tt)
                    nt = etree.SubElement(tail, w("t"))
                    nt.text = tail_txt
                    nt.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                    parent.insert(idx + 2, tail)
                return
            pos += len(txt)
        raise SanitizeError("mark_word: run not found")

    def op_text(self, op: dict):
        """Remove a phrase inside a paragraph (may span runs) and mark its position."""
        p = self._find_paragraph(op["contains"], int(op.get("occurrence", 0)))
        old = op["old"]
        runs = [r for r in p.iter(w("r")) if r.find(w("t")) is not None]
        full = "".join(_text_of(r) for r in runs)
        start = full.find(old)
        if start < 0:
            raise SanitizeError(f"text {old!r} not found in paragraph")
        end = start + len(old)
        self.removed.append(old.strip())
        pos = 0
        marker_done = rlm_done = False
        for r in runs:
            ts = r.findall(w("t"))
            for t in ts:
                txt = t.text or ""
                a, b = pos, pos + len(txt)
                pos = b
                if b <= start or a >= end:
                    continue
                s0, s1 = max(start, a) - a, min(end, b) - a
                if op.get("rtl") and not rlm_done:
                    # Arabic text in a left-to-right paragraph: a right-to-left mark where the value
                    # was keeps the remaining «: /» with the Arabic label (else it jumps to the far side)
                    rlm_done = True
                    txt = txt[:s0] + "\u200f" + txt[s0:]
                    s0, s1 = s0 + 1, s1 + 1
                t.text = txt[:s0] + txt[s1:]
                t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                if not marker_done and op.get("slot") and op.get("reserve"):
                    # a value inside running text: keep a blank gap of figure spaces where the
                    # value will be drawn (same in both variants, so the layout cannot shift);
                    # the marker itself is zero-width
                    marker_done = True
                    before, after = txt[:s0], txt[s1:]
                    t.text = before
                    parent = r.getparent()
                    idx = parent.index(r)
                    text = self.new_marker(op["slot"]) if self.with_markers else "\u00a0" * 6
                    mrun = _make_marker_run(r.find(w("rPr")), text, True, self.default_cs_font())
                    mrpr = mrun.find(w("rPr"))
                    for tag in ("sz", "szCs", "spacing"):
                        for el in mrpr.findall(w(tag)):
                            mrpr.remove(el)
                    for tag, val in (("spacing", "-20"), ("sz", "2"), ("szCs", "2")):
                        el = etree.SubElement(mrpr, w(tag))
                        el.set(w("val"), val)
                    filler = copy.deepcopy(r)
                    for tt in filler.findall(w("t")):
                        filler.remove(tt)
                    ft = etree.SubElement(filler, w("t"))
                    ft.text = FILLER * int(op["reserve"])
                    ft.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                    parent.insert(idx + 1, mrun)
                    parent.insert(idx + 2, filler)
                    if after:
                        tail = copy.deepcopy(r)
                        for tt in tail.findall(w("t")):
                            tail.remove(tt)
                        nt = etree.SubElement(tail, w("t"))
                        nt.text = after
                        nt.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                        parent.insert(idx + 3, tail)
                elif not marker_done and op.get("slot"):
                    marker_done = True
                    anchor_run = r
                    if op.get("keep_line") or op.get("newline"):
                        # keep_line: the value was the whole line; newline: the value goes on its own
                        # line under the label. A no-break space in the text's own format holds the
                        # line height in both variants (use with "zero_width")
                        hold = copy.deepcopy(r)
                        for tt in hold.findall(w("t")):
                            hold.remove(tt)
                        if op.get("newline"):
                            etree.SubElement(hold, w("br"))
                        etree.SubElement(hold, w("t")).text = "\u00a0"
                        r.addnext(hold)
                        anchor_run = hold
                    if self.with_markers:
                        # split: put marker run after this run
                        before, after = txt[:s0], txt[s1:]
                        t.text = before
                        parent = r.getparent()
                        idx = parent.index(anchor_run)
                        mrun = _make_marker_run(r.find(w("rPr")), self.new_marker(op["slot"]), True, self.default_cs_font())
                        if op.get("zero_width"):
                            # a tiny marker cannot change the line (the slot gets its height from "pad")
                            mrpr = mrun.find(w("rPr"))
                            for tag in ("sz", "szCs", "spacing"):
                                for el in mrpr.findall(w(tag)):
                                    mrpr.remove(el)
                            for tag, val in (("spacing", "-20"), ("sz", "2"), ("szCs", "2")):
                                etree.SubElement(mrpr, w(tag)).set(w("val"), val)
                        parent.insert(idx + 1, mrun)
                        if after:
                            tail = copy.deepcopy(r)
                            for tt in tail.findall(w("t")):
                                tail.remove(tt)
                            nt = etree.SubElement(tail, w("t"))
                            nt.text = after
                            nt.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                            parent.insert(idx + 2, tail)
                    else:
                        self.new_marker(op["slot"])  # phrase simply removed in the clean variant
                        if op.get("ltr"):
                            # English label in a right-to-left paragraph: a left-to-right mark keeps
                            # "Villa of :" from turning into ": Villa of" once the value is gone
                            t.text = txt[:s0] + "\u200e" + txt[s1:]

    def op_replace_all(self, op: dict):
        """Replace a literal string in all text nodes (e.g. ☑ -> ☐)."""
        n = 0
        for name in self.story_parts():
            for t in self.tree(name).getroot().iter(w("t")):
                if t.text and op["old"] in t.text:
                    n += t.text.count(op["old"])
                    t.text = t.text.replace(op["old"], op["new"])
            # checkbox content controls keep their state in w14:checked
            for el in self.tree(name).getroot().iter("{http://schemas.microsoft.com/office/word/2010/wordml}checked"):
                el.set("{http://schemas.microsoft.com/office/word/2010/wordml}val", "0")
        if n == 0 and not op.get("optional"):
            raise SanitizeError(f"{op['old']!r} not found")

    def op_remove_image(self, op: dict):
        """Remove every drawing that embeds the given media part (stamps/signatures)."""
        target = op["target"]
        removed = 0
        for name in self.story_parts():
            rels_name = re.sub(r"word/(.*)$", r"word/_rels/\1.rels", name)
            if rels_name not in self.parts:
                continue
            rels = etree.fromstring(self.parts[rels_name])
            ids = {rel.get("Id") for rel in rels if rel.get("Target") == target}
            if not ids:
                continue
            root = self.tree(name).getroot()
            for blip in list(root.iter(f"{{{A}}}blip")) + list(root.iter(f"{{{V}}}imagedata")):
                rid = blip.get(f"{{{R}}}embed") or blip.get(f"{{{R}}}id")
                if rid in ids:
                    holder = blip
                    while holder is not None and holder.tag not in (w("drawing"), w("pict")):
                        holder = holder.getparent()
                    if holder is None:
                        continue
                    run = holder.getparent()
                    run.remove(holder)
                    removed += 1
            for rel in list(rels):
                if rel.get("Id") in ids:
                    rels.remove(rel)
            self.parts[rels_name] = etree.tostring(rels, xml_declaration=True, encoding="UTF-8", standalone=True)
        media = "word/" + target
        still_used = any(
            target.encode() in data for n, data in self.parts.items() if n.endswith(".rels")
        )
        if not still_used and media in self.parts:
            del self.parts[media]
            self.order.remove(media)
        if removed == 0:
            raise SanitizeError(f"no drawing found for {target}")

    def op_unfloat_nested_tables(self, op: dict):
        """Nested floating tables are rendered incorrectly by LibreOffice; anchor them inline."""
        doc = self.tree("word/document.xml").getroot()
        n = 0
        for tbl in doc.iter(w("tbl")):
            if tbl.getparent() is not None and any(a.tag == w("tc") for a in tbl.iterancestors()):
                for pr in tbl.findall(f"{w('tblPr')}/{w('tblpPr')}"):
                    pr.getparent().remove(pr)
                    n += 1
        if op.get("outer"):
            for tbl in doc.iter(w("tbl")):
                for pr in tbl.findall(f"{w('tblPr')}/{w('tblpPr')}"):
                    pr.getparent().remove(pr)
                    n += 1
        if n == 0:
            raise SanitizeError("no floating tables found")

    def op_photo_grid(self, op: dict):
        """Photo report cards: each outer cell = [empty paragraphs][details table][p].

        * nested + outer floating tables are anchored inline (LibreOffice cannot
          lay out nested floating tables),
        * the leading empty paragraphs become one fixed-height spacer that holds
          the photo (slot photo_N),
        * the details cell (dropdown content control) and notes cell are cleared
          (slots details_N / notes_N).
        """
        doc = self.tree("word/document.xml").getroot()
        for tbl in doc.iter(w("tbl")):
            for pr in tbl.findall(f"{w('tblPr')}/{w('tblpPr')}"):
                pr.getparent().remove(pr)
        n = 0
        spacer = str(op.get("spacer_twips", 3700))
        for tc in list(doc.iter(w("tc"))):
            nested = tc.find(w("tbl"))
            if nested is None:
                continue
            leading = []
            for child in tc:
                if child.tag == w("p"):
                    leading.append(child)
                elif child.tag == w("tbl"):
                    break
            if not leading:
                continue
            first = leading[0]
            for extra in leading[1:]:
                tc.remove(extra)
            ppr = first.find(w("pPr"))
            if ppr is None:
                ppr = etree.SubElement(first, w("pPr"))
                first.insert(0, ppr)
            for sp in ppr.findall(w("spacing")):
                ppr.remove(sp)
            sp = etree.Element(w("spacing"))
            sp.set(w("before"), "0")
            sp.set(w("after"), "0")
            sp.set(w("line"), spacer)
            sp.set(w("lineRule"), "exact")
            ppr.insert(0, sp)
            for child in list(first):
                if child.tag != w("pPr"):
                    first.remove(child)
            self._insert_marker(first, len(first), first.find(f"{w('pPr')}/{w('rPr')}"), f"photo_{n}")
            rows = nested.findall(w("tr"))
            details_cells = _row_cells(rows[0])
            notes_cells = _row_cells(rows[1])
            # the details cell holds a generic dropdown caption, not project data
            self._clear_cell(details_cells[1], f"details_{n}", record=False)
            self._clear_cell(notes_cells[1], f"notes_{n}")
            if op.get("compact_trailing"):
                # Word needs a paragraph after a nested table; make it 1pt high and let the row
                # end right there, so no thin empty band shows under the details table
                after = [c for c in tc if c.tag == w("p") and c.getprevious() is not None and c.getprevious().tag == w("tbl")]
                for tp in after:
                    tpr = tp.find(w("pPr"))
                    if tpr is None:
                        tpr = etree.Element(w("pPr"))
                        tp.insert(0, tpr)
                    for old_sp in tpr.findall(w("spacing")):
                        tpr.remove(old_sp)
                    tsp = etree.Element(w("spacing"))
                    tsp.set(w("before"), "0")
                    tsp.set(w("after"), "0")
                    tsp.set(w("line"), "20")
                    tsp.set(w("lineRule"), "exact")
                    tpr.insert(0, tsp)
                    rpr = tpr.find(w("rPr"))
                    if rpr is None:
                        rpr = etree.SubElement(tpr, w("rPr"))
                    for tag in ("sz", "szCs"):
                        for old_el in rpr.findall(w(tag)):
                            rpr.remove(old_el)
                        el = etree.SubElement(rpr, w(tag))
                        el.set(w("val"), "2")
                tr = tc.getparent()
                trpr = tr.find(w("trPr"))
                if trpr is not None:
                    for th in trpr.findall(w("trHeight")):
                        th.set(w("hRule"), "atLeast")
                        th.set(w("val"), "0")
            n += 1
        if n != op.get("expected", n):
            raise SanitizeError(f"photo_grid: found {n} cards, expected {op['expected']}")
        if n == 0:
            raise SanitizeError("photo_grid: no photo cards found")

    def op_clear_columns(self, op: dict):
        """Clear every data cell under the given column headers (tables of progress values).

        Columns are matched on the table grid (gridSpan aware), so rows with merged
        or split cells are handled too.
        """
        heads = [_norm(h) for h in op["headers"]]

        def spans(cells):
            pos, out = 0, []
            for c in cells:
                gs = c.find(f"{w('tcPr')}/{w('gridSpan')}")
                n = int(gs.get(w("val"))) if gs is not None else 1
                out.append((pos, pos + n))
                pos += n
            return out

        n = 0
        for tbl in self.tree("word/document.xml").getroot().iter(w("tbl")):
            ranges = None
            for tr in tbl.findall(w("tr")):
                cells = _row_cells(tr)
                texts = [_norm(_text_of(c)) for c in cells]
                sp = spans(cells)
                hits = [sp[i] for i, t in enumerate(texts) if t in heads]
                if hits:
                    ranges = hits
                    continue
                if ranges is None:
                    continue
                for c, (a0, a1) in zip(cells, sp):
                    if any(a0 >= r0 and a1 <= r1 for r0, r1 in ranges) and _text_of(c).strip():
                        self._clear_cell(c, None)
                        n += 1
        if n == 0 and not op.get("optional"):
            raise SanitizeError(f"clear_columns: nothing cleared for {op['headers']}")

    def op_trim_leading_empty_paragraphs(self, op: dict):
        """Remove empty paragraphs at the top of the body (pulls the letter up under the letterhead)."""
        body = self.tree("word/document.xml").getroot().find(w("body"))
        keep = int(op.get("keep", 0))
        empties = []
        for child in body:
            if child.tag != w("p"):
                break
            has_content = _text_of(child).strip() or child.find(f".//{w('drawing')}") is not None or child.find(f".//{w('fldChar')}") is not None
            if has_content:
                break
            empties.append(child)
        for p in empties[keep:]:
            body.remove(p)
        if not empties and not op.get("optional"):
            raise SanitizeError("no leading empty paragraphs")

    def op_footer_align(self, op: dict):
        """Re-align footer paragraphs matching a pattern (e.g. move the form code off the letterhead contact block)."""
        pattern = re.compile(op["pattern"])
        align = op.get("align", "right")
        hits = 0
        for name in self.story_parts():
            if not re.match(r"word/footer\d*\.xml$", name):
                continue
            for p in self.tree(name).getroot().iter(w("p")):
                if not pattern.search(_text_of(p)):
                    continue
                ppr = p.find(w("pPr"))
                if ppr is None:
                    ppr = etree.SubElement(p, w("pPr"))
                    p.remove(ppr)
                    p.insert(0, ppr)
                for old in ppr.findall(w("jc")) + ppr.findall(w("tabs")) + (ppr.findall(w("pBdr")) if op.get("drop_border") else []):
                    ppr.remove(old)
                jc = etree.Element(w("jc"))
                jc.set(w("val"), align)
                # schema order: jc comes after spacing/ind and before rPr
                rpr = ppr.find(w("rPr"))
                if rpr is not None:
                    rpr.addprevious(jc)
                else:
                    ppr.append(jc)
                for r in list(p.iter(w("r"))):
                    if r.find(w("tab")) is not None and not _text_of(r).strip():
                        r.getparent().remove(r)
                hits += 1
        if not hits:
            raise SanitizeError(f"no footer paragraph matches {op['pattern']!r}")

    def op_remove_paragraph(self, op: dict):
        p = self._find_paragraph(op["contains"], int(op.get("occurrence", 0)))
        self.removed.append(_text_of(p).strip())
        p.getparent().remove(p)

    # ------------------------------------------------------------ metadata
    def scrub_metadata(self):
        core = "docProps/core.xml"
        if core in self.parts:
            root = etree.fromstring(self.parts[core])
            for el in root:
                local = etree.QName(el).localname
                if local in ("creator", "lastModifiedBy"):
                    if el.text:
                        self.removed.append(el.text)
                    el.text = "ACAD Document Generator"
                elif local in ("title", "subject", "keywords", "description", "category"):
                    el.text = ""
                elif local in ("lastPrinted",):
                    root.remove(el)
                elif local in ("created", "modified"):
                    el.text = "2026-01-01T00:00:00Z"
                elif local == "revision":
                    el.text = "1"
            self.parts[core] = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
        app = "docProps/app.xml"
        if app in self.parts:
            root = etree.fromstring(self.parts[app])
            for el in root:
                if etree.QName(el).localname in ("Company", "Manager", "HyperlinkBase"):
                    el.text = ""
            self.parts[app] = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
        if "docProps/custom.xml" in self.parts:
            # custom properties (e.g. DLP classification) can carry user names: drop the part
            self.removed.append(etree.fromstring(self.parts["docProps/custom.xml"]).xpath("string()"))
            self._drop_part("docProps/custom.xml")
        # SharePoint / document-library metadata (content type ids, revision data): not needed
        custom = [n for n in self.parts if n.startswith("customXml/")]
        if custom:
            for n in custom:
                del self.parts[n]
                if n in self.order:
                    self.order.remove(n)
            for rels_name in [n for n in self.parts if n.endswith(".rels")]:
                rels = etree.fromstring(self.parts[rels_name])
                drop = [r for r in rels if "customXml/" in r.get("Target", "")]
                for r in drop:
                    rels.remove(r)
                if drop:
                    self.parts[rels_name] = etree.tostring(rels, xml_declaration=True, encoding="UTF-8", standalone=True)
            ct = etree.fromstring(self.parts["[Content_Types].xml"])
            for el in list(ct):
                if el.get("PartName", "").startswith("/customXml/"):
                    ct.remove(el)
            self.parts["[Content_Types].xml"] = etree.tostring(ct, xml_declaration=True, encoding="UTF-8", standalone=True)
        for n in list(self.parts):
            if n == "word/people.xml" or n.startswith("word/comments"):
                raise SanitizeError(f"unexpected part with personal data: {n}")
        settings = "word/settings.xml"
        if settings in self.parts:
            root = etree.fromstring(self.parts[settings])
            for tag in ("attachedTemplate", "docVars", "rsids"):
                for el in root.findall(w(tag)):
                    root.remove(el)
            self.parts[settings] = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)

    def op_copy_header(self, op: dict):
        """Give the document the ACAD letterhead: copy the default header (with its
        images) from another reference document of the same layout."""
        from pathlib import Path

        REL = "http://schemas.openxmlformats.org/package/2006/relationships"
        HDR = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header"
        src_path = Path(__file__).resolve().parents[2] / "reference-documents" / op["from"]
        src = zipfile.ZipFile(src_path)
        src_rels = etree.fromstring(src.read("word/_rels/document.xml.rels"))
        hdr_rel = next((r for r in src_rels if r.get("Type") == HDR), None)
        if hdr_rel is None:
            raise SanitizeError(f"copy_header: {op['from']} has no header")
        hdr_src = "word/" + hdr_rel.get("Target").lstrip("/").removeprefix("word/")
        n = 1
        while f"word/header{n}.xml" in self.parts:
            n += 1
        hdr_name = f"word/header{n}.xml"
        self.parts[hdr_name] = src.read(hdr_src)
        self.order.append(hdr_name)
        # header images
        src_hdr_rels = f"word/_rels/{hdr_src.split('/')[-1]}.rels"
        exts = set()
        if src_hdr_rels in src.namelist():
            hrels = etree.fromstring(src.read(src_hdr_rels))
            for rel in hrels:
                target = rel.get("Target")
                if rel.get("TargetMode") == "External" or not target:
                    continue
                media_src = "word/" + target.lstrip("/").removeprefix("word/")
                ext = media_src.rsplit(".", 1)[-1].lower()
                new_media = f"word/media/acad-letterhead-{len(exts) + 1}.{ext}"
                self.parts[new_media] = src.read(media_src)
                self.order.append(new_media)
                rel.set("Target", new_media.removeprefix("word/"))
                exts.add(ext)
            rels_name = f"word/_rels/header{n}.xml.rels"
            self.parts[rels_name] = etree.tostring(hrels, xml_declaration=True, encoding="UTF-8", standalone=True)
            self.order.append(rels_name)
        # document relationship + section reference
        rels_name = "word/_rels/document.xml.rels"
        drels = etree.fromstring(self.parts[rels_name])
        ids = {r.get("Id") for r in drels}
        rid = next(f"rIdAcadHdr{i}" for i in range(1, 100) if f"rIdAcadHdr{i}" not in ids)
        rel = etree.SubElement(drels, f"{{{REL}}}Relationship")
        rel.set("Id", rid)
        rel.set("Type", HDR)
        rel.set("Target", f"header{n}.xml")
        self.parts[rels_name] = etree.tostring(drels, xml_declaration=True, encoding="UTF-8", standalone=True)
        R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        for sect in self.tree("word/document.xml").getroot().iter(w("sectPr")):
            for old in sect.findall(w("headerReference")):
                if old.get(w("type")) == "default":
                    sect.remove(old)
            ref = etree.Element(w("headerReference"))
            ref.set(w("type"), "default")
            ref.set(f"{{{R}}}id", rid)
            sect.insert(0, ref)
        # content types
        CT = "http://schemas.openxmlformats.org/package/2006/content-types"
        ct = etree.fromstring(self.parts["[Content_Types].xml"])
        ov = etree.SubElement(ct, f"{{{CT}}}Override")
        ov.set("PartName", "/" + hdr_name)
        ov.set("ContentType", "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml")
        have = {d.get("Extension", "").lower() for d in ct.findall(f"{{{CT}}}Default")}
        for ext in exts - have:
            d = etree.Element(f"{{{CT}}}Default")
            d.set("Extension", ext)
            d.set("ContentType", "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}")
            ct.insert(0, d)
        self.parts["[Content_Types].xml"] = etree.tostring(ct, xml_declaration=True, encoding="UTF-8", standalone=True)

    def _drop_part(self, name: str):
        del self.parts[name]
        self.order.remove(name)
        rels = etree.fromstring(self.parts["_rels/.rels"])
        for rel in list(rels):
            if rel.get("Target", "").lstrip("/") == name:
                rels.remove(rel)
        self.parts["_rels/.rels"] = etree.tostring(rels, xml_declaration=True, encoding="UTF-8", standalone=True)
        ct = etree.fromstring(self.parts["[Content_Types].xml"])
        for el in list(ct):
            if el.get("PartName", "").lstrip("/") == name:
                ct.remove(el)
        self.parts["[Content_Types].xml"] = etree.tostring(ct, xml_declaration=True, encoding="UTF-8", standalone=True)

    # ------------------------------------------------------------ run
    def fix_table_direction(self):
        """Lay tables out like Word in right-to-left documents.

        Word draws a table without w:bidiVisual left-to-right; LibreOffice mirrors such a
        table when it holds right-to-left paragraphs or sits in a right-to-left section
        (labels end up on the wrong side of the PDF). An explicit w:bidiVisual="0" means
        the same to Word and stops the mirroring.
        """
        doc = self.tree("word/document.xml").getroot()
        before = {w(t) for t in ("tblStyle", "tblpPr", "tblOverlap")}
        for tblpr in doc.iter(w("tblPr")):
            if tblpr.find(w("bidiVisual")) is not None:
                continue
            el = etree.Element(w("bidiVisual"))
            el.set(w("val"), "0")
            idx = 0
            for i, child in enumerate(tblpr):
                if child.tag in before:
                    idx = i + 1
            tblpr.insert(idx, el)

    def apply(self, ops: list[dict]) -> DocxResult:
        for op in ops:
            fn = getattr(self, "op_" + op["op"], None)
            if fn is None:
                raise SanitizeError(f"unknown docx op {op['op']}")
            self._marker_style = op.get("marker")
            fn(op)
        self.fix_table_direction()
        self.scrub_metadata()
        for name, tree in self.trees.items():
            self.parts[name] = etree.tostring(tree.getroot(), xml_declaration=True, encoding="UTF-8", standalone=True)
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for name in self.order:
                if name in self.parts:
                    zi = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                    zi.compress_type = zipfile.ZIP_DEFLATED
                    z.writestr(zi, self.parts[name])
        return DocxResult(out.getvalue(), [v for v in self.removed if v], dict(self.markers))


def sanitize_docx(source: bytes, ops: list[dict], with_markers: bool) -> DocxResult:
    return DocxSanitizer(source, with_markers).apply(ops)


def docx_all_text(data: bytes) -> str:
    """All XML text of every part, for leak checks."""
    z = zipfile.ZipFile(io.BytesIO(data))
    chunks = []
    for n in z.namelist():
        if n.endswith(".xml") or n.endswith(".rels"):
            raw = z.read(n).decode("utf-8", "replace")
            chunks.append(raw)
            try:
                chunks.append("".join(etree.fromstring(z.read(n)).itertext()))
            except etree.XMLSyntaxError:
                pass
    return "\n".join(chunks)
