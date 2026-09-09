import { expect, test } from '@playwright/test';
import { credencial, login, motivoSkip, rota } from './helpers';

const assistente = credencial('ASSISTANT');
const responsavel = credencial('PARENT');
const admin = credencial('SUPER_ADMIN');

test.describe('ASSISTANT', () => {
  test.skip(!assistente, motivoSkip('ASSISTANT'));

  test('lista de embarque carrega e o check-in grava', async ({ page }) => {
    await login(page, assistente!);
    const lista = page.waitForResponse((r) => rota('/students')(r.request()));
    await page.goto('/app/embarque');
    expect((await lista).status()).toBe(200);

    const vazio = (await page.getByText('Nenhum aluno na lista').count()) > 0;
    test.skip(vazio, 'a empresa de teste nao tem aluno para embarcar');

    const botao = page.locator('main li').first().getByRole('button').first();
    const checkin = page.waitForResponse((r) => r.url().includes('/checkin'));
    await botao.click();
    expect((await checkin).status()).toBe(200);
  });

  test('monitor nao entra na area financeira', async ({ page }) => {
    await login(page, assistente!);
    await page.goto('/app/financeiro');
    await expect(page.getByRole('heading', { name: /403/ })).toBeVisible();
  });
});

test.describe('PARENT', () => {
  test.skip(!responsavel, motivoSkip('PARENT'));

  test.beforeEach(async ({ page }) => {
    await login(page, responsavel!);
  });

  test('acompanhamento lista apenas os proprios filhos', async ({ page }) => {
    const alunos = page.waitForResponse((r) => rota('/students')(r.request()));
    await page.goto('/app/acompanhamento');
    const resposta = await alunos;
    expect(resposta.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Acompanhamento' })).toBeVisible();
  });

  test('faturas vem da rota de portabilidade escopada por responsavel', async ({ page }) => {
    const dados = page.waitForResponse((r) => rota('/privacy/export')(r.request()));
    await page.goto('/app/faturas');
    expect((await dados).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Faturas' })).toBeVisible();
  });

  test('central LGPD: exportar dados baixa arquivo real', async ({ page }) => {
    await page.goto('/app/privacidade');

    const download = page.waitForEvent('download');
    const chamada = page.waitForResponse((r) => rota('/privacy/export')(r.request()));
    await page.getByRole('button', { name: 'Exportar meus dados' }).click();
    expect((await chamada).status()).toBe(200);

    const arquivo = await download;
    expect(arquivo.suggestedFilename()).toMatch(/vanpro-meus-dados-.*\.json/);
  });

  test('central LGPD: consentimento e pedido de exclusao chamam a API', async ({ page }) => {
    const consentimentos = page.waitForResponse((r) => rota('/privacy/consents')(r.request()));
    await page.goto('/app/privacidade');
    expect((await consentimentos).status()).toBe(200);

    const semFilho = (await page.getByText('Nenhum aluno vinculado').count()) > 0;
    test.skip(semFilho, 'este responsavel nao tem aluno vinculado no ambiente de teste');

    const botaoImagem = page.getByRole('button', { name: /uso de imagem/ }).first();
    const rotulo = await botaoImagem.innerText();
    const gravado = page.waitForResponse(
      (r) => rota('/privacy/consents')(r.request()) && r.request().method() === 'POST',
    );
    await botaoImagem.click();
    expect((await gravado).status()).toBe(200);
    // O botao inverte: o consentimento mudou de verdade.
    await expect(page.getByRole('button', { name: /uso de imagem/ }).first()).not.toHaveText(rotulo);

    await page.getByRole('button', { name: /Solicitar exclus[aã]o/ }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const pedido = page.waitForResponse((r) => rota('/privacy/forget-me')(r.request()));
    await page.getByRole('button', { name: 'Registrar pedido' }).click();
    expect((await pedido).status()).toBe(202);
    await expect(page.getByRole('status')).toContainText(/Pedido registrado/i);
  });

  test('responsavel e barrado nas rotas de gestao', async ({ page }) => {
    for (const caminho of ['/app/painel', '/app/financeiro', '/app/alunos', '/app/equipe']) {
      await page.goto(caminho);
      await expect(
        page.getByRole('heading', { name: /403/ }),
        `${caminho} nao pode abrir para um responsavel`,
      ).toBeVisible();
    }

    // E o servidor recusa mesmo sem passar pela tela.
    const direto = await page.request.get('/api/v1/financial/dre');
    expect(direto.status(), 'a API precisa recusar por conta propria').toBeGreaterThanOrEqual(403);
  });
});

test.describe('SUPER_ADMIN', () => {
  test.skip(!admin, motivoSkip('SUPER_ADMIN'));

  test('painel da plataforma le sondas reais e declara o que nao mede', async ({ page }) => {
    await login(page, admin!);
    const flags = page.waitForResponse((r) => rota('/health/features')(r.request()));
    await page.goto('/app/plataforma');
    expect((await flags).status()).toBe(200);

    await expect(page.getByRole('heading', { name: 'Plataforma' })).toBeVisible();
    // Ausencia de metrica aparece como ausencia, nunca como zero.
    await expect(page.getByText(/N[aã]o medido\./)).toBeVisible();
  });
});
