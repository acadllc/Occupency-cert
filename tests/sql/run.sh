#!/usr/bin/env bash
# Applies the Supabase migrations to a throw-away database on a local
# PostgreSQL and runs the RLS tests.  Usage: PGHOST=... PGPORT=... tests/sql/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=acad_rls_test
psql -U postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB" -c "create database $DB"
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -q -f tests/sql/supabase-stub.sql
for f in supabase/migrations/*.sql; do
  psql -U postgres -d $DB -v ON_ERROR_STOP=1 -q -f "$f"
done
psql -U postgres -d $DB -v ON_ERROR_STOP=1 -q -f tests/sql/rls_test.sql
