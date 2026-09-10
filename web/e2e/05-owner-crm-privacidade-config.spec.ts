import { expect } from '@playwright/test';

import {
  apiGet,
  apiPost,
  chamarApi,
  contextoComo,
  testeComo,
  clicarEsperando,
  sufixo,
  type PaginadoLeve,
} from './helpers';

/**
 * Proprietário: relacionamento (CRM/IA), privacidade e auditoria, configurações.
 *
 * Duas decisões deliberadas neste arquivo:
 *
 * 1. A aprovação de eliminação é IRREVERSÍVEL (anonimiza a criança). Por isso o
 *    teste monta o próprio caso — cria um aluno descartável e registra o pedido
 *    pela API — e aprova ESSE. Aprovar um pedido de aluno do seed destruiria
 *    dado de demonstração para provar um botão.
 *
 * 2. Nada aqui troca a senha nem liga o 2FA do proprietário: as duas coisas
 *    derrubariam as sessões que os outros specs usam. Esses botões são provados
 *    pelo caminho de recusa, que exercita o mesmo handler e a mesma rota.
 */

const test = testeComo('OWNER');

interface Post {
  id: string;
  status: string;
}

interface Campanha {
  id: string;
  name: string;
  isActive: boolean;
}

interface Mensagem {
  id: string;
  content: string;
}

interface PedidoEliminacao {
  id: string;
  name: string;
}

interface Trilha {
  items: Array<{ id: string; action: string; description: string }>;
  meta: { total: number; totalPages: number };
  chainIntegrity: { ok: boolean; checked: number };
}

test.describe('CRM e IA', () => {
  test('o chat da equipe envia e a mensagem volta do servidor com autoria', async ({ page }) => {
    const texto = `E2E recado ${sufixo()}`;
    await page.goto('/app/crm');
    await page.getByRole('tab', { name: 'Chat da equipe' }).click();

    await page.getByLabel(/^Nova mensagem/).fill(texto);
    await clicarEsperando(page, page.getByRole('button', { name: 'Enviar' }), '/chat/messages', {
      metodo: 'POST',
    });

    // A assinatura vem do cadastro, não do que se digitou.
    const item = page.locator('li').filter({ hasText: texto }).first();
    await expect(item).toBeVisible();
    await expect(item).toContainText('Roberto Almeida');

    // O campo esvazia: senão o próximo clique manda a mesma coisa de novo.
    await expect(page.getByLabel(/^Nova mensagem/)).toHaveValue('');

    const lista = await apiGet<PaginadoLeve<Mensagem>>(page, '/crm/chat/messages?perPage=30');
    expect(lista.items.some((m) => m.content === texto), 'a mensagem precisa existir na API').toBe(
      true,
    );
  });

  test('disparar alerta grava o incidente e ele aparece na lista', async ({ page }) => {
    const titulo = `E2E Alerta ${sufixo()}`;
    await page.goto('/app/crm');
    await page.getByRole('tab', { name: 'Incidentes' }).click();

    await page.getByLabel(/^Título/).fill(titulo);
    await page.getByLabel(/^Descrição/).fill('Alerta gerado pela suíte E2E para provar o botão.');
    await page.getByLabel(/^Gravidade/).selectOption('HIGH');

    await clicarEsperando(page, page.getByRole('button', { name: 'Disparar alerta' }), '/incidents/broadcast', {
      metodo: 'POST',
    });

    const item = page.locator('li').filter({ hasText: titulo }).first();
    await expect(item).toBeVisible();
    await expect(item.getByText('Alta', { exact: true })).toBeVisible();
    await expect(page.getByLabel(/^Título/)).toHaveValue('');
  });

  test('criar campanha e alternar entre ativa e pausada', async ({ page }) => {
    const nome = `E2E Campanha ${sufixo()}`;
    await page.goto('/app/crm');
    await page.getByRole('tab', { name: 'Campanhas' }).click();

    await page.getByLabel(/^Nome/).fill(nome);
    await page.getByLabel(/^Modelo da mensagem/).fill('Olá {{nome}}, comunicado de teste.');
    await page.getByLabel(/^Canal/).selectOption('EMAIL');
    await page.getByLabel(/^Público/).selectOption('ALL_PARENTS');

    await clicarEsperando(page, page.getByRole('button', { name: 'Criar campanha' }), '/ai/campaigns', {
      metodo: 'POST',
    });

    const cartao = page.locator('li').filter({ hasText: nome }).first();
    await expect(cartao).toBeVisible();
    await expect(cartao.getByText('Ativa', { exact: true })).toBeVisible();

    // Pausar precisa PAUSAR — na tela e no dado.
    await clicarEsperando(page, cartao.getByRole('button', { name: 'Pausar' }), '/ai/campaigns/', {
      metodo: 'PATCH',
    });
    const pausada = page.locator('li').filter({ hasText: nome }).first();
    await expect(pausada.getByText('Pausada', { exact: true })).toBeVisible();

    let lista = await apiGet<PaginadoLeve<Campanha>>(page, '/ai/campaigns?perPage=100');
    expect(lista.items.find((c) => c.name === nome)?.isActive).toBe(false);

    await clicarEsperando(page, pausada.getByRole('button', { name: 'Ativar' }), '/ai/campaigns/', {
      metodo: 'PATCH',
    });
    await expect(
      page.locator('li').filter({ hasText: nome }).first().getByText('Ativa', { exact: true }),
    ).toBeVisible();

    lista = await apiGet<PaginadoLeve<Campanha>>(page, '/ai/campaigns?perPage=100');
    expect(lista.items.find((c) => c.name === nome)?.isActive).toBe(true);
  });

  test('a tela avisa que não há geração automática ANTES do clique, e não oferece botão morto', async ({
    page,
  }) => {
    await page.goto('/app/crm');
    await page.getByRole('tab', { name: 'Campanhas' }).click();

    // O aviso vem antes de qualquer acao — nao e consequencia de um erro.
    await expect(
      page.getByRole('heading', { name: /Assistente de IA não está configurada/i }),
    ).toBeVisible();

    // E o botao que so sabia falhar nao existe mais.
    await expect(
      page.getByRole('button', { name: /Gerar rascunho com IA/i }),
      'botão cuja única resposta possível é 503 não deve existir na tela',
    ).toHaveCount(0);

    // O contrato do servidor continua o mesmo para cliente de API.
    const geracao = await chamarApi(page, '/ai/posts/generate', 'POST', {
      channel: 'WHATSAPP',
      prompt: 'Rascunho de comunicado para os responsáveis.',
      quantity: 1,
    });
    expect(geracao.status, 'sem provedor de IA a rota precisa recusar, não simular').toBe(503);

    // Nada foi criado: 503 não pode virar rascunho fantasma.
    const posts = await apiGet<PaginadoLeve<Post>>(page, '/ai/posts?perPage=10');
    expect(posts.meta.total, 'recusa não pode gerar publicação').toBe(0);
  });

  test('a janela de aniversariantes consulta o servidor com o intervalo escolhido', async ({
    page,
  }) => {
    await page.goto('/app/crm');
    await page.getByRole('tab', { name: 'Aniversários' }).click();

    const espera = page.waitForResponse(
      (r) => r.url().includes('/ai/birthdays') && r.url().includes('days=30'),
    );
    await page.getByLabel(/^Janela/).selectOption('30');
    expect((await espera).status()).toBeLessThan(400);
  });
});

test.describe('Privacidade e auditoria', () => {
  test('a fila de eliminação aprova o pedido e o registro sai da fila', async ({ page }) => {
    const id = sufixo();
    const nome = `E2E Eliminar ${id}`;

    // --- cenário montado pela API, e não pela tela: o proprietário não tem
    // botão para PEDIR eliminação (quem pede é o responsável). O que se testa
    // aqui é a APROVAÇÃO, e ela precisa recair sobre um aluno descartável.
    await page.goto('/app/alunos');
    const aluno = await apiPost<{ id: string }>(page, '/students', {
      name: nome,
      school: `E2E EscolaLGPD ${id}`,
      grade: '1',
      shift: 'MORNING',
      monthlyFee: 10,
    });
    await apiPost(page, '/privacy/forget-me', { studentId: aluno.id });

    await page.goto('/app/privacidade-auditoria');
    await expect(page.getByRole('heading', { name: 'Privacidade e auditoria' })).toBeVisible();

    const antes = await apiGet<PaginadoLeve<PedidoEliminacao>>(
      page,
      '/privacy/deletion-requests?perPage=100',
    );
    expect(antes.items.some((p) => p.name === nome), 'o pedido precisa estar na fila').toBe(true);

    await expect(page.getByText('Há pedidos de eliminação esperando você?')).toBeVisible();
    const cartao = page.locator('li').filter({ hasText: nome }).first();
    await expect(cartao).toBeVisible();

    await cartao.getByRole('button', { name: /Aprovar eliminação/i }).click();
    const confirmar = page.getByRole('dialog');
    await expect(confirmar).toContainText(nome);
    await expect(confirmar).toContainText(/não há como desfazer/i);

    await clicarEsperando(
      page,
      confirmar.getByRole('button', { name: /Anonimizar definitivamente/i }),
      '/approve',
      { metodo: 'POST' },
    );

    // Efeito na tela...
    await expect(page.getByRole('status').first()).toContainText(nome);
    await expect(page.locator('li').filter({ hasText: nome })).toHaveCount(0);

    // ...e no dado: o pedido saiu da fila de verdade.
    const depois = await apiGet<PaginadoLeve<PedidoEliminacao>>(
      page,
      '/privacy/deletion-requests?perPage=100',
    );
    expect(depois.items.some((p) => p.name === nome), 'a aprovação precisa esvaziar o pedido').toBe(
      false,
    );
  });

  test('a trilha filtra por ação, pagina, e o veredito de integridade bate com a API', async ({
    page,
  }) => {
    await page.goto('/app/privacidade-auditoria');
    await page.getByRole('tab', { name: /Trilha de auditoria/i }).click();

    const daApi = await apiGet<Trilha>(page, '/privacy/audit-trail?perPage=25');
    expect(daApi.meta.total, 'a trilha não pode estar vazia numa frota em uso').toBeGreaterThan(0);

    /*
     * O veredito na tela precisa ser o MESMO que a API acabou de calcular.
     *
     * Este teste não exige `ok === true`: a suíte não pode mascarar o estado
     * real da cadeia. Se a cadeia estiver rompida, a tela tem de dizer isso —
     * e é essa fidelidade que se mede aqui. O rompimento em si está relatado
     * como defeito de produto em `INVENTARIO.md`.
     */
    const esperado = daApi.chainIntegrity.ok ? 'Sim, cadeia íntegra' : 'Não — a cadeia foi rompida';
    await expect(page.getByText(esperado)).toBeVisible();

    // --- filtro por ação ---
    const espera = page.waitForResponse(
      (r) => r.url().includes('/audit-trail') && r.url().includes('action=AUTH_LOGIN_SUCCESS'),
    );
    await page.getByLabel(/^Filtrar por ação/).selectOption('AUTH_LOGIN_SUCCESS');
    const filtrada = await espera;
    expect(filtrada.status()).toBeLessThan(400);

    const linhas = page.locator('ol > li');
    const total = await linhas.count();
    expect(total, 'o filtro de entrada na conta precisa devolver registros').toBeGreaterThan(0);
    for (let i = 0; i < total; i++) {
      await expect(linhas.nth(i)).toContainText('AUTH_LOGIN_SUCCESS');
    }

    // --- paginação ---
    // Asercao, e nao `test.skip` condicional: a trilha de entradas na conta
    // desta frota passa de uma pagina com folga no seed e cresce a cada rodada
    // da suite. Se um dia ela couber numa pagina so, isso e sinal de que a
    // trilha foi truncada — e truncamento silencioso de auditoria e exatamente
    // o que nao pode passar despercebido.
    const proxima = page.getByRole('button', { name: 'Próxima' });
    await expect(proxima, 'a trilha filtrada precisa passar de uma página').toBeEnabled();
    await clicarEsperando(page, proxima, '/audit-trail', { metodo: 'GET' });
    await expect(page.getByText(/Página 2 de/)).toBeVisible();
  });
});

test.describe('Configurações', () => {
  test('o plano e as integrações mostram o que o ambiente realmente tem', async ({ page }) => {
    await page.goto('/app/configuracoes');
    await expect(page.getByRole('heading', { name: 'Configurações', level: 1 })).toBeVisible();

    await expect(page.getByTestId('empresa-configuracoes')).toHaveText('TransVan Escolar');
    await expect(page.getByText(/plano PRO · situação Ativa/)).toBeVisible();
    await expect(page.getByText(/Veículos/).first()).toBeVisible();

    // Integração desligada é declarada como desligada — não some da tela.
    await expect(page.getByText(/Cobrança: não configurada/)).toBeVisible();
    await expect(page.getByText(/WhatsApp: não configurada/)).toBeVisible();
  });

  test('o 2FA inicia o cadastro de verdade e a desativação exige senha e código', async ({
    page,
  }) => {
    await page.goto('/app/configuracoes');

    // --- iniciar (sem ATIVAR: ativar aqui derrubaria o login dos demais specs) ---
    await clicarEsperando(
      page,
      page.getByRole('button', { name: /Ativar verificação em duas etapas/i }),
      '/2fa/setup',
      { metodo: 'POST' },
    );
    await expect(page.getByRole('img', { name: /QR Code/i })).toBeVisible();
    await expect(page.getByText(/Código manual:/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar' }).first().click();
    await expect(page.getByRole('img', { name: /QR Code/i })).toHaveCount(0);

    // --- desativar: o servidor precisa recusar, e a tela precisa dizer por quê ---
    await page.getByRole('button', { name: 'Desativar' }).click();
    await page.getByLabel(/^Sua senha/).fill('senha-errada-de-proposito');
    await page.getByLabel(/^Código do aplicativo ou de recuperação/).fill('000000');

    const { status } = await clicarEsperando(
      page,
      page.getByRole('button', { name: /Confirmar desativação/i }),
      '/2fa/disable',
      { metodo: 'POST', statusMaximo: 999 },
    );
    expect(status, 'desativar 2FA com credencial errada não pode passar').toBeGreaterThanOrEqual(400);
    await expect(page.getByRole('alert').first()).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar' }).first().click();
  });

  test('registrar passkey vai até o fim contra um autenticador virtual', async ({ page }) => {
    await page.goto('/app/configuracoes');

    /*
     * Autenticador virtual do próprio Chromium.
     *
     * Sem ele o navegador de teste não tem biometria nem chave, `navigator
     * .credentials.create` fica pendurado esperando um gesto humano que nunca
     * vem, e o teste mediria o tempo limite em vez de medir o botão. Com ele o
     * fluxo roda inteiro: desafio, assinatura e verificação no servidor.
     */
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    const desafio = page.waitForResponse((r) =>
      r.url().includes('/webauthn/register/options'),
    );
    const verificacao = page.waitForResponse(
      (r) => r.url().includes('/webauthn/register/verify'),
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: /Registrar passkey neste dispositivo/i }).click();

    expect((await desafio).status(), 'o desafio precisa ser emitido').toBeLessThan(400);
    const confirmacao = await verificacao;
    expect(
      confirmacao.status(),
      `a verificação da passkey precisa ser aceita: ${(await confirmacao.text()).slice(0, 200)}`,
    ).toBeLessThan(400);

    // Só agora a tela pode dizer que registrou.
    await expect(page.getByText('Passkey registrada neste dispositivo.')).toBeVisible();
    await cdp.send('WebAuthn.disable');
  });

  /**
   * DEFEITO DE PRODUTO — este teste falha de propósito.
   *
   * Errar a SENHA ATUAL em "Trocar senha" desloga a pessoa do sistema.
   *
   * `POST /auth/change-password` responde 401 `invalidCredentials` quando a
   * senha atual não confere. O cliente (`web/src/lib/api.ts`) trata todo 401
   * como "a sessão morreu": limpa o CSRF, emite `notify('unauthenticated')`, o
   * `AuthProvider` marca a sessão como anônima e o `RequireRole` manda para
   * `/entrar`. Resultado: quem digitou a senha antiga errado é expulso da
   * conta, sem nunca ler o motivo — e o mesmo vale para a desativação do 2FA
   * com senha errada.
   *
   * O 401 aqui não significa "sua sessão acabou", significa "esta senha está
   * errada". Correção sugerida: distinguir os dois casos (por exemplo, tratar
   * como fim de sessão apenas o código `UNAUTHENTICATED` vindo de rotas de
   * sessão, e não de qualquer 401), ou marcar essas chamadas como "erro do
   * formulário, não da sessão".
   */
  test('trocar senha barra a senha fraca no cliente e a senha atual errada no servidor', async ({
    page,
  }) => {
    await page.goto('/app/configuracoes');

    // --- fraca: nem sai do navegador ---
    let chamou = false;
    page.on('request', (r) => {
      if (r.url().includes('/auth/change-password')) chamou = true;
    });
    await page.getByLabel(/^Senha atual/).fill('qualquer');
    await page.getByLabel(/^Nova senha/).fill('123');
    await page.getByRole('button', { name: 'Trocar senha' }).click();
    await expect(page.getByText(/Pelo menos 12 caracteres/).first()).toBeVisible();
    expect(chamou, 'senha fraca não deve chegar ao servidor').toBe(false);

    // --- forte, mas com a senha atual errada: o servidor recusa ---
    await page.getByLabel(/^Nova senha/).fill('OutraChaveBoa#2026');
    const { status } = await clicarEsperando(
      page,
      page.getByRole('button', { name: 'Trocar senha' }),
      '/auth/change-password',
      { metodo: 'POST', statusMaximo: 999 },
    );
    expect(status, 'senha atual errada não pode trocar a senha').toBeGreaterThanOrEqual(400);

    // A recusa é do FORMULÁRIO, não da sessão: a pessoa continua onde estava e
    // lê o motivo. Hoje ela é deslogada e cai no login sem explicação nenhuma.
    await expect(
      page,
      'errar a senha atual não pode expulsar a pessoa da conta',
    ).toHaveURL(/\/app\/configuracoes/);
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  /*
   * A segunda sessao e CRIADA aqui, e nao esperada.
   *
   * A versao anterior deste teste olhava a lista, nao encontrava nenhum outro
   * dispositivo e se declarava NAO VERIFICADO — o que significava que encerrar
   * sessao alheia, uma das duas ou tres acoes de seguranca que uma pessoa
   * comum de fato executa, nunca tinha sido clicada. Abrir um segundo contexto
   * autenticado custa dois segundos e transforma o cenario em algo que sempre
   * roda.
   */
  test('encerrar um dispositivo conectado remove a sessão da lista', async ({ page, browser }) => {
    const outroDispositivo = await contextoComo(browser, 'OWNER');

    try {
      await page.goto('/app/configuracoes');
      await expect(page.getByRole('heading', { name: /Dispositivos conectados/i })).toBeVisible();

      const antes = await apiGet<{ items: Array<{ id: string }> }>(page, '/auth/sessions');
      expect(
        antes.items.length,
        'o segundo contexto autenticado precisa aparecer como dispositivo conectado',
      ).toBeGreaterThan(1);

      // Nunca a atual: "Este dispositivo" nem oferece o botao.
      const encerrar = page.getByRole('button', { name: 'Encerrar' });
      await expect(encerrar.first()).toBeVisible();

      await encerrar.first().click();
      const confirmar = page.getByRole('dialog');
      await expect(confirmar).toContainText(/família inteira de tokens/i);
      await clicarEsperando(
        page,
        confirmar.getByRole('button', { name: 'Encerrar', exact: true }),
        '/auth/sessions/',
        { metodo: 'DELETE' },
      );

      await expect
        .poll(async () => (await apiGet<{ items: Array<{ id: string }> }>(page, '/auth/sessions')).items.length)
        .toBeLessThan(antes.items.length);

      // A sessao atual sobreviveu: a tela continua de pe.
      await expect(page.getByRole('heading', { name: 'Configurações', level: 1 })).toBeVisible();
    } finally {
      await outroDispositivo.close();
    }
  });
});
