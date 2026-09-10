import { expect, test as base } from '@playwright/test';

import {
  CONTAS,
  apiGet,
  clicarEsperando,
  contextoComo,
  testeComo,
  entrarEscolhendoEmpresa,
  type PaginadoLeve,
} from './helpers';

/**
 * Administrador da plataforma, motorista freelancer (duas frotas) e empresa em
 * período de teste.
 *
 * O caso do freelancer é o mais fácil de "passar" sem provar nada: bastaria
 * conferir que o nome no cabeçalho mudou. O que este arquivo exige é que o
 * CONTEÚDO mude junto — a lista de alunos que ele vê depois da troca tem de ser
 * a da outra empresa, e não a que estava carregada.
 */

interface Aluno {
  id: string;
  name: string;
}

const testeAdmin = testeComo('SUPER_ADMIN');
const testeTeste = testeComo('OWNER_TESTE');

testeAdmin.describe('Administrador da plataforma', () => {
  testeAdmin('o painel mostra sondas reais e DECLARA o que não é medido', async ({ page }) => {
    await page.goto('/app/plataforma');
    await expect(page.getByRole('heading', { name: 'Plataforma', level: 1 })).toBeVisible();

    // Dependências, com o estado que a sonda respondeu.
    const pronto = await apiGet<{ status: string; checks: Record<string, string> }>(
      page,
      '/health/ready',
    );
    await expect(page.getByRole('heading', { name: 'Dependências' })).toBeVisible();
    await expect(page.getByText(new RegExp(`Situação geral: *${pronto.status}`))).toBeVisible();
    for (const [nome, estado] of Object.entries(pronto.checks)) {
      await expect(page.getByText(`${nome}: ${estado === 'ok' ? 'no ar' : 'fora'}`)).toBeVisible();
    }

    // Integrações: desligada é declarada, não some.
    await expect(page.getByRole('heading', { name: 'Integrações do ambiente' })).toBeVisible();
    await expect(page.getByText(/Cobrança: não configurada/)).toBeVisible();

    // A seção "Métricas entre empresas" declarava "não medido" porque não
    // existia rota nenhuma que atravessasse empresas. Agora existe, e o lugar
    // dela é este.
    await expect(page.getByRole('heading', { name: 'Frotas na plataforma' })).toBeVisible();
    await expect(page.getByText('Não medido.')).toHaveCount(0);
  });

  testeAdmin('a lista de frotas traz as empresas reais e esconde o documento', async ({ page }) => {
    await page.goto('/app/plataforma');
    const linha = page.locator('tr', { hasText: 'TransVan Escolar' }).first();
    await expect(linha).toBeVisible();
    await expect(linha).toContainText('Ativa');
    // Só os quatro últimos dígitos: o console decide assinatura, não exporta CNPJ.
    await expect(linha).toContainText(/\*\*\*\d{4}/);
    await expect(linha).not.toContainText('11222333000181');

    // A frota inadimplente do seed aparece com o estado certo.
    const suspensa = page.locator('tr', { hasText: 'Vai e Vem Transporte Escolar' }).first();
    await expect(suspensa).toContainText('Suspensa');
  });

  testeAdmin('suspender e reativar é ato administrativo: exige motivo e volta atrás', async ({
    page,
  }) => {
    await page.goto('/app/plataforma');
    const linha = page.locator('tr', { hasText: 'Caminho Seguro Transporte Escolar' }).first();
    const estadoOriginal = (await linha.innerText()).includes('Em teste') ? 'TRIAL' : 'ACTIVE';

    await linha.getByRole('button', { name: /Alterar assinatura/ }).click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();

    // Motivo curto é recusado pelo SERVIDOR, e a tela mostra o erro no campo.
    await dialogo.getByLabel(/^Motivo/).fill('x');
    const recusa = page.waitForResponse((r) => r.url().includes('/platform/companies/'));
    await dialogo.getByRole('button', { name: 'Aplicar' }).click();
    expect((await recusa).status(), 'motivo de um caractere não pode ser aceito').toBe(422);
    await expect(dialogo).toBeVisible();

    // Com motivo de verdade, a mudança acontece e a linha reflete.
    await dialogo.getByLabel(/^Motivo/).fill('teste de ponta a ponta do corte administrativo');
    await clicarEsperando(page, dialogo.getByRole('button', { name: 'Aplicar' }), '/platform/companies/', {
      metodo: 'PATCH',
    });
    await expect(page.locator('tr', { hasText: 'Caminho Seguro' }).first()).toContainText('Suspensa');

    // E volta ao estado anterior, para a suíte não deixar rastro.
    const voltar = page.locator('tr', { hasText: 'Caminho Seguro' }).first();
    await voltar.getByRole('button', { name: /Alterar assinatura/ }).click();
    const dialogo2 = page.getByRole('dialog');
    await dialogo2.getByLabel(/^Novo estado/).selectOption(estadoOriginal);
    await dialogo2.getByLabel(/^Motivo/).fill('devolvendo ao estado anterior ao teste');
    await clicarEsperando(page, dialogo2.getByRole('button', { name: 'Aplicar' }), '/platform/companies/', {
      metodo: 'PATCH',
    });
    await expect(page.locator('tr', { hasText: 'Caminho Seguro' }).first()).not.toContainText('Suspensa');
  });

  testeAdmin('o administrador de plataforma não tem frota e não entra nas telas de empresa', async ({
    page,
  }) => {
    await page.goto('/app/painel');
    await expect(page.getByRole('heading', { name: /Esta área não é do seu perfil/i })).toBeVisible();
    await expect(page.getByText(/entra como Administrador da plataforma/)).toBeVisible();

    // Configurações continua acessível, sem o cartão de plano (ele não tem empresa).
    await page.goto('/app/configuracoes');
    await expect(page.getByRole('heading', { name: 'Configurações', level: 1 })).toBeVisible();
    await expect(page.getByText('Plano e uso da frota ativa')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Integrações' })).toBeVisible();
  });
});

base.describe('Motorista freelancer em duas frotas', () => {

  base('o login pede a frota, o cabeçalho troca, e o conteúdo troca junto', async ({ page }) => {
    base.setTimeout(120_000);

    // Login PELA TELA: aqui a escolha de empresa é o assunto, não um detalhe.
    await entrarEscolhendoEmpresa(page, CONTAS.FREELANCER, 'TransVan Escolar');
    await expect(page.getByTestId('frota-ativa')).toHaveText('TransVan Escolar');

    // O que ela vê AGORA, na primeira frota.
    const daPrimeira = await apiGet<PaginadoLeve<Aluno>>(page, '/students?perPage=100');
    expect(daPrimeira.meta.total).toBeGreaterThan(0);
    const nomesPrimeira = new Set(daPrimeira.items.map((a) => a.name));
    await expect(
      page.locator('li').filter({ hasText: daPrimeira.items[0].name }).first(),
    ).toBeVisible();

    // --- troca de frota pelo cabeçalho ---
    await page.getByRole('button', { name: /Frota ativa:/ }).click();
    const menu = page.getByRole('listbox', { name: /Escolha a frota/i });
    await expect(menu).toBeVisible();

    const troca = page.waitForResponse((r) => r.url().includes('/auth/switch-company'));
    await menu.getByRole('option', { name: /Rota Segura/ }).click();
    expect((await troca).status(), 'a troca de frota precisa ser aceita').toBeLessThan(400);

    await expect(page.getByTestId('frota-ativa')).toHaveText('Rota Segura Transportes');

    // --- a prova que interessa: o CONTEÚDO é da outra empresa ---
    await expect
      .poll(
        async () => {
          const atual = await apiGet<PaginadoLeve<Aluno>>(page, '/students?perPage=100');
          return atual.items[0]?.name ?? '';
        },
        { message: 'depois da troca, a lista precisa ser a da nova frota' },
      )
      .not.toBe(daPrimeira.items[0].name);

    const daSegunda = await apiGet<PaginadoLeve<Aluno>>(page, '/students?perPage=100');
    const vazamento = daSegunda.items.filter((a) => nomesPrimeira.has(a.name));
    expect(vazamento, 'nenhum aluno da primeira frota pode aparecer na segunda').toEqual([]);

    // E a tela renderizou o dado novo, não o antigo em cache.
    await expect(page.locator('li').filter({ hasText: daSegunda.items[0].name }).first()).toBeVisible();
    for (const nome of [...nomesPrimeira].slice(0, 5)) {
      await expect(page.locator('li').filter({ hasText: nome })).toHaveCount(0);
    }

    // O cartão de plano em Configurações também acompanha a frota ativa.
    await page.goto('/app/configuracoes');
    await expect(page.getByTestId('empresa-configuracoes')).toHaveText('Rota Segura Transportes');

    // --- volta para a frota original, para a rodada seguinte encontrar o mesmo ---
    await page.getByRole('button', { name: /Frota ativa:/ }).click();
    const volta = page.waitForResponse((r) => r.url().includes('/auth/switch-company'));
    await page
      .getByRole('listbox', { name: /Escolha a frota/i })
      .getByRole('option', { name: /TransVan/ })
      .click();
    expect((await volta).status()).toBeLessThan(400);
    await expect(page.getByTestId('frota-ativa')).toHaveText('TransVan Escolar');
  });

  base('quem atende uma frota só não recebe o seletor de frota', async ({ browser }) => {
    const contexto = await contextoComo(browser, 'DRIVER');
    const page = await contexto.newPage();
    await page.goto('/app/rota');
    await expect(page.getByRole('heading', { name: 'Rota do dia', level: 1 })).toBeVisible();
    // Menu que nunca muda nada é ruído: não existe.
    await expect(page.getByRole('button', { name: /Frota ativa:/ })).toHaveCount(0);
    await contexto.close();
  });
});

testeTeste.describe('Empresa em período de teste', () => {
  testeTeste('a conta em teste diz até quando vale e continua escrevendo normalmente', async ({
    page,
  }) => {
    await page.goto('/app/configuracoes');

    const perfil = await apiGet<{
      company: { name: string; tenantStatus: string; trialEndsAt: string | null };
      plan: { plan: string; status: string; trialEndsAt: string | null };
    }>(page, '/company/me');

    expect(perfil.company.tenantStatus, 'esta conta do seed é a que está em teste').toBe('TRIAL');
    expect(perfil.company.trialEndsAt, 'teste sem data de fim é teste que não avisa').toBeTruthy();

    await expect(page.getByTestId('empresa-configuracoes')).toHaveText(perfil.company.name);
    // A situação aparece traduzida, com a data limite ao lado.
    await expect(page.getByText(/situação Em teste/)).toBeVisible();
    await expect(page.getByText(/teste até \d{2}\/\d{2}\/\d{4}/)).toBeVisible();

    // Conta em teste NÃO é conta suspensa: nada de faixa de somente leitura.
    await expect(page.getByText(/Somente leitura\./)).toHaveCount(0);

    // E a escrita realmente passa: o painel oferece as ações normalmente.
    await page.goto('/app/painel');
    await expect(page.getByRole('heading', { name: /^Olá, Sandra/ })).toBeVisible();
    await page.goto('/app/alunos');
    await expect(page.getByRole('button', { name: 'Novo aluno' })).toBeVisible();
  });

  testeTeste('o limite do plano aparece com uso e teto, e não como número solto', async ({ page }) => {
    await page.goto('/app/configuracoes');
    const perfil = await apiGet<{
      plan: { usage: Record<string, { used: number; limit: number }> };
    }>(page, '/company/me');

    for (const [rotulo, chave] of [
      ['Veículos', 'vehicles'],
      ['Motoristas', 'drivers'],
      ['Alunos', 'students'],
    ] as const) {
      const uso = perfil.plan.usage[chave];
      // A linha do plano, e não o item de menu de mesmo nome.
      const linha = page.locator('li').filter({ hasText: `${uso.used} de ${uso.limit}` }).first();
      await expect(linha).toBeVisible();
      await expect(linha).toContainText(rotulo);
    }
  });
});
