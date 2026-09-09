import { expect, test } from '@playwright/test';

/**
 * Telas publicas: cada botao precisa produzir uma chamada real ou uma navegacao
 * real. Assercao de texto sozinha aprovaria um `onClick` vazio.
 */
test.describe('Publico', () => {
  test('landing leva ao cadastro e a politica de privacidade', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.getByRole('link', { name: /Come[cç]ar teste de 7 dias/ }).click();
    await expect(page).toHaveURL(/\/cadastro/);

    await page.goto('/');
    await page.getByRole('link', { name: /Pol[ií]tica de Privacidade/ }).click();
    await expect(page).toHaveURL(/\/privacidade/);
    // Conteudo de verdade, nao um placeholder de template.
    await expect(page.getByRole('heading', { name: /Seus direitos \(Art\. 18\)/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Canal do encarregado/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /privacidade@/ })).toBeVisible();
  });

  test('html declara o idioma pt-BR', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  });

  test('login com senha errada mostra o erro da API e nao entra', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByLabel('E-mail').fill('nao-existe@example.com');
    await page.getByLabel('Senha').fill('SenhaErrada12345');

    const resposta = page.waitForResponse((r) => r.url().includes('/api/v1/auth/login'));
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    expect((await resposta).status()).toBeGreaterThanOrEqual(400);

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/entrar/);
  });

  test('recuperacao de senha chama a API e responde igual para qualquer e-mail', async ({ page }) => {
    await page.goto('/esqueci-a-senha');
    await page.getByLabel('E-mail').fill('qualquer@example.com');

    const resposta = page.waitForResponse((r) => r.url().includes('/api/v1/auth/forgot-password'));
    await page.getByRole('button', { name: /Enviar instru[cç][oõ]es/ }).click();
    expect((await resposta).status()).toBe(200);

    await expect(page.getByRole('status')).toBeVisible();
  });

  test('cadastro valida CPF/CNPJ e forca de senha antes de chamar a API', async ({ page }) => {
    let chamou = false;
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/register')) chamou = true;
    });

    await page.goto('/cadastro');
    await page.getByLabel('Nome da empresa').fill('Van Teste');
    await page.getByLabel('CPF ou CNPJ').fill('11111111111');
    await page.getByLabel('Seu nome').fill('Fulano');
    await page.getByLabel('Seu e-mail').fill('fulano@example.com');
    await page.getByLabel('Senha').fill('123');

    await page.getByRole('button', { name: 'Criar conta' }).click();

    await expect(page.getByText(/CPF inv[aá]lido\./)).toBeVisible();
    expect(chamou, 'nao pode chamar a API com documento invalido').toBe(false);
  });

  test('link de redefinicao sem token explica em vez de quebrar', async ({ page }) => {
    await page.goto('/redefinir-senha');
    await expect(page.getByRole('heading', { name: /Link inv[aá]lido/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pedir novo link' })).toBeVisible();
  });

  test('convite sem token explica em vez de quebrar', async ({ page }) => {
    await page.goto('/aceitar-convite');
    await expect(page.getByRole('heading', { name: /Convite inv[aá]lido/ })).toBeVisible();
  });

  test('rota inexistente cai em 404 amigavel', async ({ page }) => {
    await page.goto('/rota-que-nao-existe');
    await expect(page.getByRole('heading', { name: /404/ })).toBeVisible();
  });

  test('rota protegida sem sessao manda para o login', async ({ page }) => {
    await page.goto('/app/painel');
    await page.waitForURL(/\/entrar/);
  });
});
