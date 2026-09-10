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

## D-05 · O SaaS não cobra a própria assinatura `DECIDIDO E APLICADO`

Existem `SubscriptionPlan.priceCents` e `SaaSSubscription`; o trial expirava e
**suspendia** a empresa. Mas nunca houve cobrança do plano: o produto cortava o
acesso por inadimplência de uma fatura que ele mesmo jamais emitiu.

**Decisão tomada:** enquanto a cobrança recorrente do SaaS não existir, ela é
tratada como **manual** — e, sendo manual, o vencimento do teste não pode cortar
nada sozinho.

O que mudou, em três partes:

1. **O cron não suspende mais.** `TRIAL` vencido vira `PAST_DUE`. A frota
   continua trabalhando inteira e a interface avisa, em faixa própria, que o
   período de teste acabou e o plano precisa ser regularizado. Punir o cliente
   pelo que falta no produto seria a pior das saídas.
2. **Suspender virou ato administrativo.** `PATCH /platform/companies/:id/status`
   exige `SUPER_ADMIN` e um motivo de no mínimo 10 caracteres, e registra a
   mudança na trilha da **empresa afetada** — que é onde a pergunta "por que eu
   fiquei fora do ar?" nasce. Suspender preserva leitura, ponto e check-in
   (D-06); cancelar encerra as sessões.
3. **O console existe de verdade.** A aba Plataforma lista as frotas com estado,
   plano e tamanho, e é de lá que a mudança é feita. Antes, aquela tela declarava
   "não medido" porque não havia rota alguma que atravessasse empresas.

Testes em `api/tests/integration/platform.test.ts` (10 cenários, incluindo a
recusa para quem opera uma frota) e `api/tests/integration/jobs.test.ts`.

Quando a cobrança recorrente for construída, o passo natural é o gateway marcar
`PAST_DUE` → `SUSPENDED` pelo mesmo endpoint, com o motivo vindo da fatura.

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

## D-08 · O painel de IA promete o que não entrega `CORRIGIDO`

`POST /ai/posts/generate` responde `503 FEATURE_DISABLED` — o que é a decisão
certa (a versão anterior gerava texto de template e chamava de IA). Mas a tela
continuava oferecendo o botão "Gerar rascunho com IA", cuja **única resposta
possível** era esse 503.

Não é integração "por configurar": não existe provedor de LLM neste produto. Um
botão que só sabe falhar é pior que a ausência dele, porque ensina a pessoa a
desconfiar do resto da tela.

**Agora:** o botão foi removido e a tela diz, antes de qualquer clique, que esta
versão não gera texto automaticamente e que as campanhas são escritas ali e
enviadas pelos canais configurados. O endpoint continua devolvendo 503 para
cliente de API — o contrato do servidor não mudou. Teste em
`web/e2e/05-owner-crm-privacidade-config.spec.ts`.

Quando um provedor for integrado, a decisão de exibir o botão passa a ser a
mesma de `billing` e `whatsapp`: sonda em `/health/features`, botão só aparece
com credencial presente.

---

## D-09 · A frota nunca chegava à segunda página `CORRIGIDO`

A lista de veículos pedia 20 por página. O plano PRO — o mais caro que existe —
limita a frota a 20 veículos.

O botão "Próxima" da tela de frota, portanto, era inalcançável para **qualquer**
cliente em **qualquer** plano. Não era um caso raro: era código morto com
aparência de recurso, que passava em revisão visual porque o controle está lá,
desenhado e bonito, e ninguém consegue clicá-lo.

Achado ao tentar exercitar a paginação num teste: criar veículos até encher a
segunda página esbarrou no `PLAN_LIMIT_REACHED` do próprio produto.

**Agora:** a lista pagina de 12 em 12 — uma frota no teto do plano ocupa duas
páginas, e a navegação passa a ser exercitável. O teste em
`web/e2e/03-owner-alunos-frota.spec.ts` cria os veículos, navega ida e volta,
confere que a página 2 não repete a 1 e desfaz tudo no `finally`.

---

## D-10 · A conta suspensa parecia normal até alguém apertar Salvar `CORRIGIDO`

A faixa "Somente leitura" só acendia depois que uma escrita voltava `402
ACCOUNT_SUSPENDED` — porque o front derivava o estado do ERRO, e não do estado.

Na prática: a pessoa entrava, navegava por um aplicativo aparentemente normal,
preenchia o cadastro inteiro de um aluno e só descobria a suspensão ao apertar
"Salvar", perdendo o que digitou. A informação estava em `/auth/me`
(`company.tenantStatus`) desde sempre; ninguém a lia.

**Agora:** `AuthContext` deriva a suspensão do próprio `tenantStatus`, e o
evento vindo da API continua valendo para a suspensão que acontece com a sessão
já aberta.

E, mais importante que a correção: o seed passou a ter uma quarta empresa em
`SUSPENDED` ("Vai e Vem Transporte Escolar"). Sem uma empresa nesse estado no
banco, o caminho inteiro de somente-leitura — o mais delicado do produto — só
podia ser lido no código, nunca exercitado, e o teste correspondente vivia
declarado `NÃO VERIFICADO`. Agora quatro cenários o exercitam: a faixa aparece,
a leitura continua inteira, a escrita é recusada com 402 pelo servidor, e bater
ponto continua passando — porque a van já está na rua com criança dentro quando
o boleto vence.

---

## D-11 · A tela do ponto mandava bater entrada quando o servidor ia recusar `CORRIGIDO`

A tela do motorista descobria o turno aberto com
`items.find(t => t.status === 'IN_PROGRESS')` sobre a página dos **10 últimos**
cartões.

O caso mais comum de todos — o motorista que esqueceu de bater a saída ontem —
empurra esse cartão para fora da janela assim que existem 10 cartões mais novos.
A tela então dizia "Fora do turno", liberava o botão "Bater entrada", e o
servidor respondia `409` com "já existe um turno em andamento". A interface
mandava a pessoa fazer exatamente o que ia falhar, no começo do expediente, com
a van na porta da escola.

Achado pela suíte de ponta a ponta, e não por leitura: o cenário do ciclo de
ponto normaliza o estado antes de começar, e a normalização não encontrava o
turno que o servidor enxergava.

**Agora:** o turno aberto é **perguntado** ao servidor
(`GET /timecards?status=IN_PROGRESS&perPage=1`), independente de paginação. A
lista de cartões recentes continua servindo ao histórico, que é o que ela é.

---

## Ordem sugerida

`D-02` (rota) primeiro: ele destrava o ROI (D-03c), a tela do motorista e o
acompanhamento do responsável. Depois `D-03a` (folha) e `D-04` (recorrência),
que juntos fazem o DRE virar um número em que dá para confiar. `D-01` é
independente e pode ir em paralelo. `D-05` e `D-08` são decisão sua antes de
código.
