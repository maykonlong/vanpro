#!/bin/bash

echo "======================================================================="
echo "               __     __            _____            "
echo "               \ \   / /_ _ _ __   |  __ \ _ __ ___  "
echo "                \ \ / / _\` | '_ \  | |__) | '__/ _ \ "
echo "                 \ V / (_| | | | | |  ___/| | | (_) |"
echo "                  \_/ \__,_|_| |_| |_|    |_|  \___/ "
echo "                                                     "
echo "           Sistema Operacional para Vans, Escolar e Fretes"
echo "======================================================================="
echo ""

echo "[1/4] Verificando Docker e subindo PostgreSQL + Redis..."
docker compose up -d

echo ""
echo "[2/4] Instalando dependências..."
if [ ! -d "backend/node_modules" ]; then
    echo "Instalando backend..."
    (cd backend && npm install)
fi
if [ ! -d "frontend/node_modules" ]; then
    echo "Instalando frontend..."
    (cd frontend && npm install)
fi

echo ""
echo "[3/4] Preparando Banco de Dados PostgreSQL..."
(cd backend && npx prisma generate && npx prisma db push --skip-generate && npx prisma db seed)

echo ""
echo "[4/4] Iniciando servidores em background..."
(cd backend && npm run dev) &
(cd frontend && npm run dev) &

echo ""
echo "======================================================================="
echo "  Plataforma VanPro iniciada com sucesso!"
echo "  - App Web/Mobile: http://localhost:5173"
echo "  - API Backend:    http://localhost:3000"
echo "  - PostgreSQL:     localhost:5432 (DB: vanpro_db)"
echo "======================================================================="
