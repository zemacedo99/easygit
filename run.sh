#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# EasyGit launcher for macOS / Linux.
# Installs dependencies the first time, then launches the app.
# Usage:  ./run.sh
# ---------------------------------------------------------------------------
set -e

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js was not found. Please install Node.js from https://nodejs.org"
  echo "and then run this script again."
  echo
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing EasyGit for the first time. This may take a minute..."
  npm install
fi

echo "Starting EasyGit..."
npm start
