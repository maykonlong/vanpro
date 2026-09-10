import { expect, test, type Page } from '@playwright/test';

/**
 * Motorista freelancer: uma pessoa, duas frotas.
 *
 * O cenario que este arquivo cobre e o que a empresa ativa passar a ser
 * propriedade da SESSAO torna possivel pela primeira vez — escolher a frota no
 * login e trocar de frota depois, sem novo login, com o conteudo da tela
 * mudando junto.
 *
 * Sem credencial de conta com dois vinculos o teste PULA dizendo o que falta:
 * cenario nao verificado nao e cenario aprovado.
 */
const EMAIL = process.env.E2E_MULTI_EMAIL;
const SENHA = process.env.E2E_MULTI_PASSWORD ?? process.env.E2E_PASSWORD ?? '';
const TOTP = process.env.E2E_MULTI_TOTP;

const MOTIVO =
  'Sem credencial de conta com duas frotas: defina E2E_MULTI_EMAIL e E2E_MULTI_PASSWORD (ou E2E_PASSWORD). Ausencia de credencial nao e aprovacao — o cenario nao foi verificado.';

interface RespostaLogin {
  requires2FA?: boolean;
  requiresCompanySelection?: boolean;
  companies?: Array<{ companyName: string }>;
}

/** Preenche o formulario e devolve o corpo do POST /auth/login. */
async function submeterCredencial(page: Page): Promise<RespostaLogin> {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(EMAIL ?? '');
  await page.getByLabel('Senha').fill(SENHA);

  const resposta = page.waitForResponse(
    (r) => r.url().includes('/api/v1/auth/login') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const login = await resposta;
  expect(login.status(), 'o login precisa ser aceito pela API').toBeLessThan(400);

  let corpo = (await login.json()) as RespostaLogin;

  if (corpo.requires2FA) {
    expect(TOTP, 'conta com 2FA exige E2E_MULTI_TOTP').toBeTruthy();
    await page.getByLabel(/^C[oó]digo/).fill(TOTP ?? '');
    const segunda = page.waitForResponse((r) => r.url().includes('/api/v1/auth/2fa/login'));
    await page.getByRole('button', { name: /Confirmar c[oó]digo/i }).click();
    const etapa = await segunda;
    expect(etapa.status()).toBeLessThan(400);
    corpo = (await etapa.json()) as RespostaLogin;
  }

  return corpo;
}

test.describe('Motorista em duas frotas', () => {
  test.skip(!EMAIL || !SENHA, MOTIVO);

  test('escolhe a frota no login, opera nela e troca para a outra sem novo login', async ({
    page,
  }) => {
    const corpo = await submeterCredencial(page);

    expect(
      corpo.requiresCompanySelection,
      'a conta de teste precisa ter vinculo ativo com mais de uma frota',
    ).toBe(true);

    // --- 1. Tela de escolha ------------------------------------------------
    await expect(page.getByRole('heading', { name: /Em qual frota/i })).toBeVisible();
    // Nenhuma sessao foi emitida ainda: a pessoa continua fora do app.
    expect(page.url()).toContain('/entrar');

    const opcoes = page.getByRole('radio');
    await expect(opcoes).toHaveCount(corpo.companies?.length ?? 2);
    expect((corpo.companies ?? []).length, 'o cenario exige duas frotas').toBeGreaterThanOrEqual(2);

    const frotaA = corpo.companies![0]!.companyName;
    const frotaB = corpo.companies![1]!.companyName;
    expect(frotaA, 'as duas frotas precisam ser distintas').not.toBe(frotaB);

    // O papel em cada frota aparece na lista — e o que diz onde ela vai operar.
    await expect(page.getByText(/Seu papel aqui:/).first()).toBeVisible();

    // --- 2. Entra na frota A ----------------------------------------------
    await page.getByRole('radio').first().check();
    const escolhido = page.waitForResponse(
      (r) => r.url().includes('/api/v1/auth/select-company') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /Entrar nesta frota/i }).click();
    expect((await escolhido).status(), 'a escolha da empresa precisa concluir o login').toBe(200);
    await page.waitForURL(/\/app/);

    // A frota ativa fica visivel o tempo todo, sem abrir menu nenhum.
    await expect(page.getByTestId('frota-ativa')).toHaveText(frotaA);

    // --- 3. O conteudo e da frota A ---------------------------------------
    const perfilA = page.waitForResponse((r) => r.url().includes('/api/v1/company/me'));
    await page.goto('/app/configuracoes');
    expect((await perfilA).status()).toBe(200);
    await expect(page.getByTestId('empresa-configuracoes')).toHaveText(frotaA);
    await expect(page.getByText(/frota ativa/i).first()).toBeVisible();

    // --- 4. Troca para a frota B ------------------------------------------
    await page.getByRole('button', { name: /Trocar de frota/i }).click();
    const trocado = page.waitForResponse(
      (r) => r.url().includes('/api/v1/auth/switch-company') && r.request().method() === 'POST',
    );
    await page.getByRole('option', { name: new RegExp(escaparRegex(frotaB), 'i') }).click();
    expect((await trocado).status(), 'a troca de frota precisa ser aceita').toBe(200);

    await expect(page.getByTestId('frota-ativa')).toHaveText(frotaB);

    // --- 5. O conteudo mudou junto ----------------------------------------
    const perfilB = page.waitForResponse((r) => r.url().includes('/api/v1/company/me'));
    await page.goto('/app/configuracoes');
    expect((await perfilB).status()).toBe(200);
    await expect(page.getByTestId('empresa-configuracoes')).toHaveText(frotaB);

    // --- 6. O csrfToken novo foi adotado ----------------------------------
    // A troca revoga a sessao anterior e abre outra. Se o front tivesse ficado
    // com o CSRF antigo, esta escrita responderia 403 — e so aqui isso apareceria.
    const saida = page.waitForResponse(
      (r) => r.url().includes('/api/v1/auth/logout') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Sair da conta' }).click();
    expect(
      (await saida).status(),
      'escrita apos a troca precisa passar: o CSRF da sessao nova tem de ter sido adotado',
    ).toBe(204);
    await page.waitForURL(/\/entrar/);
  });
});

/** Nome de empresa pode conter caracteres com significado em expressão regular. */
function escaparRegex(valor: string): string {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
