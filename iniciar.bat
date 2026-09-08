@echo off
title VANOS - Sistema Operacional de Vans
color 0B

echo =======================================================================
echo           VANOS - Aplicativo Moderno (Fases 1 a 4 Concluidas)
echo =======================================================================
echo.

echo Utilizando o atalho raiz C:\vanpro para evitar problemas com caracteres especiais...

echo [1/3] Liberando portas 3000 (API) e 5173 (React Vite)...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :3000') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :5173') do taskkill /F /PID %%a >nul 2>&1

echo.
echo [2/3] Iniciando Backend API Node.js na porta 3000...
start "VANOS - Backend API" cmd /k "cd /d C:\vanpro\api && npm run dev"

echo.
echo [3/3] Iniciando Frontend React (Vite) na porta 5173...
start "VANOS - Frontend Web" cmd /k "cd /d C:\vanpro\web && npm run dev"

echo.
echo =======================================================================
echo   Plataforma VANOS iniciada com sucesso! 
echo   - App Frontend (Visual): http://localhost:5173
echo   - API Backend (Dados):   http://localhost:3000
echo =======================================================================
echo.
echo Mantenha esta janela aberta.
pause
