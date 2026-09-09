import { expect, test } from '@playwright/test';
import { clicarEsperandoRequisicao, credencial, login, motivoSkip, rota, telaNaoFicaMuda } from './helpers';

const cred = credencial('OWNER');

test.describe('OWNER', () => {
  test.skip(!cred, motivoSkip('OWNER'));

  test.beforeEach(async ({ page }) => {
    await login(page, cred!);
  });

  test('painel carrega DRE, inadimplencia, frota e alertas da API', async ({ page }) => {
    const dre = page.waitForResponse((r) => r.url().includes('/api/v1/financial/dre'));
    await page.goto('/app/painel');
    expect((await dre).status()).toBe(200);
    await telaNaoFicaMuda(page);
    await expect(page.getByRole('heading', { name: /Painel/ })).toBeVisible();
  });

  test('criar, editar e excluir aluno — cada botao produz chamada e muda a UI', async ({ page }) => {
    await page.goto('/app/alunos');
    const nome = `Aluno E2E ${Date.now()}`;

    await page.getByRole('button', { name: 'Novo aluno' }).click();
    await page.getByLabel('Nome').fill(nome);
    await page.getByLabel('Escola').fill('Escola E2E');
    await page.getByLabel('Mensalidade (R$)').fill('350,00');

    const criado = page.waitForResponse(
      (r) => rota('/students')(r.request()) && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Cadastrar aluno' }).click();
    expect((await criado).status(), 'POST /students precisa ser aceito').toBe(201);
    await expect(page.getByText(nome)).toBeVisible();

    // Editar: o PATCH tem de sair e o novo valor tem de aparecer na lista.
    const linha = page.locator('li', { hasText: nome }).first();
    await linha.getByRole('button', { name: 'Editar' }).click();
    await page.getByLabel('Escola').fill('Escola Editada E2E');
    const editado = page.waitForResponse(
      (r) => rota('/students/')(r.request()) && r.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: /Salvar altera[cç][oõ]es/ }).click();
    expect((await editado).status()).toBe(200);
    await expect(page.getByText('Escola Editada E2E')).toBeVisible();

    // Excluir passa por confirmacao — acao destrutiva nunca em um clique so.
    await page.locator('li', { hasText: nome }).first().getByRole('button', { name: 'Excluir' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const excluido = page.waitForResponse(
      (r) => rota('/students/')(r.request()) && r.request().method() === 'DELETE',
    );
    await page.getByRole('button', { name: 'Excluir', exact: true }).last().click();
    expect((await excluido).status()).toBe(204);
    await expect(page.getByText(nome)).toHaveCount(0);
  });

  test('lancar despesa muda o DRE de verdade', async ({ page }) => {
    await page.goto('/app/financeiro');

    const antes = await page.getByTestId('dre-despesa').innerText();

    await page.getByRole('tab', { name: 'Despesas' }).click();
    await page.getByRole('button', { name: /Lan[cç]ar despesa/ }).first().click();
    await page.getByLabel(/Descri[cç][aã]o/).fill(`Combustivel E2E ${Date.now()}`);
    await page.getByLabel('Valor (R$)').fill('123,45');

    const criada = page.waitForResponse(
      (r) => rota('/financial/expenses')(r.request()) && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /Lan[cç]ar despesa/ }).last().click();
    expect((await criada).status()).toBe(201);

    await page.getByRole('tab', { name: 'Resultado' }).click();
    await expect
      .poll(async () => page.getByTestId('dre-despesa').innerText(), {
        message: 'a despesa lancada precisa aparecer no total do DRE',
      })
      .not.toBe(antes);
  });

  test('atribuir fretamento trata conflito de escala com mensagem do servidor', async ({ page }) => {
    await page.goto('/app/fretamentos');

    const inicio = new Date(Date.now() + 86_400_000);
    const fim = new Date(inicio.getTime() + 3 * 3_600_000);
    const local = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    const criar = async (titulo: string) => {
      await page.getByRole('button', { name: 'Novo fretamento' }).click();
      await page.getByLabel(/T[ií]tulo/).fill(titulo);
      await page.getByLabel('Contratante').fill('Contratante E2E');
      await page.getByLabel(/Pre[cç]o \(R\$\)/).fill('900,00');
      await page.getByLabel(/In[ií]cio/).fill(local(inicio));
      await page.getByLabel('Fim').fill(local(fim));
      const criado = page.waitForResponse(
        (r) => rota('/charters')(r.request()) && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Cadastrar' }).click();
      expect((await criado).status()).toBe(201);
    };

    const marca = Date.now();
    await criar(`Fretamento A ${marca}`);
    await criar(`Fretamento B ${marca}`);

    const atribuir = async (titulo: string) => {
      const item = page.locator('li', { hasText: titulo }).first();
      await item.getByRole('button', { name: 'Atribuir' }).click();
      await page.getByLabel(/Ve[ií]culo/).selectOption({ index: 1 });
      await page.getByLabel('Motorista').selectOption({ index: 1 });
      const resposta = page.waitForResponse((r) => r.url().includes('/assign'));
      await page.getByRole('button', { name: 'Atribuir', exact: true }).last().click();
      return (await resposta).status();
    };

    expect(await atribuir(`Fretamento A ${marca}`), 'primeira atribuicao deve passar').toBe(200);

    // Mesma van e mesmo motorista no mesmo intervalo: o servidor recusa com 409
    // e a tela mostra a explicacao, em vez de "salvo!" sem ter salvado.
    expect(await atribuir(`Fretamento B ${marca}`)).toBe(409);
    await expect(page.getByRole('alert')).toContainText(/j[aá] est[aá] escalado/i);
  });

  test('convidar membro e alterar a flag de permissao', async ({ page }) => {
    await page.goto('/app/equipe');

    const email = `convite.e2e.${Date.now()}@example.com`;
    await page.getByRole('button', { name: 'Convidar' }).click();
    await page.getByLabel('Nome').fill('Convidado E2E');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Papel').selectOption('MANAGER');

    const convite = page.waitForResponse(
      (r) => rota('/company/team/invite')(r.request()) && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Enviar convite' }).click();
    expect((await convite).status()).toBe(201);
    // O sistema nao finge envio: diz que nao ha provedor de e-mail.
    await expect(page.getByText(/n[aã]o foi enviado/i)).toBeVisible();

    const membro = page.locator('li', { hasText: email }).first();
    await membro.getByRole('button', { name: /Permiss[oõ]es/ }).click();
    await page.getByLabel('Financeiro').check();

    const salvo = page.waitForResponse((r) => r.url().includes('/permissions'));
    await page.getByRole('button', { name: /Salvar permiss[oõ]es/ }).click();
    expect((await salvo).status()).toBe(200);
    await expect(page.locator('li', { hasText: email }).first()).toContainText('Financeiro');
  });

  test('configuracoes: 2FA gera QR real e sessoes vem da API', async ({ page }) => {
    await page.goto('/app/configuracoes');

    await clicarEsperandoRequisicao(
      page,
      /Ativar verifica[cç][aã]o em duas etapas/,
      rota('/auth/2fa/setup'),
      { metodo: 'POST' },
    );
    await expect(page.getByAltText(/QR Code/)).toBeVisible();

    await expect(page.getByRole('heading', { name: /Dispositivos conectados/ })).toBeVisible();
    await expect(page.getByText('Este dispositivo')).toBeVisible();
  });

  test('menu do OWNER expoe todas as areas de gestao', async ({ page }) => {
    await page.goto('/app/painel');
    for (const item of ['Painel', 'Financeiro', 'Alunos', 'Frota', 'Equipe', 'Fretamentos', 'CRM e IA']) {
      await expect(page.getByRole('link', { name: item })).toBeVisible();
    }
  });
});
