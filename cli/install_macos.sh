#!/usr/bin/env bash
# Ventarys CLI - macOS Installation Script
# Repository: https://github.com/Juanoto2012/Ventarys-AI
# Folder: cli/install_macos.sh

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m'

USE_BUN=false
FORCE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --bun) USE_BUN=true ;;
        --force) FORCE=true ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
    shift
done

print_header() {
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║              Ventarys CLI - macOS Installer                  ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

check_macos() {
    if [[ "$(uname)" != "Darwin" ]]; then
        echo -e "${RED}This script is for macOS only. Use install.sh for Linux.${NC}"
        exit 1
    fi
}

check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"
    
    # Check for Homebrew
    if ! command -v brew &> /dev/null; then
        echo -e "${YELLOW}⚠ Homebrew not found. Install from https://brew.sh${NC}"
    fi
    
    if [[ "$USE_BUN" == true ]]; then
        if ! command -v bun &> /dev/null; then
            echo -e "${YELLOW}Bun not found. Installing via Homebrew...${NC}"
            if command -v brew &> /dev/null; then
                brew install oven-sh/bun/bun
            else
                echo -e "${RED}Error: Install Bun from https://bun.sh or install Homebrew first${NC}"
                exit 1
            fi
        fi
        PKG_MANAGER="bun"
        INSTALL_CMD="install"
    else
        if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
            echo -e "${YELLOW}Node.js not found. Installing via Homebrew...${NC}"
            if command -v brew &> /dev/null; then
                brew install node
            else
                echo -e "${RED}Error: Install Node.js from https://nodejs.org or install Homebrew first${NC}"
                exit 1
            fi
        fi
        PKG_MANAGER="npm"
        INSTALL_CMD="install"
    fi
    
    echo -e "  ${GREEN}✓ Prerequisites OK (${PKG_MANAGER})${NC}"
}

build_project() {
    echo -e "${YELLOW}Installing dependencies and building...${NC}"
    
    $PKG_MANAGER $INSTALL_CMD
    if [[ $? -ne 0 ]]; then
        echo -e "${RED}Dependency installation failed${NC}"
        exit 1
    fi
    
    $PKG_MANAGER run build
    if [[ $? -ne 0 ]]; then
        echo -e "${RED}Build failed${NC}"
        exit 1
    fi
    
    echo -e "  ${GREEN}✓ Build complete${NC}"
}

link_global() {
    echo -e "${YELLOW}Linking globally...${NC}"
    
    # Try without sudo first
    $PKG_MANAGER link 2>/dev/null || {
        echo -e "${YELLOW}Requesting administrator permissions for global link...${NC}"
        sudo $PKG_MANAGER link
    }
    
    if [[ $? -ne 0 ]]; then
        echo -e "${RED}Global link failed. Try manually: sudo $PKG_MANAGER link${NC}"
        exit 1
    fi
    
    echo -e "  ${GREEN}✓ Global link created${NC}"
}

verify_installation() {
    echo -e "${YELLOW}Verifying installation...${NC}"
    
    if [[ "$USE_BUN" == true ]]; then
        bunx vnt-cli --version
    else
        npx vnt-cli --version
    fi
    
    if [[ $? -ne 0 ]]; then
        echo -e "${YELLOW}⚠ Verification failed. Try running 'vnt-cli' manually${NC}"
    else
        echo -e "  ${GREEN}✓ Installation verified${NC}"
    fi
}

post_install_notes() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  Installation complete!                                      ║${NC}"
    echo -e "${CYAN}║  Run 'vnt-cli' to start                                      ║${NC}"
    echo -e "${CYAN}║  Run 'vnt-cli config --set-key agnes:YOUR_KEY' to configure  ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${GRAY}macOS Notes:${NC}"
    echo -e "${GRAY}  • For WebGPU local models: Use Chrome/Edge with WebGPU enabled${NC}"
    echo -e "${GRAY}  • For Ollama: Run 'OLLAMA_ORIGINS=\"*\" ollama serve' for CORS${NC}"
    echo -e "${GRAY}  • For LM Studio: Enable 'Network Access' in settings${NC}"
}

main() {
    print_header
    check_macos
    
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    cd "$SCRIPT_DIR"
    
    echo -e "${GRAY}Project directory: $(pwd)${NC}"
    echo ""
    
    check_prerequisites
    build_project
    link_global
    verify_installation
    post_install_notes
}

main "$@"