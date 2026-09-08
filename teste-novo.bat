@echo off
title VANOS - Teste Nova Arquitetura
color 0D

echo =======================================================================
echo           VANOS - TESTE DA NOVA ARQUITETURA (FORA DO ONEDRIVE)
echo =======================================================================
echo.
echo Este script inicia a nova versao React/Vite a partir da pasta C:\Projetos\vanpro
echo O banco de dados e os dados reais serao os mesmos!
echo.

echo [1/3] Liberando portas 3000 (API) e 5173 (React Vite)...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :3000') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :5173') do taskkill /F /PID %%a >nul 2>&1

echo.
echo [2/3] Iniciando Backend API Node.js (C:\Projetos\vanpro\api)...
start "VANOS API (TESTE)" cmd /k "cd /d C:\Projetos\vanpro\api && npm run dev"

echo.
echo [3/3] Iniciando Frontend Web React (C:\Projetos\vanpro\web)...
start "VANOS WEB (TESTE)" cmd /k "cd /d C:\Projetos\vanpro\web && npm run dev"

echo.
echo =======================================================================
echo   Ambiente de Teste Iniciado!
echo   - App Frontend (Visual): http://localhost:5173
echo   - API Backend (Dados):   http://localhost:3000
echo =======================================================================
echo.
echo Mantenha esta janela aberta.
pause
