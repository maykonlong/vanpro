# LGPD — registro de tratamento (ROPA) e avaliação de impacto (DPIA)

Este documento existe porque o VanPro trata **dados pessoais de crianças em
escala, com geolocalização** — a combinação que a LGPD (Art. 14) e a orientação
da ANPD tratam com o rigor mais alto, e que dispensa discussão sobre "se é
necessário": é.

Ele não é peça de conformidade decorativa. Cada linha aqui aponta para código ou
configuração que se pode conferir, e o que ainda não está resolvido aparece como
**pendente**, não como cumprido.

- Controlador: a **frota** (cada empresa cliente é controladora dos dados dos
  seus alunos).
- Operador: o **VanPro**, que trata em nome dela.
- Última revisão: 2026-09-10 · Revisar até: 2027-03-10, ou a cada mudança de
  finalidade, base legal ou operador subcontratado.

---

## 1. Registro das operações de tratamento (Art. 37)

### 1.1 Aluno transportado

| | |
|---|---|
| **Dados** | nome, escola, série, turno, data de nascimento, endereço, foto, coordenadas de embarque, mensalidade |
| **Titular** | criança ou adolescente |
| **Finalidade** | executar o transporte escolar contratado: identificar quem embarca, saber onde buscar, confirmar entrega ao responsável |
| **Base legal** | Art. 7º, V (execução de contrato) para o transporte; **Art. 14, §1º (consentimento específico e destacado do responsável)** para foto e uso de imagem |
| **Onde** | `Student` (`api/prisma/schema.prisma`) |
| **Proteção** | `name`, `address` e `photoUrl` cifrados em repouso (AES-256-GCM, `/// @encrypted`); banco em TLS 1.3 com verificação da outra ponta; consulta escopada por empresa na camada de dados, com falha fechada |
| **Retenção** | enquanto durar o contrato de transporte, mais o prazo fiscal das mensalidades emitidas |
| **Eliminação** | pedido do titular entra em fila com **aprovação humana** (`deleteRequestStatus`), porque obrigação fiscal pode impedir a exclusão imediata — e apagar sem verificar seria trocar um descumprimento por outro |

**A separação entre as duas bases legais é deliberada.** O transporte não pode
depender de consentimento: se dependesse, retirar o consentimento encerraria o
serviço no meio do ano letivo. A **imagem**, sim — e por isso `imageConsent` é
campo próprio, conferido no `where` da consulta que alimenta material de
divulgação (`ai.controller.ts`, rota de aniversariantes), e não filtrado depois.

### 1.2 Responsável

| | |
|---|---|
| **Dados** | nome, e-mail, vínculo com o aluno |
| **Base legal** | Art. 7º, V (execução de contrato) |
| **Onde** | `User` com papel `PARENT` |
| **Retenção** | enquanto houver aluno vinculado |

Não há telefone no cadastro. Isso não é lacuna de documentação: **o campo não
existe no schema**, e é por isso que o canal de WhatsApp recusa envio em vez de
fingir que enviou (`ai.controller.ts`).

### 1.3 Motorista e monitor

| | |
|---|---|
| **Dados** | nome, e-mail, vínculo empregatício, diária, jornada (batidas de ponto), localização durante o turno |
| **Base legal** | Art. 7º, V (contrato de trabalho) e Art. 7º, II (obrigação legal — registro de jornada) |
| **Onde** | `Driver`, `Timecard`, `Punch` |
| **Retenção** | jornada segue o prazo trabalhista, mais longo que o do produto |

A localização é tratada **durante o turno**, para o acompanhamento da van, e não
é histórico de vida: a posição é transmitida por WebSocket para a sala da própria
empresa e **não é persistida** (`realtime/server.ts`).

### 1.4 Segurança e auditoria

| | |
|---|---|
| **Dados** | id do usuário, endereço IP, agente do navegador (hash), ação praticada |
| **Base legal** | Art. 7º, IX (legítimo interesse) e Art. 37 (registro das operações) |
| **Onde** | `AuditLog`, `Session` |
| **Proteção** | trilha append-only encadeada por hash, com verificação (`verifyChain`); e-mail em log aparece pseudonimizado por **HMAC** com segredo do servidor — hash puro de e-mail é enumerável e não pseudonimiza ninguém |
| **Retenção** | **pendente**: não há expurgo automático de `ipAddress` na trilha. Ver §3 |

---

## 2. Direitos do titular (Art. 18) — onde cada um é exercido

| Direito | Rota | Observação |
|---|---|---|
| Confirmação e acesso | `GET /privacy/my-data` | devolve o que existe sobre o titular |
| Portabilidade | `GET /privacy/export` | arquivo, não tela |
| Correção | telas de cadastro | com trilha de quem alterou |
| Eliminação | `POST /privacy/forget` | fila com aprovação humana (§1.1) |
| Informação sobre compartilhamento | este documento, §4 | |
| Revogação de consentimento | `POST /privacy/consent` | atinge a **imagem**; não interrompe o transporte |

Estas rotas continuam respondendo com a **assinatura suspensa**: direito do
titular não depende de o cliente estar em dia com o VanPro
(`authenticate.ts`, allowlist de operações essenciais).

---

## 3. Avaliação de impacto (DPIA / RIPD)

O gatilho é explícito: **dados de crianças, em escala, com geolocalização**.

### Riscos avaliados

| Risco | Probabilidade | Impacto | Mitigação em código | Residual |
|---|---|---|---|---|
| Uma frota enxergar aluno de outra | baixa | **muito alto** | escopo por empresa injetado na camada de dados, falha fechada, com teste que tenta atravessar por id direto | baixo |
| Vazamento do banco em repouso | baixa | **muito alto** | nome, endereço e foto cifrados (AES-256-GCM); chave fora do banco; lista de chaves antigas para rotação | baixo |
| Interceptação em trânsito | baixa | alto | TLS 1.3 na borda e no banco, com verificação da outra ponta; conexão sem TLS recusada pelo `pg_hba` | baixo |
| Foto de criança acessível por quem adivinhar a URL | média | **muito alto** | arquivo servido por rota autenticada com dono conferido no caminho; `Cache-Control: private, no-store`; nunca `express.static` | baixo |
| Uso de imagem sem consentimento | média | alto | `imageConsent` no `where`, não no filtro posterior | baixo |
| Sequestro de sessão | média | alto | cookie httpOnly + Secure + SameSite=Strict; refresh opaco rotacionado com detecção de reuso que revoga a família | baixo |
| Acesso indevido pelo console da plataforma | baixa | **muito alto** | `requireSuperAdmin` + sessão com segundo fator apresentado (não apenas cadastrado); leitura e escrita auditadas na trilha da empresa afetada | baixo |
| Rastreamento contínuo do motorista | média | médio | posição não é persistida; transmitida apenas para a sala da própria empresa | médio — ver pendência |
| IP na trilha sem prazo de expurgo | alta | baixo | — | **pendente** |

### Pendências assumidas

1. **Expurgo de `ipAddress` na trilha de auditoria.** Hoje o IP fica indefinidamente.
   A trilha precisa dele para responder "de onde partiu", e apagá-lo cedo demais
   destrói a própria finalidade. **Decisão:** manter por 12 meses e então
   truncar para a rede (`/24` em IPv4, `/48` em IPv6), preservando a linha da
   trilha e a cadeia de hash. Implementar na rotina agendada de purga
   (`api/src/jobs/index.ts`), junto com a purga de credenciais que já existe.
2. **Registro de acesso de leitura a dado de criança.** Escrita é auditada;
   leitura não. Auditar toda leitura de `Student` inflaria a trilha a ponto de
   inutilizá-la. **Decisão:** auditar a leitura em massa (exportação e listagem
   sem filtro), não a leitura individual da operação diária.
3. **Retenção de log de aplicação.** Rotacionado em disco (20 MB × 5 por
   serviço); sem agregador externo e sem política formal de descarte.

Nenhuma dessas pendências envolve dado circulando sem proteção — são lacunas de
**ciclo de vida**, e é assim que estão classificadas.

---

## 4. Compartilhamento e transferência internacional

| Operador | Dado enviado | Situação |
|---|---|---|
| Asaas (cobrança, Brasil) | nome do pagador, documento, valor | **desligado** neste ambiente — sem credencial, a rota recusa com 503 |
| WhatsApp Business / Meta (EUA) | telefone, mensagem | **desligado**, e sem telefone no cadastro não há o que enviar |

**Não há transferência internacional em curso.** Quando o canal da Meta for
ligado, ele passa a exigir cláusulas contratuais padrão (Art. 33, II) e uma
avaliação de transferência — e este documento deixa de estar em dia até que
existam.

O produto **não usa analytics de terceiro**, não carrega script externo e não
tem cookie de rastreamento. É por isso que não há banner de consentimento: não há
o que consentir. Banner que não corresponde a tratamento nenhum é teatro, e
ensina o usuário a clicar em "aceitar" sem ler.

---

## 5. Incidente

Procedimento, prazos e comunicação à ANPD (3 dias úteis):
[`RUNBOOK-LGPD-BREACH.md`](RUNBOOK-LGPD-BREACH.md).
