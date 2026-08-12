#!/bin/sh
# Stop every local dev service and free its port.
#
# Why this exists: zero-cache listens on 4848 AND forks a change-streamer that
# listens on 4849, and `pnpm dev` supervises the API server through a `tsx
# watch` parent. Killing "the process on port 4848" therefore tends to leave
# either the change-streamer (next start dies with EADDRINUSE :::4849) or a
# watcher that silently respawns the server. This kills the whole set.
set -u

PORTS="3001 4848 4849 5173"

for port in $PORTS; do
  pids=$(lsof -ti "tcp:$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
    echo "freed :$port"
  fi
done

# The supervisors hold no port of their own but restart what we just killed.
pkill -9 -f "tsx watch src/index.ts" 2>/dev/null || true
pkill -9 -f "zero-cache-dev" 2>/dev/null || true

sleep 1
still=""
for port in $PORTS; do
  if [ -n "$(lsof -ti "tcp:$port" 2>/dev/null || true)" ]; then
    still="$still $port"
  fi
done

if [ -n "$still" ]; then
  echo "still listening:$still" >&2
  exit 1
fi
echo "dev stack stopped; ports $PORTS are free"
