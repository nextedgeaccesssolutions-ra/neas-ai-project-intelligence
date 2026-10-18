#!/usr/bin/env bash
# Runs the database acceptance tests on a throwaway local PostgreSQL 16 cluster.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DIR="$(mktemp -d)"
# initdb refuses to run as root: use an unprivileged account when needed
RUN=()
if [ "$(id -u)" = "0" ]; then RUN=(runuser -u "${PGUSER_OS:-postgres}" --); chown "${PGUSER_OS:-postgres}" "$DIR"; chmod 755 "$DIR"; fi
PORT="${PGPORT_TEST:-55432}"
cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
"${RUN[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null
PSQL=(psql -h "$DIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q)
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
echo "re-applying migrations (must be idempotent)"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
psql -h "$DIR" -p "$PORT" -U postgres -d postgres -X -f "$ROOT/supabase/tests/10_acceptance.sql" | tee "$DIR/out.txt"
grep -qE '^ +[0-9]+ \| +0$' "$DIR/out.txt" || { echo "DATABASE TESTS FAILED"; exit 1; }
echo "DATABASE TESTS PASSED"
