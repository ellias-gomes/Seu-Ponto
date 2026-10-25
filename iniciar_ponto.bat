@echo off
title Seu Ponto - Sistema de Marcacao e Comprovacao
cd /d "%~dp0"

echo =========================================================
echo    Iniciando o Seu Ponto...
echo =========================================================

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    python servidor_local.py
    goto fim
)

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    py servidor_local.py
    goto fim
)

echo [AVISO] Python nao foi encontrado no PATH.
echo Abrindo diretamente o index.html no navegador padrao...
start "" "%~dp0index.html"

:fim
pause
