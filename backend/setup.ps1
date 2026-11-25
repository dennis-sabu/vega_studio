# VEGA Studio Backend – Windows setup
# Run from the backend/ directory: .\setup.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Creating virtual environment..."
py -3.12 -m venv .venv

Write-Host "Installing dependencies..."
.venv\Scripts\pip install --upgrade pip
.venv\Scripts\pip install -r requirements.txt -r requirements-dev.txt

Write-Host ""
Write-Host "Setup complete. To activate:"
Write-Host "  .venv\Scripts\Activate.ps1"
Write-Host ""
Write-Host "To run the backend:"
Write-Host "  .venv\Scripts\python -m app"
Write-Host ""
Write-Host "To run tests:"
Write-Host "  .venv\Scripts\pytest tests/ -v"
