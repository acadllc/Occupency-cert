# ACAD Document Generator

Internal web dashboard for **ACAD Engineering Consultants - One Person Company LLC**
(اكاد للاستشارات الهندسيه - شركة الشخص الواحد ذ.م.م). Staff enter each project once — Arabic and
English separately — save it to Supabase, choose individual documents or all of them, and get
completed PDF or Word files. A new project can start from its documents — the **Land Site Plan**, **Emirates IDs**, **passports**,
**كفالة papers** and other PDFs — which fill most fields automatically. Every file is stored privately and kept in the project's history.

- **Frontend:** React + TypeScript + Vite, hosted on GitHub Pages (`https://acadllc.github.io/Occupency-cert/`)
- **Backend:** Supabase Auth (one shared company login, optional TOTP 2-step), Postgres with Row Level Security, private Storage
- **PDF engine:** runs in the browser (HarfBuzz text shaping for Arabic + pdf-lib) on sanitized, pre-built templates, so no extra server is needed
- **Templates:** all **18** reference documents are mapped, sanitized and visually verified (11 Word documents and 7 government PDF forms)

| Area | Status |
| --- | --- |
| Template sanitization (old owners, IDs, dates, stamps, signatures, metadata removed) | ✅ 18/18, automated leak check passes ([report](docs/template-qa-report.md)) |
| Field mappings, Arabic RTL shaping, check boxes, photos, optional stamp & signature | ✅ 18/18, rendered and visually reviewed; 67 automated tests |
| Word (.docx) output | ✅ for the 11 Word-based documents (the 7 official PDF forms are always PDF) |
| Document import (site plan incl. multi-page owner lists, Emirates ID, passport, كفالة and other labelled forms) | ✅ read in the browser, never uploaded |
| Project-type tabs (Occupancy certificate, Architectural, Taqneen, Bank papers, Contractor contracts) | ✅ Occupancy has the 18 documents; the other tabs are ready for their templates |
| Dashboard: login, projects, search, bilingual inputs, dynamic fields, warnings, PDF/ZIP download, history | ✅ end-to-end tested (Playwright) |
| Supabase schema, RLS, private buckets | ✅ migrations + RLS test suite (run on PostgreSQL 16) |
| Live Supabase project | ✅ connected (run new migrations from `supabase/migrations/` when they are added) |

## How it works

```
Browser (GitHub Pages, public static files)
  ├─ Supabase Auth  ── email + password (+ optional authenticator code)
  ├─ Supabase DB    ── projects, revisions, generation jobs, document records (RLS: allow-listed users only)
  ├─ PDF engine     ── sanitized base PDF + field mapping + HarfBuzz/bidi → finished PDF (in memory)
  └─ Supabase Storage (private) ── generated-documents/, project-files/ (photos)
```

The original reference documents are **never** published to the site. A Python build step
(`scripts/templates/`) turns each one into a sanitized base PDF plus a slot layout
(`templates/dist/`). Only these sanitized blank forms, the open-licensed fonts and the JSON
mappings ship with the frontend. See [docs/architecture.md](docs/architecture.md).

## 1. One-time Supabase setup (you need to do this)

Detailed walkthrough with screenshots-level steps: **[docs/supabase-setup.md](docs/supabase-setup.md)**. Summary:

1. **Run the migrations** in the Supabase Dashboard → SQL Editor, in this order (paste each file, then *Run*):
   1. `supabase/migrations/20261013000100_init.sql`
   2. `supabase/migrations/20261013000200_template_registry_seed.sql`

   (or with the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`).
2. **Authentication → Sign In / Providers:** keep *Email* enabled, **turn off "Allow new users to sign up"**,
   set a minimum password length of 12 or more.
3. **Authentication → Users → Add user:** create the shared company account (email + strong password, *Auto confirm*).
4. **Allow-list that account** (SQL Editor):
   ```sql
   insert into public.app_users (user_id)
   select id from auth.users where email = 'the-company-account@your-domain';
   ```
5. **Authentication → URL Configuration:** Site URL `https://acadllc.github.io/Occupency-cert/`; add redirect URLs
   `https://acadllc.github.io/Occupency-cert/**` and `http://localhost:5173/**`.
6. Optional but recommended: sign in, open **Account & security**, enable the authenticator (TOTP).

> The browser only uses the **publishable** key. The secret key and the database password are never needed by the
> app — do not put them in GitHub, `.env` files or variables. If a secret was shared anywhere, rotate it in
> Supabase → Project Settings.

## 2. Deploy to GitHub Pages

1. Repository → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Repository → **Settings → Secrets and variables → Actions → Variables** → add:
   - `VITE_SUPABASE_URL` = `https://<project-ref>.supabase.co` (no `/rest/v1/`)
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_…`
3. Merge to `main` (or run the *Deploy to GitHub Pages* workflow manually). The site is published at
   `https://acadllc.github.io/Occupency-cert/`. Routing uses `#/…` URLs, so no server rewrites are needed.

## 3. Local development

Requirements: Node 22, npm. (Python 3.12+, PyMuPDF, lxml and LibreOffice only for rebuilding templates.)

```bash
npm ci
cp apps/web/.env.example apps/web/.env.local   # fill in the URL + publishable key
npm run dev                                    # http://localhost:5173
```

| Command | Purpose |
| --- | --- |
| `npm test` | unit tests + generation of every template with sample, long and empty data |
| `npm run typecheck` / `npm run lint` | static checks |
| `PGHOST=… PGPORT=… npm run test:sql` | apply migrations to a throw-away PostgreSQL DB and run the RLS tests |
| `npm run e2e` | Playwright end-to-end test against a mock backend build |
| `npm run templates:build` | rebuild sanitized templates (`templates/dist`) from `reference-documents/` |
| `npm run templates:qa` | render sample PDFs to PNG and run the sanitization leak check |

## 4. Using the dashboard

1. **New project** → optionally **Upload documents (PDF)** — select several files at once: the site plan (all pages, so
   every owner is found), Emirates IDs, passports, كفالة papers or other forms. City, area, sector, plot number, land
   use, owner names (Arabic and English; several owners are listed side by side), ID numbers, nationality, phone and
   email are read on your computer (the files are not uploaded), shown for review, and filled into the form. Existing
   projects have a **Fill from documents** button; values you already typed are only replaced if you tick them. Then
   fill the remaining shared information once (Arabic and English side by side; the derived Arabic/English location
   preview updates live). Names are never machine-translated. The project also stores the municipality project
   number, owner phone/email/ID/nationality and the project start/end dates.
2. Under **Documents to generate**, pick the project type tab (Occupancy certificate, Architectural, Taqneen, Bank
   papers, Contractor contracts), then tick documents — one by one, a whole category (checkbox next to its title) or
   the whole tab. Inputs needed only by those documents appear
   under **Document-specific details** (e.g. elevator data, check-box options, photos for photo reports).
3. **Save & generate** → choose **PDF** or **Word (.docx)** and whether to **add the ACAD stamp & signature**; a pre-flight list shows empty inputs and which documents use them → **Continue with blanks** or go back.
   Each file is generated, uploaded privately and recorded; download individually or as a ZIP. Official government
   PDF forms are always produced as PDF.
4. **Generated documents** tab: every generation is immutable and tied to the saved project revision; re-download
   any older file. Editing a project creates a new revision and never changes old files.

## 5. Adding templates and fields

New templates are added by a developer, without touching the dashboard code:
copy the source file into `reference-documents/`, write `templates/definitions/<key>.json`
(sanitize operations, slots, field mappings), run `npm run templates:build`, review the QA renders, set the status to
`verified`. New inputs are one entry in `templates/fields.json`. Step-by-step: **[docs/adding-templates.md](docs/adding-templates.md)**.

Fixed company values (legal names, supported cities: Al Ain, Abu Dhabi) live in `templates/company.json`.
The company **stamp & signature** image is uploaded once under **Settings → Stamp & signature** and kept in the private
`company-assets` bucket — it is deliberately **not** in this public repository or on the public website. It is placed on
the consultant signature area of ACAD's documents (the letters beside «الاستشاري», the photo reports on the consultant
row, the government forms on the consultant signature line). Positions are per template (`"stamp"` items in the
definitions). Owner and contractor undertakings (owner renewal letter, gas and swimming-pool testing forms) have no
ACAD signature place and never get it.

## 6. Security and privacy notes

- Access control is enforced by Postgres RLS and Storage policies: a user must be authenticated **and** listed in
  `public.app_users`; with 2-step verification enabled, only verified sessions are accepted. No client-side flags.
- Buckets are private; downloads go through the authenticated session. Generated documents cannot be overwritten or deleted from the browser.
- One shared login means the history shows *which account* generated a file, not which employee. The schema already
  supports individual accounts later (add rows to `app_users`).
- More: [docs/security.md](docs/security.md).

## 7. Known limitations

- Word templates are converted with LibreOffice using open-licensed look-alike fonts (Noto Naskh/Sans Arabic, Cairo,
  Tajawal, Carlito) because the original fonts (Traditional/Simplified Arabic, Janna LT, DIN Arabic) cannot be
  redistributed. Layout and wording are preserved; letter shapes differ slightly. For pixel-identical fonts export the
  sanitized DOCX files from Microsoft Word (see docs/adding-templates.md → *High-fidelity Word export*).
- The two photo reports use nested floating tables that LibreOffice cannot lay out; they were re-anchored inline (same
  2-column card grid, photo area above each details table).
- Word output keeps the original Word layout and fonts as named in the document; on computers without those fonts Word
  substitutes them. The stamp & signature in Word files is a floating image that can be moved or deleted in Word.
- Document import reads text-based PDFs (as downloaded from the government portals/apps); photos and scans have no
  text and must be typed. The site plan reader targets the Abu Dhabi Real Estate Centre "Land Site Plan / مخطط أرض";
  other forms are read by their labels (e.g. «اسم المالك», «رقم الهاتف», «رقم المشروع بالبلدية»), so always review the
  suggested values.
- When several owners do not fit on one line, the PDF uses a smaller font (down to 5 pt) and wraps inside the box. If
  even that is not enough (e.g. 12 heirs in a one-line box of a government form), the box shows the first owner with
  «وآخرون (مرفق كشف بأسماء الملاك)» / "& others (list of owners attached)" and a page listing every owner with their ID
  number is added at the end of the PDF.
- Tables of people (heirs in a power of attorney, partners, owners) are read across pages; letters that some PDFs store
  in the wrong order («االمارات», «عبدهللا») are corrected.
- Over-long values shrink to fit and, if still too long, the PDF is produced with a visible warning rather than being cut off.
- `05Owner Undertaking for Temporary Occupancy certificate.pdf`, named in the original specification, is not in
  `reference-documents/` and is therefore not implemented.
