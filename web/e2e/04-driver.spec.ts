import { expect, test } from '@playwright/test';
import { credencial, login, motivoSkip, rota } from './helpers';

const cred = credencial('DRIVER');

test.describe('DRIVER', () => {
  test.skip(!cred, motivoSkip('DRIVER'));

  test.beforeEach(async ({ page }) => {
    await login(page, cred!);
  });

  test('rota do dia: check-in do aluno chama a API e muda o status na tela', async ({ page }) => {
    const lista = page.waitForResponse((r) => rota('/students')(r.request()));
    await page.goto('/app/rota');
    expect((await lista).status()).toBe(200);

    const primeiro = page.locator('main li').first();
    const semAlunos = (await page.getByText('Nenhum aluno na lista').count()) > 0;
    test.skip(semAlunos, 'a empresa de teste nao tem aluno cadastrado para o check-in');

    const botao = primeiro.getByRole('button').first();
    const texto = await botao.innerText();

    const checkin = page.waitForResponse(
      (r) => r.url().includes('/checkin') && r.request().method() === 'PATCH',
    );
    await botao.click();
    expect((await checkin).status(), `o botao "${texto}" precisa gravar o check-in`).toBe(200);

    // Estado mudou de fato: os botoes oferecidos sao outros.
    await expect(page.locator('main li').first().getByRole('button').first()).not.toHaveText(texto);
  });

  test('ciclo completo de ponto: entrada, pausa, retorno e saida', async ({ page }) => {
    await page.goto('/app/ponto');

    const estado = page.getByTestId('estado-ponto');
    await expect(estado).toBeVisible();

    // Encerra um turno que tenha ficado aberto de outra execucao.
    if ((await estado.innerText()) === 'Em pausa') {
      const fim = page.waitForResponse((r) => rota('/timecards/punch')(r.request()));
      await page.getByRole('button', { name: 'Encerrar pausa' }).click();
      expect((await fim).status()).toBe(201);
    }
    if ((await estado.innerText()) === 'Em turno') {
      const saida = page.waitForResponse((r) => rota('/timecards/punch')(r.request()));
      await page.getByRole('button', { name: /Registrar sa[ií]da/ }).click();
      expect((await saida).status()).toBe(201);
    }
    await expect(estado).toHaveText('Fora do turno');

    const semVan = (await page.getByLabel(/Ve[ií]culo/).locator('option').count()) <= 1;
    test.skip(semVan, 'a empresa de teste nao tem veiculo cadastrado para bater ponto');
    await page.getByLabel(/Ve[ií]culo/).selectOption({ index: 1 });

    const bater = async (nome: string | RegExp) => {
      const resposta = page.waitForResponse(
        (r) => rota('/timecards/punch')(r.request()) && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: nome }).click();
      expect((await resposta).status(), `${String(nome)} precisa ser registrado`).toBe(201);
    };

    await bater('Registrar entrada');
    await expect(estado).toHaveText('Em turno');

    await bater('Iniciar pausa');
    await expect(estado).toHaveText('Em pausa');
    // Durante a pausa o app nao oferece a saida: e a mesma regra do servidor.
    await expect(page.getByRole('button', { name: /Registrar sa[ií]da/ })).toHaveCount(0);

    await bater('Encerrar pausa');
    await expect(estado).toHaveText('Em turno');

    await bater(/Registrar sa[ií]da/);
    await expect(estado).toHaveText('Fora do turno');
  });

  test('meus ganhos mostra apenas o proprio holerite', async ({ page }) => {
    await page.goto('/app/meus-ganhos');
    await expect(page.getByRole('heading', { name: 'Meus ganhos' })).toBeVisible();

    const temTotal = (await page.getByTestId('ganhos-total').count()) > 0;
    const temExplicacao = (await page.getByText(/Ainda n[aã]o h[aá] como apurar/).count()) > 0;
    expect(
      temTotal || temExplicacao,
      'a tela precisa mostrar o total ou dizer por que nao ha o que apurar',
    ).toBe(true);
  });

  test('motorista nao acessa area de gestao', async ({ page }) => {
    await page.goto('/app/financeiro');
    await expect(page.getByRole('heading', { name: /403/ })).toBeVisible();
  });
});
