# Adding or updating a template

The dashboard reads everything from `templates/` — no React changes are needed for a new document or field.

## 1. Inspect the source
```bash
cp "<new file>.docx|pdf" reference-documents/
python3 scripts/templates/inspect_pdf.py "reference-documents/<file>.pdf"   # PDFs: dotted lines, check boxes, widgets, images
```
For DOCX files, open the document and note which table cells / phrases hold project data and which image is a stamp
(`unzip -l` shows `word/media/*`).

## 2. Write `templates/definitions/<key>.json`
```jsonc
{
  "key": "my-new-letter", "version": 1, "status": "draft",
  "name": "English display name", "nameAr": "الاسم بالعربي",
  "description": "…", "category": "Letters",
  "projectType": "building",   // picker tab: occupancy | building | taqneen | bank | contractor (templates/project-types.json)
  "source": "<file name in reference-documents>", "format": "docx",
  "sanitize": [
    { "op": "date_field", "slot": "date" },                              // DOCX: remove DATE field, mark its place
    { "op": "footer_align", "pattern": "AACM-CP", "align": "right" },     // DOCX: move footer lines (e.g. off the letterhead contact block)
    { "op": "copy_header", "from": "02NOMBER OF USERS.docx" },            // DOCX: add the ACAD letterhead from another reference file
    { "op": "cell", "label": "اسم المالك", "offset": -2, "slot": "owner" }, // clear the cell next to a label
    { "op": "text", "contains": "…sentence…", "old": "old phrase", "slot": "x" },
    { "op": "remove_image", "target": "media/image1.png" }               // stamp / signature
  ],
  "slots": { "date": { "kind": "inline", "width": 120 }, "owner": { "kind": "cell" } },
  "fields": [
    { "slot": "date", "value": "date", "font": "din", "dir": "rtl", "align": "right" },
    { "slot": "owner", "value": "owner_name_ar", "font": "sans", "size": 12, "align": "right", "multiline": true }
  ]
}
```
More DOCX options: `text` with `"reserve": N` keeps a blank gap inside running text (slot kind `gap`),
`"zero_width": true` uses a tiny marker that cannot move the line (with `"keep_line": true` when the phrase was the
whole line), `"ltr": true` keeps an English label in place in a right-to-left paragraph; any op can take
`"marker": {"font": "…", "size": 11}` for its marker; `drop_fallback` removes the legacy VML copies of text boxes and
`textbox_nowrap` (`"contains": [...]`) keeps text-box values on one line, `textbox_move` (`dx`/`dy` in points) moves a
text box and `textbox_para` (`jc`, `ind_left`) re-aligns its paragraphs. In Arabic paragraphs `text` takes
`"rtl": true` (a right-to-left mark keeps «: /» next to the label once the value is gone) and `"newline": true` puts the
value on its own line under the label. Tables in right-to-left documents get an explicit `w:bidiVisual="0"` during the
build, so LibreOffice lays them out like Word (otherwise it mirrors them in the PDF). A text field can set `"docxMaxWidth"` (pt) so
the Word output shrinks a value that would overflow a fixed-size text box.

PDF operations: `remove_image` (by bbox), `redact_spans` (by font/text/region), `redact_text_rect`, `remove_line_art`,
`flatten_form`. PDF slots use `{ "kind": "rect", "page": 0, "rect": [x0, y0, x1, y1], "baseline": y }` (points, top-left origin).

Mapping item types: text (`value`), bilingual line (`en` + `ar`), check mark (`check`), photo (`photo`), photo caption
(`photoText`). Value expressions: `field`, `field|ar`, `$consultant_name_en`, `@project_location_ar`,
`{a} - {b}`, `role=contractor ? contractor_name_ar : $consultant_name_ar`.
Fonts: `sans`, `naskh`, `din`, `kufi`, `carlito`, `tajawal`, `amiri` (+ `"bold": true`).

## 3. Add any new inputs to `templates/fields.json`
Shared inputs: `"scope": "shared"`. Inputs only for this document: `"scope": "template", "templates": ["my-new-letter"]`.
Types: text, textarea, date, select, multiselect, yesno, photos. Use `"pair"` to show Arabic/English side by side.

## 4. Build, review, activate
```bash
npm run templates:build             # sanitize + convert + detect slots + catalog
npx tsx scripts/qa-generate.ts my-new-letter && python3 scripts/templates/qa.py
```
Look at `templates/.qa/out/my-new-letter.{sample,long,empty}-N.png`. When the output is right and the leak check passes,
set `"status": "verified"`, run `node scripts/catalog.mjs`, `npx tsx scripts/gen-template-seed.ts`,
`npx tsx scripts/gen-inventory.ts`, `npm test`, commit, and apply the regenerated seed migration in Supabase.
Changing a published template? Increase `version` — old generated PDFs keep their version number in the history.

## High-fidelity Word export (optional)
The build writes `templates/sanitized/<key>.docx` (clean) and `<key>.marked.docx` (with invisible markers). If you
have Microsoft Word and the original fonts, export both to PDF as `templates/word-exports/<key>.pdf` and
`<key>.marked.pdf`; the next build uses them instead of LibreOffice. Licensed font files can also be placed in
`templates/fonts-licensed/` (git-ignored) to improve the LibreOffice conversion.
