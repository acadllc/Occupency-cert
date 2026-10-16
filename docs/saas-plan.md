# SaaS plan: one dashboard for many consultancies

Decisions agreed with the owner (October 2026). Nothing here is built yet; this is the plan for
converting the single-company (ACAD) site into a subscription service for consultancies.

## Market
- Engineering **consultancies** first (Abu Dhabi / Al Ain). Contractors later, as an add-on where the
  consultant sends a paper to the contractor to review and sign.

## Accounts
- No public sign-up. The platform owner creates each company and its users.
- Many users per company; roles: company admin, user, (optional) viewer. A user belongs to one company.
- Plans can limit the number of users per company.
- Every generated document records who generated it and when (stamps are legally sensitive).

## Database (one shared Supabase database)
- `companies` (name ar/en, short/brand names, letterhead, stamp, contact person, phone, email,
  licence, address, subscription status) and `company_members` (user, company, role).
- `company_id` on projects, revisions, generated documents and stored files; storage paths
  `companies/<id>/...`.
- RLS: a user sees only rows / files of their own company. Tests must prove company A cannot read B.
- Creating users needs the service key: only in a server-side Edge Function, never in the frontend.
- ACAD becomes company #1; its existing data is tagged, nothing is lost.

## Templates
- **Shared library** (no company): DMT, Estidama, FAB / bank forms, standard undertakings. Built once,
  used by every company.
- **Company details become fields** filled per company: name, letterhead (header/footer), stamp,
  contact person, phone, email. (Today these are fixed to ACAD, e.g. the red values on the Estidama
  forms and `templates/company.json`.)
- **Letterhead swap**: shared letters are rendered on each company's letterhead (same technique as the
  `copy_header` docx op).
- **Company-only templates** for letters unique to one company (setup fee).
- Later, if needed: companies upload their own Word files with `{{field}}` tags (simple tag
  replacement, no automatic "fix everything" processing).

## Onboarding a new company
1. The company sends all its files plus a blank letterhead Word page and its stamp image.
2. Each file is compared with the library (text compared without the changing values) and sorted:
   1. already in the library → enable it for the company;
   2. same letter on their letterhead → nothing to build;
   3. new shared form → build once, add to the shared library;
   4. unique to the company → build as a company-only template.
   A report of this sorting is shown to the owner before anything is built.
3. Originals stay in git-ignored private storage, never in the repository.

## Dashboard templates page (per company)
- Same project-type tabs and categories.
- Shows only the company's papers: the shared ones it uses plus its own.
- Badge per paper: "Shared" or the company name; search by Arabic / English name.
- "In preparation" entries for files received but not built yet.

## Order of work
1. Make the repository private and remove old client documents from its history.
2. Companies / members tables, `company_id` everywhere, new RLS + tests.
3. Company details, letterhead and stamp per company instead of `templates/company.json`.
4. Owner admin page + server-side user creation; per-company templates page.
5. Own domain.
