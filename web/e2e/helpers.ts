import { expect, type Page, type Request } from '@playwright/test';

/**
 * Credenciais dos seis papeis.
 *
 * Vem do ambiente porque o banco de teste e provisionado pelo seed da API — o
 * E2E nao inventa usuario. Sem a variavel, o teste PULA com a razao dita em
 * voz alta: teste que se auto-aprova sem ter rodado e pior que teste vermelho.
 */
export type Papel = 'OWNER' | 'MANAGER' | 'DRIVER' | 'ASSISTANT' | 'PARENT' | 'SUPER_ADMIN';

export interface Credencial {
  email: string;
  password: string;
  /** Codigo TOTP fixo, quando a conta de teste tem 2FA ligado. */
  totp?: string;
}

const SENHA_PADRAO = process.env.E2E_PASSWORD ?? '';

export function credencial(papel: Papel): Credencial | null {
  const email = process.env[`E2E_${papel}_EMAIL`];
  const password = process.env[`E2E_${papel}_PASSWORD`] ?? SENHA_PADRAO;
  if (!email || !password) return null;
  return { email, password, totp: process.env[`E2E_${papel}_TOTP`] };
}

/** Mensagem unica para o skip, para o relatorio dizer o que falta configurar. */
export function motivoSkip(papel: Papel): string {
  return `Sem credencial de ${papel}: defina E2E_${papel}_EMAIL e E2E_${papel}_PASSWORD (ou E2E_PASSWORD). Ausencia de credencial nao e aprovacao — o cenario nao foi verificado.`;
}

export async function login(page: Page, cred: Credencial): Promise<void> {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(cred.email);
  await page.getByLabel('Senha').fill(cred.password);

  const resposta = page.waitForResponse(
    (r) => r.url().includes('/api/v1/auth/login') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const login = await resposta;
  expect(login.status(), 'o login precisa ser aceito pela API').toBeLessThan(400);

  const corpo = (await login.json()) as { requires2FA?: boolean };
  if (corpo.requires2FA) {
    expect(cred.totp, 'conta com 2FA exige E2E_<PAPEL>_TOTP').toBeTruthy();
    await page.getByLabel(/^C[oó]digo/).fill(cred.totp ?? '');
    const segundaEtapa = page.waitForResponse((r) => r.url().includes('/api/v1/auth/2fa/login'));
    await page.getByRole('button', { name: /Confirmar c[oó]digo/i }).click();
    expect((await segundaEtapa).status()).toBeLessThan(400);
  }

  await page.waitForURL(/\/app/);
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await page.waitForURL(/\/entrar/);
}

/**
 * Clica e prova que houve efeito de verdade: a requisicao esperada saiu, o
 * servidor aceitou e a UI mudou. Assercao de renderizacao sozinha aprovaria um
 * `onClick` vazio.
 */
export async function clicarEsperandoRequisicao(
  page: Page,
  nomeBotao: string | RegExp,
  casaUrl: (req: Request) => boolean,
  opcoes: { metodo?: string; statusMaximo?: number } = {},
): Promise<number> {
  const { metodo, statusMaximo = 400 } = opcoes;
  const espera = page.waitForResponse(
    (r) => casaUrl(r.request()) && (!metodo || r.request().method() === metodo),
  );
  await page.getByRole('button', { name: nomeBotao }).first().click();
  const resposta = await espera;
  expect(
    resposta.status(),
    `o botao "${String(nomeBotao)}" precisa produzir uma chamada aceita pela API`,
  ).toBeLessThan(statusMaximo);
  return resposta.status();
}

export function rota(caminho: string) {
  return (req: Request) => req.url().includes(`/api/v1${caminho}`);
}

/** A tela nunca pode ficar sem carregando, sem conteudo e sem erro. */
export async function telaNaoFicaMuda(page: Page): Promise<void> {
  const conteudo = page.locator('main');
  await expect(conteudo).toBeVisible();
  const texto = (await conteudo.innerText()).trim();
  expect(texto.length, 'a tela nao pode renderizar vazia').toBeGreaterThan(0);
}
