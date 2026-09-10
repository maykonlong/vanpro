import { expect, type Page } from '@playwright/test';

import { apiGet, testeComo, clicarEsperando, type PaginadoLeve } from './helpers';

/**
 * Motorista: rota do dia, ponto e ganhos.
 *
 * O ponto é a parte mais delicada do produto: as batidas são fatos
 * append-only, e a máquina de estados do servidor (fora → em turno → em pausa
 * → em turno → fora) tem de estar espelhada no botão. Um teste que só clicasse
 * em "bater entrada" aprovaria uma tela que oferece "iniciar pausa" durante a
 * pausa e devolve 409 na cara do motorista.
 *
 * Por isso o teste NORMALIZA o cartão aberto que encontrar e depois percorre o
 * ciclo inteiro, exigindo que cada estado apareça na tela e que cada batida
 * tenha ido ao servidor.
 */

const test = testeComo('DRIVER');

interface Aluno {
  id: string;
  name: string;
  status: string;
}

interface Cartao {
  id: string;
  status: string;
  punches: Array<{ type: string }>;
}

const ESTADO = (p: Page) => p.getByTestId('estado-ponto');

async function estadoAtual(page: Page): Promise<string> {
  await expect(ESTADO(page)).toBeVisible();
  return (await ESTADO(page).innerText()).trim();
}

/** Bate um ponto e exige que o servidor tenha aceitado a batida. */
async function bater(page: Page, botao: string, estadoEsperado: string): Promise<void> {
  await clicarEsperando(page, page.getByRole('button', { name: botao }), '/timecards/punch', {
    metodo: 'POST',
  });
  await expect(ESTADO(page), `depois de "${botao}" a tela precisa dizer "${estadoEsperado}"`).toHaveText(
    estadoEsperado,
  );
}

test.describe('Rota do dia', () => {
  test('a faixa do ponto, a lista de embarque e os fretamentos abrem com dado real', async ({
    page,
  }) => {
    await page.goto('/app/rota');

    await expect(page.getByText('Seu ponto')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rota do dia', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Meus fretamentos' })).toBeVisible();

    // A resposta vem antes da tabela: "faltam N de M", e não 18 linhas para contar.
    await expect(page.getByText(/Faltam \d+ de \d+|Rota concluída/)).toBeVisible();

    // O botão da faixa leva ao ponto — e é o ÚNICO lugar que bate ponto.
    await page.getByRole('link', { name: /Ver meu ponto|Bater entrada/ }).click();
    await expect(page).toHaveURL(/\/app\/ponto/);
  });

  test('o check-in muda o estado do aluno de verdade, e "Desfazer" devolve', async ({ page }) => {
    await page.goto('/app/rota');

    // Escolhe um aluno que esteja aguardando, para o teste não depender do
    // estado em que a rodada anterior deixou a lista.
    const lista = await apiGet<PaginadoLeve<Aluno>>(page, '/students?perPage=100');
    const alvo = lista.items.find((a) => a.status === 'PENDING') ?? lista.items[0];
    expect(alvo, 'a frota do seed precisa ter alunos').toBeTruthy();
    const original = alvo.status;

    const cartao = page.locator('li').filter({ hasText: alvo.name }).first();
    await expect(cartao).toBeVisible();

    // Marca como embarcado.
    if (original !== 'PENDING') {
      await clicarEsperando(page, cartao.getByRole('button', { name: /^Desfazer/ }), '/checkin', {
        metodo: 'PATCH',
      });
    }
    const aguardando = page.locator('li').filter({ hasText: alvo.name }).first();
    await clicarEsperando(page, aguardando.getByRole('button', { name: /^Embarcou/ }), '/checkin', {
      metodo: 'PATCH',
    });

    // Efeito na tela...
    const embarcado = page.locator('li').filter({ hasText: alvo.name }).first();
    await expect(embarcado.getByText('Embarcado', { exact: true })).toBeVisible();
    // ...e no dado.
    let depois = await apiGet<PaginadoLeve<Aluno>>(page, '/students?perPage=100');
    expect(depois.items.find((a) => a.id === alvo.id)?.status).toBe('BOARDED');

    // Entregar é o próximo passo oferecido, e só ele.
    await expect(embarcado.getByRole('button', { name: /^Entreguei/ })).toBeVisible();
    await expect(embarcado.getByRole('button', { name: /^Embarcou/ })).toHaveCount(0);

    await clicarEsperando(page, embarcado.getByRole('button', { name: /^Entreguei/ }), '/checkin', {
      metodo: 'PATCH',
    });
    const entregue = page.locator('li').filter({ hasText: alvo.name }).first();
    await expect(entregue.getByText('Entregue', { exact: true })).toBeVisible();
    depois = await apiGet<PaginadoLeve<Aluno>>(page, '/students?perPage=100');
    expect(depois.items.find((a) => a.id === alvo.id)?.status).toBe('DELIVERED');

    // Desfazer devolve ao estado inicial — e o banco compartilhado fica como estava.
    await clicarEsperando(page, entregue.getByRole('button', { name: /^Desfazer/ }), '/checkin', {
      metodo: 'PATCH',
    });
    depois = await apiGet<PaginadoLeve<Aluno>>(page, '/students?perPage=100');
    expect(depois.items.find((a) => a.id === alvo.id)?.status).toBe('PENDING');
  });

  test('os filtros de turno e de situação recortam a lista sem ir à rede de novo', async ({
    page,
  }) => {
    await page.goto('/app/rota');
    await expect(page.getByText(/Faltam \d+ de \d+|Rota concluída/)).toBeVisible();

    // Situação é filtro LOCAL de propósito: trocar de aba no meio da rua não
    // pode depender de rede.
    let chamou = false;
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/students')) chamou = true;
    });
    await page.getByRole('radio', { name: /^Entregues/ }).click();
    await expect(page.getByRole('radio', { name: /^Entregues/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(chamou, 'o filtro de situação é local; não pode disparar consulta').toBe(false);

    // Turno, sim, refaz a consulta com o turno escolhido.
    const espera = page.waitForResponse(
      (r) => r.url().includes('/students') && r.url().includes('shift=MORNING'),
    );
    await page.getByRole('radio', { name: 'Manhã' }).click();
    expect((await espera).status()).toBeLessThan(400);
  });
});

test.describe('Ponto', () => {
  test('ciclo completo: entrada, pausa, volta e saída', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/app/ponto');
    await expect(page.getByRole('heading', { name: 'Ponto', level: 1 })).toBeVisible();

    // --- normaliza o que a rodada anterior (ou o seed) deixou aberto ---
    if ((await estadoAtual(page)) === 'Em pausa') {
      await bater(page, 'Voltar da pausa', 'Em turno');
    }
    if ((await estadoAtual(page)) === 'Em turno') {
      await bater(page, 'Bater saída', 'Fora do turno');
    }
    expect(await estadoAtual(page)).toBe('Fora do turno');

    // Sem van escolhida a batida fica bloqueada, com a razão escrita.
    await expect(page.getByRole('button', { name: 'Bater entrada' })).toBeDisabled();
    await expect(page.getByText(/Escolha a van acima para liberar a batida/)).toBeVisible();

    const seletor = page.getByLabel(/Em qual van você vai hoje/);
    await expect
      .poll(() => seletor.locator('option').count())
      .toBeGreaterThan(1);
    const placa = (await seletor.locator('option').nth(1).innerText()).split(' —')[0].trim();
    await seletor.selectOption({ index: 1 });
    await expect(page.getByRole('button', { name: 'Bater entrada' })).toBeEnabled();

    // --- ciclo ---
    await bater(page, 'Bater entrada', 'Em turno');
    // A van aparece pela PLACA, e não por um identificador que o motorista não
    // reconheceria. (`.first()`: a placa também aparece no histórico do dia.)
    await expect(page.getByText(new RegExp(`Van ${placa}`)).first()).toBeVisible();
    await expect(page.getByText(/Trabalhando há .* · entrou às \d{2}:\d{2}/)).toBeVisible();

    await bater(page, 'Iniciar pausa', 'Em pausa');
    // Durante a pausa, "iniciar pausa" NÃO pode continuar oferecido.
    await expect(page.getByRole('button', { name: 'Iniciar pausa' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Bater saída' })).toHaveCount(0);
    await expect(page.getByText(/Em pausa há /)).toBeVisible();

    await bater(page, 'Voltar da pausa', 'Em turno');
    await bater(page, 'Bater saída', 'Fora do turno');

    // --- o cartão do dia foi para o histórico, com as quatro batidas ---
    const cartoes = await apiGet<PaginadoLeve<Cartao>>(page, '/timecards?perPage=10');
    const encerrado = cartoes.items.find((t) => t.status === 'COMPLETED');
    expect(encerrado, 'a saída precisa encerrar o cartão').toBeTruthy();
    const tipos = encerrado!.punches.map((p) => p.type);
    expect(tipos).toEqual(
      expect.arrayContaining(['CLOCK_IN', 'BREAK_START', 'BREAK_END', 'CLOCK_OUT']),
    );

    await expect(page.getByRole('heading', { name: 'Jornadas anteriores' })).toBeVisible();
    await expect(page.getByText('Entrada').first()).toBeVisible();
  });

  test('a quilometragem é opcional e fica atrás de um toque', async ({ page }) => {
    await page.goto('/app/ponto');
    await expect(page.getByLabel(/Quilometragem do painel/)).toHaveCount(0);
    await page.getByRole('button', { name: /Anotar a quilometragem/i }).click();
    await expect(page.getByLabel(/Quilometragem do painel/)).toBeVisible();
  });
});

test.describe('Meus ganhos', () => {
  test('a apuração responde a pergunta do motorista e o mês refaz a conta', async ({ page }) => {
    await page.goto('/app/meus-ganhos');
    await expect(page.getByRole('heading', { name: 'Meus ganhos', level: 1 })).toBeVisible();

    await expect(page.getByText(/Quanto você tem a receber em /)).toBeVisible();
    await expect(page.getByText('Valor da diária').first()).toBeVisible();
    await expect(page.getByText('Dias trabalhados').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Fretamentos no mês' })).toBeVisible();

    // Trocar o mês precisa refazer a apuração no servidor.
    const espera = page.waitForResponse(
      (r) => r.url().includes('/earnings') && r.url().includes('month=2026-01'),
    );
    await page.getByLabel(/^Mês de referência/).fill('2026-01');
    expect((await espera).status()).toBeLessThan(400);
    await expect(page.getByText(/Quanto você tem a receber em janeiro de 2026/i)).toBeVisible();
  });

  test('o motorista não alcança as telas de gestão', async ({ page }) => {
    await page.goto('/app/financeiro');
    await expect(page.getByRole('heading', { name: /Esta área não é do seu perfil/i })).toBeVisible();
    await expect(page.getByText(/entra como Motorista/)).toBeVisible();

    // "Voltar" precisa voltar de verdade.
    await page.goto('/app/rota');
    await page.goto('/app/alunos');
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page).toHaveURL(/\/app\/rota/);
  });
});
