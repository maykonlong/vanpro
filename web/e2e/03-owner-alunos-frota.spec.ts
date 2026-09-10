import { liberarCotaUpload } from './limites';
import { expect } from '@playwright/test';

import {
  apiGet,
  apiPost,
  apiDelete,
  testeComo,
  clicarEsperando,
  placaAleatoria,
  sufixo,
  type PaginadoLeve,
} from './helpers';

/**
 * Proprietário: alunos e frota.
 *
 * Todo registro criado aqui leva sufixo aleatório e é removido no fim do
 * próprio teste. O banco é compartilhado: spec que deixa lixo derruba o
 * vizinho na próxima rodada.
 *
 * Cada escrita é conferida DUAS vezes — na tela e relendo a API. "Salvou" que
 * só aparece na tela é exatamente o defeito que esta suíte existe para pegar.
 */

const test = testeComo('OWNER');

/** PNG 1×1 real: o servidor confere o CONTEÚDO do arquivo, não a extensão. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface Aluno {
  id: string;
  name: string;
  school: string;
  monthlyFee: { cents: number };
  photoUrl: string | null;
}

interface Veiculo {
  id: string;
  plate: string;
  model: string;
  km: number;
  capacity: number;
}

interface Motorista {
  id: string;
  name: string;
  status: string;
  dailyRate: { cents: number };
}

test.describe('Alunos', () => {
  test('ciclo completo: criar, conferir na API, editar, e excluir com confirmação', async ({
    page,
  }) => {
    const id = sufixo();
    const nome = `E2E Aluno ${id}`;
    const escola = `E2E Escola ${id}`;

    await page.goto('/app/alunos');
    await expect(page.getByRole('heading', { name: 'Alunos', level: 1 })).toBeVisible();

    // --- criar ---
    await page.getByRole('button', { name: 'Novo aluno' }).click();
    const form = page.getByRole('dialog');
    await expect(form).toBeVisible();
    await form.getByLabel(/^Nome/).fill(nome);
    await form.getByLabel(/^Escola/).fill(escola);
    await form.getByLabel(/^Série/).fill('5º Ano E2E');
    await form.getByLabel(/^Turno/).selectOption('AFTERNOON');
    await form.getByLabel(/^Mensalidade/).fill('321,00');
    await form.getByLabel(/^Endereço/).fill('Rua do Teste, 100');
    await form.getByLabel(/^Data de nascimento/).fill('2015-04-10');
    await form.getByLabel(/Tratamento de dados autorizado/i).check();

    await clicarEsperando(page, form.getByRole('button', { name: 'Cadastrar aluno' }), '/students', {
      metodo: 'POST',
    });

    // Efeito na tela...
    await expect(page.locator('li').filter({ hasText: nome }).first()).toBeVisible();
    await expect(page.getByText(`${escola} · Tarde · R$ 321,00`)).toBeVisible();

    // ...e efeito no dado, relido da API. Centavos, não reais.
    const criados = await apiGet<PaginadoLeve<Aluno>>(page, `/students?search=${escola}&perPage=5`);
    const criado = criados.items.find((a) => a.name === nome);
    expect(criado, 'o aluno precisa existir na API, não só na tela').toBeTruthy();
    expect(criado!.monthlyFee.cents).toBe(32_100);

    // --- editar ---
    const cartao = page.locator('li', { hasText: nome }).first();
    await cartao.getByRole('button', { name: new RegExp(`^Editar\\s*${nome}`) }).click();
    const edicao = page.getByRole('dialog');
    await expect(edicao.getByLabel(/^Nome/)).toHaveValue(nome);
    await edicao.getByLabel(/^Mensalidade/).fill('499,90');
    await edicao.getByLabel(/^Turno/).selectOption('MORNING');
    await clicarEsperando(page, edicao.getByRole('button', { name: 'Salvar alterações' }), '/students/', {
      metodo: 'PATCH',
    });

    await expect(page.getByText(`${escola} · Manhã · R$ 499,90`)).toBeVisible();
    const editados = await apiGet<PaginadoLeve<Aluno>>(page, `/students?search=${escola}&perPage=5`);
    expect(editados.items.find((a) => a.id === criado!.id)!.monthlyFee.cents).toBe(49_990);

    // --- excluir, com confirmação que NOMEIA o item ---
    await page
      .locator('li', { hasText: nome })
      .first()
      .getByRole('button', { name: new RegExp(`^Excluir\\s*${nome}`) })
      .click();
    const confirmar = page.getByRole('dialog');
    await expect(confirmar).toContainText(nome);

    // Cancelar precisa CANCELAR: o aluno continua lá.
    await confirmar.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.locator('li').filter({ hasText: nome }).first()).toBeVisible();

    await page
      .locator('li', { hasText: nome })
      .first()
      .getByRole('button', { name: new RegExp(`^Excluir\\s*${nome}`) })
      .click();
    await clicarEsperando(
      page,
      page.getByRole('dialog').getByRole('button', { name: 'Excluir', exact: true }),
      '/students/',
      { metodo: 'DELETE' },
    );

    await expect(page.locator('li').filter({ hasText: nome })).toHaveCount(0);
    const sobrou = await apiGet<PaginadoLeve<Aluno>>(page, `/students?search=${escola}&perPage=5`);
    expect(sobrou.items.find((a) => a.id === criado!.id), 'a exclusão precisa valer na API').toBeFalsy();
  });

  test('busca e filtro de turno consultam o servidor com o que foi digitado', async ({ page }) => {
    await page.goto('/app/alunos');

    const busca = page.waitForResponse(
      (r) => r.url().includes('/students') && r.url().includes('search=Instituto'),
    );
    await page.getByLabel(/^Buscar por escola/).fill('Instituto');
    expect((await busca).status()).toBeLessThan(400);

    const turno = page.waitForResponse(
      (r) => r.url().includes('/students') && r.url().includes('shift=MORNING'),
    );
    await page.getByLabel(/^Turno/).selectOption('MORNING');
    expect((await turno).status()).toBeLessThan(400);

    // Busca que não casa com nada precisa explicar, não ficar em branco.
    const vazia = page.waitForResponse(
      (r) => r.url().includes('/students') && r.url().includes('search=zzz'),
    );
    await page.getByLabel(/^Buscar por escola/).fill('zzzz-nao-existe');
    expect((await vazia).status()).toBeLessThan(400);
    await expect(page.getByText('Nenhum aluno cadastrado')).toBeVisible();
  });

  test('o envio de foto sobe o arquivo e passa a URL para o cadastro', async ({ page }) => {
    const id = sufixo();
    const nome = `E2E Foto ${id}`;
    const escola = `E2E EscolaFoto ${id}`;

    await page.goto('/app/alunos');
    await page.getByRole('button', { name: 'Novo aluno' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel(/^Nome/).fill(nome);
    await form.getByLabel(/^Escola/).fill(escola);
    await form.getByLabel(/^Mensalidade/).fill('100,00');

    liberarCotaUpload();
    const envio = page.waitForResponse((r) => r.url().includes('/uploads'));
    await form.locator('input[type="file"]').setInputFiles({
      name: 'foto.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });
    const resposta = await envio;

    expect(resposta.status(), `o upload precisa ser aceito: ${(await resposta.text()).slice(0, 200)}`)
      .toBeLessThan(400);

    // O botão muda de "Enviar foto" para "Trocar foto" e a miniatura aparece.
    await expect(form.getByRole('button', { name: 'Trocar foto' })).toBeVisible();
    await expect(form.getByRole('img', { name: 'Foto cadastrada' })).toBeVisible();

    await clicarEsperando(page, form.getByRole('button', { name: 'Cadastrar aluno' }), '/students', {
      metodo: 'POST',
    });

    const lista = await apiGet<PaginadoLeve<Aluno>>(page, `/students?search=${escola}&perPage=5`);
    const criado = lista.items.find((a) => a.name === nome);
    expect(criado?.photoUrl, 'a foto precisa ter sido gravada no cadastro').toBeTruthy();

    // Limpeza.
    await page
      .locator('li', { hasText: nome })
      .first()
      .getByRole('button', { name: new RegExp(`^Excluir\\s*${nome}`) })
      .click();
    await clicarEsperando(
      page,
      page.getByRole('dialog').getByRole('button', { name: 'Excluir', exact: true }),
      '/students/',
      { metodo: 'DELETE' },
    );
  });
});

test.describe('Frota — veículos', () => {
  test('cadastrar, editar, atualizar odômetro e remover uma van', async ({ page }) => {
    const placa = placaAleatoria();
    const id = sufixo();

    await page.goto('/app/frota');
    await expect(page.getByRole('heading', { name: 'Frota', level: 1 })).toBeVisible();
    await page.getByRole('tab', { name: 'Veículos' }).click();

    // --- cadastrar ---
    await page.getByRole('button', { name: 'Cadastrar veículo' }).first().click();
    const form = page.getByRole('dialog');
    await form.getByLabel(/^Placa/).fill(placa);
    await form.getByLabel(/^Modelo/).fill(`E2E Van ${id}`);
    await form.getByLabel(/^Capacidade/).fill('12');
    await form.getByLabel(/^Situação/).selectOption('IDLE');
    await clicarEsperando(page, form.getByRole('button', { name: 'Cadastrar' }), '/vehicles', {
      metodo: 'POST',
    });

    const cartao = page.locator('li', { hasText: placa }).first();
    await expect(cartao).toBeVisible();
    await expect(cartao).toContainText('12 lugares');

    const criados = await apiGet<PaginadoLeve<Veiculo>>(page, '/vehicles?perPage=100');
    const veiculo = criados.items.find((v) => v.plate === placa);
    expect(veiculo, 'o veículo precisa existir na API').toBeTruthy();

    // --- placa inválida é barrada ANTES da rede ---
    await page.getByRole('button', { name: 'Cadastrar veículo' }).first().click();
    const invalido = page.getByRole('dialog');
    await invalido.getByLabel(/^Placa/).fill('XX');
    await invalido.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(invalido.getByText('Placa inválida.')).toBeVisible();
    await invalido.getByRole('button', { name: 'Cancelar' }).click();

    // --- editar ---
    await page
      .locator('li', { hasText: placa })
      .first()
      .getByRole('button', { name: /^Editar/ })
      .click();
    const edicao = page.getByRole('dialog');
    await edicao.getByLabel(/^Situação/).selectOption('MAINTENANCE');
    await clicarEsperando(page, edicao.getByRole('button', { name: 'Salvar' }), '/vehicles/', {
      metodo: 'PATCH',
    });
    await expect(page.locator('li', { hasText: placa }).first()).toContainText('Manutenção');

    // --- odômetro: só avança ---
    await page
      .locator('li', { hasText: placa })
      .first()
      .getByRole('button', { name: /^Odômetro/ })
      .click();
    const odometro = page.getByRole('dialog');
    await odometro.getByLabel(/^Quilometragem/).fill(String(veiculo!.km + 250));
    await clicarEsperando(page, odometro.getByRole('button', { name: 'Registrar' }), '/km', {
      metodo: 'PATCH',
    });
    await expect(page.locator('li', { hasText: placa }).first()).toContainText(
      (veiculo!.km + 250).toLocaleString('pt-BR'),
    );

    // Valor MENOR precisa ser recusado pelo servidor, com a explicação na tela.
    await page
      .locator('li', { hasText: placa })
      .first()
      .getByRole('button', { name: /^Odômetro/ })
      .click();
    const retroceder = page.getByRole('dialog');
    await retroceder.getByLabel(/^Quilometragem/).fill('1');
    await clicarEsperando(page, retroceder.getByRole('button', { name: 'Registrar' }), '/km', {
      metodo: 'PATCH',
      statusMaximo: 999,
      statusEsperado: undefined,
    }).then(({ status }) => {
      expect(status, 'odômetro que retrocede não pode ser aceito').toBeGreaterThanOrEqual(400);
    });
    await expect(retroceder.getByRole('alert').first()).toBeVisible();
    await retroceder.getByRole('button', { name: 'Cancelar' }).click();

    // --- remover ---
    await page
      .locator('li', { hasText: placa })
      .first()
      .getByRole('button', { name: /^Remover/ })
      .click();
    const confirmar = page.getByRole('dialog');
    await expect(confirmar).toContainText(placa);
    await clicarEsperando(
      page,
      confirmar.getByRole('button', { name: 'Remover', exact: true }),
      '/vehicles/',
      { metodo: 'DELETE' },
    );

    await expect(page.locator('li', { hasText: placa })).toHaveCount(0);
    const restantes = await apiGet<PaginadoLeve<Veiculo>>(page, '/vehicles?perPage=100');
    expect(restantes.items.find((v) => v.plate === placa)).toBeFalsy();
  });
});

test.describe('Frota — motoristas', () => {
  test('cadastrar, editar e arquivar um motorista', async ({ page }) => {
    const id = sufixo();
    const nome = `E2E Motorista ${id}`;

    await page.goto('/app/frota');
    await page.getByRole('tab', { name: 'Motoristas' }).click();

    await page.getByRole('button', { name: 'Cadastrar motorista' }).first().click();
    const form = page.getByRole('dialog');
    await form.getByLabel(/^Nome/).fill(nome);
    await form.getByLabel(/^Turno/).selectOption('FULL');
    await form.getByLabel(/^Diária/).fill('180,00');
    await clicarEsperando(page, form.getByRole('button', { name: 'Cadastrar' }), '/drivers', {
      metodo: 'POST',
    });

    const cartao = page.locator('li', { hasText: nome }).first();
    await expect(cartao).toBeVisible();
    await expect(cartao).toContainText('Integral · diária R$ 180,00');
    await expect(cartao.getByText('Ativo')).toBeVisible();

    const lista = await apiGet<PaginadoLeve<Motorista>>(page, '/drivers?perPage=100');
    const motorista = lista.items.find((d) => d.name === nome);
    expect(motorista?.dailyRate.cents).toBe(18_000);

    // --- editar ---
    await cartao.getByRole('button', { name: new RegExp(`^Editar\\s*${nome}`) }).click();
    const edicao = page.getByRole('dialog');
    await edicao.getByLabel(/^Diária/).fill('205,50');
    await clicarEsperando(page, edicao.getByRole('button', { name: 'Salvar' }), '/drivers/', {
      metodo: 'PATCH',
    });
    await expect(page.locator('li', { hasText: nome }).first()).toContainText('R$ 205,50');

    // --- arquivar (o cadastro nunca é apagado) ---
    await page
      .locator('li', { hasText: nome })
      .first()
      .getByRole('button', { name: new RegExp(`^Arquivar\\s*${nome}`) })
      .click();
    const confirmar = page.getByRole('dialog');
    await expect(confirmar).toContainText(nome);
    await clicarEsperando(
      page,
      confirmar.getByRole('button', { name: 'Arquivar', exact: true }),
      '/archive',
      { metodo: 'POST' },
    );

    const arquivado = page.locator('li', { hasText: nome }).first();
    await expect(arquivado.getByText('Arquivado')).toBeVisible();
    // Arquivado não oferece mais o botão de arquivar.
    await expect(arquivado.getByRole('button', { name: /^Arquivar/ })).toHaveCount(0);

    const depois = await apiGet<PaginadoLeve<Motorista>>(page, '/drivers?perPage=100');
    expect(depois.items.find((d) => d.name === nome)?.status).toBe('ARCHIVED');
  });

  /**
   * A frota semeada cabe numa pagina so. A versao anterior deste teste
   * respondia a isso com `test.skip('paginacao NAO exercitada')` — honesto no
   * texto, mas o efeito era a paginacao nunca ter sido clicada em rodada
   * nenhuma, com a suite verde. Aqui o cenario e CRIADO: enchemos a frota
   * acima da pagina de 20, exercitamos a navegacao de verdade e devolvemos o
   * banco ao estado anterior no fim, inclusive se a asercao falhar.
   */
  test('a paginação da frota navega quando há mais de uma página', async ({ page }) => {
    const POR_PAGINA = 12; // igual ao `perPage` de `Fleet.tsx`; teto do plano PRO = 20.
    await page.goto('/app/frota');

    const antes = await apiGet<PaginadoLeve<Veiculo>>(page, '/vehicles?perPage=100');
    const faltam = POR_PAGINA + 1 - antes.items.length;
    const criados: string[] = [];

    try {
      for (let i = 0; i < faltam; i += 1) {
        const criado = await apiPost<Veiculo>(page, '/vehicles', {
          plate: placaAleatoria(),
          model: `E2E Paginacao ${sufixo()}`,
          capacity: 12,
          status: 'IDLE',
        });
        criados.push(criado.id);
      }

      await page.goto('/app/frota');
      await page.getByRole('tab', { name: 'Veículos' }).click();
      const proxima = page.getByRole('button', { name: 'Próxima' });
      await expect(proxima, 'com 13 veículos a segunda página precisa existir').toBeEnabled();

      await clicarEsperando(page, proxima, '/vehicles', { metodo: 'GET' });
      await expect(page.getByText(/Página 2 de/)).toBeVisible();

      // A segunda pagina precisa trazer conteudo, e nao a mesma lista de novo:
      // paginacao que devolve a pagina 1 com o rotulo "2" e um bug que so
      // aparece quando alguem procura um veiculo que sumiu.
      const p1 = await apiGet<PaginadoLeve<Veiculo>>(page, '/vehicles?page=1&perPage=12');
      const p2 = await apiGet<PaginadoLeve<Veiculo>>(page, '/vehicles?page=2&perPage=12');
      expect(p2.items.length, 'a página 2 não pode vir vazia').toBeGreaterThan(0);
      const repetidos = p2.items.filter((v) => p1.items.some((o) => o.id === v.id));
      expect(repetidos, 'a página 2 não pode repetir itens da página 1').toHaveLength(0);

      const anterior = page.getByRole('button', { name: 'Anterior' });
      await clicarEsperando(page, anterior, '/vehicles', { metodo: 'GET' });
      await expect(page.getByText(/Página 1 de/)).toBeVisible();
    } finally {
      for (const id of criados) await apiDelete(page, `/vehicles/${id}`);
    }
  });
});
