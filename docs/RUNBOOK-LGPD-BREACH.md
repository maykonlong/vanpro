# Runbook — incidente com dado pessoal (LGPD)

Procedimento para suspeita ou confirmação de vazamento, acesso indevido ou perda
de dado pessoal no VanPro.

> **O relógio já está correndo.** A comunicação à ANPD e aos titulares deve sair
> em **3 dias úteis contados da DETECÇÃO** — não da confirmação, não do fim da
> investigação (Regulamento de Comunicação de Incidente de Segurança, ANPD).
>
> Por isso o passo 1 não é investigar. É anotar a hora.

> **O dado aqui é de criança.** Nome, endereço, escola, foto, e o padrão diário
> de deslocamento de um menor de idade. É a categoria em que a ANPD anunciou
> fiscalização para 2026, e é a que o público lê com menos tolerância. Trate
> qualquer dúvida no sentido de comunicar.

---

## 0. Papéis — quem é quem aqui

| Papel LGPD | Quem é no VanPro | Responsabilidade no incidente |
|---|---|---|
| **Controlador** | o **dono da van** (a empresa cliente) | decide as finalidades; é quem **comunica** à ANPD e aos titulares |
| **Operador** | a **plataforma VanPro** | trata em nome do controlador; fornece os **fatos técnicos** e contém |
| **Titular** | o **aluno** (criança/adolescente) | o dado é dele |
| **Responsável legal** | pai, mãe ou responsável (papel `PARENT`) | exerce os direitos **em nome** do titular menor |

Isso muda a prática em dois pontos:

1. **A plataforma não comunica sozinha.** Quem fala com a ANPD e com as famílias
   é o dono da van. A plataforma entrega a ele os números e os fatos, por
   escrito, a tempo de ele cumprir o prazo — o que significa que o material
   técnico precisa estar pronto **antes** do 3º dia útil, não no dia.
2. **O aviso ao titular é aviso ao responsável.** Notificar a criança não
   cumpre nada.

O modelo é multi-tenant com `companyId` em tudo: o primeiro recorte de um
incidente é **quais empresas** foram atingidas, e a resposta a essa pergunta
muda quem precisa ser avisado.

---

## 1. Detectar e congelar o relógio (imediato)

1. **Registre data e hora UTC da detecção.** É o marco dos 3 dias úteis.
   ```bash
   date -u +%Y-%m-%dT%H:%M:%SZ
   ```
   Anote junto: quem detectou, e como (alerta, relato, achado em log).

2. **Abra o registro do incidente** — um arquivo, um ticket, o que for, desde
   que datado e não editável em silêncio.

3. **Não apague nada.** A trilha é prova. `AuditLog` é encadeado por hash e
   nunca é reescrito (`api/src/lib/audit.ts`, `verifyChain()`); rode a
   verificação da cadeia **antes** de qualquer intervenção, porque depois não se
   distingue mais o que o incidente mexeu do que a resposta mexeu.

### Gatilhos que já são detecção

- `vanpro_violacoes_tenant_total > 0` — o alerta
  `VanProViolacaoDeTenant` (`infra/observabilidade/alertas.yml`). Significa
  consulta sem contexto de empresa ou com empresa divergente: **vazamento
  potencial entre empresas**. O relógio começa quando o alerta dispara.
- Rota respondendo 200 sem sessão em `infra/scripts/verificar-deploy.sh`.
- Relato de responsável vendo dado de aluno que não é filho dele.

---

## 2. Conter (horas)

**Rotação de segredo** — o que possa ter vazado sai de circulação:

```bash
node infra/scripts/gen-secrets.mjs        # gera valores novos
```

| Segredo | Efeito da rotação | Cuidado |
|---|---|---|
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | derruba **todas** as sessões, de todos | é o objetivo; avise o suporte antes |
| `ASAAS_WEBHOOK_TOKEN` | webhooks passam a ser recusados até reconfigurar no gateway | reconfigure no painel do Asaas no mesmo movimento |
| `ASAAS_API_KEY`, `WHATSAPP_TOKEN`, `GOOGLE_MAPS_KEY` | integração cai para `503 FEATURE_DISABLED` | comportamento declarado, não é falha |
| `PRISMA_FIELD_ENCRYPTION_KEY` | **NÃO rotacione sob pressão** | trocar a chave sem re-cifrar o banco torna nome, endereço e foto de todos os alunos ilegíveis. É uma migração de dados planejada, nunca um passo de contenção |
| `POSTGRES_PASSWORD` | exige reiniciar `api` e `migrate` | rotacione junto com a `DATABASE_URL` |

**Revogação de sessões** — `revokeFamily` em
`api/src/modules/auth/session.service.ts` derruba a família de refresh de um
usuário; a rotação do `JWT_REFRESH_SECRET` derruba todas de uma vez. Escolha o
alcance conforme o que se sabe: se o vetor é uma conta específica, revogue a
conta; se não se sabe, revogue tudo. Deslogar todo mundo custa uma manhã de
suporte; deixar a sessão do atacante viva custa o incidente inteiro de novo.

**Se o vetor for o host** (firewall, TLS, vizinho de contêiner): é escopo do
`ancorar`, e o host **não** foi verificado neste projeto — ver
`docs/RELATORIO-VALIDACAO.md` §5.

---

## 3. Avaliar o alcance (dentro do 1º dia)

Responda **por empresa afetada**, com número, não com adjetivo:

- **Quais dados.** Cadastro? Endereço? Foto? Financeiro? A trilha de auditoria?
- **Quantos titulares.** A contagem exata, por `companyId`.
- **Risco ao titular.** Dado de criança já é risco elevado por si. A relação
  aluno ↔ escola ↔ veículo ↔ horário é a mais grave do conjunto: ela descreve
  onde uma criança específica está, todo dia, a que horas.
- **Origem.** Credencial? Dependência comprometida (o vetor nº 1 em 2026)? Host?
  Erro no código (foi o caso do DRE somando tenants — `RELATORIO-VALIDACAO.md`)?

### O alcance por titular sai do endpoint que já existe

**Não escreva consulta nova sob pressão.** A extensão exata do que a plataforma
guarda de um titular é o que o endpoint de portabilidade devolve:

```
GET /api/v1/privacy/export
```

É o mesmo pacote do direito de acesso/portabilidade (art. 18, II), já auditado,
já testado, já com o serializador explícito que impede coluna nova de vazar. Uma
query improvisada às 2h da manhã tem duas chances de errar — mostrar de menos (e
a comunicação sai incompleta) ou mostrar de mais (e a resposta ao incidente vira
o segundo incidente).

Os demais direitos do titular, para referência:

| Direito | Rota | Auditado como |
|---|---|---|
| Acesso / portabilidade (art. 18, II) | `GET /api/v1/privacy/export` | `lgpd.*` |
| Dados do próprio usuário | `GET /api/v1/privacy/my-data` | `lgpd.*` |
| Eliminação (art. 18, VI) | `POST /api/v1/privacy/forget-me` → fila de aprovação em `/privacy/deletion-requests` | `lgpd.*` |
| Consentimentos | `GET`/`POST /api/v1/privacy/consents` | `lgpd.*` |
| Trilha de auditoria | `GET /api/v1/privacy/audit-trail` | — |

A exclusão de aluno é **lógica** (`deletedAt`), por obrigação fiscal e defesa
trabalhista (`docs/ARCHITECTURE.md`, regra 10). Isso é compatível com o art. 16
— o que virou obrigação legal é conservado —, mas **precisa** ser dito ao titular
na resposta: prometer apagamento total e manter registro é o que gera a segunda
reclamação.

---

## 4. Comunicar (até o 3º dia útil)

Quem comunica é o **controlador** (o dono da van). A **plataforma** entrega os
fatos técnicos, por escrito. Conteúdo mínimo:

- a natureza dos dados pessoais atingidos;
- os titulares envolvidos — **número e categorias** (aqui: crianças e
  adolescentes, categoria de atenção reforçada);
- as medidas técnicas de proteção que estavam em uso (criptografia de campo em
  repouso, TLS, isolamento por tenant, trilha encadeada) — e, com honestidade,
  quais delas **falharam** neste caso;
- os riscos ao titular e as medidas de mitigação adotadas ou propostas;
- **data do incidente e data da tomada de conhecimento** — as duas, e elas
  costumam ser diferentes.

Comunique também **aos responsáveis legais** dos alunos afetados, em linguagem
que um pai entenda: o que aconteceu, o que isso significa para o filho dele, o
que já foi feito, e o que ele deve fazer (trocar senha, desconfiar de contato).

Guarde cópia de tudo no registro do incidente.

> Se ao 3º dia útil a investigação ainda não terminou, **comunique com o que se
> sabe** e diga que é parcial. O prazo é da comunicação, não da conclusão.

---

## 5. Corrigir e registrar (depois)

- **Feche a causa raiz com teste de regressão.** Nesta base, defesa entra com
  controle negativo executado: o teste que **quebra quando a defesa some**
  (`docs/ARCHITECTURE.md` §Testes). Todo módulo deve ter a tentativa de acesso
  cruzado entre empresas — foi o teste ausente que deixou o vazamento do DRE
  passar.
- Acrescente um guarda em `infra/scripts/guards.sh` se o defeito for do tipo que
  volta num merge apressado. Cada guarda de lá corresponde a um defeito que
  existiu neste repositório.
- Reveja acessos: quem tinha `OWNER`/`MANAGER` e não devia? Quais flags
  (`canManageFinance/HR/Routes`) estavam abertas sem necessidade?
- Verifique a cadeia de auditoria de novo (`verifyChain()`) e registre o
  resultado.
- Registre a lição no relatório de validação — inclusive o que **não** foi
  possível determinar. Incidente com pergunta em aberto se documenta como
  pergunta em aberto.

---

## NÃO VERIFICADO neste runbook

| Item | Situação |
|---|---|
| Este procedimento de ponta a ponta | nunca ensaiado. Um runbook de incidente que nunca foi ensaiado é uma hipótese, igual a um dump que nunca foi restaurado |
| Rotação de segredo em produção | os efeitos descritos vêm da leitura do código, não de execução |
| `GET /api/v1/privacy/export` como pacote de alcance | a rota existe e é coberta por teste; **não** foi exercitada no contexto de um incidente real |
| Contato da ANPD e do encarregado (DPO) | **não estão escritos em lugar nenhum deste repositório.** Preencha antes que sejam necessários — procurar isso no 2º dia útil é perder metade do prazo |
