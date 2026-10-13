# MASTER PROMPT — ACAD Document Generator

You are Claude Code acting as lead full-stack engineer, document-automation engineer, security engineer, and QA engineer. Build a complete production-oriented application from scratch in the GitHub repository `occupancy-cert` (confirm the actual repository path/remote before making changes). This is a real engineering consultancy workflow, not a mockup.

## 0. Non-negotiable operating instructions

1. Inspect the repository and all provided source documents **before** designing, coding, or changing files. The source templates must be copied/placed in an accessible local project folder; attachments in a ChatGPT conversation are **not automatically accessible to Claude Code**. If any file is missing, report precisely which file and pause only the work dependent on it; proceed on work that is possible.
2. Create a clear phased plan, implement it, run tests, and report what is finished vs. blocked. Do not claim a PDF template works until it has been rendered and visually checked.
3. Never alter or overwrite the original source templates. Work from versioned copies, preserving original files for auditing. Original sample documents contain real historical project/client information; **do not publish those originals or historical private details in a public GitHub repo or public GitHub Pages asset**.
4. Do not put secrets, Supabase service-role keys, admin passwords, third-party tokens, signing keys, or privileged credentials in client code, GitHub Pages assets, or committed `.env` files.
5. Never simulate authorization using JavaScript flags or hardcoded username/password checks. Enforce access control server-side through Supabase Auth, database RLS, Storage policies, and privileged backend services where necessary.
6. Favor robust, comprehensible code with strict TypeScript types, linting, migration scripts, tests, and simple deployment instructions. Use reasonable maintained libraries and pin dependencies.
7. Explain any blocker requiring user action (e.g., Supabase project setup, secret provisioning, private processing server deployment) and give exact steps. Do not pretend a free static website can execute LibreOffice or run a secure PDF service.
8. For every template, prioritize faithfulness to the actual source: preserve exact page size/count, structure, logos/branding, headings, tables, fixed legal wording, and graphic elements unless those elements contain obsolete project details, stamps, or signatures.
9. All **old client/project-specific information, handwritten/electronic signatures, and stamps** must be removed from reusable templates. Leave appropriately sized signing/stamping regions visibly blank for manual completion. **Keep logos and normal ACAD corporate stationery**; a logo is not a stamp.
10. Be transparent when an element cannot be reliably removed or populated; mark the template as `needs_review` and block unsafe production activation rather than silently leaking previous-client information or producing a faulty document.

## 1. Product purpose

Create **ACAD Document Generator**, an English-language web dashboard for ACAD Engineering Consultants. Staff sign into **one shared company account** (explicit business requirement), enter each engineering project's details one time in both Arabic and English, save the project to Supabase, select individual documents or all documents, and generate completed PDFs. Generated PDFs must be downloadable individually or together as a ZIP and must also be saved privately in Supabase Storage, associated with the project and its generation history.

The app must be modular: we will add many more DOCX/PDF templates and mapping fields in future development. The dashboard must dynamically display additional document-specific inputs only when needed by the selected templates. The language of the UI is **English**, while its inputs and generated text support Arabic (RTL) and English (LTR).

## 2. Deployment architecture and security

- Public frontend: GitHub Pages from the repository named `occupancy-cert` (actual GitHub Pages URL depends on GitHub username/organization). Use a static React + TypeScript + Vite frontend or equally appropriate maintainable stack with correct Pages base path and GitHub Actions deployment.
- Auth and DB: Supabase Auth and Postgres, with restrictive RLS. The single shared account must be created securely outside the browser (manual Auth dashboard setup or controlled admin-only backend process). Do not use hardcoded login credentials. Prefer MFA if practical, session expiry, sign-out, safe error handling, and account-recovery procedures. Explain limitations of audit attribution for a shared account; do not falsely describe it as individual-account auditing.
- File storage: private Supabase Storage buckets for generated PDFs/ZIP if requested, and private template assets if the backend needs them. Never expose historical documents or project data through a public bucket.
- PDF/DOCX processing: choose a realistic two-path architecture:
  - Browser-safe editing of suitable fillable/overlay PDF templates only if it produces verified, visually faithful output and access policies are correct.
  - **Preferred for production fidelity and original DOCX-to-PDF conversion:** a private authenticated processing service (for example containerized Python + LibreOffice/PyMuPDF, on an external backend host, or other supported secure runtime). Supabase Edge Functions may orchestrate work, validate authenticated requests and issue short-lived access, but do not assume they can directly run LibreOffice or other native software. The processing service should be callable only via verified authentication/authorization and have least-privilege access.
- Treat uploads/templates as untrusted files: validate type/size, keep processing isolated, avoid shell-injection through file names, use temporary files and resource limits, enforce maximum job size/time, and clean up temporary files.
- Do not deploy any sensitive source templates to the static public site; keep private assets in a private bucket/server or use sanitized non-sensitive templates where appropriate. Use only safe public frontend environment variables, such as Supabase project URL and publishable/anon key, protected by RLS.
- Avoid CORS `*` on private operations, prevent broken access control, ensure errors do not leak private data, avoid storing auth tokens in insecure custom mechanisms, and validate all server-side inputs.
- All generated PDFs and ZIPs must be downloadable only by an authenticated session with the correct authorization; use private buckets and short-lived signed URLs when appropriate. Revocation/expiration should be understood.

## 3. Initial source-document inventory (10 files)

The following filenames refer to the user's actual source files. Verify them on disk rather than assuming they exist in your own environment.

1. `TAKLEEF(1).pdf` — The Consultant Authorization & Undertaking Letter, 2 pages. Contains project ID, date, project description, owner name, developer, zone, sector, plot number, consultant name, authorization type and yes/no choices for backfilling/leveling, signature areas. Includes Arabic and English labels and a second-page consultant undertaking.
2. `01UNDERTAKE STR ARCH.docx` — Architectural/structural occupancy undertaking. Contains date, project ID, plot number, owner, zone/neighborhood, subject, consultancy stationery, and existing signature/stamp example.
3. `02NOMBER OF USERS.docx` — Number of users letter. Contains date, owner, consultant name, project location, project components and subject. Some existing fields contain combined city/zone/sector/plot/reference details.
4. `03EXPLAIN FOR ARCHIVE.docx` — Explanation concerning architectural and structural archive drawings. Contains date, project number, plot number, owner, zone/neighborhood and subject.
5. `01OWNER UNDERTAKE FOR CD ESTIFAA- تعهد المالك بتجديد شهادة الإستيفاء.docx` — Owner undertaking for annual certificate renewal. Contains date, owner, consultant, project location, project components and subject.
6. `03undertaking of the completion of all plumbing works and water tanks تعهد الاستشاري بإنجاز كافة أعمال تمديدات المياه والصرف الصحي والخزانات.pdf` — 1-page plumbing and water-tank consultant undertaking. Contains project ID/date/description/owner/developer/contractor/area/sector/plot/land use, checklist scope of works, consultant name, signing area.
7. `01Undertaking of Water Validaity for Human Use تعهد الاستشاري بصلاحية المياه للاستخدام الآدمي.pdf` — 1-page water suitability undertaking. Contains project ID/date/description/address/owner/developer/contractor/area/sector/plot/land/building usage, scope checkbox choices and signing area.
8. `04Inspection report for the internal drainage system and its connection to the internal manholes تقرير فحص نظام الصرف الداخلي ووصلاته بغرف التفتيش ال.docx` — Internal drainage system inspection report. Contains date, owner, consultant, project location, project components and subject.
9. `05OWNER UNDERTAKE - تعهد عدم ربط شبكة الصرف الصحي مع صرف مياه الأمطار.docx` — Owner undertaking not to connect sanitary drains to rainwater drainage. Contains date, owner, consultant, project location, project components and subject.
10. `05Owner Undertaking for Temporary Occupancy certificate.pdf` — 1-page temporary occupancy undertaking. Contains project ID, application date, project description/address, owner/developer/consultant/contractor, working area, project type (residential/commercial/industrial), start and completion dates, zone/sector/plot and owner's signing area.

Create a detailed template audit/mapping record for **each of the 10** files. Do not assume all documents have every field or the same field order. Some PDFs have nonfillable dotted lines and/or checkbox-looking graphics; determine whether each element is an AcroForm, native text, vector drawing, or image. Some DOCX values are inside tables, headers, footers or text runs rather than a simple paragraph.

## 4. Project-level input data model

Every project should have a stable UUID, creation/update timestamps, status, and revision tracking. Maintain shared logical values, paired bilingual fields where applicable, and document-specific fields registered separately. At minimum support:

| Canonical field | Dashboard label / Arabic meaning | Type/rules |
| --- | --- | --- |
| `project_id` | Project ID / رقم المشروع | string, preserve leading zeroes, punctuation and letter prefixes |
| `date` | Document date / التاريخ | date, explicit UAE display-format rules (e.g. DD/MM/YYYY) |
| `project_description_ar` | Project Description (Arabic) / وصف المشروع | RTL multiline |
| `project_description_en` | Project Description (English) | LTR multiline |
| `owner_name_ar` | Owner Name (Arabic) / اسم المالك | RTL |
| `owner_name_en` | Owner Name (English) | LTR |
| `developer_name_ar` / `_en` | Developer Name / اسم المطور إن وجد | optional separate RTL/LTR |
| `contractor_name_ar` / `_en` | Contractor Name / اسم المقاول | optional separate RTL/LTR |
| `plot_number` | Plot Number / رقم القسيمة | string, not a number; retain punctuation and zeroes |
| `sector_ar` / `_en` | Sector / الحوض | separate RTL/LTR when different names used; maintain canonical if same code |
| `area_ar` / `_en` | Area or Zone / المنطقة | separate RTL/LTR |
| `city_ar` / `_en` | City / المدينة | default options Al Ain / العين and Abu Dhabi / أبوظبي; overridable for future projects |
| `project_components_ar` / `_en` | Project Components / مكونات المشروع | multiline RTL/LTR |
| `subject_ar` / `_en` | Subject / الموضوع | document-specific default text, editable when needed |
| `land_building_usage_ar` / `_en` | Land/Building Usage / استخدام الأرض أو المبنى | separate RTL/LTR |
| `project_type` | Project Type / طبيعة النشاط | residential/commercial/industrial/other; map to localized labels and source checkboxes |
| `start_date` | Start Date | date |
| `completion_date` | Completion Date | date |
| `working_area_ar` / `_en` | Working Area / نطاق مساحة الأشغال | text, flexible meaning/units |

Also provide `project_location_ar` and `project_location_en` as **derived preview strings** built from city, area, sector, plot number in the required document-specific order. Do not translate proper names automatically or invent missing data. Support overrides for templates that explicitly use an address instead of the combined location. Additional likely needs found in initial forms (register these as dynamic fields and map only where present): `application_date`, `project_address_ar/en`, `land_usage_ar/en` if distinct, `authorization_type` (design and supervision/design only/supervision only), `needs_backfilling`, `issue_permit_before_backfilling`, `scope_of_work` multi-select, `reference_number`, and other specific fields discovered during per-template inspection. Don't mix project ID, permit ID, plot number and other reference numbers.

Fixed consultant values:
- English: `ACAD Engineering Consultants - One Person Company LLC`
- Arabic: `اكاد للاستشارات الهندسيه - شركة الشخص الواحد ذ.م.م`

Use these as centrally configured read-only defaults in all applicable documents, with an explicit admin-maintenance mechanism in code/config for legitimate future updates. Note source documents sometimes use a shorter/stylistic brand name; preserve decorative letterhead branding while using the configured legal consultant name for editable consultant identity fields. No automatic machine translation of owner/developer/contractor names.

## 5. Dynamic field registry and template mapping engine

Build a scalable **declarative field registry** rather than scattering hardcoded replacements throughout the app:

- Each field definition: canonical key, English dashboard label, optional Arabic label, input widget type (text/multiline/date/select/multi-select/yes-no), Arabic/English direction, validators, default, whether global or per-template, selection-dependent visibility, and ordering.
- Each template definition: stable key, human-readable English name, original filename, format (`pdf`/`docx`), source version/checksum, page count, required/optional field references, defaults, checkbox options, blank-field policy, mapping strategy, testing status and version.
- Each mapped target: page or Word structural anchor, text run/table cell/paragraph/bookmark/content control or PDF form field/rect coordinates, language/direction, font/fallback, alignment, maximum width/height, shrink-or-wrap behavior and whether source text must first be cleared.
- Mappings can choose `owner_name_ar` on Arabic labels and `owner_name_en` on English labels; repeat the same canonical value in all applicable positions including multiple pages and header/footer occurrences. Distinguish bilingual mirrored fields from one single shared value when source has one combined field.
- Avoid searching/replacing arbitrary common words or entire document body. Use stable placeholders/content controls or positional anchored map per template; test each mapping. For existing documents without placeholders, first create sanitized, versioned editable templates with anchors.
- Future new template workflow: developer adds an original document in private local/source-controlled secure location, runs inspector tool, creates sanitized blank template and mapping config, creates/verifies tests, then activates the version. A new field should require adding a registry entry and mapping—not rewriting forms/dashboard logic.
- Maintain a per-template preview and a checklist showing filled/missing/needs-review fields.

## 6. Sanitization and document fidelity (CRITICAL)

The provided examples include previously filled data for other clients. Every reusable production template MUST be sanitized **before any new customer/project generation**:

1. Identify all historical project IDs, dates, property/plot data, owners, developers, contractors, addresses, descriptions, project components, reference numbers, and any other changeable client/project-specific information, including fields not yet in the dashboard. Remove them from the underlying visible document AND associated text/data streams/metadata as necessary. Do not merely paint white on top and leave confidential text extractable underneath.
2. Remove old signatures and official stamps, whether PDF graphical objects, embedded DOCX images, or part of a composite image; preserve blank spaces for subsequent physical/manual signing. **Do not remove ACAD logos, letterhead, general corporate design, table borders, disclaimer/legal fixed wording, or generic official printed headers.** If an image contains both a logo and a stamp/signature or past private content and cannot be cleanly isolated, manually rebuild only that local part from authorized clean components; if not possible, mark it as needing review and ask for a clean source.
3. Preserve the source document's page geometry, all non-variable legal/technical language, footers, table borders, logos, fonts, colors, alignment, Arabic script shaping, and rendering fidelity. Do not fabricate a signature or reapply a removed stamp automatically.
4. For DOCX: preserve OOXML formatting, tables, headers/footers, text direction and images as much as possible; implement stable anchors/content controls for future replacement. Export to PDF on the secure server using a consistent supported office engine and font set. Never promise pixel-identical rendering across incompatible Word/LibreOffice installations without verifying the output.
5. For PDFs: use actual fillable form fields when present; otherwise use proven coordinate/anchor-based insertion into a legitimately sanitized base, with Arabic shaping and RTL support. If fonts are missing, install/legal-distribute appropriate fonts on the server; do not alter the legal document text to hide broken shaping.
6. Validate both `pdftotext`/equivalent text extraction and rendered images of all output pages to ensure old names/IDs/signatures/stamps are absent. Remove relevant original names from metadata/annotations/form values/embedded attachments too. Blank source values or intentional defaults must stay blank unless supplied by employee.
7. Handle overly long Arabic/English names and descriptions through bounded wrapping or a reported template-specific exception; **never silently clip text** or cover labels.
8. Provide template status: `draft`, `needs_review`, `verified`, `active`, `retired`. Only verified/active sanitized templates should be available for routine generation.

## 7. Dashboard UX

English-only interface, professional minimal ACAD-branded layout, responsive desktop-first with usable mobile/tablet views:

- Login page: Supabase email/password sign-in (one shared company account). Generic login error messages, authenticated route guards and sign out. No public user signup or password reveal in client.
- Dashboard home: summary of total projects, recently updated projects, recent generations, and main actions (New Project, Find Project, Generate Documents).
- Project list: search by project ID, owner Arabic or English, plot, location, creation date; sort/filter, pagination as needed; open/edit project.
- New/Edit Project: grouped inputs: project ID/dates; owners/developers/contractors (Arabic + English); location city/area/sector/plot; description/components/usage/type; dynamic per-document inputs. Show RTL labels/input direction where appropriate; do not infer English name from Arabic. Display formatted derived project location in both languages.
- Template selection: searchable list/card of documents with checkboxes and useful descriptions, `Select All`, `Generate Selected`. Only reveal template-specific fields for selected files; surface missing values as warnings. If the user chooses Generate All, include all `active` templates (not unreviewed templates).
- Missing fields: preflight with explicit list and affected documents; **warn but let the authenticated user choose Continue with Blanks**, except security/integrity failures and invalid inputs that make output unsafe. No invisible placeholder strings like `undefined`, `null`, `[object Object]`.
- Generation: track progress, show per-document success or failure, let user download each PDF or a ZIP. Save PDF generation history/storage path per project.
- History: list generated files, template name/version, date/time, processing status, relevant warnings, download/re-download actions. Editing project data must not silently rewrite older PDFs; generation creates a new immutable revision or clearly versioned file.
- UI usability: loading states, friendly error messages, empty states, toasts, keyboard labels/accessible form inputs, confirmation before destructive operations.

## 8. Supabase data model

Write SQL migrations and minimal secure seed/setup instructions. Suggested normalized schema (refine as needed):

- `projects`: `id uuid`, `project_id text`, `fields jsonb` or typed core columns + `fields jsonb` for extensibility, `created_at`, `updated_at`, `revision`, `created_by`, `updated_by`; index common search fields and preserve exact string formatting.
- `template_registry`: `id`, `template_key`, `name`, `template_version`, `source_hash`, `status`, `schema_version`, `required_fields jsonb`, `mapping_version`, `created_at` (public-facing metadata should contain no secrets).
- `generation_jobs`: job id, project id, status, requested templates, request snapshot/project revision, warnings/errors safe for client, timestamps.
- `generated_documents`: id, project id, job id, template id/version, sanitized output filename, private storage path, mime type, checksum, size, generation timestamp, project revision/snapshot id.
- Optional `project_revisions` immutable snapshots for historical accuracy and audit support.

Use Supabase migrations checked into source, enable RLS on every relevant table, forbid unauthenticated SELECT/INSERT/UPDATE/DELETE; narrow policies to the authenticated company's approved account via its stable Auth UID or a secure allowlist mechanism. Do not assume all authenticated Supabase users are authorized ACAD employees. Restrict Storage read/write/delete appropriately and never rely on a `user_id` sent by frontend. Apply auth verification at private processing endpoints. Establish documented backup/retention policy and sensible PDF naming convention such as `PROJECT_ID/template-key/YYYYMMDD-HHMMSS-revision.pdf`, sanitized for paths.

Because the business chooses **one shared login**, audit records cannot reliably distinguish individual employees. Mention this trade-off clearly in README; design code so future multiple user accounts can be added without reworking data ownership/RLS.

## 9. Processing and job contract

- The UI sends the authenticated project UUID and selected template keys (or a revision snapshot), not a trustable arbitrary Storage path or privileged backend secret.
- Server authenticates requester, authorizes project access, loads canonical sanitized template, validates field schema and character bounds, expands derived fields and maps input to all associated locations.
- Generate PDF, render/check page count and basic integrity, upload to **private** Supabase Storage, write immutable generation metadata/status. Return short-lived authenticated access paths or a secure signed URL. Prevent malicious path traversal, oversized request payloads, duplicate race conditions and accidental overwrite. Use idempotency keys where useful.
- Generate selected/all documents in parallel only within safe resource limits. ZIP should include exactly successful requested files; report partial failures clearly. No public unprotected download link.
- Keep backend code structured by service interfaces so a browser-safe PDF solution can coexist with secure server-side DOCX conversion.

## 10. Testing & verification requirements

Build automated tests PLUS manual visual QA. Include:

1. Field-registry/schema/unit tests: Arabic/English mapping, date formats, project location derivation, optional/missing fields, long values, special chars, hyphenated and zero-prefixed project/plot IDs.
2. Template mapping tests for **all ten files** and all detected data fields. For every mapped field, check correct target location and whether the right Arabic vs English value appears; ensure shared values repeat consistently across relevant pages.
3. Sanitization tests: compare against an inventory of *actual historical values* found in the originals; verify none remains in extracted output text/metadata or page images. Ensure existing handwritten signatures/stamps are absent and **logos remain**. Keep sensitive test fixtures and actual names out of public git.
4. PDF integrity tests: each result opens, page count/size correct, Arabic text shaped/readable, fonts embedded where necessary, not clipped/overlapping, headings/tables and fixed legal text remain.
5. Render all original/sanitized/generated pages to PNG at appropriate DPI and visually compare differences. Intentional changes must be constrained to the input fields, signature/stamp removal and any explicitly approved corrections. Generate QA previews/diffs and a verification report per template. Refuse to call a template fully verified until visually checked.
6. Security tests: unauthenticated cannot access private tables/files/generation API; unauthorized Auth user cannot log in to the company dashboard; malicious file names/HTML input are safely handled; no service-role keys or original source files in built static bundle or GitHub commits.
7. End-to-end tests: login, create project, edit it, save/reopen it, select one/all templates, missing-field warning and Continue with Blanks, PDF export, ZIP export, generation history, download old versions. Test with non-sensitive fabricated Arabic/English project data.

## 11. Repository structure (suggested, adapt to actual tools)

```text
occupancy-cert/
  apps/web/                # React + TS + Vite GitHub Pages frontend
  services/document-worker/# secured backend + PDF/DOCX processing
  packages/shared/         # typed field registry, template schema, contracts
  template-mappings/       # versioned declarative safe mappings
  supabase/migrations/     # SQL migrations and RLS policies
  scripts/                 # template inspection, sanitization, QA
  tests/                   # units/integration/e2e and document QA
  docs/                    # architecture, template inventory, ops, deployment
  .github/workflows/       # CI + GitHub Pages frontend deployment
  .env.example             # variable names only, no secret values
  README.md
```

If using a monorepo is unnecessary, simplify without losing clear boundaries. Ensure static Pages hosting uses correct Vite `base` for `occupancy-cert`, SPA routing strategy compatible with GitHub Pages (HashRouter or appropriate 404 fallback), and production environment variables injected correctly without including secrets.

## 12. Build phases — do real work, don't stop at a conceptual answer

**Phase A: Source audit and architecture** — inspect actual ten files and repo. Produce `docs/template-inventory.md` with every field, file, Arabic/English placement, mutable/static distinction, logos/stamps, and processing method. Produce a concise architecture decision on how native PDF and DOCX documents will be faithfully output. Identify environment setup tasks and uncertainties.

**Phase B: Repo scaffolding, frontend and Supabase** — implement app, secure auth, SQL migrations/RLS, private Storage, project CRUD, search, bilingual input registry and selection-driven dynamic inputs. Add `.env.example`, setup steps, secure dev configuration and GitHub Pages deployment.

**Phase C: Sanitized templates and generation engine** — create sanitized reusable versions of the ten documents and mapping configurations without prior project information and without signatures/stamps. Build data insertion, DOCX-to-PDF conversion, Arabic RTL and high-fidelity document testing. Review each template individually; do not skip difficult PDFs.

**Phase D: Generation management** — selected/all document generation, blanks warnings, progress/history, individual download and ZIP, immutable generation snapshots and private Supabase Storage links.

**Phase E: Tests, security review and deployment** — run automated and visual checks, validate no client/contractor identifiers leak from originals, verify private access and Word-to-PDF integrity, build and deploy frontend to GitHub Pages. Supply a concise status table, remaining secrets/hosting/config steps, and exact commands to test/deploy.

## 13. Definition of done

The project is not complete merely because there is a good-looking dashboard. It is done only when:

- The correct GitHub Pages frontend is buildable and deployable.
- Only the approved company login can access project data and private PDFs.
- Real project records save, search, reopen and update through Supabase.
- Arabic and English entry works separately throughout the system.
- Dynamic fields follow template selections, and warn-but-continue behavior works.
- All ten templates have either verified working PDF-generation mappings **or an honest, explicit needs-review status** identifying the exact unresolved issue; never claim incomplete templates are supported.
- Every usable template strips old customer data, signatures and stamps while retaining ACAD logos and formatting.
- Selected document outputs and ZIP downloads save as private versioned PDF records in Supabase.
- New field or template mappings can be added without rewriting the main UI.
- README explains both frontend and secure private processing deployment, Supabase migrations/credentials, GitHub Pages settings, limitations, and security practices.

## 14. Start here

1. Confirm which actual repo is connected (do not assume a GitHub owner from the title `occupancy cert`).
2. Inventory actual local files. If the ten listed attachments aren't in the Claude Code workspace, tell me to copy them into a safe local directory; **do not** fabricate their contents or claim they were inspected.
3. Evaluate existing repo files, then produce and execute a phased implementation plan.
4. Make meaningful, tested code changes instead of giving only example code or a textual architecture.
5. After every phase, summarize working features, pending tests, outstanding blockers, and the next concrete step.

Final expectation: deliver a working, secure, extensible ACAD document-generation application, not merely a proof-of-concept design.
