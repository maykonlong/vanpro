# 🚀 Roadmap de Maturidade SaaS B2B (Além do Básico)

Se o objetivo é transformar o VanPro num SaaS imparável (que fature alto e retenha clientes por anos), a base Multi-Tenant que montamos é o "Nível 1". Para chegar ao "Nível 5", o sistema precisa de recursos avançados de segurança, retenção, auditoria e colaboração. 

Aqui está a lista absoluta e definitiva do que falta para um SaaS de Classe Mundial, dividida por áreas estratégicas:

---

## 🔐 1. Gestão de Identidade e Segurança (Identity Access Management)
O que separa um sistema amador de um sistema corporativo.
- [x] **Prevenção de Account Takeover:** Bloqueio temporário (Rate Limit e Payload Bombing previstos) e Fingerprint de Dispositivo para roubo de sessão (Fase 25).
- [x] **Autenticação Biométrica (WebAuthn):** Fim das senhas, login por impressão digital / Face ID integrado ao hardware via Passkeys (Fase 26).
- [ ] **Fluxo de Recuperação (Esqueci Minha Senha):** Geração de Token temporário enviado por e-mail via BullMQ, com validade de 15 minutos, para redefinição segura de senha.
- [ ] **Forçar Troca de Senha / Expiração:** Exigir que a senha seja trocada a cada 90 dias ou em caso de suspeita de vazamento.
- [ ] **Autenticação em Duas Etapas (2FA):** Suporte a Google Authenticator (TOTP) obrigatório para a conta `SUPER_ADMIN` e opcional para `OWNER`.
- [x] **Criptografia em Repouso (Data at Rest):** Dados sensíveis anonimizados e protegidos (Prisma Middleware).

## 🕵️‍♂️ 2. Auditoria, LGPD e Observabilidade
Essencial para resolver disputas, auditorias fiscais e vazamentos.
- [x] **Log Forense Rotativo (Winston):** Arquivos salvos em pastas isoladas por Empresa, com deleção automática em 7 dias (Fase 28).
- [x] **Privacidade LGPD Total:** Consentimento de imagem, Direito ao Esquecimento com CronJob diário, e Portabilidade (Takeout) com exportação JSON (Fase 27).
- [x] **Master Audit Log (Nível Banco):** Tabela AuditLog gravando as principais mutações com identificação de ator.
- [x] **Soft Delete (Lixeira Oculta):** Aplicado nas entidades críticas (Student, Vehicle), com data de corte para expurgo.

## 💬 3. Colaboração e Fluxo de Trabalho (Team & CRM)
Para a frota ser gerida de forma unificada.
- **Anotações Internas (Notes):** Uma aba no perfil do Aluno onde o Motorista ou Auxiliar deixa recados invisíveis para o Pai. Ex: "A criança tem chorado na volta, falar com a mãe amanhã".
- **Módulo de Ocorrências e Alertas (Alerts):** Disparo em massa de notificações push/whatsapp: "Van quebrada, atraso de 30 min".
- **Chat da Frota:** Um chat interno (via Socket.io) apenas para a equipe daquela empresa (Dono, Motoristas, Auxiliares) conversarem isolados do resto.

## 📈 4. Onboarding, Retenção e Billing
Para escalar as vendas do seu SaaS sem você precisar interferir manualmente.
- **Self-Service Sign Up:** Uma Landing Page onde o cliente se cadastra, insere o cartão, e o sistema automaticamente cria a `Company` dele no Asaas/Stripe e libera o acesso.
- **Trial Automatizado:** O cliente ganha 7 dias grátis. No 8º dia, um CronJob bloqueia o login dele (HTTP 403) exigindo pagamento.
- **Bloqueio por Inadimplência (Dunning):** Se o Dono da Frota não pagar a mensalidade do *seu* SaaS, o sistema avisa 3 dias antes. Se não pagar, o painel do motorista bloqueia.

## 📊 5. BI e Painel Analítico
- **Churn e MRR Dinâmico:** Gráficos mostrando se você está perdendo mais empresas de Van do que ganhando.
- **Dashboard de Uso:** Ver quais empresas estão usando ativamente o GPS e quais estão "esquecendo" de ligar o app (estas têm alto risco de cancelar sua assinatura).

---

### Resumo do Próximo Passo Ideal
Se você quiser implementar essas features, o ideal é dividi-las em **duas novas grandes Fases**:
1. **Fase 13: Identity & Audit (Esqueci minha senha, Logs Inquebráveis e Soft Delete)** - *Foca em proteger o sistema contra humanos.*
2. **Fase 14: Team CRM (Anotações, Ocorrências e Notificações Push)** - *Foca em dar mais ferramentas para os seus clientes justificarem pagar a mensalidade.*
