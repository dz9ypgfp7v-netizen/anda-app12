#!/usr/bin/env bash
# Recrea la base de pruebas "anda_test" con el shim de Supabase y todas las migraciones.
set -e
cd "$(dirname "$0")/.."
export PGHOST=127.0.0.1 PGPORT=${ANDA_PGPORT:-54329} PGUSER=postgres
DB=${1:-anda_test}
psql -q -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/demo/supabase_shim.sql
for f in supabase/migrations/*.sql; do
  echo "→ $f"; psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"
done
