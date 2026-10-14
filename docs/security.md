# Security notes

## Access control
- **Authentication:** Supabase Auth email/password. Public sign-up must be disabled. Login errors are generic.
- **Authorization:** `public.is_app_user()` (security definer) requires the caller's `auth.uid()` to be in
  `public.app_users`, and — once a TOTP factor is verified — an `aal2` session. Every table policy and every storage
  policy calls it. An authenticated user who is not allow-listed sees nothing (tested in `tests/sql/rls_test.sql`).
- **Least privilege:** `anon` has no table privileges; `authenticated` has only the privileges each table needs
  (no DELETE anywhere; generated documents and revisions are insert-only via policy/trigger).
- **Integrity:** triggers set `created_by/updated_by/created_at` server-side (client values are ignored), bump the
  revision only when fields change, keep immutable revision snapshots, and freeze generation jobs once finished.
  Storage paths must be `projects/<existing project uuid>/…`; the document record path is checked against its project.
- **Keys:** the frontend only contains the publishable key and project URL. The app refuses secret keys; CI greps the
  repository and the deploy workflow greps the built bundle for `sb_secret_`.

## Browser hardening
- Content-Security-Policy meta tag: scripts only from the site (`'wasm-unsafe-eval'` for HarfBuzz), network only to the configured Supabase origin, no plugins, `base-uri 'self'`.
- `noindex` and `no-referrer` meta tags. Hash routing (no tokens in paths). Supabase uses PKCE for email links.
- User input is rendered as React text (no HTML injection); control characters are rejected; lengths are bounded.
- Uploaded photos are re-encoded to JPEG in the browser (drops EXIF/GPS) and limited to 10 MB in the bucket.

## Template privacy
- `reference-documents/` holds the original samples **with real historical client data**. They are inputs for the
  build only and are never copied to the website. Sanitized outputs are checked by `scripts/templates/qa.py`
  (exact search in DOCX XML, NFKC/word-level search in PDF text and metadata, image inventory).
- ⚠️ The GitHub repository is currently **public**, so the originals in `reference-documents/` are publicly visible.
  Make the repository private (GitHub Pages from a private repository needs a paid plan) or remove the originals from
  the repository *and its history*, keeping them only locally / in a private location.

## Shared account trade-off
A single company login cannot attribute actions to individual employees; `created_by` identifies the account only.
Mitigations: strong unique password in a password manager, TOTP enabled, password rotation when staff change,
Supabase Auth logs for sign-in times/IPs. To move to individual accounts later, create users and add them to
`app_users` — no schema or policy change is required.
