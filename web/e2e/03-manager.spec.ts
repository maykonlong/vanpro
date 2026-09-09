import { expect, test } from '@playwright/test';
import { credencial, login, motivoSkip } from './helpers';

const cred = credencial('MANAGER');

/**
 * O gestor ve o menu recortado pelas flags do vinculo — e, mesmo assim, o
 * servidor recusa a rota. Esconder botao e UX; a negacao que vale e a de la.
 */
test.describe('MANAGER', () => {
  test.skip(!cred, motivoSkip('MANAGER'));

  test.beforeEach(async ({ page }) => {
    await login(page, cred!);
  });

  test('menu reflete exatamente as flags devolvidas por /auth/me', async ({ page }) => {
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status()).toBe(200);
    const perfil = (await me.json()) as {
      permissions: { canManageFinance: boolean; canManageRoutes: boolean };
    };

    await page.goto('/app/painel');

    const financeiro = page.getByRole('link', { name: 'Financeiro' });
    const alunos = page.getByRole('link', { name: 'Alunos' });

    await expect(financeiro).toHaveCount(perfil.permissions.canManageFinance ? 1 : 0);
    await expect(alunos).toHaveCount(perfil.permissions.canManageRoutes ? 1 : 0);
  });

  test('area sem permissao explica em vez de mostrar painel zerado', async ({ page }) => {
    const me = await page.request.get('/api/v1/auth/me');
    const perfil = (await me.json()) as { permissions: { canManageFinance: boolean } };
    test.skip(perfil.permissions.canManageFinance, 'este gestor tem a flag de financeiro ligada');

    await page.goto('/app/financeiro');
    await expect(page.getByText(/indispon[ií]vel para o seu perfil/i)).toBeVisible();
    // Zero seria lido como "empresa sem movimento" — pior que nao mostrar.
    await expect(page.getByTestId('dre-receita')).toHaveCount(0);
  });

  test('rota exclusiva de outro papel devolve 403 amigavel', async ({ page }) => {
    await page.goto('/app/meus-ganhos');
    await expect(page.getByRole('heading', { name: /403/ })).toBeVisible();
  });
});
