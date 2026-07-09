#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

FRONTEND_PORT=3100
BACKEND_PORT=5100

command -v python3 >/dev/null || { echo "Python 3 is required."; exit 1; }
command -v npm >/dev/null || { echo "Node.js/npm is required."; exit 1; }

[ -d venv ] || python3 -m venv venv
venv/bin/python -m pip install -q -r AI_Health_UI/requirements.txt
[ -d web-app/node_modules ] || npm --prefix web-app install

echo "Starting backend:  http://localhost:${BACKEND_PORT}"
(cd AI_Health_UI && FLASK_PORT="$BACKEND_PORT" ../venv/bin/python app.py) > logs-backend.txt 2>&1 &
BACKEND_PID=$!

trap 'kill "$BACKEND_PID" 2>/dev/null || true' EXIT

echo "Starting frontend: http://localhost:${FRONTEND_PORT}"
npm --prefix web-app run dev
