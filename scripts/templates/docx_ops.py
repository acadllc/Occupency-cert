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


def _make_marker_run(rpr_source, text: str):
    run = etree.Element(w("r"))
    rpr = copy.deepcopy(rpr_source) if rpr_source is not None else etree.Element(w("rPr"))
    rpr.tag = w("rPr")
    for tag in ("color", "highlight", "shd", "vanish", "webHidden", "rStyle", "u"):
        for el in rpr.findall(w(tag)):
            rpr.remove(el)
    # values are mostly Arabic: measure with the complex-script size (szCs) when present
    szcs = rpr.find(w("szCs"))
    if szcs is not None:
        for el in rpr.findall(w("sz")):
            rpr.remove(el)
        sz = etree.SubElement(rpr, w("sz"))
        sz.set(w("val"), szcs.get(w("val")))
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

    def story_parts(self) -> list[str]:
        names = ["word/document.xml"]
        names += sorted(n for n in self.parts if re.match(r"word/(header|footer)\d*\.xml$", n))
        return names

    def new_marker(self, slot: str) -> str:
        self._marker_index += 1
        text = marker_text(self._marker_index)
        self.markers[text] = slot
        return text

    def _insert_marker(self, parent, index: int, rpr_source, slot: str):
        if not self.with_markers:
            # still register the slot so marker numbering is identical between variants
            self.new_marker(slot)
            return
        parent.insert(index, _make_marker_run(rpr_source, self.new_marker(slot)))

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

    def _clear_cell(self, tc, slot: str | None):
        paras = tc.findall(w("p"))
        old = "\n".join(_text_of(p) for p in paras).strip()
        if old:
            self.removed.append(old)
        rpr = _first_rpr(tc)
        for p in paras[1:]:
            tc.remove(p)
        p = paras[0]
        for child in list(p):
            if child.tag != w("pPr"):
                p.remove(child)
        if slot:
            self._insert_marker(p, len(p), rpr, slot)

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
                if target in _norm(_text_of(p)):
                    hits.append(p)
        if len(hits) <= occurrence:
            raise SanitizeError(f"paragraph not found: {contains!r}")
        return hits[occurrence]

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
        marker_done = False
        for r in runs:
            ts = r.findall(w("t"))
            for t in ts:
                txt = t.text or ""
                a, b = pos, pos + len(txt)
                pos = b
                if b <= start or a >= end:
                    continue
                s0, s1 = max(start, a) - a, min(end, b) - a
                t.text = txt[:s0] + txt[s1:]
                t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                if not marker_done and op.get("slot"):
                    marker_done = True
                    if self.with_markers:
                        # split: put marker run after this run
                        before, after = txt[:s0], txt[s1:]
                        t.text = before
                        parent = r.getparent()
                        idx = parent.index(r)
                        mrun = _make_marker_run(r.find(w("rPr")), self.new_marker(op["slot"]))
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
                        self.new_marker(op["slot"])

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
        for n in list(self.parts):
            if n in ("word/people.xml", "docProps/custom.xml") or n.startswith("word/comments"):
                raise SanitizeError(f"unexpected part with personal data: {n}")
        settings = "word/settings.xml"
        if settings in self.parts:
            root = etree.fromstring(self.parts[settings])
            for tag in ("attachedTemplate", "docVars", "rsids"):
                for el in root.findall(w(tag)):
                    root.remove(el)
            self.parts[settings] = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)

    # ------------------------------------------------------------ run
    def apply(self, ops: list[dict]) -> DocxResult:
        for op in ops:
            fn = getattr(self, "op_" + op["op"], None)
            if fn is None:
                raise SanitizeError(f"unknown docx op {op['op']}")
            fn(op)
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
