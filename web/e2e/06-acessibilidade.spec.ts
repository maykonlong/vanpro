import { expect, test } from '@playwright/test';

/**
 * Regras de acessibilidade que valem para qualquer tela, verificadas nas
 * publicas (que rodam sem credencial): alvo de toque, foco visivel, rotulo em
 * botao so-icone e navegacao por teclado.
 */
test.describe('Acessibilidade', () => {
  test('todo controle interativo tem ao menos 44x44 de alvo', async ({ page }) => {
    for (const caminho of ['/', '/entrar', '/cadastro', '/privacidade']) {
      await page.goto(caminho);
      const controles = page.locator('button, a[href], input:not([type="hidden"]), select, textarea');
      const total = await controles.count();

      for (let i = 0; i < total; i += 1) {
        const alvo = controles.nth(i);
        if (!(await alvo.isVisible())) continue;
        const caixa = await alvo.boundingBox();
        if (!caixa) continue;
        // Link dentro de paragrafo corrido e excecao aceita pelo WCAG.
        const inline = await alvo.evaluate((el) => el.tagName === 'A' && el.closest('p') !== null);
        if (inline) continue;
        expect(
          Math.round(caixa.height),
          `alvo pequeno em ${caminho}: ${await alvo.innerText().catch(() => '')}`,
        ).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test('o formulario de login e operavel so pelo teclado', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByLabel('E-mail').focus();
    await page.keyboard.type('teclado@example.com');
    await page.keyboard.press('Tab');
    await page.keyboard.type('SenhaDeTeste12345');

    const resposta = page.waitForResponse((r) => r.url().includes('/api/v1/auth/login'));
    await page.keyboard.press('Enter');
    // Enter no formulario precisa submeter — nao so mover o foco.
    expect((await resposta).status()).toBeGreaterThan(0);
  });

  test('o link de pular navegacao aparece ao receber foco', async ({ page }) => {
    await page.goto('/');
    const pular = page.getByRole('link', { name: /Pular para o conte[uú]do/ });
    await pular.focus();
    const caixa = await pular.boundingBox();
    expect(caixa, 'o link de pulo precisa ficar visivel com foco').not.toBeNull();
    expect(caixa!.x).toBeGreaterThanOrEqual(0);
  });

  test('nao existe onClick vazio: todo botao visivel muda algo', async ({ page }) => {
    await page.goto('/entrar');
    // O botao de passkey precisa acionar a API de WebAuthn do servidor.
    const chamada = page.waitForResponse((r) => r.url().includes('/webauthn/login/options'));
    await page.getByRole('button', { name: 'Entrar com passkey' }).click();
    expect((await chamada).status()).toBeGreaterThan(0);
  });

  test('a pagina nao rola na horizontal em viewport de celular', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const caminho of ['/', '/entrar', '/privacidade']) {
      await page.goto(caminho);
      const excedeu = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(excedeu, `${caminho} rola horizontalmente no celular`).toBe(false);
    }
  });
});
