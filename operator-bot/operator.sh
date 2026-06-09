#!/usr/bin/env bash
#
# Control script for the PriceBetGame operator bot.
#
#   ./operator.sh start     # start the bot in the background (survives terminal close)
#   ./operator.sh stop      # stop it
#   ./operator.sh restart   # stop then start
#   ./operator.sh status    # is it running? + last few log lines
#   ./operator.sh logs      # live tail of the log (Ctrl-C to exit the tail; bot keeps running)
#
# Reads config from the project root .env (MONAD_RPC, PRICEBETGAME_ADDRESS, OPERATOR_PRIVATE_KEY).
# IMPORTANT: run only ONE operator at a time — two will collide on startRound().

set -euo pipefail
cd "$(dirname "$0")"

PIDFILE=".operator.pid"
LOGFILE="operator.log"

running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

cmd_start() {
  if running; then
    echo "operator already running (pid $(cat "$PIDFILE"))"; return 0
  fi
  if [ ! -d node_modules ]; then
    echo "installing dependencies…"; npm install >/dev/null 2>&1
  fi
  nohup node --env-file=../.env index.js >> "$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"
  echo "operator started (pid $!) — logging to operator-bot/$LOGFILE"
  echo "watch it:  ./operator.sh logs"
}

cmd_stop() {
  if running; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    echo "operator stopped (pid $(cat "$PIDFILE"))"
  else
    echo "operator not running"
  fi
  rm -f "$PIDFILE"
}

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_stop; sleep 1; cmd_start ;;
  status)
    if running; then echo "STATUS: RUNNING (pid $(cat "$PIDFILE"))"; else echo "STATUS: STOPPED"; fi
    [ -f "$LOGFILE" ] && { echo "--- last log lines ---"; tail -n 6 "$LOGFILE"; } || true
    ;;
  logs)
    [ -f "$LOGFILE" ] || { echo "no log yet — start the bot first"; exit 1; }
    tail -f "$LOGFILE"
    ;;
  *)
    echo "usage: ./operator.sh {start|stop|restart|status|logs}"; exit 1 ;;
esac
