<#>
.SYNOPSIS
    Ventarys CLI - Windows Installation Script
.DESCRIPTION
    Installs Ventarys CLI globally on Windows using npm or bun.
.NOTES
    Repository: https://github.com/Juanoto2012/Ventarys-AI
    Folder: cli/install.ps1
#>

param(
    [switch]$UseBun,
    [switch]$Force,
    [switch]$NoPathUpdate
)

$ErrorActionPreference = "Stop"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "          Ventarys CLI - Windows Installer                     " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
function Check-Prerequisites {
    Write-Host "Checking prerequisites..." -ForegroundColor Yellow
    
    $hasNode = Get-Command node -ErrorAction SilentlyContinue
    $hasNpm = Get-Command npm -ErrorAction SilentlyContinue
    $hasBun = Get-Command bun -ErrorAction SilentlyContinue
    
    if (-not $hasNode -and -not $hasBun) {
        Write-Error "Neither Node.js nor Bun found. Please install Node.js (https://nodejs.org) or Bun (https://bun.sh)"
        exit 1
    }
    
    if ($UseBun -and -not $hasBun) {
        Write-Error "Bun requested but not found. Install from https://bun.sh"
        exit 1
    }
    
    if (-not $UseBun -and -not $hasNpm) {
        Write-Error "npm not found. Install Node.js or use -UseBun flag"
        exit 1
    }
    
    Write-Host "  Prerequisites OK" -ForegroundColor Green
}

# Install dependencies and build
function Build-Project {
    Write-Host "Installing dependencies and building..." -ForegroundColor Yellow
    
    $pkgManager = if ($UseBun) { "bun" } else { "npm" }
    $installCmd = if ($UseBun) { "install" } else { "install" }
    
    & $pkgManager $installCmd
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Dependency installation failed"
        exit 1
    }
    
    & $pkgManager run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed"
        exit 1
    }
    
    Write-Host "  Build complete" -ForegroundColor Green
}

# Link globally
function Link-Global {
    Write-Host "Linking globally..." -ForegroundColor Yellow
    
    $pkgManager = if ($UseBun) { "bun" } else { "npm" }
    
    & $pkgManager link
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Global link failed. Run as Administrator or use 'npm link' manually"
        exit 1
    }
    
    Write-Host "  Global link created" -ForegroundColor Green
}

# Verify installation
function Verify-Installation {
    Write-Host "Verifying installation..." -ForegroundColor Yellow
    
    $cmd = if ($UseBun) { "bunx" } else { "npx" }
    & $cmd vnt-cli --version
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Verification failed. Try running 'vnt-cli' manually"
    } else {
        Write-Host "  Installation verified" -ForegroundColor Green
    }
}

# Main
try {
    Check-Prerequisites
    
    # Change to script directory (cli folder contains package.json)
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    Set-Location $scriptDir
    
    Write-Host "Project directory: $(Get-Location)" -ForegroundColor Gray
    Write-Host ""
    
    Build-Project
    Link-Global
    Verify-Installation
    
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  Installation complete!                                       " -ForegroundColor Cyan
    Write-Host "  Run 'vnt-cli' to start                                      " -ForegroundColor Cyan
    Write-Host "  Run 'vnt-cli config --set-key agnes:YOUR_KEY' to configure  " -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
}
catch {
    Write-Error "Installation failed: $_"
    exit 1
}