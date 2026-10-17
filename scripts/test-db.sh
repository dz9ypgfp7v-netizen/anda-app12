#!/usr/bin/env bash
# Reinicia la base de pruebas, carga datos de ejemplo y corre TODAS las pruebas de la base.
# Uso: scripts/test-db.sh            (todas)
#      scripts/test-db.sh 04         (solo el archivo que empieza con 04)
set -e
cd "$(dirname "$0")/.."
export PGHOST=127.0.0.1 PGPORT=${ANDA_PGPORT:-54329} PGUSER=postgres
scripts/db-reset.sh >/dev/null 2>&1
psql -q -v ON_ERROR_STOP=1 -d anda_test -f supabase/seed.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d anda_test -f supabase/demo/demo_users.sql >/dev/null
cd tests
if [ -n "$1" ]; then files=$(ls ${1}_*.test.mjs); else files=$(ls [0-9][0-9]_*.test.mjs); fi
total=0; failed=0
for f in $files; do
  out=$(node --test --test-concurrency=1 --test-reporter=spec "$f" 2>&1) || true
  p=$(echo "$out" | grep -E "^ℹ pass" | awk '{print $3}'); x=$(echo "$out" | grep -E "^ℹ fail" | awk '{print $3}')
  echo "$f: ${p:-0} ok, ${x:-?} fallan"
  if [ "${x:-1}" != "0" ]; then echo "$out" | grep -v "^\s*at \|node:internal" | grep -A25 "failing tests" ; failed=1; fi
  total=$((total + ${p:-0}))
done
echo "TOTAL: $total pruebas pasan"
exit $failed
