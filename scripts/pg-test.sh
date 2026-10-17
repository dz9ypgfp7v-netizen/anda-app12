#!/usr/bin/env bash
# Levanta (si hace falta) un PostgreSQL local SOLO para pruebas. Uso: scripts/pg-test.sh [start|stop|status]
PGBIN=/usr/lib/postgresql/16/bin
DATA=${ANDA_PGDATA:-/home/claude/.pgdata}
PORT=${ANDA_PGPORT:-54329}
cmd=${1:-start}
as() { if [ "$(id -u)" = "0" ]; then runuser -u claude -- "$@"; else "$@"; fi; }
case "$cmd" in
  start)
    if as $PGBIN/pg_ctl -D "$DATA" status >/dev/null 2>&1; then echo "ya estaba corriendo"; exit 0; fi
    mkdir -p /tmp/pgsock && chown claude:claude /tmp/pgsock 2>/dev/null
    as $PGBIN/pg_ctl -D "$DATA" -o "-p $PORT -k /tmp/pgsock -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=100" -l "$DATA.log" -w start ;;
  stop) as $PGBIN/pg_ctl -D "$DATA" -m fast stop ;;
  status) as $PGBIN/pg_ctl -D "$DATA" status ;;
esac
