# VanPro Elite SaaS 🚐✨

![Version](https://img.shields.io/badge/version-2.0.0-emerald)
![Status](https://img.shields.io/badge/status-Enterprise_Ready-blue)
![Stack](https://img.shields.io/badge/stack-React_|_Node_|_Prisma-purple)

**VanPro Elite** é a plataforma definitiva (SaaS B2B) para gestão de Frotas de Transporte Escolar e Executivo. Projetado com arquitetura multi-tenant, segurança nível bancário e uma experiência de usuário (UX) moderna.

---

## 🌟 Principais Funcionalidades

### 📈 Fluxo de Caixa (DRE Integrado)
- **Painel Financeiro Global:** Acompanhe Entradas (Mensalidades), Saídas (Manutenção, Combustível, Folha) e veja o Lucro Líquido em tempo real.
- **Categorização Inteligente:** Lançamentos vinculados a veículos específicos ou funcionários.

### 👥 Gestão de RH e Equipe (Smart Contracts)
- **Contratos Simultâneos (Bicos):** Motoristas Freelancers podem atuar em múltiplas frotas (Multi-tenant isolation) sem perder o histórico.
- **Holerite Digital (MyEarnings):** Painel exclusivo para o motorista/auxiliar acompanhar suas diárias e comissões sem acessar o faturamento do dono.
- **Grace Period (Modo Arquivo):** Ex-funcionários perdem acesso de edição, mas mantêm histórico de leitura por razões trabalhistas.

### 🛡️ Segurança e Delegação de Acessos (RBAC)
- **Feature Flags:** Delegação de acessos (Gestor Financeiro, Gestor de RH, Operador de Rotas).
- **Escudo Sentinela:** Prevenção contra SQL Injection, XSS, Rate Limiting nativo e Audit Logs em operações sensíveis.

---

## 🚀 Arquitetura Técnica

- **Frontend:** React, TailwindCSS, Lucide Icons (Design System Glassmorphism/Dark Mode).
- **Backend/API:** Node.js, Express, Middlewares de Segurança Isolados.
- **Banco de Dados:** PostgreSQL via **Prisma ORM**.
- **Infraestrutura:** Docker-ready, preparado para escalonamento horizontal.

## 🛠️ Como Iniciar Localmente

1. Clone o repositório:
   ```bash
   git clone https://github.com/maykonlong/vanpro.git
   ```
2. Instale as dependências da API e do Web:
   ```bash
   cd api && npm install
   cd ../web && npm install
   ```
3. Configure o banco de dados (Prisma):
   ```bash
   cd api
   npx prisma generate
   npx prisma db push
   ```
4. Inicie os servidores em terminais separados:
   ```bash
   npm run dev # na pasta api
   npm run dev # na pasta web
   ```

## 🤖 AI Discoverability (Para Agentes IA)
Este repositório está otimizado para leitura por Modelos de Linguagem (LLMs). Consulte o arquivo `llms.txt` na raiz para um resumo contextual focado em Inteligência Artificial.

---
*Desenvolvido para revolucionar a mobilidade escolar e fretamento corporativo.*
