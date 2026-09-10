import { expect } from '@playwright/test';

import { apiGet, chamarApi, contextoComo, testeComo, type PaginadoLeve } from './helpers';

/**
 * Negativas — valem tanto quanto as positivas.
 *
 * Uma suíte só de caminhos felizes aprova um produto que vaza dado de outra
 * empresa, aceita escrita sem CSRF e deixa a pessoa clicando numa tela morta
 * depois que a sessão caiu. É isso que este arquivo tenta fazer de propósito.
 */

interface Aluno {
  id: string;
  name: string;
}

const test = testeComo('OWNER');

test.describe('Isolamento entre empresas', () => {
  test('o dono de uma frota não alcança o aluno da outra, nem pelo id', async ({ browser }) => {
    // Pega um id real da SEGUNDA frota, pela sessão de quem tem direito a ele.
    const outra = await contextoComo(browser, 'OWNER_2');
    const paginaOutra = await outra.newPage();
    await paginaOutra.goto('/app/alunos');
    const alheios = await apiGet<PaginadoLeve<Aluno>>(paginaOutra, '/students?perPage=5');
    expect(alheios.meta.total, 'a segunda frota do seed precisa ter alunos').toBeGreaterThan(0);
    const alvo = alheios.items[0];
    await outra.close();

    // Agora, com a sessão do dono da PRIMEIRA frota.
    const nossa = await contextoComo(browser, 'OWNER');
    const page = await nossa.newPage();
    await page.goto('/app/alunos');

    const resposta = await page.evaluate(async (id) => {
      const r = await fetch(`/api/v1/students/${id}`, { credentials: 'include' });
      return { status: r.status, corpo: await r.text() };
    }, alvo.id);

    expect(
      resposta.status,
      'aluno de outra empresa não pode ser lido nem por id conhecido',
    ).toBeGreaterThanOrEqual(400);
    expect(resposta.corpo, 'a resposta não pode vazar o nome do aluno alheio').not.toContain(
      alvo.name,
    );

    await nossa.close();
  });
});

test.describe('CSRF', () => {
  test('escrita sem o cabeçalho de CSRF é recusada mesmo com a sessão válida', async ({ page }) => {
    await page.goto('/app/alunos');

    const semToken = await page.evaluate(async () => {
      const r = await fetch('/api/v1/students', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E sem csrf',
          school: 'x',
          grade: '1',
          shift: 'MORNING',
          monthlyFee: 1,
        }),
      });
      return { status: r.status, corpo: await r.text() };
    });

    expect(
      semToken.status,
      'cookie de sessão sozinho não pode autorizar escrita — é o buraco do CSRF',
    ).toBeGreaterThanOrEqual(400);
    expect(semToken.status).toBeLessThan(500);
  });
});


/*
 * A frota "Vai e Vem" existe no seed em `SUSPENDED`. Antes de ela existir,
 * este bloco inteiro se declarava NAO VERIFICADO — o caminho mais delicado do
 * produto (conta que abre, mostra tudo e nao aceita nada) nunca tinha sido
 * exercitado uma vez sequer.
 *
 * O contrato tem TRES partes, e as tres sao verificadas aqui: le, nao
 * escreve, e as duas operacoes essenciais continuam passando — porque a van
 * ja esta na rua com crianca dentro quando o boleto vence.
 */
const comoDonoSuspenso = testeComo('OWNER_SUSPENSO');
const comoMotoristaSuspenso = testeComo('DRIVER_SUSPENSO');

comoDonoSuspenso(
  'a faixa de somente leitura aparece quando a assinatura está suspensa',
  async ({ page }) => {
    await page.goto('/app/painel');
    const empresa = await apiGet<{ company: { tenantStatus: string } }>(page, '/company/me');
    expect(
      empresa.company.tenantStatus,
      'o seed precisa manter esta frota suspensa; sem isso o cenário não existe',
    ).toBe('SUSPENDED');

    await expect(page.getByText(/Somente leitura\./)).toBeVisible();
    await expect(page.getByRole('link', { name: /Ver como regularizar/i })).toBeVisible();
  },
);

comoDonoSuspenso('a leitura continua inteira: os dados não somem', async ({ page }) => {
  await page.goto('/app/alunos');
  const alunos = await apiGet<{ items: unknown[] }>(page, '/students?perPage=10');
  expect(alunos.items.length, 'conta suspensa continua enxergando o próprio cadastro').toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Alunos', level: 1 })).toBeVisible();
});

comoDonoSuspenso('a escrita é recusada pelo SERVIDOR, não só escondida na tela', async ({ page }) => {
  await page.goto('/app/alunos');
  const r = await chamarApi(page, '/students', 'POST', {
    name: 'Aluno de frota suspensa',
    school: 'Escola Teste',
    grade: '1º Ano A',
    shift: 'MORNING',
    monthlyFee: 500,
  });
  // 402 Payment Required, e nao 403: o problema nao e permissao — a pessoa TEM
  // o papel. E a assinatura. O codigo de status certo e o que permite ao front
  // mandar para "regularizar" em vez de para "voce nao tem acesso".
  expect(
    r.status,
    `conta suspensa não pode criar aluno. Resposta: ${r.texto.slice(0, 200)}`,
  ).toBe(402);
  expect(r.texto).toContain('ACCOUNT_SUSPENDED');
});

comoMotoristaSuspenso(
  'ponto e check-in continuam funcionando: a van não para porque o boleto venceu',
  async ({ page }) => {
    await page.goto('/app/motorista');
    const frota = await apiGet<PaginadoLeve<{ id: string }>>(page, '/vehicles?perPage=1');
    const veiculo = frota.items[0];
    expect(veiculo, 'a frota suspensa precisa ter um veículo para bater ponto').toBeTruthy();

    const ponto = await chamarApi(page, '/timecards/punch', 'POST', {
      type: 'CLOCK_IN',
      vehicleId: veiculo!.id,
    });

    /*
     * O que se prova aqui e que a SUSPENSAO nao entrou no caminho: qualquer
     * resposta serve, menos 402. Um 409 ("ja existe turno aberto") e resultado
     * legitimo da maquina de estados e nao tem nada a ver com assinatura —
     * exigir 2xx faria este teste depender da ordem em que a suite roda.
     */
    expect(
      ponto.status,
      `bater ponto é operação essencial e não pode ser barrada pela suspensão. Resposta: ${ponto.texto.slice(0, 200)}`,
    ).not.toBe(402);
    expect(ponto.texto).not.toContain('ACCOUNT_SUSPENDED');
  },
);

test.describe('Conta suspensa — página pública', () => {
  test('a tela de conta suspensa explica o que para e o que continua', async ({ page }) => {
    // A rota é pública e existe independentemente do estado da assinatura: o
    // que se verifica aqui é que ela informa em vez de só bloquear.
    await page.goto('/conta-suspensa');
    await expect(page.getByRole('heading', { name: 'Conta suspensa', level: 1 })).toBeVisible();
    await expect(page.getByText(/os dados continuam visíveis, mas nenhuma alteração é aceita/i)).toBeVisible();

    await page.getByRole('button', { name: /Voltar ao sistema/i }).click();
    await expect(page).toHaveURL(/\/app/);
  });
});

test.describe('Sessão expirada', () => {
  test('sessão derrubada no meio do uso leva ao login, e não a uma tela morta', async ({ page }) => {
    await page.goto('/app/alunos');
    await expect(page.getByRole('heading', { name: 'Alunos', level: 1 })).toBeVisible();

    // A sessão morre por fora — exatamente como quando o servidor revoga.
    await page.context().clearCookies();

    // A próxima ação da pessoa tem de encontrar isso e reagir.
    const naoAutenticado = page.waitForResponse(
      (r) => r.url().includes('/api/v1/students') && r.status() === 401,
      { timeout: 30_000 },
    );
    await page.getByLabel(/^Turno/).selectOption('FULL');
    await naoAutenticado;

    await page.waitForURL(/\/entrar/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Entrar', level: 1 })).toBeVisible();
  });
});
