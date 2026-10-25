#!/usr/bin/env bash
# =========================================================
#  Seu Ponto - Inicializador para Linux (Pop!_OS / Ubuntu)
# =========================================================

set -e

# Navega até a pasta onde o script está localizado
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

echo "========================================================="
echo "   Iniciando Seu Ponto no Pop!_OS / Linux..."
echo "========================================================="

if command -v python3 >/dev/null 2>&1; then
    python3 servidor_local.py
elif command -v python >/dev/null 2>&1; then
    python servidor_local.py
else
    echo "[AVISO] Python 3 não foi encontrado no sistema."
    echo "Abrindo o index.html diretamente no navegador padrão..."
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$DIR/index.html"
    fi
fi
