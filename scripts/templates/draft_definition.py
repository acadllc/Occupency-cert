#!/usr/bin/env python3
"""Draft a template definition for an ACAD / bank Word letter.

    python3 scripts/templates/draft_definition.py <source.docx relative to reference-documents> \\
        --key bank-fin-final-receipt --name "Final Handover Report" --name-ar "محضر استلام نهائي" \\
        --category "دفعة نهائية" --project-type bank [--write] [--extra extra.json]

What it recognises (and maps to EXISTING fields only):
  * the project table rows (رقم المشروع / اسم المالك / اسم الاستشاري / اسم المقاول /
    موقع المشروع / مكونات المشروع / الرقم المرجعي / start & end dates), in both
    table directions (bidiVisual or not), and "label value" written in one cell;
  * the letter date (typed, or a Word DATE field);
  * later mentions of the owner / contractor names in the text (a blank gap is
    reserved so the value cannot run into the following words);
  * old stamps / signatures pasted into the body (images outside the header).
Other project data it finds (dates, project numbers in headers, values in known
rows) is cleared without a field, so it stays blank for the user.

--extra adds hand-written sanitize ops / slots / fields (JSON with the same keys,
plus "drop_slots" / "drop_old" / "drop_ops" to discard drafted ops, "remap" to change a
drafted field's value, "marker" for the font/size of drafted cell markers and "props"
for extra definition keys).
The draft is a starting point: build it, look at the QA renders, adjust.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

from lxml import etree

ROOT = Path(__file__).resolve().parents[2]
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def w(tag: str) -> str:
    return f"{{{W}}}{tag}"


def text_of(el) -> str:
    return "".join(t.text or "" for t in el.iter(w("t")))


def norm(s: str) -> str:
    s = re.sub(r"[‎‏‪-‮ـ]", "", s)
    s = s.replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip()


def squash(s: str) -> str:
    s = norm(s).rstrip(":：").strip()
    s = re.sub(r"[أإآ]", "ا", s).replace("ة", "ه").replace("ى", "ي")
    return s.replace(" ", "").replace(":", "")


# label (squashed) -> (slot base, mapping value; None = clear without a field)
LABELS: dict[str, tuple[str | None, str | None]] = {}
for labels, slot, value in [
    (["رقم المشروع"], "project_id", "project_id"),
    (["اسم المالك", "اسم المــالك"], "owner", "owner_name_ar"),
    (["اسم الاستشاري", "الاستشاري ( التصميم )", "الاستشاري ( الإشراف )"], "consultant", "$consultant_name_ar"),
    (["اسم المقاول"], "contractor", "contractor_name_ar"),
    (["موقع المشروع"], "location", "@project_location_ar"),
    (["مكونات المشروع"], "components", "project_components_ar"),
    (["المشروع"], "project", "project_description_ar"),
    (["الرقم المرجعي", "رقم القسيمه", "رقم القسيمة"], "plot", "plot_number"),
    (["تاريخ بداية العمل", "تاريخ أمر المباشرة", "تاريخ أمر المباشره", "تاريخ امر المباشره"], "start_date", "project_start_date"),
    (["تاريخ نهاية العمل", "تاريخ إنتهاء المشروعحسب العقد", "تاريخ إنتهاء المشروع حسب العقد"], "end_date", "project_end_date"),
    ([
        "قيمة المشروع", "مدة المشروع", "إحداثيات الموقع GPS", "التمديد الزمني", "تاريخ النهاية المعدل", "تمديد المشروع",
        "تاريخ دفع رسوم الكهرباء", "تاريخ دفع رسوم المياه", "تاريخ الإستلام الإبتدائي الفعلي", "إجمالي غرامة التأخير",
        "مدة التأخير", "الفتره الزمنية الأصلية للمشروع", "التمديدات الزمنية السابقة ( شهر)",
        "الفتره الزمنية المطلوب تمديد المشروع لها ( شهر )", "تاريخ إنتهاء المشروعحسب التمديد السابق",
        "تاريخ إنتهاء المشروعحسب التمديد الجديد", "نسبة إنجاز الأعمال الحالية بالموقع",
        "نسبة إنجاز اخر دفعه تم صرفها", "نسبة إنجاز الدفعة الحالية", "مدة المشروع المقترحة", "السعر التقديري",
        "المساحة الإجمالية للبناء",
    ], None, None),
]:
    for l in labels:
        LABELS[squash(l)] = (slot, value)

# combined "label value" cells (checklists): only the name / number labels
COMBINED = {squash(k): v for k, v in {
    "رقم المشروع": ("project_id", "project_id"),
    "اسم المالك": ("owner", "owner_name_ar"),
    "المقاول": ("contractor", "contractor_name_ar"),
    "الاستشاري": ("consultant", "$consultant_name_ar"),
    "موقع المشروع": ("location", "@project_location_ar"),
}.items()}

DATE = re.compile(r"\d{1,2}[_\s‎‏]*[/\-.][_\s‎‏]*\d{1,2}[_\s‎‏]*[/\-.][_\s‎‏]*\d{4}")


def text_of_field_results(p) -> str:
    """Text shown by the fields of a paragraph (between 'separate' and 'end')."""
    out, inside = [], False
    for r in p.iter(w("r")):
        fc = r.find(w("fldChar"))
        if fc is not None:
            kind = fc.get(w("fldCharType"))
            inside = kind == "separate" or (inside and kind != "end")
            continue
        if inside:
            out.append(text_of(r))
    return "".join(out)


class Draft:
    def __init__(self, src: Path, no_signature_names: bool = False):
        self.no_signature_names = no_signature_names
        self.z = zipfile.ZipFile(src)
        self.doc = etree.fromstring(self.z.read("word/document.xml"))
        self.ops: list[dict] = []
        self.fields: list[dict] = []
        self.slots: dict[str, dict] = {}
        self.counts: dict[str, int] = {}
        self.known: dict[str, list[str]] = {"owner": [], "contractor": [], "project_id": [], "plot": []}
        self.date_done = False

    def new_slot(self, base: str) -> str:
        n = self.counts.get(base, 0)
        self.counts[base] = n + 1
        return base if n == 0 else f"{base}_{n + 1}"

    def map_field(self, slot: str, value: str, kind: str = "cell", width: int = 210):
        if kind == "cell":
            self.slots[slot] = {"kind": "cell"}
        elif kind == "gap":
            self.slots[slot] = {"kind": "gap", "width": width}
        else:
            self.slots[slot] = {"kind": "inline", "width": width}
        # numbers and dates (12345678/01/000000) must keep their left-to-right order
        ltr = value in ("project_id", "bank_project_number", "date", "plot_number") or value.endswith("_date")
        style = {"font": "sans", "size": 12, "align": "right", "dir": "ltr" if ltr else "rtl"}
        if kind == "cell":
            style.update({"multiline": True, "padding": [4, 2, 4, 2]})
        else:
            style["padding"] = [0, 0, 0, 0]
        self.fields.append({"slot": slot, "value": value, **style})

    # body images: old stamps / signatures (small); a full-page letterhead image is kept
    def images(self):
        rels = etree.fromstring(self.z.read("word/_rels/document.xml.rels"))
        targets = {r.get("Id"): r.get("Target") for r in rels}
        WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
        A = "http://schemas.openxmlformats.org/drawingml/2006/main"
        small: set[str] = set()
        large: set[str] = set()
        for drawing in self.doc.iter(w("drawing")):
            ext = drawing.find(f".//{{{WP}}}extent")
            cx = int(ext.get("cx", "0")) if ext is not None else 0
            for blip in drawing.iter(f"{{{A}}}blip"):
                t = targets.get(blip.get(f"{{{R}}}embed"))
                if t:
                    (large if cx > 4_500_000 else small).add(t)
        for imd in self.doc.iter("{urn:schemas-microsoft-com:vml}imagedata"):
            t = targets.get(imd.get(f"{{{R}}}id"))
            shape = imd.getparent()
            m = re.search(r"width:([\d.]+)pt", shape.get("style", "") if shape is not None else "")
            if t:
                (large if m and float(m.group(1)) > 350 else small).add(t)
        for t in sorted(small - large):
            self.ops.append({"op": "remove_image", "target": t.lstrip("/").removeprefix("word/")})

    def tables(self):
        label_occ: dict[str, int] = {}
        for tbl in self.doc.iter(w("tbl")):
            tblpr = tbl.find(w("tblPr"))
            visual = tblpr is not None and tblpr.find(w("bidiVisual")) is not None
            for tr in tbl.findall(w("tr")):
                cells = tr.xpath("./w:tc | ./w:sdt/w:sdtContent/w:tc", namespaces={"w": W})
                texts = [norm(text_of(c)) for c in cells]
                raws = [text_of(c).strip() for c in cells]
                for i, t in enumerate(texts):
                    key = squash(t)
                    if key in LABELS:
                        occ = label_occ.get(raws[i], 0)
                        label_occ[raws[i]] = occ + 1
                        self.table_value(texts, raws, i, key, occ, visual)
                    else:
                        self.combined_cell(cells[i], t)

    def table_value(self, texts, raws, i, key, occ, visual):
        step = 1 if visual else -1  # the value follows the label in reading order
        j = i + step
        if 0 <= j < len(texts) and texts[j] in (":", "："):
            j += step
        elif (0 <= j < len(texts) and texts[j] == "" and 0 <= j + step < len(texts) and texts[j + step]
              and squash(texts[j + step]) not in LABELS and not texts[j + step].endswith(":")):
            j += step
        if not 0 <= j < len(texts) or squash(texts[j]) in LABELS:
            return
        base, value = LABELS[key]
        if base in self.known and texts[j]:
            self.known[base].append(texts[j])
        op = {"op": "cell", "label": raws[i], "offset": j - i}
        if occ:
            op["occurrence"] = occ
        if value:
            slot = self.new_slot(base)
            op["slot"] = slot
            self.map_field(slot, value)
            self.ops.append(op)
        elif texts[j]:
            self.ops.append(op)

    def combined_cell(self, cell, t):
        for lab, (base, value) in COMBINED.items():
            if not squash(t).startswith(lab) or len(squash(t)) <= len(lab) + 2:
                continue
            raw = text_of(cell)
            parts = re.split(r"\s{2,}|[:：]\s*", raw.strip(), maxsplit=1)
            old = parts[1].strip() if len(parts) > 1 else ""
            if not old or squash(old) in LABELS:
                return
            slot = self.new_slot(base)
            self.ops.append({"op": "text", "contains": old, "old": old, "slot": slot})
            self.map_field(slot, value, kind="inline", width=200)
            if base in self.known:
                self.known[base].append(old)
            return

    def paragraphs(self):
        for p in self.doc.iter(w("p")):
            if any(a.tag == w("tc") for a in p.iterancestors()):
                continue
            raw = "".join(x.text or "" for x in p.iter(w("t")))
            t = norm(raw)
            if not t:
                continue
            instr = "".join(x.text or "" for x in p.iter(w("instrText")))
            if re.search(r"\bDATE\b", instr):
                if not self.date_done:
                    self.ops.insert(0, {"op": "date_field", "slot": "date"})
                    self.map_field("date", "date", kind="inline", width=110)
                    self.date_done = True
                raw = raw.replace(text_of_field_results(p), "")
            if not self.date_done and t.startswith("التاريخ"):
                m = DATE.search(raw)
                if m:
                    self.ops.append({"op": "text", "contains": norm(m.group(0)), "old": m.group(0), "slot": "date"})
                    self.map_field("date", "date", kind="inline", width=110)
                    self.date_done = True
                    raw = raw.replace(m.group(0), "")
            for base in ("owner", "contractor"):
                value = "owner_name_ar" if base == "owner" else "contractor_name_ar"
                for v in sorted(set(self.known[base]), key=len, reverse=True):
                    for _ in range(raw.count(v)):
                        slot = self.new_slot(base)
                        if norm(raw) == norm(v) and self.no_signature_names:
                            # the name alone on its line (signature block): bank papers leave it blank
                            self.counts[base] -= 1
                            self.ops.append({"op": "text", "contains": v, "old": v})
                        elif norm(raw) == norm(v):
                            # the name alone on its line (signature block)
                            self.ops.append({"op": "text", "contains": v, "old": v, "slot": slot})
                            self.map_field(slot, value, kind="inline", width=220)
                        else:
                            self.ops.append({"op": "text", "contains": v, "old": v, "slot": slot, "reserve": max(8, round(len(v) * 0.9))})
                            self.map_field(slot, value, kind="gap", width=160)
                    raw = raw.replace(v, "")
            for m in DATE.finditer(raw):
                self.ops.append({"op": "text", "contains": norm(m.group(0)), "old": m.group(0)})

    # headers / footers: project numbers and dates are cleared
    def headers(self):
        for name in self.z.namelist():
            if not re.match(r"word/(header|footer)\d*\.xml$", name):
                continue
            root = etree.fromstring(self.z.read(name))
            for p in root.iter(w("p")):
                raw = "".join(x.text or "" for x in p.iter(w("t")))
                for v in set(self.known["project_id"]):
                    if v and v in raw:
                        self.ops.append({"op": "text", "contains": v, "old": v})
                        raw = raw.replace(v, "")
                for m in DATE.finditer(raw):
                    self.ops.append({"op": "text", "contains": norm(m.group(0)), "old": m.group(0)})

    def run(self):
        self.images()
        self.tables()
        self.paragraphs()
        self.headers()
        return self.ops, self.fields, self.slots


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("--key", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--name-ar", required=True)
    ap.add_argument("--category", required=True)
    ap.add_argument("--project-type", default="bank")
    ap.add_argument("--description", default="")
    ap.add_argument("--extra", help="JSON with extra sanitize/slots/fields")
    ap.add_argument("--stamp", action="store_true", help="ACAD stamp & signature under the last «الاستشاري» label")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    ops, fields, slots = Draft(ROOT / "reference-documents" / a.source, no_signature_names=a.project_type == "bank").run()
    if a.project_type == "bank":
        # the project number on bank papers is the bank's (FAB) project / loan number
        for f in fields:
            if f.get("value") == "project_id":
                f["value"] = "bank_project_number"
    if a.stamp and a.project_type == "bank":
        sys.exit("bank papers never carry the ACAD stamp & signature")
    if a.stamp:
        st = json.loads(Path(a.extra).read_text(encoding="utf-8")).get("stamp", {}) if a.extra else {}
        words = st.get("words", ["الاستشاري", "الإستشاري", "الاستشارى", "الإستشارى"])
        ops.append({"op": "mark_word", "words": words, "occurrence": st.get("occurrence", -1), "slot": "stamp"})
        slots["stamp"] = {"kind": "inline", "width": 10}
        fields.append({"slot": "stamp", "stamp": {"size": st.get("size", 105), "anchor": "marker", "dx": st.get("dx", 28), "dy": st.get("dy", 58)}})
    if a.extra:
        extra = json.loads(Path(a.extra).read_text(encoding="utf-8"))
        drop = set(extra.get("drop_slots", []))
        ops = [o for o in ops if o.get("slot") not in drop and o.get("old") not in extra.get("drop_old", [])
               and o["op"] not in extra.get("drop_ops", [])]
        fields = [f for f in fields if f["slot"] not in drop]
        slots = {k: v for k, v in slots.items() if k not in drop}
        for f in fields:
            if f["slot"] in extra.get("remap", {}):
                f["value"] = extra["remap"][f["slot"]]
        if extra.get("marker"):
            # marker font/size for the drafted cell values (see docx_ops "marker")
            for o in ops:
                if o["op"] in ("cell", "insert_after") and o.get("slot"):
                    o["marker"] = extra["marker"]
        ops += extra.get("sanitize", [])
        slots.update(extra.get("slots", {}))
        fields += extra.get("fields", [])
    d = {
        "key": a.key,
        "version": 1,
        "status": "verified",
        "name": a.name,
        "nameAr": a.name_ar,
        "description": a.description or a.name,
        "category": a.category,
        "projectType": a.project_type,
        "source": a.source,
        "format": "docx",
        "sanitize": ops,
        "slots": slots,
        "fields": fields,
    }
    if a.extra:
        d.update(json.loads(Path(a.extra).read_text(encoding="utf-8")).get("props", {}))
    if a.write and a.source.startswith("private/"):
        # the operations name historical client values: keep them with the private originals
        priv = ROOT / "reference-documents" / "private" / "sanitize"
        priv.mkdir(parents=True, exist_ok=True)
        (priv / f"{a.key}.json").write_text(json.dumps(ops, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        d["sanitize"] = "private"
    out = json.dumps(d, ensure_ascii=False, indent=2) + "\n"
    if a.write:
        (ROOT / "templates" / "definitions" / f"{a.key}.json").write_text(out, encoding="utf-8")
    else:
        sys.stdout.write(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
