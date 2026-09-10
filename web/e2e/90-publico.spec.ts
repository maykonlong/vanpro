import { liberarCotaPublica } from './limites';
import { expect, test } from '@playwright/test';

import { CONTAS, cnpjValido, pouparCotaDeLogin, sufixo, telaNaoFicaMuda } from './helpers';

/**
 * Área pública: landing, login, recuperação de senha, convite, cadastro,
 * política de privacidade e 404.
 *
 * Aqui mora o primeiro botão que qualquer pessoa aperta no produto. Cada um é
 * clicado e o efeito é conferido — navegação que aconteceu, requisição que
 * saiu, mensagem que apareceu.
 */

/**
 * DEFEITO DE PRODUTO (D-1) — este teste falha de propósito.
 *
 * `web/src/lib/api.ts` trata qualquer 401 como sessão expirada e chama
 * `POST /auth/refresh` — inclusive para o `GET /auth/me` do boot, quando nunca
 * houve sessão nesta aba. Esse refresh responde 401 e consome o `authLimiter`
 * (10 por 15 min por IP). Cerca de dez cargas anônimas e o próprio
 * `POST /auth/login` passa a responder 429 com a SENHA CERTA, para todo mundo
 * atrás daquele IP.
 *
 * Correção sugerida: incluir `/auth/me` em `NO_RETRY`, ou não tentar renovar
 * quando nunca houve sessão.
 */
test('a carga anônima não deveria disparar um refresh de sessão inexistente', async ({ page }) => {
  const chamadas: string[] = [];
  page.on('request', (r) => {
    const caminho = new URL(r.url()).pathname;
    if (caminho.startsWith('/api/v1/auth/')) chamadas.push(`${r.method()} ${caminho}`);
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /A van inteira em um lugar só/i })).toBeVisible();

  expect(
    chamadas,
    'visitante anônimo não tem sessão para renovar; o refresh gasta a cota do login de todo o IP',
  ).not.toContain('POST /api/v1/auth/refresh');
});

/*
 * O refresh sem sessão é respondido localmente em TODOS os testes deste arquivo
 * (o `beforeEach` do Playwright vale para o arquivo inteiro, inclusive para o
 * teste acima). Isso não enfraquece a asserção do defeito: o que ela mede é a
 * requisição que o CLIENTE dispara, e essa continua sendo disparada — o que a
 * interceptação evita é apenas que ela chegue ao servidor e queime a cota de
 * login de toda a suíte. Nenhuma outra chamada é encenada em lugar nenhum.
 */
test.beforeEach(async ({ page }) => {
  await pouparCotaDeLogin(page);
});

test.describe('Landing', () => {
  test('a página inicial abre e cada rota de acesso leva ao lugar certo', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /A van inteira em um lugar só/i }),
    ).toBeVisible();
    await telaNaoFicaMuda(page);

    // "Entrar" do cabeçalho
    await page.getByRole('navigation', { name: 'Acesso' }).getByRole('link', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    await expect(page.getByRole('heading', { name: 'Entrar', level: 1 })).toBeVisible();

    // "Criar conta" do cabeçalho
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Acesso' }).getByRole('link', { name: 'Criar conta' }).click();
    await expect(page).toHaveURL(/\/cadastro$/);

    // CTA do herói
    await page.goto('/');
    await page.getByRole('link', { name: /Começar teste de 7 dias/i }).click();
    await expect(page).toHaveURL(/\/cadastro$/);

    // "Já tenho conta"
    await page.goto('/');
    await page.getByRole('link', { name: /Já tenho conta/i }).click();
    await expect(page).toHaveURL(/\/entrar$/);

    // CTA do rodapé da seção de papéis
    await page.goto('/');
    await page.getByRole('link', { name: /Criar minha conta/i }).click();
    await expect(page).toHaveURL(/\/cadastro$/);

    // Política de privacidade
    await page.goto('/');
    await page.getByRole('link', { name: /Política de Privacidade/i }).click();
    await expect(page).toHaveURL(/\/privacidade$/);
    await telaNaoFicaMuda(page);
  });

  test('o alternador de aparência percorre o ciclo, pinta a tela e guarda a escolha', async ({
    page,
  }) => {
    await page.goto('/');
    const botao = page.getByRole('button', { name: /^Aparência:/ });

    const escuro = () => page.evaluate(() => document.documentElement.classList.contains('dark'));
    const guardado = () => page.evaluate(() => localStorage.getItem('vanpro:tema'));

    // sistema -> claro
    await botao.click();
    await expect.poll(guardado).toBe('light');
    expect(await escuro(), 'no tema claro o <html> não pode ter a classe dark').toBe(false);

    // claro -> escuro: a classe precisa MUDAR de fato, não só o rótulo do botão
    await botao.click();
    await expect.poll(guardado).toBe('dark');
    expect(await escuro()).toBe(true);

    // Escolha de aparência que some no F5 é botão que finge funcionar.
    await page.reload();
    expect(await guardado()).toBe('dark');
    expect(await escuro()).toBe(true);

    // escuro -> sistema, devolvendo o navegador ao estado em que encontrou
    await botao.click();
    await expect.poll(guardado).toBe('system');
  });
});

test.describe('Login', () => {
  test('senha errada é recusada com mensagem, sem tela branca e sem navegar', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByLabel(/^E-mail/).fill(CONTAS.OWNER.email);
    await page.getByLabel(/^Senha/).fill('SenhaTotalmenteErrada#1');

    const resposta = page.waitForResponse((r) => r.url().includes('/api/v1/auth/login'));
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    const status = (await resposta).status();

    expect(status, 'credencial errada não pode ser aceita').toBeGreaterThanOrEqual(400);
    await expect(page).toHaveURL(/\/entrar$/);
    const alerta = page.getByRole('alert').first();
    await expect(alerta).toBeVisible();
    expect((await alerta.innerText()).trim().length).toBeGreaterThan(0);
  });

  test('e-mail inexistente recebe a mesma recusa genérica (sem enumerar cadastro)', async ({
    page,
  }) => {
    await page.goto('/entrar');
    await page.getByLabel(/^E-mail/).fill(`nao-existe-${sufixo()}@exemplo.com.br`);
    await page.getByLabel(/^Senha/).fill('QualquerCoisa#12345');

    const resposta = page.waitForResponse((r) => r.url().includes('/api/v1/auth/login'));
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    expect((await resposta).status()).toBeGreaterThanOrEqual(400);
    await expect(page.getByRole('alert').first()).toBeVisible();
  });

  test('os links auxiliares do login funcionam', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByRole('link', { name: /Esqueci minha senha/i }).click();
    await expect(page).toHaveURL(/\/esqueci-a-senha$/);

    await page.goto('/entrar');
    await page.getByRole('link', { name: /Cadastre sua empresa/i }).click();
    await expect(page).toHaveURL(/\/cadastro$/);
  });

  test('"Entrar com passkey" dispara o desafio WebAuthn de verdade', async ({ page }) => {
    await page.goto('/entrar');
    const espera = page.waitForResponse(
      (r) => r.url().includes('/api/v1/auth/webauthn/login/options'),
      { timeout: 20_000 },
    );
    await page.getByRole('button', { name: /Entrar com passkey/i }).click();
    const status = (await espera).status();
    // O navegador de teste não tem autenticador cadastrado: o que se prova aqui
    // é que o botão chama a rota real, e que a falha vira mensagem na tela em
    // vez de silêncio.
    expect(status).toBeLessThan(500);
    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('Recuperação de senha', () => {
  test('o formulário envia e responde igual para e-mail existente ou não', async ({ page }) => {
    liberarCotaPublica();
    await page.goto('/esqueci-a-senha');
    await page.getByLabel(/^E-mail/).fill(CONTAS.OWNER.email);

    const espera = page.waitForResponse((r) => r.url().includes('/api/v1/auth/forgot-password'));
    await page.getByRole('button', { name: /Enviar instruções/i }).click();
    const resposta = await espera;

    expect(resposta.status(), 'a cota pública foi zerada antes: 429 aqui é defeito').toBeLessThan(400);
    await expect(page.getByRole('status').first()).toBeVisible();
  });

  test('redefinição sem token não finge que funciona', async ({ page }) => {
    await page.goto('/redefinir-senha');
    await expect(page.getByRole('heading', { name: /Link inválido/i })).toBeVisible();
    await page.getByRole('link', { name: /Pedir novo link/i }).click();
    await expect(page).toHaveURL(/\/esqueci-a-senha$/);
  });

  test('redefinição com token inválido recusa no servidor, não no cliente', async ({ page }) => {
    liberarCotaPublica();
    await page.goto('/redefinir-senha?token=token-que-nao-existe');
    await page.getByLabel(/^Nova senha/).fill('TrocaSegura#2026x');
    await page.getByLabel(/Repita a nova senha/i).fill('TrocaSegura#2026x');

    const espera = page.waitForResponse((r) => r.url().includes('/api/v1/auth/reset-password'));
    await page.getByRole('button', { name: /Redefinir senha/i }).click();
    const resposta = await espera;

    expect(resposta.status(), 'token inventado não pode redefinir senha').toBeGreaterThanOrEqual(400);
    await expect(page.getByRole('alert').first()).toBeVisible();
  });

  test('a validação local barra senhas fracas e senhas diferentes antes da rede', async ({
    page,
  }) => {
    let chamou = false;
    page.on('request', (r) => {
      if (r.url().includes('/auth/reset-password')) chamou = true;
    });

    await page.goto('/redefinir-senha?token=qualquer');
    await page.getByLabel(/^Nova senha/).fill('123');
    await page.getByLabel(/Repita a nova senha/i).fill('456');
    await page.getByRole('button', { name: /Redefinir senha/i }).click();

    await expect(page.getByText(/As senhas não conferem/i)).toBeVisible();
    expect(chamou, 'senha fraca não deve nem sair do navegador').toBe(false);
  });
});

test.describe('Convite', () => {
  test('convite sem token explica em vez de quebrar', async ({ page }) => {
    await page.goto('/aceitar-convite');
    await expect(page.getByRole('heading', { name: /Convite inválido/i })).toBeVisible();
    await page.getByRole('link', { name: /Ir para o login/i }).click();
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test('convite com token inválido é recusado pelo servidor', async ({ page }) => {
    await page.goto('/aceitar-convite?token=token-invalido-de-teste');
    await page.getByLabel(/^Seu nome/).fill('Fulano de Teste');
    await page.getByLabel(/^Senha/).fill('ConviteForte#2026x');
    await page.getByLabel(/Repita a senha/i).fill('ConviteForte#2026x');

    const espera = page.waitForResponse((r) => r.url().includes('/api/v1/company/accept-invite'));
    await page.getByRole('button', { name: /Ativar meu acesso/i }).click();
    expect((await espera).status()).toBeGreaterThanOrEqual(400);
    await expect(page.getByRole('alert').first()).toBeVisible();
  });
});

test.describe('Cadastro de empresa', () => {
  test('a validação local barra CPF/CNPJ inválido e senha fraca antes de enviar', async ({
    page,
  }) => {
    let chamou = false;
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/register')) chamou = true;
    });

    liberarCotaPublica();
    await page.goto('/cadastro');
    await page.getByLabel(/^Nome da empresa/).fill('Empresa de Teste');
    await page.getByLabel(/CPF ou CNPJ/i).fill('11111111111');
    await page.getByLabel(/^Seu nome/).fill('Fulano');
    await page.getByLabel(/^Seu e-mail/).fill('nao-e-email');
    await page.getByLabel(/^Senha/).fill('123');
    await page.getByRole('button', { name: /Criar conta/i }).click();

    await expect(page.getByText(/CPF inválido/i)).toBeVisible();
    await expect(page.getByText(/E-mail inválido/i)).toBeVisible();
    expect(chamou, 'formulário inválido não deve chamar a API').toBe(false);
  });

  test('a máscara de documento e o medidor de senha reagem ao que se digita', async ({ page }) => {
    await page.goto('/cadastro');
    const doc = page.getByLabel(/CPF ou CNPJ/i);
    await doc.fill('11222333000181');
    await expect(doc).toHaveValue('11.222.333/0001-81');

    const senha = page.getByLabel(/^Senha/);
    await senha.fill('abc');
    await expect(page.getByText(/Forca da senha: Muito fraca|Forca da senha: Fraca/i)).toBeVisible();
    await senha.fill('CorredorAzul2026Longo');
    await expect(page.getByText(/Forca da senha: (Forte|Muito forte)/i)).toBeVisible();
  });

  test('o cadastro cria a empresa de verdade e já entra logado', async ({ page }) => {
    const id = sufixo();
    const email = `e2e.owner.${id.toLowerCase()}@exemplo.com.br`;

    await page.goto('/cadastro');
    await page.getByLabel(/^Nome da empresa/).fill(`E2E Frota ${id}`);
    await page.getByLabel(/CPF ou CNPJ/i).fill(cnpjValido());
    await page.getByLabel(/^Seu nome/).fill(`Dono E2E ${id}`);
    await page.getByLabel(/^Seu e-mail/).fill(email);
    await page.getByLabel(/^Senha/).fill(`FrotaE2E${id}#26`);

    const espera = page.waitForResponse((r) => r.url().includes('/api/v1/register'));
    await page.getByRole('button', { name: /Criar conta/i }).click();
    const resposta = await espera;

    expect(
      resposta.status(),
      `o cadastro precisa ser aceito: ${(await resposta.text()).slice(0, 300)}`,
    ).toBeLessThan(400);

    await page.waitForURL(/\/app\/painel/, { timeout: 30_000 });
    // O efeito real: a sessão nasceu e a empresa criada é a frota ativa.
    await expect(page.getByRole('heading', { name: /^Olá, Dono/i })).toBeVisible();
    await expect(page.getByText(`E2E Frota ${id}`).first()).toBeVisible();
  });
});

test.describe('Rotas públicas restantes', () => {
  test('a política de privacidade abre com conteúdo', async ({ page }) => {
    await page.goto('/privacidade');
    await telaNaoFicaMuda(page);
    expect((await page.locator('main').first().innerText()).length).toBeGreaterThan(200);
  });

  test('endereço inexistente cai no 404 explicado, não em tela branca', async ({ page }) => {
    await page.goto('/rota-que-nao-existe-mesmo');
    await expect(page.getByRole('heading', { name: /404/ })).toBeVisible();
    await page.getByRole('link', { name: /Voltar para a página inicial/i }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('área do app sem sessão manda para o login', async ({ page }) => {
    await page.goto('/app/painel');
    await page.waitForURL(/\/entrar/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Entrar', level: 1 })).toBeVisible();
  });
});
