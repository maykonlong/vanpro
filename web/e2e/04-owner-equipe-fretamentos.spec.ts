import { expect } from '@playwright/test';

import {
  apiGet,
  testeComo,
  clicarEsperando,
  escolherPrimeiraOpcao,
  sufixo,
  type PaginadoLeve,
} from './helpers';

/**
 * Proprietário: equipe e fretamentos.
 *
 * O fretamento é onde mora a regra mais cara do produto — conflito de escala.
 * Um teste que só cria e lista aprovaria uma agenda que escala a mesma van em
 * dois contratos ao mesmo tempo. Por isso aqui o conflito é PROVOCADO de
 * propósito e a recusa é conferida.
 */

const test = testeComo('OWNER');

interface Membro {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  permissions: { canManageFinance: boolean; canManageHR: boolean; canManageRoutes: boolean };
}

interface Fretamento {
  id: string;
  title: string;
  status: string;
  vehicleId: string | null;
  driverId: string | null;
}

/** Datas bem no futuro: não colidem com a agenda do seed. */
function janela(diasAFrente: number): { inicio: string; fim: string } {
  const base = new Date();
  base.setFullYear(base.getFullYear() + 1);
  base.setDate(base.getDate() + diasAFrente);
  base.setHours(8, 0, 0, 0);
  const fim = new Date(base.getTime() + 6 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { inicio: fmt(base), fim: fmt(fim) };
}

test.describe('Equipe', () => {
  test('convidar, alterar permissão e arquivar o vínculo', async ({ page }) => {
    const id = sufixo();
    const nome = `E2E Convidado ${id}`;
    const email = `e2e.convidado.${id.toLowerCase()}@exemplo.com.br`;

    await page.goto('/app/equipe');
    await expect(page.getByRole('heading', { name: 'Equipe', level: 1 })).toBeVisible();

    // --- convidar ---
    await page.getByRole('button', { name: 'Convidar' }).first().click();
    const form = page.getByRole('dialog');
    await form.getByLabel(/^Nome/).fill(nome);
    await form.getByLabel(/^E-mail/).fill(email);
    await form.getByLabel(/^Papel/).selectOption('MANAGER');
    await form.getByLabel(/^Contrato/).selectOption('FULL_TIME');
    await form.getByLabel(/^Rotas/).check();

    await clicarEsperando(page, form.getByRole('button', { name: 'Enviar convite' }), '/team/invite', {
      metodo: 'POST',
    });

    // O ambiente não tem provedor de e-mail: a tela precisa DIZER que o convite
    // não foi enviado, em vez de deixar a pessoa esperando por um e-mail que
    // nunca vai chegar.
    await expect(page.getByRole('status').first()).toContainText(email);
    await expect(page.getByText(/o convite NÃO foi enviado/i)).toBeVisible();

    const cartao = page.locator('li').filter({ hasText: email }).first();
    await expect(cartao).toBeVisible();
    await expect(cartao.getByText('Convidado', { exact: true })).toBeVisible();
    await expect(cartao.getByText('Rotas', { exact: true })).toBeVisible();

    const equipe = await apiGet<PaginadoLeve<Membro>>(page, '/company/team?perPage=100');
    const membro = equipe.items.find((m) => m.email === email);
    expect(membro, 'o convite precisa existir na API').toBeTruthy();
    expect(membro!.permissions.canManageRoutes).toBe(true);
    expect(membro!.permissions.canManageFinance).toBe(false);

    // --- alterar permissão ---
    await cartao.getByRole('button', { name: 'Permissões' }).click();
    const permissoes = page.getByRole('dialog');
    await expect(permissoes).toContainText(`Permissões de ${nome}`);
    await permissoes.getByLabel(/^Financeiro/).check();
    await permissoes.getByLabel(/^Rotas/).uncheck();
    await clicarEsperando(
      page,
      permissoes.getByRole('button', { name: 'Salvar permissões' }),
      '/permissions',
      { metodo: 'POST' },
    );

    const depois = page.locator('li').filter({ hasText: email }).first();
    await expect(depois.getByText('Financeiro', { exact: true })).toBeVisible();
    await expect(depois.getByText('Rotas', { exact: true })).toHaveCount(0);

    const equipe2 = await apiGet<PaginadoLeve<Membro>>(page, '/company/team?perPage=100');
    const membro2 = equipe2.items.find((m) => m.email === email)!;
    expect(membro2.permissions.canManageFinance, 'a permissão precisa valer na API').toBe(true);
    expect(membro2.permissions.canManageRoutes).toBe(false);

    // --- arquivar ---
    await depois.getByRole('button', { name: 'Arquivar' }).click();
    const confirmar = page.getByRole('dialog');
    await expect(confirmar).toContainText(nome);
    await clicarEsperando(
      page,
      confirmar.getByRole('button', { name: 'Arquivar', exact: true }),
      '/archive',
      { metodo: 'POST' },
    );

    const arquivado = page.locator('li').filter({ hasText: email }).first();
    await expect(arquivado.getByText('Arquivado', { exact: true })).toBeVisible();
    await expect(arquivado.getByRole('button', { name: 'Arquivar' })).toHaveCount(0);

    const equipe3 = await apiGet<PaginadoLeve<Membro>>(page, '/company/team?perPage=100');
    expect(equipe3.items.find((m) => m.email === email)!.status).toBe('ARCHIVED');
  });

  test('o proprietário não recebe botão para mexer no próprio vínculo', async ({ page }) => {
    await page.goto('/app/equipe');
    const eu = page.locator('li').filter({ hasText: 'roberto@transvan.com.br' }).first();
    await expect(eu).toBeVisible();
    // Arquivar a si mesmo é a porta trancada por dentro: nem o botão existe.
    await expect(eu.getByRole('button', { name: 'Arquivar' })).toHaveCount(0);
    await expect(eu.getByRole('button', { name: 'Permissões' })).toHaveCount(0);
  });
});

test.describe('Fretamentos', () => {
  test('criar, atribuir, recusar conflito de escala, mudar de estado e excluir', async ({ page }) => {
    const id = sufixo();
    const tituloA = `E2E Fretamento A ${id}`;
    const tituloB = `E2E Fretamento B ${id}`;
    const a = janela(10);
    // A janela de B começa DENTRO da de A: é exatamente a sobreposição que a
    // API precisa recusar.
    const b = janela(10);

    await page.goto('/app/fretamentos');
    await expect(page.getByRole('heading', { name: 'Fretamentos', level: 1 })).toBeVisible();

    const criar = async (titulo: string, quando: { inicio: string; fim: string }) => {
      await page.getByRole('button', { name: 'Novo fretamento' }).first().click();
      const form = page.getByRole('dialog');
      await form.getByLabel(/^Título/).fill(titulo);
      await form.getByLabel(/^Contratante/).fill(`Colégio E2E ${id}`);
      await form.getByLabel(/^Preço/).fill('1.500,00');
      await form.getByLabel(/^Início/).fill(quando.inicio);
      await form.getByLabel(/^Fim/).fill(quando.fim);
      await clicarEsperando(page, form.getByRole('button', { name: 'Cadastrar' }), '/charters', {
        metodo: 'POST',
      });
      await expect(page.locator('li').filter({ hasText: titulo }).first()).toBeVisible();
    };

    await criar(tituloA, a);
    await criar(tituloB, b);

    // --- atribuir A ---
    const cartaoA = page.locator('li').filter({ hasText: tituloA }).first();
    await expect(cartaoA.getByText('Sem escala')).toBeVisible();
    await cartaoA.getByRole('button', { name: /^Atribuir/ }).click();

    const atribuir = page.getByRole('dialog');
    const veiculo = await escolherPrimeiraOpcao(atribuir.getByLabel(/^Veículo/));
    const motorista = await escolherPrimeiraOpcao(atribuir.getByLabel(/^Motorista/));
    await clicarEsperando(page, atribuir.getByRole('button', { name: 'Atribuir', exact: true }), '/assign', {
      metodo: 'POST',
    });

    await expect(page.locator('li').filter({ hasText: tituloA }).first().getByText('Escalado')).toBeVisible();

    // --- conflito: o MESMO veículo e o MESMO motorista, em janela sobreposta ---
    const cartaoB = page.locator('li').filter({ hasText: tituloB }).first();
    await cartaoB.getByRole('button', { name: /^Atribuir/ }).click();
    const conflito = page.getByRole('dialog');
    await conflito.getByLabel(/^Veículo/).selectOption({ label: veiculo });
    await conflito.getByLabel(/^Motorista/).selectOption({ label: motorista });

    const { status } = await clicarEsperando(
      page,
      conflito.getByRole('button', { name: 'Atribuir', exact: true }),
      '/assign',
      { metodo: 'POST', statusMaximo: 999 },
    );
    expect(status, 'escalar o mesmo recurso em janela sobreposta precisa ser recusado').toBe(409);

    // A recusa precisa DIZER qual contrato ocupa o recurso — 409 seco não
    // resolve a vida de quem está montando a escala.
    const erro = conflito.getByRole('alert').first();
    await expect(erro).toBeVisible();
    await expect(erro).toContainText(tituloA);
    await expect(conflito.getByLabel(/^Veículo/)).toBeVisible();

    // Com outro recurso, a mesma tela aceita — prova que o formulário funciona
    // e que o 409 foi da REGRA, não do botão.
    const veiculos = await conflito.getByLabel(/^Veículo/).locator('option').count();
    if (veiculos > 2) {
      await conflito.getByLabel(/^Veículo/).selectOption({ index: 2 });
      const motoristas = await conflito.getByLabel(/^Motorista/).locator('option').count();
      if (motoristas > 2) await conflito.getByLabel(/^Motorista/).selectOption({ index: 2 });
      await clicarEsperando(
        page,
        conflito.getByRole('button', { name: 'Atribuir', exact: true }),
        '/assign',
        { metodo: 'POST' },
      );
      await expect(
        page.locator('li').filter({ hasText: tituloB }).first().getByText('Escalado'),
      ).toBeVisible();
    } else {
      await conflito.getByRole('button', { name: 'Cancelar' }).click();
    }

    // --- editar ---
    await page
      .locator('li')
      .filter({ hasText: tituloA })
      .first()
      .getByRole('button', { name: /^Editar/ })
      .click();
    const edicao = page.getByRole('dialog');
    await edicao.getByLabel(/^Preço/).fill('1.750,00');
    await clicarEsperando(page, edicao.getByRole('button', { name: 'Salvar' }), '/charters/', {
      metodo: 'PATCH',
    });
    await expect(page.locator('li').filter({ hasText: tituloA }).first()).toContainText('R$ 1.750,00');

    // --- máquina de estados: Agendado -> Em andamento -> Cancelado ---
    const cartaoAtual = () => page.locator('li').filter({ hasText: tituloA }).first();
    await expect(cartaoAtual().getByText('Agendado')).toBeVisible();

    await clicarEsperando(page, cartaoAtual().getByRole('button', { name: 'Iniciar' }), '/status', {
      metodo: 'POST',
    });
    await expect(cartaoAtual().getByText('Em andamento')).toBeVisible();
    // "Iniciar" não pode continuar oferecido para quem já iniciou.
    await expect(cartaoAtual().getByRole('button', { name: 'Iniciar' })).toHaveCount(0);

    await clicarEsperando(page, cartaoAtual().getByRole('button', { name: 'Cancelar' }), '/status', {
      metodo: 'POST',
    });
    await expect(cartaoAtual().getByText('Cancelado')).toBeVisible();
    // Contrato encerrado não aceita mais nada.
    await expect(cartaoAtual().getByRole('button', { name: /^Atribuir/ })).toBeDisabled();

    // --- excluir: o servidor só deixa apagar o que nunca rodou ---
    await page
      .locator('li')
      .filter({ hasText: tituloB })
      .first()
      .getByRole('button', { name: /^Excluir/ })
      .click();
    const confirmar = page.getByRole('dialog');
    await expect(confirmar).toContainText(tituloB);
    await clicarEsperando(
      page,
      confirmar.getByRole('button', { name: 'Excluir', exact: true }),
      '/charters/',
      { metodo: 'DELETE' },
    );
    await expect(page.locator('li').filter({ hasText: tituloB })).toHaveCount(0);

    const restantes = await apiGet<PaginadoLeve<Fretamento>>(page, '/charters?perPage=100');
    expect(restantes.items.find((c) => c.title === tituloB)).toBeFalsy();
    // O A fica como CANCELADO: a API recusa apagar contrato que já rodou, e o
    // teste NÃO contorna essa regra por conveniência de limpeza.
    expect(restantes.items.find((c) => c.title === tituloA)?.status).toBe('CANCELED');
  });

  test('o filtro de situação consulta o servidor e muda a lista', async ({ page }) => {
    await page.goto('/app/fretamentos');

    const espera = page.waitForResponse(
      (r) => r.url().includes('/charters') && r.url().includes('status=COMPLETED'),
    );
    await page.getByLabel(/^Situação/).selectOption('COMPLETED');
    expect((await espera).status()).toBeLessThan(400);

    const cartoes = page.locator('li').filter({ hasText: 'Concluído' });
    const total = await cartoes.count();
    if (total === 0) {
      await expect(page.getByText('Nenhum fretamento na agenda')).toBeVisible();
    } else {
      // Filtrou por concluído: nenhum outro estado pode aparecer.
      await expect(page.locator('li').filter({ hasText: 'Agendado' })).toHaveCount(0);
    }
  });
});
