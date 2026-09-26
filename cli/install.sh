#!/usr/bin/env bash
# Ventarys CLI - Linux/macOS Installation Script
# Repository: https://github.com/Juanoto2012/Ventarys-AI
# Folder: cli/install.sh

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

USE_BUN=false
FORCE=false
NO_PATH_UPDATE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --bun) USE_BUN=true ;;
        --force) FORCE=true ;;
        --no-path-update) NO_PATH_UPDATE=true ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
    shift
done

print_header() {
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║              Ventarys CLI - Linux/macOS Installer           ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"
    
    if [[ "$USE_BUN" == true ]]; then
        if ! command -v bun &> /dev/null; then
            echo -e "${RED}Error: Bun not found. Install from https://bun.sh${NC}"
            exit 1
        fi
        PKG_MANAGER="bun"
        INSTALL_CMD="install"
    else
        if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
            echo -e "${RED}Error: Node.js/npm not found. Install from https://nodejs.org${NC}"
            exit 1
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
    
    $PKG_MANAGER link
    if [[ $? -ne 0 ]]; then
        echo -e "${RED}Global link failed. Try: sudo $PKG_MANAGER link${NC}"
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

main() {
    print_header
    
    # Get script directory (cli folder contains package.json)
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    cd "$SCRIPT_DIR"
    
    echo -e "${GRAY}Project directory: $(pwd)${NC}"
    echo ""
    
    check_prerequisites
    build_project
    link_global
    verify_installation
    
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  Installation complete!                                      ║${NC}"
    echo -e "${CYAN}║  Run 'vnt-cli' to start                                      ║${NC}"
    echo -e "${CYAN}║  Run 'vnt-cli config --set-key agnes:YOUR_KEY' to configure  ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
}

main "$@"