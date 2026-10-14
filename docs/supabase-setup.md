# Supabase setup (one time)

Everything below is done in the Supabase Dashboard of the project. It takes about 10 minutes.
None of these steps requires the secret key or the database password.

## 1. Run the database migrations

Dashboard → **SQL Editor** → *New query*. Paste the full content of each file and click **Run**, in order:

| Order | File | What it does |
| --- | --- | --- |
| 1 | `supabase/migrations/20261013000100_init.sql` | tables, triggers, RLS policies, private buckets `generated-documents` and `project-files`, storage policies |
| 2 | `supabase/migrations/20261013000200_template_registry_seed.sql` | registers the 18 templates (metadata only) |
| 3 | `supabase/migrations/20261014000100_word_output.sql` | allows Word (.docx) files in the `generated-documents` bucket and history |
| 4 | `supabase/migrations/20261014000200_company_assets.sql` | private `company-assets` bucket for the stamp & signature image (uploaded from Settings) |

Alternative with the Supabase CLI (on your own computer):

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Re-run step 2 (or `db push`) whenever a template is added or its version changes
(`npx tsx scripts/gen-template-seed.ts` regenerates the seed file).

## 2. Authentication settings

Dashboard → **Authentication**:

1. **Sign In / Providers → Email:** enabled. **Allow new users to sign up: OFF.** (Nobody can self-register.)
2. **Sign In / Providers → Email → Minimum password length:** 12 or more; enable *leaked password protection* if your plan offers it.
3. **Multi-Factor:** make sure **TOTP** is enabled (it is by default).
4. **URL Configuration:**
   - Site URL: `https://acadllc.github.io/Occupency-cert/`
   - Redirect URLs: `https://acadllc.github.io/Occupency-cert/**` and `http://localhost:5173/**`
   (used by the *Forgot password* email link).
5. Optional: **Sessions** – set an inactivity timeout / time-box if your plan supports it.

## 3. Create the shared company account

Dashboard → **Authentication → Users → Add user → Create new user**: company email, a long random password,
tick **Auto Confirm User**. Store the password in the company password manager.

## 4. Allow-list the account

Being signed in is not enough; the user must be in `public.app_users`. SQL Editor:

```sql
insert into public.app_users (user_id, label)
select id, 'ACAD shared company account' from auth.users where email = 'the-company-account@your-domain';

-- check
select u.email, a.created_at from public.app_users a join auth.users u on u.id = a.user_id;
```

To revoke access later: `delete from public.app_users where user_id = '<uuid>';` (and/or delete the auth user).

## 5. Verify

```sql
-- all tables have RLS enabled
select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1;

-- both buckets are private
select id, public from storage.buckets;

-- 18 templates registered
select count(*) from public.template_registry;
```

Then open the deployed site, sign in, create a test project and generate one document. It should appear under
**Storage → generated-documents → projects/<project uuid>/…** and in the project's *Generated documents* tab.

## Values the frontend needs

| Variable | Where | Value |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `apps/web/.env.local` (local) and GitHub → Settings → Secrets and variables → Actions → **Variables** | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | same | the `sb_publishable_…` key (Project Settings → API Keys) |

Both are public by design; access is protected by RLS. **Never** configure the `sb_secret_…` key or the database
password anywhere in this repository, its workflows or the frontend. The app refuses to start with a secret key.

## Backups and retention

- Enable Supabase's daily backups (Pro plan) or schedule `pg_dump` exports; Storage objects are not part of database backups — use the Storage API or `supabase storage` CLI to copy the buckets if you need offline copies.
- Generated PDFs are immutable from the dashboard. If old files must be purged (e.g. after N years), do it from the SQL editor / service role:
  delete the `generated_documents` rows and the matching objects in `generated-documents`.
