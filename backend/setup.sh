#!/usr/bin/env bash
# VEGA Studio Backend – Linux/macOS setup
# Run from the backend/ directory: bash setup.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "Creating virtual environment..."
py -3.12 -m venv .venv 2>/dev/null || python3.12 -m venv .venv

echo "Installing dependencies..."
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt

echo ""
echo "Setup complete. To activate:"
echo "  source .venv/bin/activate"
echo ""
echo "To run the backend:"
echo "  python -m app"
echo ""
echo "To run tests:"
echo "  pytest tests/ -v"
