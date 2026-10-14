# Architecture decision record

## Context
- Hosting: static GitHub Pages + Supabase (Auth, Postgres, Storage). No other server was available.
- Documents: 11 Word files (Arabic letters with ACAD letterhead, photo reports) and 7 government PDF forms (DMT), some with AcroForm fields, all containing previous clients' data, stamps and signatures.
- Requirements: faithful layout, correct Arabic RTL shaping, no leakage of historical data, private storage, expandability.

## Decision: pre-built sanitized PDF bases + browser-side overlay engine

1. **Offline template build** (`scripts/templates/build.py`, Python + PyMuPDF + LibreOffice):
   - DOCX: declarative operations clear historical table cells / phrases, remove DATE fields and stamp images, scrub
     metadata and freeze table column widths. Two variants are converted: a *clean* one (the production base PDF) and
     a *marked* one with short white markers (`QZnZQ`) in every slot. Marker positions + surrounding table borders give
     exact slot rectangles; a raster comparison proves the markers did not shift the layout.
   - PDF: true redaction (text removed from content streams), image-drawing removal for stamps/signatures, line-art removal for
     old tick marks, form reset + flattening, metadata/XMP removal, garbage collection.
   - Outputs `templates/dist/<key>.pdf`, `<key>.layout.json`, a sanitized editable `templates/sanitized/<key>.docx`, and `catalog.json`.
2. **Runtime engine** (`packages/engine`, TypeScript, shared by the browser, tests and the QA tool):
   - Resolves values from the declarative field registry (`templates/fields.json`) and template mappings (shared fields,
     derived location strings, fixed company names, conditionals, options, photos).
   - Shapes text with **HarfBuzz (WASM)** and orders mixed Arabic/English/digits with the **Unicode Bidi Algorithm**;
     pdf-lib's own layout cannot shape Arabic. Glyphs are embedded as a subset Type0 font with ToUnicode and
     `ActualText`, so values stay searchable/copyable.
   - Wraps and shrinks text inside each slot; if it still cannot fit it renders anyway and returns a warning (never silently clipped).
   - Draws ticks/dots for check boxes and embeds photos.

### Why not a server with LibreOffice per request?
It would need a separately hosted, secured container (cost, maintenance, cold starts) and the result would still
depend on fonts installed on that server. Building the bases once, reviewing them visually and freezing them gives
deterministic output, and the engine can run anywhere (browser, Node tests). The DOCX → PDF conversion is a one-time
developer step; an optional Word-export path gives exact proprietary fonts.

### Word output, stamp and site plan import
- **Word (.docx):** the build also keeps the *marked* sanitized DOCX (`templates/dist/<key>.docx`). In the browser the
  engine (`packages/engine/src/docx.ts`, JSZip) replaces each invisible marker run with the value (same run
  formatting), ticks check boxes, inlines photos and adds the stamp as a floating image. Official PDF forms have no
  Word source and are always PDF.
- **Stamp:** `templates/company-stamp.png`, placed only when the user ticks *Add the ACAD stamp*; positions are
  `"stamp"` items in each definition. Signatures are never added.
- **Site plan import:** pdf.js reads the text layer of the uploaded site plan locally;
  `packages/engine/src/siteplan.ts` maps the PROPERTY / OWNER DETAILS rows to fields. The file is not uploaded.

### Data flow during generation
1. Project must be saved; generation uses the saved revision snapshot.
2. `generation_jobs` row (RLS) → for each template: engine → PDF or DOCX bytes → upload to `generated-documents/projects/<uuid>/<template>/<file>` (insert-only policy)
   → `generated_documents` row (path is validated by a CHECK constraint) → job marked completed/partial/failed.
3. Downloads: authenticated `storage.download` (or short-lived signed URL); ZIP assembled in the browser.

## Repository layout
```
apps/web/              React dashboard (GitHub Pages)
packages/engine/       field registry helpers, value resolution, HarfBuzz text layout, PDF fill
templates/             fields.json, company.json, definitions/, fonts/ (OFL), dist/ (built), sanitized/
scripts/templates/     build.py, docx_ops.py, pdf_ops.py, layout.py, inspect_pdf.py, qa.py
supabase/migrations/   schema, RLS, storage policies, template registry seed
tests/                 vitest (engine + all templates), sql (RLS), e2e (Playwright)
docs/                  setup, inventory, QA report, security, adding templates
```
