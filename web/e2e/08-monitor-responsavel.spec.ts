import { expect } from '@playwright/test';

import {
  alvosDeToqueGrandes,
  barraInferior,
  apiDelete,
  apiGet,
  apiPost,
  contextoComo,
  testeComo,
  clicarEsperando,
  semRolagemHorizontal,
  sufixo,
  type PaginadoLeve,
} from './helpers';

/**
 * Monitor e responsável — as duas pessoas que usam o produto no celular.
 *
 * O embarque roda em 375 px porque é assim que ele existe de verdade: em pé,
 * com a van parando, uma mão só. Testar essa tela em 1280 px mediria uma
 * situação que nunca acontece.
 */

interface Aluno {
  id: string;
  name: string;
  status: string;
}

interface Consentimento {
  id: string;
  name: string;
  lgpdConsent: boolean;
  imageConsent: boolean;
  deleteRequestStatus: string;
}

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------

const test = testeComo('ASSISTANT');
const testeResponsavel = testeComo('PARENT');

test.describe('Monitor (375 px)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('a lista de embarque abre no celular, responde a pergunta e cabe na tela', async ({
    page,
  }) => {
    await page.goto('/app/embarque');
    await expect(page.getByRole('heading', { name: 'Embarque', level: 1 })).toBeVisible();

    // A resposta antes da tabela.
    await expect(page.getByText(/Faltam \d+ de \d+|Rota concluída/)).toBeVisible();
    await semRolagemHorizontal(page);

    // No celular a navegação é a barra de baixo, e não um menu escondido.
    const barra = barraInferior(page);
    await expect(barra).toBeVisible();
    await expect(barra.getByRole('link', { name: /Embarque/ })).toBeVisible();

    // Os alvos que ele toca com a van parando.
    await alvosDeToqueGrandes(page.locator('main').getByRole('button'));
  });

  test('o monitor marca embarque e entrega, e o dado muda no servidor', async ({ page }) => {
    await page.goto('/app/embarque');

    const lista = await apiGet<PaginadoLeve<Aluno>>(page, '/students?perPage=100');
    const alvo = lista.items.find((a) => a.status === 'PENDING') ?? lista.items[0];
    expect(alvo, 'a frota do seed precisa ter alunos').toBeTruthy();

    if (alvo.status !== 'PENDING') {
      await clicarEsperando(
        page,
        page.locator('li').filter({ hasText: alvo.name }).first().getByRole('button', { name: /^Desfazer/ }),
        '/checkin',
        { metodo: 'PATCH' },
      );
    }

    const cartao = () => page.locator('li').filter({ hasText: alvo.name }).first();
    await expect(cartao()).toBeVisible();

    await clicarEsperando(page, cartao().getByRole('button', { name: /^Embarcou/ }), '/checkin', {
      metodo: 'PATCH',
    });
    await expect(cartao().getByText('Embarcado', { exact: true })).toBeVisible();

    let depois = await apiGet<PaginadoLeve<Aluno>>(page, '/students?perPage=100');
    expect(depois.items.find((a) => a.id === alvo.id)?.status).toBe('BOARDED');

    // Faltou é o outro caminho: desfaz e marca ausência.
    await clicarEsperando(page, cartao().getByRole('button', { name: /^Desfazer/ }), '/checkin', {
      metodo: 'PATCH',
    });
    await clicarEsperando(page, cartao().getByRole('button', { name: /^Faltou/ }), '/checkin', {
      metodo: 'PATCH',
    });
    await expect(cartao().getByText('Ausente', { exact: true })).toBeVisible();
    depois = await apiGet<PaginadoLeve<Aluno>>(page, '/students?perPage=100');
    expect(depois.items.find((a) => a.id === alvo.id)?.status).toBe('ABSENT');

    // Devolve como estava.
    await clicarEsperando(page, cartao().getByRole('button', { name: /^Desfazer/ }), '/checkin', {
      metodo: 'PATCH',
    });
    depois = await apiGet<PaginadoLeve<Aluno>>(page, '/students?perPage=100');
    expect(depois.items.find((a) => a.id === alvo.id)?.status).toBe('PENDING');
  });

  test('o filtro por situação mostra estado vazio com saída, e não um vão em branco', async ({
    page,
  }) => {
    await page.goto('/app/embarque');
    await expect(page.getByText(/Faltam \d+ de \d+|Rota concluída/)).toBeVisible();

    const situacao = page.getByRole('radiogroup', { name: 'Filtrar por situação' });
    await situacao.getByRole('radio', { name: /^Na van/ }).click();

    const vazio = page.getByRole('heading', { name: 'Nada nesta situação' });
    if (await vazio.isVisible()) {
      // Vazio com saída: o botão do estado vazio precisa devolver a lista.
      await page.getByRole('button', { name: 'Ver todos' }).click();
      await expect(situacao.getByRole('radio', { name: /^Todos/ })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    }
  });

  test('o monitor não alcança área de gestão e recebe explicação com saída', async ({ page }) => {
    await page.goto('/app/painel');
    await expect(page.getByRole('heading', { name: /Esta área não é do seu perfil/i })).toBeVisible();
    await expect(page.getByText(/entra como Monitor/)).toBeVisible();
    await page.getByRole('button', { name: /Ir para a minha tela inicial/i }).click();
    await expect(page).toHaveURL(/\/app\/embarque/);
  });
});

// ---------------------------------------------------------------------------
// Responsável
// ---------------------------------------------------------------------------

testeResponsavel.describe('Responsável', () => {

  testeResponsavel('o acompanhamento responde "cadê meu filho" em uma frase e atualiza sob demanda', async ({
    page,
  }) => {
    await page.goto('/app/acompanhamento');
    await expect(page.getByRole('heading', { name: 'Acompanhar', level: 1 })).toBeVisible();

    const filhos = await apiGet<PaginadoLeve<Aluno>>(page, '/students?perPage=20');
    expect(filhos.meta.total, 'a conta do seed precisa ter filhos vinculados').toBeGreaterThan(0);

    // A frase é em português comum, com o PRIMEIRO nome — nunca "status: BOARDED".
    const primeiro = filhos.items[0].name.split(' ')[0];
    await expect(
      page.getByRole('heading', {
        name: new RegExp(
          `${primeiro} (ainda não embarcou|está na van|já foi entregue|foi marcado como ausente)`,
        ),
      }),
    ).toBeVisible();

    // O produto DIZ que não tem mapa, em vez de mostrar um mapa parado.
    await expect(page.getByRole('heading', { name: /Por que não há mapa aqui/i })).toBeVisible();

    // "Atualizar" precisa reconsultar o servidor.
    await clicarEsperando(page, page.getByRole('button', { name: 'Atualizar' }), '/students', {
      metodo: 'GET',
    });

    // Os dois atalhos do rodapé.
    await page.getByRole('link', { name: /Mensalidades e comprovantes/i }).click();
    await expect(page).toHaveURL(/\/app\/faturas/);

    await page.goto('/app/acompanhamento');
    await page.getByRole('link', { name: /Meus dados e os do meu filho/i }).click();
    await expect(page).toHaveURL(/\/app\/privacidade/);
  });

  testeResponsavel('as mensalidades respondem "eu devo alguma coisa" antes de listar', async ({ page }) => {
    await page.goto('/app/faturas');
    await expect(page.getByRole('heading', { name: 'Mensalidades', level: 1 })).toBeVisible();

    await expect(page.getByText('Você tem alguma mensalidade em aberto?')).toBeVisible();

    const dados = await apiGet<{
      manifesto: { totalPartes: number };
      alunos: Array<{ name: string; faturas: Array<{ id: string }> }>;
    }>(page, '/privacy/export?page=1&perPage=10');

    const comFatura = dados.alunos.filter((a) => a.faturas.length > 0);
    if (comFatura.length === 0) {
      await expect(page.getByText('Nenhuma mensalidade emitida')).toBeVisible();
      return;
    }
    await expect(page.getByRole('heading', { name: comFatura[0].name })).toBeVisible();

    const proxima = page.getByRole('button', { name: 'Próxima' });
    if ((await proxima.count()) > 0 && !(await proxima.isDisabled())) {
      await clicarEsperando(page, proxima, '/privacy/export', { metodo: 'GET' });
      await expect(page.getByText(/Página 2 de/)).toBeVisible();
    }
  });

  testeResponsavel('LGPD: exportar, revogar e reconceder consentimento — cada botão com efeito', async ({
    page,
  }) => {
    await page.goto('/app/privacidade');
    await expect(page.getByRole('heading', { name: 'Meus dados (LGPD)', level: 1 })).toBeVisible();

    // --- Art. 18, I e II: confirmação e acesso ---
    const eu = await apiGet<{ usuario: { email: string } }>(page, '/privacy/my-data');
    await expect(page.getByText(`E-mail: ${eu.usuario.email}`)).toBeVisible();

    // --- Art. 18, V: portabilidade. O arquivo tem de sair de verdade. ---
    const baixa = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
    await clicarEsperando(
      page,
      page.getByRole('button', { name: 'Exportar meus dados' }),
      '/privacy/export',
      { metodo: 'GET' },
    );
    await expect(page.getByRole('status').first()).toContainText(/Arquivo gerado/);
    const arquivo = await baixa;
    expect(arquivo, 'o botão de exportar precisa entregar um arquivo').toBeTruthy();
    expect(arquivo!.suggestedFilename()).toMatch(/^vanpro-meus-dados-\d{4}-\d{2}-\d{2}\.json$/);

    // --- Art. 18, IV e IX: consentimento vai e volta ---
    const antes = await apiGet<PaginadoLeve<Consentimento>>(page, '/privacy/consents?perPage=50');
    const aluno = antes.items[0];
    expect(aluno, 'o responsável precisa ter aluno vinculado').toBeTruthy();

    const bloco = page.locator('li').filter({ hasText: aluno.name }).first();
    const rotuloInicial = aluno.imageConsent ? 'Revogar uso de imagem' : 'Autorizar uso de imagem';
    const rotuloOposto = aluno.imageConsent ? 'Autorizar uso de imagem' : 'Revogar uso de imagem';

    await clicarEsperando(page, bloco.getByRole('button', { name: rotuloInicial }), '/privacy/consents', {
      metodo: 'POST',
    });
    await expect(
      page.locator('li').filter({ hasText: aluno.name }).first().getByRole('button', { name: rotuloOposto }),
    ).toBeVisible();

    const meio = await apiGet<PaginadoLeve<Consentimento>>(page, '/privacy/consents?perPage=50');
    expect(
      meio.items.find((c) => c.id === aluno.id)?.imageConsent,
      'a revogação precisa valer no servidor, não só no botão',
    ).toBe(!aluno.imageConsent);

    // Devolve ao valor original: o seed é compartilhado.
    await clicarEsperando(
      page,
      page.locator('li').filter({ hasText: aluno.name }).first().getByRole('button', { name: rotuloOposto }),
      '/privacy/consents',
      { metodo: 'POST' },
    );
    const fim = await apiGet<PaginadoLeve<Consentimento>>(page, '/privacy/consents?perPage=50');
    expect(fim.items.find((c) => c.id === aluno.id)?.imageConsent).toBe(aluno.imageConsent);
  });

  testeResponsavel('LGPD: solicitar exclusão registra o pedido para a empresa avaliar', async ({
    page,
    browser,
  }) => {
    /*
     * O pedido recai sobre um aluno DESCARTÁVEL, criado para este teste e
     * vinculado a esta responsável. Pedir a eliminação de um aluno do seed
     * deixaria uma criança de demonstração marcada para sempre — a bandeira
     * `PENDING_APPROVAL` não tem volta pela API.
     */
    const id = sufixo();
    const nome = `E2E Filho ${id}`;

    await page.goto('/app/privacidade');
    const eu = await apiGet<{ usuario: { id: string } }>(page, '/privacy/my-data');

    const dono = await contextoComo(browser, 'OWNER');
    const paginaDono = await dono.newPage();
    await paginaDono.goto('/app/alunos');
    const criado = await apiPost<{ id: string }>(paginaDono, '/students', {
      name: nome,
      school: `E2E EscolaFilho ${id}`,
      grade: '3',
      shift: 'MORNING',
      monthlyFee: 10,
      parentId: eu.usuario.id,
    });

    await page.reload();
    const bloco = page.locator('li').filter({ hasText: nome }).first();
    await expect(bloco).toBeVisible();

    await bloco.getByRole('button', { name: 'Solicitar exclusão' }).click();
    const confirmar = page.getByRole('dialog');
    await expect(confirmar).toContainText(nome);
    await expect(confirmar).toContainText(/Art. 16/);

    await clicarEsperando(
      page,
      confirmar.getByRole('button', { name: 'Registrar pedido' }),
      '/privacy/forget-me',
      { metodo: 'POST', statusEsperado: 202 },
    );

    // Efeito na tela: o pedido fica visível como pendente de avaliação.
    await expect(page.getByRole('status').first()).toContainText(/Pedido registrado/);
    await expect(
      page.locator('li').filter({ hasText: nome }).first().getByText('Aguardando aprovação'),
    ).toBeVisible();

    // Efeito no dado.
    const consentimentos = await apiGet<PaginadoLeve<Consentimento>>(
      page,
      '/privacy/consents?perPage=50',
    );
    expect(consentimentos.items.find((c) => c.id === criado.id)?.deleteRequestStatus).toBe(
      'PENDING_APPROVAL',
    );

    // Limpeza: o aluno descartável sai da base pela mão de quem pode.
    expect(await apiDelete(paginaDono, `/students/${criado.id}`)).toBeLessThan(400);
    await dono.close();
  });

  testeResponsavel('o responsável não alcança o financeiro da empresa', async ({ page }) => {
    await page.goto('/app/financeiro');
    await expect(page.getByRole('heading', { name: /Esta área não é do seu perfil/i })).toBeVisible();
    await expect(page.getByText(/entra como Responsável/)).toBeVisible();

    // E o servidor recusa a rota da empresa mesmo digitada na mão.
    const bruto = await page.evaluate(async () => {
      const r = await fetch('/api/v1/financial/invoices?perPage=1', { credentials: 'include' });
      return r.status;
    });
    expect(bruto, 'o faturamento da empresa não pode vazar para o responsável').toBeGreaterThanOrEqual(
      403,
    );
  });
});
