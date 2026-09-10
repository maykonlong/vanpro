import { expect } from '@playwright/test';

import {
  apiDelete,
  apiGet,
  contextoComo,
  testeComo,
  clicarEsperando,
  sufixo,
  type PaginadoLeve,
} from './helpers';

/**
 * Gestora com `canManageFinance` e SEM `canManageRoutes`/`canManageHR`.
 *
 * O ponto deste arquivo é a diferença entre "não pode alterar" e "não pode
 * ver". A lista de alunos continua na tela — esconder faria a gestora concluir
 * que a empresa não tem aluno cadastrado —, o que some são os botões de
 * escrita, e o motivo tem de estar escrito.
 *
 * Ausência de botão sozinha não prova nada: o teste também bate na API na
 * marra e exige o 403 do servidor. A negação que vale é a de lá.
 */

const test = testeComo('MANAGER');

interface Aluno {
  id: string;
  name: string;
}

test('o menu mostra só o que o vínculo dela abre', async ({ page }) => {
  await page.goto('/app/painel');
  const menu = page.getByRole('navigation', { name: 'Navegação principal' }).first();

  for (const item of ['Painel', 'Financeiro', 'Alunos', 'Frota', 'Equipe', 'Fretamentos', 'Relacionamento']) {
    await expect(menu.getByRole('link', { name: item, exact: true })).toBeVisible();
  }
  // Privacidade e auditoria é do controlador dos dados: nem entra no menu dela.
  await expect(menu.getByRole('link', { name: 'Privacidade e auditoria' })).toHaveCount(0);
});

test('alunos: a lista aparece inteira, os botões de escrita não, e o motivo está escrito', async ({
  page,
}) => {
  await page.goto('/app/alunos');
  await expect(page.getByRole('heading', { name: 'Alunos', level: 1 })).toBeVisible();

  // 1. A explicação, com a permissão que falta nomeada e quem libera.
  const aviso = page.getByRole('heading', { name: /O cadastro de alunos: você está só de leitura/i });
  await expect(aviso).toBeVisible();
  await expect(page.getByText(/Rotas e cadastros/)).toBeVisible();
  await expect(page.getByText(/proprietário da conta/).first()).toBeVisible();

  // 2. A lista continua REAL e completa — este é o ponto do aviso.
  const daApi = await apiGet<PaginadoLeve<Aluno>>(page, '/students?perPage=20');
  expect(daApi.meta.total, 'a frota do seed tem alunos').toBeGreaterThan(0);
  await expect(page.locator('li').filter({ hasText: daApi.items[0].name }).first()).toBeVisible();

  // 3. Nenhum botão de escrita.
  await expect(page.getByRole('button', { name: 'Novo aluno' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Editar/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Excluir/ })).toHaveCount(0);

  // 4. A porta dos fundos também está trancada: sem botão E sem rota.
  const tentativa = await page.evaluate(async () => {
    const csrf = document.cookie
      .split('; ')
      .find((c) => c.startsWith('csrf_token='))
      ?.slice('csrf_token='.length);
    const r = await fetch('/api/v1/students', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': decodeURIComponent(csrf ?? '') },
      body: JSON.stringify({ name: 'x', school: 'y', grade: '1', shift: 'MORNING', monthlyFee: 1 }),
    });
    return { status: r.status, corpo: await r.text() };
  });
  expect(tentativa.status, 'o servidor precisa recusar a criação, não só a tela').toBe(403);
  expect(tentativa.corpo).toContain('FORBIDDEN');

  // 5. Ler continua liberado: o filtro funciona normalmente.
  const busca = page.waitForResponse(
    (r) => r.url().includes('/students') && r.url().includes('shift=FULL'),
  );
  await page.getByLabel(/^Turno/).selectOption('FULL');
  expect((await busca).status()).toBeLessThan(400);
});

test('financeiro funciona por inteiro para quem tem a permissão', async ({ page, browser }) => {
  const descricao = `E2E gestora ${sufixo()}`;

  await page.goto('/app/financeiro');
  await expect(page.getByRole('heading', { name: 'Financeiro', level: 1 })).toBeVisible();
  // Nada de aviso de permissão aqui: ela TEM a flag do financeiro.
  await expect(page.getByRole('heading', { name: /fora das suas permissões/i })).toHaveCount(0);

  await expect(page.getByTestId('dre-receita')).toBeVisible();
  await expect(page.getByTestId('dre-lucro')).toBeVisible();

  await page.getByRole('tab', { name: 'Despesas' }).click();
  await page.getByRole('button', { name: /Lançar despesa/i }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/^Descrição/).fill(descricao);
  await form.getByLabel(/^Valor \(R\$\)/).fill('10,00');
  await clicarEsperando(page, form.getByRole('button', { name: 'Lançar despesa' }), '/financial/expenses', {
    metodo: 'POST',
  });
  await expect(page.locator('li').filter({ hasText: descricao }).first()).toBeVisible();

  /*
   * Limpeza pela sessão do PROPRIETÁRIO.
   *
   * A gestora não consegue apagar o que acabou de lançar — `DELETE
   * /financial/expenses/:id` é exclusivo do OWNER no servidor. Isso é um
   * defeito de produto (a tela oferece a ela um botão que sempre responde 403)
   * e está registrado como tal no teste seguinte e em `INVENTARIO.md`. Aqui o
   * teste apenas não deixa lixo no banco por causa dele.
   */
  const dono = await contextoComo(browser, 'OWNER');
  const paginaDono = await dono.newPage();
  await paginaDono.goto('/app/financeiro');
  const despesas = await apiGet<PaginadoLeve<{ id: string; description: string }>>(
    paginaDono,
    '/financial/expenses?perPage=100',
  );
  const alvo = despesas.items.find((d) => d.description === descricao);
  if (alvo) {
    expect(await apiDelete(paginaDono, `/financial/expenses/${alvo.id}`)).toBeLessThan(400);
  }
  await dono.close();
});

/**
 * DEFEITO DE PRODUTO — este teste falha de propósito.
 *
 * `web/src/pages/owner/Financial.tsx` mostra o botão "Excluir" de despesa para
 * qualquer pessoa que chegue à aba (basta `canManageFinance`), mas a API exige
 * `requireRole('OWNER')` em `DELETE /financial/expenses/:id`. A gestora clica,
 * confirma a exclusão e leva 403 — um botão morto atrás de um diálogo de
 * confirmação, que é o pior lugar possível para um.
 *
 * As telas irmãs já fazem o certo: Alunos, Frota e Fretamentos escondem o
 * botão de excluir com `hasRole('OWNER')`. A correção é a mesma linha, no
 * componente `Despesas`. O teste NÃO foi ajustado para passar por cima disso.
 */
test('a gestora não deveria receber um botão de excluir despesa que sempre dá 403', async ({
  page,
}) => {
  await page.goto('/app/financeiro');
  const lista = page.waitForResponse((r) => r.url().includes('/financial/expenses'));
  await page.getByRole('tab', { name: 'Despesas' }).click();
  const resposta = await lista;
  expect(resposta.status()).toBeLessThan(400);

  const despesas = (await resposta.json()) as { items: Array<{ description: string }> };
  expect(
    despesas.items.length,
    'o seed lança despesas no período; sem nenhuma, este teste não inspecionaria botão algum',
  ).toBeGreaterThan(0);
  // Espera a lista estar REALMENTE pintada antes de contar botão nenhum:
  // contar cedo demais acharia zero e aprovaria o defeito por acidente.
  await expect(page.locator('li').filter({ hasText: despesas.items[0].description }).first()).toBeVisible();

  await expect(
    page.getByRole('button', { name: /^Excluir/ }),
    'quem não pode excluir não pode receber o botão de excluir',
  ).toHaveCount(0);
});

test('frota: as duas abas continuam legíveis e cada uma explica a permissão que falta', async ({
  page,
}) => {
  await page.goto('/app/frota');

  await page.getByRole('tab', { name: 'Veículos' }).click();
  await expect(
    page.getByRole('heading', { name: /O cadastro de veículos: você está só de leitura/i }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cadastrar veículo' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Editar/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Remover/ })).toHaveCount(0);

  // A lista continua ali — é o contrário de esconder a tela.
  const veiculos = await apiGet<PaginadoLeve<{ plate: string }>>(page, '/vehicles?perPage=20');
  expect(veiculos.meta.total).toBeGreaterThan(0);
  await expect(page.locator('li').filter({ hasText: veiculos.items[0].plate }).first()).toBeVisible();

  // Odômetro segue oferecido de propósito: a API abre essa rota à gestão inteira.
  const km = veiculos.items[0];
  await page
    .locator('li')
    .filter({ hasText: km.plate })
    .first()
    .getByRole('button', { name: /^Odômetro/ })
    .click();
  const odometro = page.getByRole('dialog');
  const atual = Number(await odometro.getByLabel(/^Quilometragem/).inputValue());
  await odometro.getByLabel(/^Quilometragem/).fill(String(atual + 3));
  await clicarEsperando(page, odometro.getByRole('button', { name: 'Registrar' }), '/km', {
    metodo: 'PATCH',
  });
  await expect(page.locator('li').filter({ hasText: km.plate }).first()).toContainText(
    (atual + 3).toLocaleString('pt-BR'),
  );

  await page.getByRole('tab', { name: 'Motoristas' }).click();
  await expect(
    page.getByRole('heading', { name: /O cadastro de motoristas: você está só de leitura/i }),
  ).toBeVisible();
  await expect(page.getByText(/Pessoas e RH/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cadastrar motorista' })).toHaveCount(0);
});

test('equipe e fretamentos: consulta liberada, escrita explicada', async ({ page }) => {
  await page.goto('/app/equipe');
  await expect(page.getByRole('heading', { name: /Equipe: você está só de leitura/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Convidar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Permissões' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Arquivar' })).toHaveCount(0);
  // Ela continua vendo quem é quem na frota.
  await expect(page.locator('li').filter({ hasText: 'roberto@transvan.com.br' }).first()).toBeVisible();

  await page.goto('/app/fretamentos');
  await expect(
    page.getByRole('heading', { name: /A gestão de fretamentos: você está só de leitura/i }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo fretamento' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Atribuir/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Iniciar' })).toHaveCount(0);

  // Mas a agenda está lá, e o filtro dela funciona.
  const espera = page.waitForResponse(
    (r) => r.url().includes('/charters') && r.url().includes('status=PENDING'),
  );
  await page.getByLabel(/^Situação/).selectOption('PENDING');
  expect((await espera).status()).toBeLessThan(400);
});

test('a área de privacidade e auditoria devolve um 403 com saída, não tela branca', async ({
  page,
}) => {
  await page.goto('/app/privacidade-auditoria');

  await expect(page.getByRole('heading', { name: /Esta área não é do seu perfil/i })).toBeVisible();
  // Responde as três perguntas: por quê, quem libera, e para onde ir.
  await expect(page.getByText(/entra como Gestor/)).toBeVisible();
  await expect(page.getByText(/proprietário da conta/)).toBeVisible();

  await page.getByRole('button', { name: /Ir para a minha tela inicial/i }).click();
  await expect(page).toHaveURL(/\/app\/painel/);

  // E o servidor também recusa, para quem tentar pela porta dos fundos.
  const bruto = await page.evaluate(async () => {
    const r = await fetch('/api/v1/privacy/audit-trail?perPage=1', { credentials: 'include' });
    return r.status;
  });
  expect(bruto, 'a trilha não pode ser lida por quem não é o controlador').toBe(403);
});
