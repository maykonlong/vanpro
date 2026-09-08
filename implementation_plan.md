# Plano de Implementação Detalhado: VanPro SaaS (Sistema Operacional para Vans & Fretes)

Este documento é a especificação técnica e arquitetural completa para a implementação da plataforma **VanPro** — um SaaS Multitenant de gestão de frota de vans escolares, fretes eventuais, logística de passageiros, finanças DRE por veículo, CRM de vendas e aplicativo em tempo real para motoristas e pais.

---

## 🎨 Inspirações Visuais da Interface

![1. Dashboard do Proprietário da Frota](C:/Users/MaykonSilva/.gemini/antigravity-ide/brain/c9929ad9-a170-498b-923f-6a4ccd539744/fleet_owner_dashboard_1788881018682.png)
*1. Dashboard do Frotista (Dark Mode com mapa interativo, indicadores diários, DRE por van e lista de tarefas operaiconais).*

<!-- slide -->

![2. App do Motorista & Check-in de Alunos](C:/Users/MaykonSilva/.gemini/antigravity-ide/brain/c9929ad9-a170-498b-923f-6a4ccd539744/driver_route_app_1788881062323.png)
*2. App do Motorista (Sequência de rota, tempos estimados, botões de check-in com status e geolocalização).*

<!-- slide -->

![3. Portal dos Pais & Rastreamento ao Vivo](C:/Users/MaykonSilva/.gemini/antigravity-ide/brain/c9929ad9-a170-498b-923f-6a4ccd539744/parent_tracking_app_1788881096557.png)
*3. App dos Pais (Notificações instantâneas, ETA do veículo em tempo real e aviso de ausência).*

> [!TIP]
> **Deseja gerar mais 3 inspirações visuais?** (Opções: Módulo de Fretes Avulsos, CRM de Captação de Alunos ou Simulador de Viabilidade com IA). Caso queira, basta solicitar.

---

## 🏛️ Arquitetura Global do Sistema

O sistema adota **Clean Architecture** e **Domain-Driven Design (DDD)** com isolamento multitenant rígido via coluna `tenant_id` em PostgreSQL com Row-Level Security (RLS) e middleware de validação.

### Stack Tecnológica
- **Backend:** Node.js (v20+), TypeScript, Express.js / Fastify.
- **ORM & Banco de Dados:** PostgreSQL 16 + Prisma ORM (ou Drizzle ORM).
- **Cache & Filas:** Redis + BullMQ (processamento assíncrono de cobranças, notificações WhatsApp, relatórios).
- **Tempo Real:** Socket.io (WebSockets para localização GPS da van e alertas de embarque).
- **Frontend / PWA:** React 18, Vite, Tailwind CSS + Vanilla CSS Tokens, Lucide Icons, Leaflet/Mapbox para mapas.
- **Validação & Segurança:** Zod, JWT (Access 15min / Refresh 48h em HTTP-only Cookie), bcrypt, Helmet, CORS restritivo, Rate Limiting por tenant.
- **Infraestrutura:** Docker Compose (PostgreSQL, Redis), Scripts `iniciar.bat` e `iniciar.sh`.

---

## 🗄️ Esquema Completo do Banco de Dados PostgreSQL (`schema.prisma`)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  OWNER
  ADMIN
  FINANCIAL
  DRIVER
  MONITOR
  PARENT
}

enum PlanType {
  AUTONOMO      // 1 Van
  PROFISSIONAL  // Até 5 Vans
  FROTA         // 10+ Vans
  ENTERPRISE
}

enum Shift {
  MORNING
  AFTERNOON
  NIGHT
  FULL_DAY
}

enum AttendanceStatus {
  PENDING
  BOARDED
  DROPPED_OFF
  ABSENT
}

enum FreightStatus {
  DRAFT
  REQUESTED
  APPROVED
  IN_PROGRESS
  COMPLETED
  CANCELLED
}

enum TransactionType {
  INCOME
  EXPENSE
}

enum TransactionCategory {
  MONTHLY_FEE
  FREIGHT_REVENUE
  FUEL
  MAINTENANCE
  TIRES
  INSURANCE
  TAXES
  SALARY
  TOLL
  CLEANING
  PARKING
  OTHER
}

enum LeadStatus {
  NEW
  CONTACTED
  PROPOSAL_SENT
  NEGOTIATING
  WON
  LOST
}

model Tenant {
  id                    String                 @id @default(uuid())
  name                  String
  tradeName             String?
  document              String?                // CNPJ ou CPF
  slug                  String                 @unique
  plan                  PlanType               @default(AUTONOMO)
  active                Boolean                @default(true)
  createdAt             DateTime               @default(now())
  updatedAt             DateTime               @updatedAt

  users                 User[]
  vehicles              Vehicle[]
  schools               School[]
  students              Student[]
  routes                Route[]
  freights              Freight[]
  financialTransactions FinancialTransaction[]
  crmLeads              CRMLead[]
  contracts             Contract[]
  auditLogs             AuditLog[]

  @@map("tenants")
}

model User {
  id                    String                 @id @default(uuid())
  tenantId              String
  name                  String
  email                 String                 @unique
  passwordHash          String
  role                  Role
  phone                 String?
  cpf                   String?
  cnhNumber             String?
  cnhCategory           String?
  cnhValidity           DateTime?
  active                Boolean                @default(true)
  createdAt             DateTime               @default(now())
  updatedAt             DateTime               @updatedAt

  tenant                Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  assignedVehicles      Vehicle[]              @relation("DriverVehicle")
  routes                Route[]                @relation("DriverRoute")
  students              Student[]              @relation("ParentStudent")
  occurrences           Occurrence[]           @relation("UserOccurrence")
  auditLogs             AuditLog[]

  @@index([tenantId])
  @@map("users")
}

model Vehicle {
  id                    String                 @id @default(uuid())
  tenantId              String
  name                  String                 // Ex: Van 01 - Transit
  plate                 String
  renavam               String?
  model                 String
  year                  Int
  capacity              Int                    // Ex: 15 passageiros
  currentKm             Int                    @default(0)
  avgKmPerLiter         Float                  @default(8.5)
  fuelType              String                 @default("DIESEL")
  insuranceExpiry       DateTime?
  licenseExpiry         DateTime?
  driverId              String?
  active                Boolean                @default(true)
  createdAt             DateTime               @default(now())
  updatedAt             DateTime               @updatedAt

  tenant                Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  driver                User?                  @relation("DriverVehicle", fields: [driverId], references: [id])
  maintenances          Maintenance[]
  fuelLogs              FuelLog[]
  routes                Route[]
  freights              Freight[]
  financialTransactions FinancialTransaction[]

  @@index([tenantId])
  @@map("vehicles")
}

model Maintenance {
  id                    String                 @id @default(uuid())
  tenantId              String
  vehicleId             String
  description           String
  serviceType           String                 // PREVENTIVE, CORRECTIVE, OIL_CHANGE, TIRES
  kmAtService           Int
  nextDueKm             Int?
  nextDueDate           DateTime?
  cost                  Decimal                @db.Decimal(10, 2)
  workshopName          String?
  invoiceUrl            String?
  performedAt           DateTime
  createdAt             DateTime               @default(now())

  vehicle               Vehicle                @relation(fields: [vehicleId], references: [id], onDelete: Cascade)

  @@index([vehicleId])
  @@map("maintenances")
}

model FuelLog {
  id                    String                 @id @default(uuid())
  tenantId              String
  vehicleId             String
  kmAtFill              Int
  liters                Float
  pricePerLiter         Decimal                @db.Decimal(10, 2)
  totalCost             Decimal                @db.Decimal(10, 2)
  stationName           String?
  calculatedKmPerLiter  Float?
  filledAt              DateTime               @default(now())

  vehicle               Vehicle                @relation(fields: [vehicleId], references: [id], onDelete: Cascade)

  @@index([vehicleId])
  @@map("fuel_logs")
}

model School {
  id                    String                 @id @default(uuid())
  tenantId              String
  name                  String
  address               String
  lat                   Float?
  lng                   Float?
  contactPhone          String?
  tenant                Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  students              Student[]

  @@map("schools")
}

model Student {
  id                    String                 @id @default(uuid())
  tenantId              String
  parentId              String?
  schoolId              String
  name                  String
  grade                 String?                // Ex: 5º Ano B
  shift                 Shift
  pickupAddress         String
  pickupLat             Float?
  pickupLng             Float?
  dropoffAddress        String
  dropoffLat            Float?
  dropoffLng            Float?
  monthlyFee            Decimal                @db.Decimal(10, 2)
  dueDay                Int                    @default(10)
  active                Boolean                @default(true)
  notes                 String?
  createdAt             DateTime               @default(now())

  tenant                Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  parent                User?                  @relation("ParentStudent", fields: [parentId], references: [id])
  school                School                 @relation(fields: [schoolId], references: [id])
  routeWaypoints        RouteWaypoint[]
  attendances           Attendance[]
  contracts             Contract[]

  @@index([tenantId])
  @@map("students")
}

model Route {
  id                    String                 @id @default(uuid())
  tenantId              String
  vehicleId             String
  driverId              String
  name                  String                 // Ex: Rota Manhã - Escola Pedro II
  shift                 Shift
  estimatedDistanceKm   Float?
  estimatedDurationMin  Int?
  active                Boolean                @default(true)
  createdAt             DateTime               @default(now())

  tenant                Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  vehicle               Vehicle                @relation(fields: [vehicleId], references: [id])
  driver                User                   @relation("DriverRoute", fields: [driverId], references: [id])
  waypoints             RouteWaypoint[]
  attendances           Attendance[]

  @@index([tenantId])
  @@map("routes")
}

model RouteWaypoint {
  id                    String                 @id @default(uuid())
  routeId               String
  studentId             String
  orderIndex            Int
  estimatedTime         String                 // HH:mm
  type                  String                 // PICKUP ou DROPOFF

  route                 Route                  @relation(fields: [routeId], references: [id], onDelete: Cascade)
  student               Student                @relation(fields: [studentId], references: [id])

  @@map("route_waypoints")
}

model Attendance {
  id                    String                 @id @default(uuid())
  tenantId              String
  routeId               String
  studentId             String
  date                  DateTime               @db.Date
  status                AttendanceStatus       @default(PENDING)
  pickupTime            DateTime?
  dropoffTime           DateTime?
  absenceReason         String?
  lat                   Float?
  lng                   Float?

  route                 Route                  @relation(fields: [routeId], references: [id])
  student               Student                @relation(fields: [studentId], references: [id])

  @@unique([routeId, studentId, date])
  @@map("attendances")
}

model Freight {
  id                    String                 @id @default(uuid())
  tenantId              String
  vehicleId             String?
  clientName            String
  clientPhone           String
  serviceType           String                 // EVENT, TRIP, FREIGHT, PRIVATE
  originAddress         String
  destinationAddress    String
  distanceKm            Float
  estimatedFuelCost     Decimal                @db.Decimal(10, 2)
  tollCost              Decimal                @db.Decimal(10, 2) @default(0)
  suggestedPrice        Decimal                @db.Decimal(10, 2)
  finalPrice            Decimal                @db.Decimal(10, 2)
  scheduledDate         DateTime
  status                FreightStatus          @default(REQUESTED)
  notes                 String?
  createdAt             DateTime               @default(now())

  tenant                Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  vehicle               Vehicle?               @relation(fields: [vehicleId], references: [id])

  @@index([tenantId])
  @@map("freights")
}

model FinancialTransaction {
  id                    String                 @id @default(uuid())
  tenantId              String
  vehicleId             String?
  type                  TransactionType
  category              TransactionCategory
  description           String
  amount                Decimal                @db.Decimal(10, 2)
  dueDate               DateTime
  paymentDate           DateTime?
  paid                  Boolean                @default(false)
  referenceMonth        String                 // YYYY-MM
  createdAt             DateTime               @default(now())

  tenant                Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  vehicle               Vehicle?               @relation(fields: [vehicleId], references: [id])

  @@index([tenantId, referenceMonth])
  @@map("financial_transactions")
}

model CRMLead {
  id                    String                 @id @default(uuid())
  tenantId              String
  parentName            String
  phone                 String
  schoolName            String?
  neighborhood          String?
  shift                 Shift?
  status                LeadStatus             @default(NEW)
  notes                 String?
  createdAt             DateTime               @default(now())

  tenant                Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@map("crm_leads")
}

model Contract {
  id                    String                 @id @default(uuid())
  tenantId              String
  studentId             String
  contractNumber        String                 @unique
  startDate             DateTime
  endDate               DateTime
  monthlyValue          Decimal                @db.Decimal(10, 2)
  dueDay                Int
  signedUrl             String?
  active                Boolean                @default(true)
  createdAt             DateTime               @default(now())

  tenant                Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  student               Student                @relation(fields: [studentId], references: [id])

  @@map("contracts")
}

model Occurrence {
  id                    String                 @id @default(uuid())
  tenantId              String
  userId                String
  type                  String                 // DELAY, ACCIDENT, BREAKDOWN, ABSENCE, OTHER
  description           String
  photoUrl              String?
  lat                   Float?
  lng                   Float?
  createdAt             DateTime               @default(now())

  user                  User                   @relation("UserOccurrence", fields: [userId], references: [id])

  @@map("occurrences")
}

model AuditLog {
  id                    String                 @id @default(uuid())
  tenantId              String
  userId                String
  action                String                 // CREATE, UPDATE, DELETE
  entity                String                 // Route, Student, Financial, etc.
  details               String
  ipAddress             String?
  createdAt             DateTime               @default(now())

  tenant                Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user                  User                   @relation(fields: [userId], references: [id])

  @@map("audit_logs")
}
```

---

## 🌐 Mapeamento Completo de Endpoints REST API

### Auth & Sessão (`/api/v1/auth`)
- `POST /login` -> Retorna JWT em cookie httpOnly + payload de usuário sem dados sensíveis.
- `POST /refresh` -> Rotaciona o token de acesso.
- `POST /logout` -> Invalida o refresh token.
- `GET /me` -> Informações do usuário autenticado e permissões.

### Frota & Manutenção (`/api/v1/vehicles`)
- `GET /` -> Lista todas as vans do tenant com filtro por status, motorista e alertas de manutenção.
- `POST /` -> Cadastra novo veículo.
- `GET /:id` -> Ficha técnica completa do veículo, histórico de gastos e revisões.
- `POST /:id/maintenance` -> Registra manutenção preventivas/corretiva e recalcula próxima troca de óleo/pneu.
- `POST /:id/fuel` -> Registra abastecimento, calcula km/l instantâneo e gera alerta de consumo anormal se > 15% acima da média.

### Alunos & Escolas (`/api/v1/students`)
- `GET /` -> Lista alunos com busca por escola, turno, van e status financeiro.
- `POST /` -> Cadastra aluno e gera waypoint inicial de rota.
- `PATCH /:id` -> Atualiza dados do aluno ou altera de van/rota.
- `POST /:id/absence` -> (Rota dos Pais) Marca falta preventiva para data X.

### Rotas & Check-in (`/api/v1/routes`)
- `GET /` -> Lista rotas com status de ocupação (Verde: <80%, Amarelo: 80-99%, Vermelho: Lotação Máxima).
- `GET /:id/today` -> Visão da rota do dia para o motorista.
- `POST /:id/checkin` -> Registra embarque/desembarque de aluno com timestamp + geolocalização e dispara WebSocket para os pais.

### Fretes & Serviços Eventuais (`/api/v1/freights`)
- `POST /quote` -> Calculadora automática de frete (Entrada: Origem, Destino, Data -> Saída: Distância km, Combustível est., Pedágio est., Preço Sugerido).
- `POST /` -> Cria agendamento de frete.
- `GET /` -> Calendário de fretes e viagens.

### Financeiro & DRE (`/api/v1/financial`)
- `GET /dre` -> Retorna a DRE consolidada ou filtrada por Van para o mês de referência.
- `GET /transactions` -> Lista receitas e despesas com status de pagamento.
- `POST /transactions` -> Lança nova receita ou despesa manual.
- `POST /charge-whatsapp` -> Dispara link de cobrança/lembrete de mensalidade via integração WhatsApp.

### CRM & Captação (`/api/v1/crm`)
- `GET /leads` -> Kanban de Vendas (Novo -> Contato -> Proposta -> Fechado).
- `POST /leads` -> Recebe lead (ex: via formulário ou WhatsApp).

### Assistente de IA Operacional (`/api/v1/ai`)
- `POST /query` -> Recebe pergunta em linguagem natural (ex: "Qual van deu mais lucro esse mês?") e executa query agregada no Postgres retornando resposta resumida.
- `POST /simulate-student` -> Recebe 1 a 5 novos alunos fictícios, analisa o impacto na rota atual (km extra, tempo extra, custo de diesel extra vs nova receita mensal) e retorna se é financeiramente viável.

---

## ⚡ Eventos WebSockets (Socket.io)

- `van:location_update` -> Transmitido pelo App do Motorista a cada 10s contendo `{ tenantId, vehicleId, routeId, lat, lng, speed }`.
- `student:boarded` -> Notificação imediata para os Pais `{ studentId, studentName, timestamp, lat, lng }`.
- `student:dropped_off` -> Notificação de entrega na escola ou residência.
- `route:delay_alert` -> Notificação enviada caso a van esteja > 15 min atrasada no cronograma.

---

## 🛠️ Scripts de Inicialização Automática

### `docker-compose.yml`
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: vanpro_postgres
    environment:
      POSTGRES_USER: vanpro_user
      POSTGRES_PASSWORD: vanpro_password
      POSTGRES_DB: vanpro_db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: vanpro_redis
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

### `iniciar.bat` (Windows)
```cmd
@echo off
echo ===================================================
echo   Iniciando Plataforma VanPro (PostgreSQL + Node)
echo ===================================================

echo [1/4] Subindo containers Docker (PostgreSQL e Redis)...
docker-compose up -d

echo [2/4] Instalando dependencias do Backend e Frontend...
cd backend && npm install && cd ../frontend && npm install && cd ..

echo [3/4] Executando Migrations e Seeds no PostgreSQL...
cd backend && npx prisma migrate dev --name init && npx prisma db seed && cd ..

echo [4/4] Iniciando Servidores em modo Desenvolvimento...
start cmd /k "cd backend && npm run dev"
start cmd /k "cd frontend && npm run dev"

echo.
echo ===================================================
echo VanPro rodando com sucesso!
echo Backend:  http://localhost:3000
echo Frontend: http://localhost:5173
echo ===================================================
```

### `iniciar.sh` (Linux / macOS)
```bash
#!/bin/bash
echo "==================================================="
echo "  Iniciando Plataforma VanPro (PostgreSQL + Node)"
echo "==================================================="

echo "[1/4] Subindo containers Docker (PostgreSQL e Redis)..."
docker compose up -d

echo "[2/4] Instalando dependências..."
(cd backend && npm install)
(cd frontend && npm install)

echo "[3/4] Executando Migrations e Seeds no PostgreSQL..."
(cd backend && npx prisma migrate dev --name init && npx prisma db seed)

echo "[4/4] Subindo serviços em segundo plano..."
(cd backend && npm run dev) &
(cd frontend && npm run dev) &

echo "==================================================="
echo "VanPro rodando com sucesso!"
echo "Backend:  http://localhost:3000"
echo "Frontend: http://localhost:5173"
echo "==================================================="
```

---

## 📋 Lista Estruturada de Arquivos a Criar no Projeto

### Componente Backend (`backend/`)
- `[NEW]` [package.json](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/backend/package.json)
- `[NEW]` [tsconfig.json](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/backend/tsconfig.json)
- `[NEW]` [.env.example](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/backend/.env.example)
- `[NEW]` [prisma/schema.prisma](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/backend/prisma/schema.prisma)
- `[NEW]` [prisma/seed.ts](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/backend/prisma/seed.ts)
- `[NEW]` [src/server.ts](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/backend/src/server.ts)
- `[NEW]` [src/config/database.ts](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/backend/src/config/database.ts)
- `[NEW]` [src/config/redis.ts](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/backend/src/config/redis.ts)
- `[NEW]` [src/middlewares/authMiddleware.ts](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/backend/src/middlewares/authMiddleware.ts)
- `[NEW]` [src/middlewares/tenantMiddleware.ts](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/backend/src/middlewares/tenantMiddleware.ts)
- `[NEW]` [src/modules/auth/authController.ts](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/backend/src/modules/auth/authController.ts)
- `[NEW]` [src/modules/fleet/fleetService.ts](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/backend/src/modules/fleet/fleetService.ts)
- `[NEW]` [src/modules/routes/routeService.ts](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/backend/src/modules/routes/routeService.ts)
- `[NEW]` [src/modules/financial/dreService.ts](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/backend/src/modules/financial/dreService.ts)
- `[NEW]` [src/modules/ai/aiService.ts](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/backend/src/modules/ai/aiService.ts)

### Componente Frontend (`frontend/`)
- `[NEW]` [package.json](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/frontend/package.json)
- `[NEW]` [index.html](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/frontend/index.html)
- `[NEW]` [src/index.css](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/frontend/src/index.css)
- `[NEW]` [src/App.jsx](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/frontend/src/App.jsx)
- `[NEW]` [src/components/OwnerDashboard.jsx](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/frontend/src/components/OwnerDashboard.jsx)
- `[NEW]` [src/components/DriverAppView.jsx](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/frontend/src/components/DriverAppView.jsx)
- `[NEW]` [src/components/ParentAppView.jsx](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/frontend/src/components/ParentAppView.jsx)
- `[NEW]` [src/components/FreightCalculator.jsx](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/frontend/src/components/FreightCalculator.jsx)
- `[NEW]` [src/components/AiSimulatorModal.jsx](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/frontend/src/components/AiSimulatorModal.jsx)

### Infraestrutura Raiz
- `[NEW]` [docker-compose.yml](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/docker-compose.yml)
- `[NEW]` [iniciar.bat](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/iniciar.bat)
- `[NEW]` [iniciar.sh](file:///c:/Users/MaykonSilva/OneDrive%20-%20C&M%20SOFTWARE%20LICENCIAMENTO%20DE%20SISTEMAS%20LTDA/Área%20de%20Trabalho/Arquivos%20Gerais/Automações/vanpro/iniciar.sh)

---

## 🔍 Plano de Verificação

1. **Compilação e Tipagem:** `tsc --noEmit` no backend sem erros de tipos.
2. **Migrations PostgreSQL:** Aplicação do `npx prisma migrate dev` e seed executados com sucesso no container Docker do PostgreSQL.
3. **Fluxos em Tela:**
   - Alternância fluida entre a visão **Frotista**, **Motorista (Check-in)** e **Pais (Rastreamento)**.
   - Cálculo automático de DRE por Van.
   - Cálculo dinâmico do simulador de viabilidade financeira de novos alunos.
