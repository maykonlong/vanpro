# 🚀 Roadmap de Maturidade SaaS B2B (Além do Básico)

Se o objetivo é transformar o VanPro num SaaS imparável (que fature alto e retenha clientes por anos), a base Multi-Tenant que montamos é o "Nível 1". Para chegar ao "Nível 5", o sistema precisa de recursos avançados de segurança, retenção, auditoria e colaboração. 

Aqui está a lista absoluta e definitiva do que falta para um SaaS de Classe Mundial, dividida por áreas estratégicas:

---

## 🔐 1. Gestão de Identidade e Segurança (Identity Access Management)
O que separa um sistema amador de um sistema corporativo.
- **Fluxo de Recuperação (Esqueci Minha Senha):** Geração de Token temporário enviado por e-mail via BullMQ, com validade de 15 minutos, para redefinição segura de senha.
- **Forçar Troca de Senha / Expiração:** Exigir que a senha seja trocada a cada 90 dias ou em caso de suspeita de vazamento.
- **Autenticação em Duas Etapas (2FA):** Suporte a Google Authenticator (TOTP) obrigatório para a conta `SUPER_ADMIN` e opcional para `OWNER`.
- **Prevenção de Account Takeover:** Bloqueio temporário (Lockout) automático após 5 tentativas de login falhas e alerta por e-mail de "Novo dispositivo conectado".
- **Criptografia em Repouso (Data at Rest):** Criptografar dados extremamente sensíveis diretamente no banco (ex: documentos das crianças) com chaves AES-256 (KMS), impedindo vazamento mesmo se o banco de dados for roubado.

## 🕵️‍♂️ 2. Auditoria e Conformidade (Audit Logs)
Essencial para resolver disputas e evitar que funcionários do SaaS destruam o banco acidentalmente.
- **Master Audit Log (Nível SaaS):** Registro inflexível (Append-only) de tudo o que o `SUPER_ADMIN` faz. Ex: "Admin X alterou o plano da Empresa Y de FREE para PRO".
- **Tenant Audit Log (Nível Cliente):** Log gerencial para o Dono da Frota. Ex: "Motorista Z deletou o aluno Joãozinho às 14h". Se um pai processar a van alegando que não foi avisado de algo, o log salva a empresa.
- **Soft Delete (Lixeira Oculta):** Nunca rodar `DELETE FROM table`. Ao invés disso, alterar `deletedAt = data_atual`. Isso permite que o Super Admin recupere dados apagados acidentalmente.

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
