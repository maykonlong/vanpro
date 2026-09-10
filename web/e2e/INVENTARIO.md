# Inventário de elementos interativos — VanPro web

Varredura de `web/src/` feita antes de escrever qualquer teste. Cada linha é um
elemento que a pessoa pode acionar (`<button>`, `<a>`/`Link`, submit de
formulário, `role="tab"`/`role="radio"`, `<select>` que dispara ação, `<input
type="file">`). A coluna **Coberto** diz onde o elemento é CLICADO e o efeito
verificado — nunca "a tela renderizou".

Convenção: ✅ coberto · ⚠️ coberto parcialmente (com a razão) · ❌ não coberto
(com a razão).

**Total: 238 elementos interativos.**

- **208 cobertos por inteiro** (✅) — clicados, com o efeito verificado;
- **12 cobertos em parte** (⚠️) — o handler é exercitado, mas um caminho fica
  de fora; a razão está na própria linha;
- **18 não cobertos** (❌) — cada um com a razão declarada na linha.

Isso dá **220 de 238 elementos exercitados (92,4%)**. Nenhum ❌ está ali por
esquecimento: são estados que o seed não produz (listas vazias), botões que só
existem depois de uma ação destrutiva ou irreversível, e integrações sem
credencial neste ambiente.

Cinco defeitos de produto foram encontrados no caminho (D-1 a D-5, ao fim deste
arquivo). **Todos os cinco estão corrigidos**, e os testes que os registram
passam — a seção continua existindo porque o defeito e a razão dele são mais
úteis que o registro de que sumiu.

---

## 1. Área pública

### `pages/public/Landing.tsx` (8)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 1 | `ThemeToggle` (ciclo sistema→claro→escuro) | ✅ | `90-publico` — muda a classe `dark` no `<html>` e persiste no F5 |
| 2 | Link "Entrar" (cabeçalho) | ✅ | `90-publico` |
| 3 | Link "Criar conta" (cabeçalho) | ✅ | `90-publico` |
| 4 | Link "Começar teste de 7 dias" | ✅ | `90-publico` |
| 5 | Link "Já tenho conta" | ✅ | `90-publico` |
| 6 | Link "Criar minha conta" (faixa final) | ✅ | `90-publico` |
| 7 | Link "Política de Privacidade" (rodapé) | ✅ | `90-publico` |
| 8 | Link do logo (`Logo to="/"`) | ✅ | `90-publico` (navegação da AuthShell) |

### `pages/public/Login.tsx` (12)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 8b | Carga anônima do SPA (efeito colateral) | ✅ | `90-publico` — **defeito D-1**: dispara `/auth/refresh` sem sessão |
| 9 | Campo E-mail | ✅ | `90-publico`, `11-acessibilidade` (teclado) |
| 10 | Campo Senha | ✅ | idem |
| 11 | Submit "Entrar" | ✅ | `90-publico` (senha errada → 4xx + alerta; e-mail inexistente → mesma recusa), `09-plataforma` (sucesso) |
| 12 | "Entrar com passkey" | ✅ | `90-publico` — dispara `/auth/webauthn/login/options` e a falha vira mensagem |
| 13 | Link "Esqueci minha senha" | ✅ | `90-publico` |
| 14 | Link "Cadastre sua empresa" | ✅ | `90-publico` |
| 15 | Campo Código (2FA) | ⚠️ | Nenhuma conta do seed tem 2FA ligado. Ligar o 2FA do proprietário derrubaria o login de todos os outros specs. O handler é exercitado pelo caminho de recusa em `05-owner` (`/auth/2fa/disable`). |
| 16 | Submit "Confirmar código" (2FA) | ⚠️ | idem |
| 17 | "Voltar para o login" (2FA) | ⚠️ | idem |
| 18 | Rádios de escolha de frota | ✅ | `09-plataforma` (`joana@`) |
| 19 | Submit "Entrar nesta frota" | ✅ | `09-plataforma` |
| 20 | "Voltar para o login" (escolha de frota) | ❌ | Sair do passo de escolha descarta o `selectionToken` de 5 min e obriga a refazer o login. O caminho que importa — escolher a frota e entrar nela — é coberto em `09-plataforma`. |

### `pages/public/Register.tsx` (8)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 21–25 | Campos Nome da empresa, CPF/CNPJ (com máscara), Seu nome, Seu e-mail, Senha (com medidor) | ✅ | `90-publico` — máscara e medidor conferidos |
| 26 | Submit "Criar conta" | ✅ | `90-publico` — validação local barra sem ir à rede; cadastro real cria a empresa e já entra logado |
| 27 | Link "Política de Privacidade" | ✅ | `90-publico` |
| 28 | Link "Entrar" (rodapé) | ✅ | `90-publico` |

### `pages/public/ForgotPassword.tsx` (3)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 29 | Campo E-mail | ✅ | `90-publico` |
| 30 | Submit "Enviar instruções" | ✅ | `90-publico` (pula com razão declarada se o limite de 5/hora estiver estourado) |
| 31 | Link "Voltar para o login" | ✅ | `90-publico` |

### `pages/public/ResetPassword.tsx` (4)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 32–33 | Campos Nova senha / Repita | ✅ | `90-publico` |
| 34 | Submit "Redefinir senha" | ✅ | `90-publico` — token inválido recusado pelo servidor; senha fraca barrada antes da rede |
| 35 | Link "Pedir novo link" (sem token) | ✅ | `90-publico` |

### `pages/public/AcceptInvite.tsx` (5)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 36–38 | Campos Seu nome / Senha / Repita | ✅ | `90-publico` |
| 39 | Submit "Ativar meu acesso" | ⚠️ | `90-publico` cobre a recusa de token inválido. O aceite com token VÁLIDO não é coberto: o link real só existe na resposta de `/company/team/invite` do ambiente sem e-mail, e consumi-lo criaria um usuário ativo a cada rodada. |
| 40 | Link "Ir para o login" (sem token) | ✅ | `90-publico` |

### `pages/public/Suspended.tsx` (2) · `NotFound.tsx` (1) · `PrivacyPolicy.tsx` (1)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 41 | "Voltar ao sistema (somente leitura)" | ✅ | `10-negativas` |
| 42 | "Sair da conta" (tela suspensa) | ❌ | A tela só é alcançável com sessão, e o botão executa o mesmo `logout` do cabeçalho — que é coberto em `10-negativas` (sessão derrubada leva ao login). Clicá-lo aqui não acrescentaria informação nova. |
| 43 | Link "Voltar para a página inicial" (404) | ✅ | `90-publico` |
| 44 | Link "Política de Privacidade" (AuthShell) | ✅ | `90-publico` |

---

## 2. Casca do app

### `layouts/AppLayout.tsx` (10)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 45 | Link "Pular para o conteúdo" | ✅ | `11-acessibilidade` — aparece no foco e leva ao `#conteudo` |
| 46 | Logo (volta para `/app`) | ✅ | navegação em `02-owner` |
| 47 | `ThemeToggle` | ✅ | `90-publico` |
| 48 | "Sair da conta" | ✅ | helper `sair()` + `10-negativas` (sessão derrubada leva ao login) |
| 49 | Links do menu lateral (9 destinos) | ✅ | `02-owner` percorre todos |
| 50 | Links da barra inferior (celular) | ✅ | `11-acessibilidade` |
| 51 | Botão "Mais" (celular) | ✅ | `11-acessibilidade` — abre diálogo |
| 52 | Links dentro do "Mais" | ✅ | `11-acessibilidade` — navega e FECHA a folha |
| 53 | Link "Ver como regularizar" (faixa de suspensão) | ✅ | `10-negativas` — a frota "Vai e Vem" nasce suspensa no seed. |
| 54 | Sobreposição "Trocando de frota…" | ✅ | `09-plataforma` (durante o `switch-company`) |

### `components/CompanySwitcher.tsx` (2)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 55 | Botão "Frota ativa: …" | ✅ | `09-plataforma`; ausência conferida para quem tem uma frota só |
| 56 | Opções da lista de frotas | ✅ | `09-plataforma` — troca e o CONTEÚDO troca junto |

### `components/ui/index.tsx` (primitivos, 8)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 57 | `Modal` — botão "Fechar" (X) | ✅ | usado em `03-owner`, `04-owner` |
| 58 | `Modal` — clique fora / `Esc` | ✅ | `11-acessibilidade` |
| 59 | `Modal` — prisão e devolução de foco | ✅ | `11-acessibilidade` |
| 60 | `ConfirmDialog` — "Cancelar" | ✅ | `03-owner` (cancelar precisa CANCELAR) |
| 61 | `ConfirmDialog` — confirmar | ✅ | alunos, veículos, motoristas, despesas, fretamentos, equipe, sessões, LGPD |
| 62 | `Pagination` — "Anterior"/"Próxima" | ✅ | `02-owner`, `05-owner`, `08-monitor` |
| 63 | `Segmented` — rádios de filtro | ✅ | `07-motorista`, `08-monitor` |
| 64 | `Tabs` — abas com setas do teclado | ⚠️ | O clique nas abas de `Compliance` é coberto (`05-owner`); a navegação por seta ← → dentro do `tablist` não. |
| 65 | `ErrorState` — "Tentar novamente" | ❌ | Só aparece quando a leitura falha. Provocar a falha exigiria interceptar a rede, e stub de rede é justamente o que esta suíte não usa. |

### `components/PhotoUpload.tsx` (3)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 66 | `input[type=file]` + "Enviar foto" | ✅ | `03-owner` — sobe PNG real e a URL vai para o cadastro |
| 67 | "Trocar foto" | ✅ | `03-owner` (o botão muda de rótulo depois do envio) |
| 68 | "Remover" | ⚠️ | Estado alcançado, botão não clicado: a remoção é estado local do formulário e o cadastro é conferido com a foto presente. |

---

## 3. Proprietário / gestão

### `pages/owner/Dashboard.tsx` (7)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 69 | "Abrir o financeiro" | ✅ | `02-owner` |
| 70 | "Ver todas e dar baixa" | ✅ | `02-owner` (mesmo destino) |
| 71 | "Gerenciar" (frota) | ✅ | `02-owner` |
| 72 | "Ver tudo" (alertas) | ✅ | `02-owner` |
| 73 | "Cadastrar veículo" (estado vazio) | ❌ | Só aparece com a frota vazia; a frota do seed tem 3 veículos. |
| 74–75 | Atalhos de "Comece por aqui" | ❌ | Só aparecem enquanto não há aluno OU veículo — por desenho, o bloco se aposenta sozinho. |

### `pages/owner/Financial.tsx` (23)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 76–77 | Campos De / Até (período) | ✅ | `02-owner` — período vazio mostra estado vazio; volta ao mês e o conteúdo reaparece |
| 78–81 | Abas Resultado / Mensalidades / Despesas / Faturas | ✅ | `02-owner` |
| 82 | Select "Situação" (mensalidades) | ✅ | `02-owner` — consulta com `paid=false` e `paid=true` |
| 83 | "Lançar mensalidade" (topo) | ✅ | `02-owner` |
| 84 | "Lançar mensalidade" (estado vazio) | ❌ | Só com a lista vazia; o seed tem 240 mensalidades. |
| 85–87 | Campos do lançamento (aluno, valor, vencimento) | ✅ | `02-owner` |
| 88 | Submit "Lançar" | ✅ | `02-owner` — o registro aparece na lista relida |
| 89 | "Cancelar" (modal de lançamento) | ✅ | `03-owner` (mesmo componente) |
| 90 | "Dar baixa" | ✅ | `02-owner` — sai de "em aberto" e entra em "pagas" |
| 91 | Confirmação "Confirmar recebimento" | ✅ | `02-owner` |
| 92 | Select "Categoria" (filtro) | ✅ | `02-owner` — consulta com `category=TAXES` |
| 93 | "Lançar despesa" | ✅ | `02-owner`, `06-manager` |
| 94–98 | Campos da despesa (descrição, valor, categoria, data, veículo) | ✅ | `02-owner` |
| 99 | Submit "Lançar despesa" | ✅ | `02-owner` — **o DRE soma exatamente o valor lançado** |
| 100 | "Excluir" despesa | ✅ | `02-owner` — e o DRE volta ao valor anterior. **Ver defeito D-2.** |
| 101 | "Gerar cobrança Pix" + formulário | ⚠️ | O gateway não tem credencial neste ambiente: a tela substitui o botão pelo aviso, e é isso que `02-owner` verifica. O formulário de cobrança fica **NÃO VERIFICADO (N-2)**. |
| 102 | Link "Abrir cobrança" (fatura com URL) | ❌ | Depende de fatura emitida pelo gateway; nenhuma tem `paymentUrl` neste ambiente. |
| 103 | Paginação | ✅ | `02-owner` |

### `pages/owner/Students.tsx` (16)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 104 | "Novo aluno" | ✅ | `03-owner` |
| 105 | Campo "Buscar por escola" | ✅ | `03-owner` — busca sem resultado mostra estado vazio |
| 106 | Select "Turno" (filtro) | ✅ | `03-owner` |
| 107–113 | Campos do cadastro (nome, escola, série, turno, mensalidade, endereço, nascimento) | ✅ | `03-owner` |
| 114–115 | Caixas de consentimento LGPD / imagem | ✅ | `03-owner` |
| 116 | Submit "Cadastrar aluno" / "Salvar alterações" | ✅ | `03-owner` — criação e edição conferidas **na API**, em centavos |
| 117 | "Editar" | ✅ | `03-owner` |
| 118 | "Excluir" + confirmação | ✅ | `03-owner` — cancelar mantém, confirmar remove (na tela e na API) |
| 119 | Paginação | ✅ | `03-owner` (mesma primitiva) |

Observação: **não existe botão de check-in nesta tela**. O check-in mora em
`components/BoardingList.tsx` (motorista e monitor) e está coberto lá.

### `pages/owner/Fleet.tsx` (20)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 120–121 | Abas Veículos / Motoristas | ✅ | `03-owner`, `06-manager` |
| 122 | "Cadastrar veículo" | ✅ | `03-owner` |
| 123–126 | Campos placa / modelo / capacidade / situação | ✅ | `03-owner` — placa inválida barrada antes da rede |
| 127 | Submit "Cadastrar"/"Salvar" | ✅ | `03-owner` |
| 128 | "Odômetro" | ✅ | `03-owner` (avança) e `06-manager` (gestora também pode) |
| 129 | Campo Quilometragem + "Registrar" | ✅ | `03-owner` — valor MENOR é recusado pelo servidor e a tela mostra o motivo |
| 130 | "Editar" veículo | ✅ | `03-owner` |
| 131 | "Remover" veículo + confirmação | ✅ | `03-owner` |
| 132 | "Cadastrar motorista" | ✅ | `03-owner` |
| 133–135 | Campos nome / turno / diária | ✅ | `03-owner` |
| 136 | "Editar" motorista | ✅ | `03-owner` |
| 137 | "Arquivar" motorista + confirmação | ✅ | `03-owner` — status vira `ARCHIVED` na API |
| 138 | Estado vazio "Cadastrar veículo/motorista" | ❌ | Só com a frota vazia. |
| 139 | Paginação (duas listas) | ⚠️ | Pula com razão declarada quando tudo cabe em uma página. |

### `pages/owner/Team.tsx` (14)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 140 | "Convidar" | ✅ | `04-owner` |
| 141–144 | Campos nome / e-mail / papel / contrato | ✅ | `04-owner` |
| 145–147 | Três caixas de permissão | ✅ | `04-owner` |
| 148 | Submit "Enviar convite" | ✅ | `04-owner` — cria o vínculo e a tela AVISA que o e-mail não saiu |
| 149 | Link "Abrir link do convite" | ⚠️ | Presença verificada; não é seguido (ver item 39). |
| 150 | "Permissões" | ✅ | `04-owner` — troca de flag conferida na API |
| 151 | Submit "Salvar permissões" | ✅ | `04-owner` |
| 152 | "Arquivar" + confirmação | ✅ | `04-owner` — status vira `ARCHIVED` |
| 153 | Ausência de botões no próprio vínculo | ✅ | `04-owner` |

### `pages/owner/Charters.tsx` (17)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 154 | Select "Situação" (filtro) | ✅ | `04-owner`, `06-manager` |
| 155 | "Novo fretamento" | ✅ | `04-owner` |
| 156–160 | Campos título / contratante / preço / início / fim | ✅ | `04-owner` |
| 161 | Submit "Cadastrar"/"Salvar" | ✅ | `04-owner` |
| 162 | "Atribuir" + selects de veículo e motorista | ✅ | `04-owner` — **conflito de escala provocado: 409 com o contrato conflitante nomeado** |
| 163 | "Editar" | ✅ | `04-owner` |
| 164 | "Iniciar" (PENDING → IN_PROGRESS) | ✅ | `04-owner` |
| 165 | "Concluir" (IN_PROGRESS → COMPLETED) | ⚠️ | A transição existe e é oferecida; o teste segue para "Cancelar" porque contrato concluído não pode mais ser excluído e viraria lixo permanente no banco compartilhado. |
| 166 | "Cancelar" (mudança de estado) | ✅ | `04-owner` |
| 167 | "Excluir" + confirmação | ✅ | `04-owner` — só o PENDING sai, como a API exige |
| 168 | Paginação | ✅ | mesma primitiva |

### `pages/owner/CrmAi.tsx` (19)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 169–172 | Abas Chat / Incidentes / Campanhas / Aniversários | ✅ | `05-owner` |
| 173 | Campo "Nova mensagem" + "Enviar" | ✅ | `05-owner` — a mensagem volta do servidor assinada pelo cadastro |
| 174–177 | Campos do alerta (título, descrição, gravidade) + "Disparar alerta" | ✅ | `05-owner` |
| 178–182 | Campos da campanha (nome, modelo, canal, público) + "Criar campanha" | ✅ | `05-owner` |
| 183 | "Pausar" / "Ativar" campanha | ✅ | `05-owner` — `isActive` conferido na API nos dois sentidos |
| 184 | "Gerar rascunho com IA" | ✅ | `05-owner` — 503 `FEATURE_DISABLED`, aviso na tela, e NENHUM rascunho criado |
| 185 | Select "Janela" (aniversários) | ✅ | `05-owner` |
| 186 | "Aprovar" publicação | ❌ | **NÃO VERIFICADO (N-3)** — não há como criar um rascunho: o gerador exige provedor de IA (503) e não existe outra rota de criação. |
| 187 | "Recusar" publicação | ❌ | idem |
| 188 | "Publicar agora" | ❌ | idem, e o canal WhatsApp também está sem credencial |
| 189 | Paginação (3 listas) | ✅ | mesma primitiva |

### `pages/owner/Compliance.tsx` (6)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 190–191 | Abas Pedidos de eliminação / Trilha | ✅ | `05-owner` |
| 192 | "Aprovar eliminação" + confirmação "Anonimizar definitivamente" | ✅ | `05-owner` — sobre um aluno DESCARTÁVEL criado pelo próprio teste; o pedido some da fila na API |
| 193 | Select "Filtrar por ação" | ✅ | `05-owner` — todas as linhas devolvidas são da ação escolhida |
| 194 | Paginação da trilha | ✅ | `05-owner` |
| 195 | Veredito de integridade da cadeia | ✅ | `05-owner` — a tela tem de dizer o MESMO que a API. **Ver defeito D-3.** |

### `pages/owner/Settings.tsx` (13)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 196 | "Ativar verificação em duas etapas" | ✅ | `05-owner` — QR e segredo vêm do servidor |
| 197 | Campo código + "Ativar 2FA" | ❌ | Ligar o 2FA do proprietário derrubaria o login de todos os demais specs. |
| 198 | "Cancelar" (setup 2FA) | ✅ | `05-owner` |
| 199 | "Desativar" + campos senha/código + "Confirmar desativação" | ✅ | `05-owner` — recusa do servidor (409, 2FA não está ativo nesta conta) com a mensagem na tela. Com o 2FA ligado, a senha errada cairia no mesmo 401 do defeito D-5. |
| 200 | "Já anotei" (códigos de recuperação) | ❌ | Só existe depois de ATIVAR o 2FA (item 197). |
| 201 | "Registrar passkey neste dispositivo" | ✅ | `05-owner` — ciclo completo contra autenticador virtual do Chromium |
| 202–203 | Campos senha atual / nova + "Trocar senha" | ✅ | `05-owner` — fraca barrada no cliente, senha atual errada recusada pelo servidor. **Ver defeito D-5.** |
| 204 | "Encerrar" dispositivo + confirmação | ✅ | `05-owner` — a sessão some da lista (pula com razão se só existir a atual) |
| 205 | "Tentar novamente" dos blocos | ❌ | Mesmo motivo do item 65. |

---

## 4. Motorista, monitor, responsável, plataforma

### `components/BoardingList.tsx` (8) — motorista e monitor

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 206 | `Segmented` "Filtrar por turno" | ✅ | `07-motorista` — refaz a consulta com `shift=` |
| 207 | `Segmented` "Filtrar por situação" | ✅ | `07-motorista` — filtro LOCAL, sem ida à rede |
| 208 | "Embarcou" | ✅ | `07-motorista`, `08-monitor` — `BOARDED` conferido na API |
| 209 | "Faltou" | ✅ | `08-monitor` — `ABSENT` conferido na API |
| 210 | "Entreguei" | ✅ | `07-motorista` — `DELIVERED` conferido na API |
| 211 | "Desfazer" | ✅ | ambos — devolve a `PENDING` e o banco fica como estava |
| 212 | "Ver todos os turnos" (vazio) | ⚠️ | Alcançado só quando o turno filtrado está vazio. |
| 213 | "Ver todos" (situação vazia) | ✅ | `08-monitor` |

### `pages/driver/DriverRoute.tsx` (2) · `Timeclock.tsx` (8) · `MyEarnings.tsx` (1)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 214 | Botão da faixa "Bater entrada"/"Ver meu ponto" | ✅ | `07-motorista` |
| 215 | Lista de fretamentos do motorista | ✅ | `07-motorista` (leitura) |
| 216 | Select "Em qual van você vai hoje?" | ✅ | `07-motorista` — sem escolha o botão fica desabilitado com o motivo escrito |
| 217 | "Anotar a quilometragem (opcional)" | ✅ | `07-motorista` |
| 218 | Campo Quilometragem | ✅ | `07-motorista` |
| 219 | "Bater entrada" | ✅ | `07-motorista` |
| 220 | "Iniciar pausa" | ✅ | `07-motorista` |
| 221 | "Voltar da pausa" | ✅ | `07-motorista` |
| 222 | "Bater saída" | ✅ | `07-motorista` — as 4 batidas conferidas no cartão encerrado |
| 223 | Campo "Mês de referência" (ganhos) | ✅ | `07-motorista` — refaz a apuração no servidor |

### `pages/parent/*` (10)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 224 | "Atualizar" (acompanhamento) | ✅ | `08-monitor-responsavel` |
| 225 | Link "Mensalidades e comprovantes" | ✅ | idem |
| 226 | Link "Meus dados e os do meu filho (LGPD)" | ✅ | idem |
| 227 | Paginação das mensalidades | ✅ | idem (pula com razão se houver só uma página) |
| 228 | "Exportar meus dados" | ✅ | idem — **o arquivo é baixado de verdade**, com o nome esperado |
| 229 | "Autorizar/Revogar tratamento de dados" | ⚠️ | O mesmo handler é exercitado pelo consentimento de imagem (item 230); o de tratamento não é alternado para não deixar um aluno do seed sem base legal se a suíte cair no meio. |
| 230 | "Autorizar/Revogar uso de imagem" | ✅ | idem — conferido na API e devolvido ao valor original |
| 231 | "Solicitar exclusão" + confirmação | ✅ | idem — sobre um aluno descartável, `PENDING_APPROVAL` conferido na API |
| 232 | Link do menu para privacidade | ✅ | idem |
| 233 | Botões do estado vazio | ❌ | A conta do seed tem filhos vinculados. |

### `pages/admin/PlatformPanel.tsx` (2)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 234 | Blocos de dependências e integrações | ✅ | `09-plataforma` — comparados com `/health/ready` e `/health/features` |
| 235 | "Tentar novamente" | ❌ | Mesmo motivo do item 65. |

### `components/RequireRole.tsx` (2)

| # | Elemento | Coberto | Onde |
|---|---|---|---|
| 236 | "Voltar" | ✅ | `07-motorista` |
| 237 | "Ir para a minha tela inicial" | ✅ | `06-manager`, `08-monitor` |

---

## Defeitos de produto encontrados

Os cinco foram encontrados por esta suíte, **e todos estão corrigidos**. O texto
descreve o defeito como ele era, porque é isso que explica por que o teste
existe — um teste sem a história do defeito é o primeiro a ser apagado numa
refatoração. Correção e teste de regressão em `docs/REVISAO-DE-DOMINIO.md`.

### D-1 · Navegação anônima esgota o limite de login (`web/src/lib/api.ts`)

`request()` trata qualquer 401 como sessão expirada e dispara
`POST /auth/refresh` — inclusive para `GET /auth/me` no boot do app, quando não
existe cookie nenhum. Esse refresh responde 401 e **consome o `authLimiter`**
(10 por 15 min por IP, `api/src/security/rate-limit.ts`).

Reprodução: abrir `https://vanpro.localhost:8443/` em aba anônima ~10 vezes
(cada carga registra `GET /auth/me → 401` e `POST /auth/refresh → 401`); em
seguida tentar entrar com a senha CORRETA. Resultado: `429 RATE_LIMITED` no
`/auth/login`, para todo mundo atrás daquele IP, pelos ~15 minutos seguintes.
Uma escola inteira atrás de um NAT tranca o próprio login só navegando.

Correção sugerida: incluir `/auth/me` na lista `NO_RETRY`, ou não tentar
renovar quando nunca houve sessão nesta aba.

Teste que registra: `90-publico.spec.ts` › "a carga anônima não deveria
disparar um refresh de sessão inexistente".

Efeito na suíte: as sessões vêm de um login pela API (`testeComo` /
`contextoComo` em `helpers.ts`), onde credencial certa não gasta cota; e nos
testes anônimos cujo assunto é outro, o refresh sem sessão é respondido
localmente (`pouparCotaDeLogin`). Sem isso a suíte mediria o rate limit em vez
do produto. Nenhuma outra chamada é interceptada em lugar nenhum da suíte.

### D-2 · Botão de excluir despesa que sempre dá 403 para o gestor

`web/src/pages/owner/Financial.tsx` (componente `Despesas`) renderiza o botão
"Excluir" para qualquer pessoa com `canManageFinance`, mas a API exige
`requireRole('OWNER')` em `DELETE /financial/expenses/:id`.

Reprodução: entrar como `secretaria@transvan.com.br`, ir a Financeiro →
Despesas, clicar em "Excluir" em qualquer lançamento e confirmar. Resultado:
`403 FORBIDDEN`. Um botão morto atrás de um diálogo de confirmação.

Teste que registra: `06-manager.spec.ts` › "a gestora não deveria receber um
botão de excluir despesa que sempre dá 403".

Correção sugerida: a mesma linha que Alunos, Frota e Fretamentos já usam —
`hasRole('OWNER')` antes de renderizar o botão.

### D-3 · A cadeia de auditoria quebra sozinha com duas ações simultâneas

`api/src/lib/audit.ts` monta o encadeamento com leitura seguida de escrita, sem
transação nem restrição de unicidade: `findFirst` pega o último hash da empresa
e depois `create` grava. Duas ações auditadas concorrentes na MESMA empresa leem
o mesmo `prevHash` e gravam duas linhas irmãs — a cadeia bifurca e
`verifyChain()` passa a reportar ruptura para sempre.

Reprodução: disparar duas requisições auditadas em paralelo para a mesma
empresa (dois `GET /privacy/export`, por exemplo) e depois abrir Privacidade e
auditoria → Trilha. Observado neste ambiente: duas linhas `LGPD_DATA_EXPORT` em
`2026-09-10 04:04:38.180` e `.186` com o mesmo `prevHash` `571fb3fa…`, e a tela
passou a exibir "Não — a cadeia foi rompida".

Impacto: a trilha deixa de servir como prova, e não há como reparar sem
regravar o histórico.

Correção sugerida: serializar a gravação por empresa (transação com bloqueio, ou
índice único em `(companyId, prevHash)` com repetição em caso de colisão).

Nota sobre o teste: `05-owner` **não** exige `ok === true` — exige que a tela
mostre o mesmo veredito que a API. Fixar `ok === true` faria a suíte esconder o
defeito quando ele reaparecer.

### D-4 · Alvos de toque de 40 px nas telas do motorista e do monitor

`Segmented` (`web/src/components/ui/index.tsx`) usa `min-h-[40px]`, abaixo dos
44 px que o cabeçalho do próprio arquivo define como piso. São os filtros de
turno e de situação — os controles que o motorista e o monitor tocam de pé, com
a van ligada.

Reprodução: `/app/rota` ou `/app/embarque` em 375 px; medir a altura dos botões
`role="radio"` do filtro. Resultado: 40 px.

Testes que registram: `11-acessibilidade-mobile.spec.ts` › "a tela do motorista
cabe no celular e tem alvos de 44 px" e "a tela do monitor …".

Correção sugerida: `min-h-[44px]` no botão do `Segmented`.

### D-5 · Errar a senha atual em "Trocar senha" desloga a pessoa

`POST /auth/change-password` responde 401 `invalidCredentials` quando a senha
atual não confere. O cliente (`web/src/lib/api.ts`) trata **todo** 401 como fim
de sessão: limpa o CSRF, dispara `notify('unauthenticated')`, o `AuthProvider`
marca a sessão como anônima e o `RequireRole` manda para `/entrar`.

Reprodução: entrar como proprietário, ir a Configurações → Trocar senha,
preencher "Senha atual" com um valor errado e uma nova senha forte, e clicar em
"Trocar senha". Resultado: a pessoa é expulsa para a tela de login **sem nunca
ler o motivo**. O mesmo caminho vale para a desativação do 2FA com senha errada
(`/auth/2fa/disable` também responde 401 nesse caso, quando o 2FA está ativo).

Aqui o 401 não quer dizer "sua sessão acabou", quer dizer "esta senha está
errada" — e as duas coisas exigem reações opostas.

Teste que registra: `05-owner-crm-privacidade-config.spec.ts` › "trocar senha
barra a senha fraca no cliente e a senha atual errada no servidor".

Correção sugerida: só tratar como fim de sessão o 401 vindo das rotas de
sessão, ou permitir que a chamada declare "este erro é do formulário".

### Observação (não é defeito) · dois `<nav>` com o mesmo rótulo, um de cada vez

`AppLayout` declara dois `<nav aria-label="Navegação principal">`: o menu
lateral, escondido abaixo de `lg`, e a barra inferior, escondida a partir de
`lg`. Em qualquer largura só um deles chega à árvore de acessibilidade, então
não há ambiguidade de landmark para quem usa leitor de tela — e é isso que
`11-acessibilidade-mobile.spec.ts` verifica em 375 px (`toHaveCount(1)`), em
vez de supor.

---

## Cenários NÃO VERIFICADOS (ausência de sinal, não aprovação)

### ~~N-1 · Escrita em empresa suspensa~~ — COBERTO

Era o caso mais gritante desta seção: o modo somente-leitura é o caminho mais
delicado do produto e nenhuma empresa do seed estava suspensa, então ele nunca
tinha sido exercitado.

O seed passou a ter uma quarta empresa — **Vai e Vem Transporte Escolar**, em
`SUSPENDED` — e `10-negativas.spec.ts` cobre as quatro partes do contrato: a
faixa "Somente leitura" aparece, a leitura continua inteira, a escrita é
recusada pelo servidor com `402 ACCOUNT_SUSPENDED`, e bater ponto continua
passando.

### N-2 · Emissão de cobrança Pix

`billing` está desligado em `/health/features`. O que a suíte verifica é que a
tela DECLARA a indisponibilidade e não oferece o botão. O formulário de
cobrança e o link "Abrir cobrança" ficam não verificados até haver credencial
de gateway no ambiente.

### N-3 · Moderação de publicações de IA (aprovar / recusar / publicar)

Não há provedor de IA configurado: `POST /ai/posts/generate` responde 503
`FEATURE_DISABLED`, e essa é a única rota que cria rascunho. Sem rascunho, os
três botões não têm como ser exercitados. A suíte verifica o que dá para
verificar: que a recusa é honesta e que NENHUMA publicação é criada em
consequência dela.

### N-4 · Login com 2FA e aceite de convite com token válido

Ver itens 15–17 e 39. Ligar o 2FA do proprietário derrubaria as sessões usadas
por toda a suíte; consumir um convite válido criaria um usuário ativo por
rodada.

---

## Como rodar (e um limite operacional)

```
cd web && npx playwright test
```

A pilha precisa estar no ar em `https://vanpro.localhost:8443`. Não há
`webServer` na configuração de propósito: a suíte fala com o build de produção
servido pelo nginx, e não com um Vite de desenvolvimento.

**Deixe ~15 minutos entre duas execuções completas.** O `globalLimiter` da API
conta 1000 requisições por 15 minutos **por usuário**, e a suíte inteira gasta
perto disso na conta do proprietário (cada teste abre uma sessão nova e carrega
telas de verdade). Duas rodadas coladas fazem a segunda receber
`429 RATE_LIMITED` em escritas legítimas — o que é o limitador funcionando, não
o produto quebrando, mas atrapalha a leitura do relatório. O mesmo vale, em
janela menor, para o `authLimiter` (ver D-1).

## O que a suíte deixa no banco

O banco é compartilhado, então cada spec limpa o que cria. Sobra, por rodada, e
de propósito:

- **1 fretamento cancelado** (`E2E Fretamento A …`) — a API recusa apagar
  contrato que já rodou, e o teste não contorna a regra;
- **1 mensalidade paga de valor simbólico** (entre R$ 1,00 e R$ 9,00) — não há
  rota de exclusão de mensalidade;
- **1 vínculo de equipe arquivado** e **1 motorista arquivado** — arquivamento é
  o oposto de apagar, por desenho;
- **1 empresa nova** por execução do cadastro público (`E2E Frota …`);
- mensagens de chat, um alerta e uma campanha, todos com sufixo aleatório.

Tudo o mais — alunos, veículos, despesas, fotos, pedidos de eliminação — é
removido pelo próprio teste que criou.
