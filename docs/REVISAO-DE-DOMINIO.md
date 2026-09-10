# Revisão de domínio — o que não fecha na lógica do produto

A revisão de segurança já foi feita (ver [`RELATORIO-VALIDACAO.md`](RELATORIO-VALIDACAO.md)).
Este documento é sobre outra coisa: **a lógica de negócio faz sentido para quem
opera uma frota escolar?**

O critério aqui não é "compila e tem teste". É: *se um dono de van usasse isso
segunda-feira de manhã, o sistema responderia às perguntas dele?*

Estado de cada item: `CORRIGIDO`, `EM ABERTO` (projetado, não implementado) ou
`DECISÃO PENDENTE` (depende de escolha de produto).

---

## D-01 · O motorista freelancer não funciona — e é a feature de capa `EM ABERTO`

O README anuncia: *"Um motorista pode estar vinculado à Frota A pela manhã e à
Frota B à tarde"*. O seed cria exatamente esse caso (Joana, contrato
`FREELANCE`, com vínculo ativo nas duas empresas).

**Não funciona.** Três razões, todas estruturais:

1. `User.tenantId` é um **escalar único**. `UserCompany` é muitos-para-muitos, mas
   a sessão sempre resolve para o `tenantId` do usuário
   (`authenticate.ts:82-129`). Joana só existe na Rota Segura; o vínculo com a
   TransVan é linha morta no banco.
2. `Driver.userId` é `@unique` **global**. A mesma pessoa não pode ter cadastro de
   motorista em duas frotas — logo não pode ter diária diferente em cada uma,
   que é justamente o que define um freelancer.
3. `req.auth.role` vem de `User.role`, não de `UserCompany.role`. Quem for dono de
   uma frota e motorista em outra seria dono nas duas.

**Correção projetada** (não aplicada — precisa de migration, e o banco está fora):

- `Session` ganha `companyId`: a empresa ativa passa a ser propriedade da
  **sessão**, não do usuário. Rotação de refresh preserva.
- Login resolve os vínculos ativos: nenhum → 403; um → entra direto; mais de um →
  devolve a lista e exige `POST /auth/select-company`.
- `POST /auth/switch-company` troca a empresa ativa, revogando a família de
  sessão anterior e auditando.
- `Driver`: `@@unique([companyId, userId])` no lugar do `@unique` global.
- `authenticate` passa a ler papel e permissões de `UserCompany` da empresa
  ativa. `User.role` fica só para `SUPER_ADMIN` (papel de plataforma).
- Front: seletor de empresa no cabeçalho.

Enquanto isso não existe, o honesto é **tirar a promessa do README** ou marcar
como não disponível — hoje ela está anunciada e não entregue.

---

## D-02 · Não existe o conceito de ROTA `EM ABERTO`

Aluno tem `shift` (turno). Não tem veículo, não tem motorista, não tem ordem de
parada. Consequências em cadeia:

- **O motorista não sabe quem embarca.** Ele lista *todos* os alunos da empresa.
  Numa frota com 3 vans e 60 alunos, a tela de embarque é inútil.
- **`Vehicle.capacity` não valida nada.** Dá para vender 30 vagas numa van de 15.
- **O ROI por veículo não fecha** (ver D-03).
- **O responsável não tem como saber qual van é a do filho** — o `vehicle:subscribe`
  do WebSocket depende de alguém saber o `vehicleId` certo.

**Correção projetada:** modelo `Route` (empresa, nome, turno, veículo, motorista,
alunos com ordem de parada), validação de capacidade na atribuição, e os módulos
de aluno/veículo/motorista passando a conversar com ela.

Este é o buraco central do domínio: quase todo o resto que não fecha, não fecha
por causa dele.

---

## D-03 · O DRE mostra lucro errado por construção `EM ABERTO`

Três furos, em ordem de gravidade:

**a) Folha não entra sozinha.** `Timecard`/`Punch` registram as diárias e
`Driver.dailyRateCents` diz quanto cada uma vale — mas nada disso vira `Expense`
de categoria `PAYROLL`. A folha só aparece no DRE se alguém digitar à mão. Ou
seja: o lucro líquido exibido é **maior que o real** por padrão, e o erro cresce
com o tamanho da equipe. Falta um fechamento de folha por período, idempotente.

**b) Só existe regime de caixa.** O DRE soma `paidAt`. O dono precisa das duas
visões — quanto **entrou** (caixa) e quanto foi **faturado** (competência, por
`dueDate`) — porque a diferença entre elas *é* a inadimplência. Hoje não há como
ver quanto ele tem a receber.

**c) ROI por veículo é parcial e não diz isso.** Considera despesa com
`vehicleId` e receita de fretamento, mas ignora a mensalidade dos alunos que
andam naquela van — porque o vínculo não existe (D-02). A métrica aparece na
tela sem ressalva, o que é pior que não aparecer.

---

## D-04 · A mensalidade não é recorrente `EM ABERTO`

`FinancialTransaction` é criada uma a uma, à mão. Na operação real o dono
cadastra o aluno com um valor e ele se repete todo mês, com vencimento em dia
fixo. Falta: geração mensal automática, dia de vencimento configurável, pró-rata
no mês de entrada e parada automática no desligamento.

Sem isso, o "financeiro" do sistema é uma planilha com login.

---

## D-05 · O SaaS não cobra a própria assinatura `DECISÃO PENDENTE`

Existem `SubscriptionPlan.priceCents` e `SaaSSubscription`; o trial expira e
suspende a empresa. Mas **nunca há cobrança do plano**. O produto suspende por
falta de pagamento de uma fatura que ele nunca emitiu.

Duas saídas honestas, e é decisão de produto:

1. Implementar a cobrança recorrente do plano via gateway; ou
2. Assumir no modelo que a cobrança é **manual** (o dono paga por fora e alguém
   marca como ativa), e a suspensão automática vira apenas *aviso*, não corte.

O que não pode continuar é a terceira opção atual: suspender por inadimplência
sem nunca ter cobrado.

---

## D-06 · Suspensão cortava o acompanhamento da criança `CORRIGIDO`

A regra anterior recusava **toda** requisição autenticada de empresa suspensa,
inclusive `GET` — apesar de o próprio comentário no código prometer *"leitura
continua, escrita para"*.

O efeito prático: no dia em que o teste do dono vencia, a mãe deixava de ver
onde estava a van com o filho dentro, o motorista não conseguia bater ponto (e
perdia registro de jornada), e o dono perdia até a tela que mostra a fatura que
precisa pagar para voltar.

Cobrança é assunto entre o VanPro e o dono da frota. Ela não pode deixar criança
sem acompanhamento nem apagar a jornada de quem trabalhou.

**Agora:** suspensão é somente-leitura. Escritas de gestão respondem 402; passam
as escritas essenciais — ponto, check-in, alerta de incidente e os direitos do
titular (LGPD Art. 18 não depende de o cliente estar em dia).
Testes em `tests/integration/security.test.ts`.

---

## D-07 · Expiração de senha punia quem não tem acesso administrativo `CORRIGIDO`

Os 90 dias valiam para todos os papéis, inclusive `PARENT`.

Rotação periódica obrigatória sem indício de comprometimento é desaconselhada
pela NIST SP 800-63B: ela empurra o usuário para senha previsível com sufixo
incremental. E para uma mãe que abre o aplicativo uma vez por mês só para ver a
van, a conta trancada aparece justamente no dia em que ela precisa.

**Agora:** a expiração vale para `SUPER_ADMIN`, `OWNER` e `MANAGER` — quem vê
faturamento, folha e dados de todas as crianças. Não vale para responsável,
motorista e monitor. Testes em `tests/integration/auth.test.ts`.

---

## D-08 · O painel de IA promete o que não entrega `DECISÃO PENDENTE`

`POST /ai/posts/generate` responde `503 FEATURE_DISABLED` — o que é a decisão
certa (a versão anterior gerava texto de template e chamava de IA). Mas a tela
continua se chamando "CRM e IA" e oferecendo o botão.

Ou se conecta um provedor de LLM de verdade, ou a tela deve dizer, antes do
clique, que a funcionalidade depende de configuração — em vez de deixar o
usuário descobrir pelo erro.

---

## Ordem sugerida

`D-02` (rota) primeiro: ele destrava o ROI (D-03c), a tela do motorista e o
acompanhamento do responsável. Depois `D-03a` (folha) e `D-04` (recorrência),
que juntos fazem o DRE virar um número em que dá para confiar. `D-01` é
independente e pode ir em paralelo. `D-05` e `D-08` são decisão sua antes de
código.
