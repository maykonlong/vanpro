import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';

import {
  apiGet,
  testeComo,
  centavos,
  clicarEsperando,
  escolherPrimeiraOpcao,
  sufixo,
  telaNaoFicaMuda,
} from './helpers';

/**
 * Proprietário: painel e financeiro.
 *
 * O critério aqui não é "a tela abriu". É: o filtro de período REFAZ a
 * consulta, a despesa lançada MUDA o DRE, a baixa MUDA a situação da
 * mensalidade — e a exclusão desfaz tudo isso, para a rodada seguinte
 * encontrar o banco como o encontrou.
 */

const test = testeComo('OWNER');

/**
 * Abre o financeiro direto.
 *
 * A navegação pelo menu já é coberta no teste do menu lateral; repeti-la aqui
 * só carregaria o painel inteiro (sete consultas) antes de cada teste do
 * financeiro, e a suíte tem um teto de requisições por usuário a respeitar.
 */
async function abrirFinanceiro(page: Page): Promise<void> {
  await page.goto('/app/financeiro');
  await expect(page.getByRole('heading', { name: 'Financeiro', level: 1 })).toBeVisible();
}

async function aba(page: Page, nome: string): Promise<void> {
  await page.getByRole('tab', { name: nome, exact: true }).click();
}

/** Lê o total de despesas do DRE, em centavos. */
async function despesaDoDre(page: Page): Promise<number> {
  await aba(page, 'Resultado');
  const alvo = page.getByTestId('dre-despesa');
  await expect(alvo).toBeVisible();
  await expect(alvo).not.toHaveText('');
  return centavos(await alvo.innerText());
}

test.describe('Painel', () => {
  test('abre nas duas respostas do dono e os atalhos levam às telas certas', async ({ page }) => {
    await page.goto('/app/painel');
    await expect(page.getByRole('heading', { name: /^Olá, Roberto/ })).toBeVisible();
    await telaNaoFicaMuda(page);

    // Resposta 1: o resultado do mês. Resposta 2: quanto está atrasado.
    await expect(page.getByText(/Como está .+, do dia 1º até hoje/)).toBeVisible();
    await expect(page.getByText('Quanto está atrasado')).toBeVisible();

    // Blocos de apoio precisam ter carregado dado real, não ficar em esqueleto.
    await expect(page.getByRole('heading', { name: 'Frota', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Alertas da equipe' })).toBeVisible();
    await expect(page.getByText(/veículos · \d+ em rota agora/)).toBeVisible();

    await page.getByRole('link', { name: /Abrir o financeiro/i }).click();
    await expect(page).toHaveURL(/\/app\/financeiro/);

    await page.goto('/app/painel');
    await page.getByRole('link', { name: /^Gerenciar/ }).click();
    await expect(page).toHaveURL(/\/app\/frota/);

    await page.goto('/app/painel');
    await page.getByRole('link', { name: /^Ver tudo/ }).click();
    await expect(page).toHaveURL(/\/app\/crm/);
  });

  test('o menu lateral leva a cada área do proprietário', async ({ page }) => {
    await page.goto('/app/painel');
    const destinos: Array<[string, RegExp]> = [
      ['Painel', /\/app\/painel/],
      ['Financeiro', /\/app\/financeiro/],
      ['Alunos', /\/app\/alunos/],
      ['Frota', /\/app\/frota/],
      ['Equipe', /\/app\/equipe/],
      ['Fretamentos', /\/app\/fretamentos/],
      ['Relacionamento', /\/app\/crm/],
      ['Privacidade e auditoria', /\/app\/privacidade-auditoria/],
      ['Configurações', /\/app\/configuracoes/],
    ];
    const menu = page.getByRole('navigation', { name: 'Navegação principal' }).first();
    for (const [texto, url] of destinos) {
      await menu.getByRole('link', { name: texto, exact: true }).click();
      await expect(page).toHaveURL(url);
      await telaNaoFicaMuda(page);
    }
  });
});

test.describe('Financeiro', () => {
  test('as quatro abas trocam de conteúdo e o resultado traz DRE e ROI', async ({ page }) => {
    await abrirFinanceiro(page);

    await aba(page, 'Resultado');
    await expect(page.getByTestId('dre-receita')).toBeVisible();
    await expect(page.getByTestId('dre-despesa')).toBeVisible();
    await expect(page.getByTestId('dre-lucro')).toBeVisible();
    await expect(page.getByRole('heading', { name: /ROI por veículo/i })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();

    await aba(page, 'Mensalidades');
    await expect(page.getByRole('button', { name: /Lançar mensalidade/i }).first()).toBeVisible();

    await aba(page, 'Despesas');
    await expect(page.getByRole('button', { name: /Lançar despesa/i }).first()).toBeVisible();

    await aba(page, 'Faturas');
    // O gateway não tem credencial neste ambiente: a tela precisa DIZER isso,
    // e não oferecer um botão que tomaria 503 depois do formulário todo.
    await expect(page.getByRole('heading', { name: /Cobrança Pix não está configurada/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Gerar cobrança Pix/i })).toHaveCount(0);
  });

  test('o filtro de período refaz a consulta e muda o que a tela mostra', async ({ page }) => {
    await abrirFinanceiro(page);
    await aba(page, 'Despesas');

    // Período antigo, garantidamente sem lançamento: a tela precisa dizer isso
    // com orientação, não ficar em branco.
    const respostaVazia = page.waitForResponse(
      (r) => r.url().includes('/financial/expenses') && r.url().includes('from=2019-01-01'),
    );
    await page.getByLabel('De', { exact: true }).fill('2019-01-01');
    await page.getByLabel('Até', { exact: true }).fill('2019-01-31');
    expect((await respostaVazia).status()).toBeLessThan(400);
    await expect(page.getByText('Nenhuma despesa no período')).toBeVisible();

    // Volta ao mês corrente e o conteúdo reaparece.
    const hoje = new Date();
    const primeiro = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
    const ate = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    const respostaCheia = page.waitForResponse(
      (r) => r.url().includes('/financial/expenses') && r.url().includes(`from=${primeiro}`),
    );
    await page.getByLabel('De', { exact: true }).fill(primeiro);
    await page.getByLabel('Até', { exact: true }).fill(ate);
    expect((await respostaCheia).status()).toBeLessThan(400);
    await expect(page.getByText('Nenhuma despesa no período')).toHaveCount(0);
  });

  test('lançar despesa muda o DRE, e excluir devolve o DRE ao valor anterior', async ({ page }) => {
    await abrirFinanceiro(page);

    const antes = await despesaDoDre(page);
    const descricao = `E2E despesa ${sufixo()}`;

    await aba(page, 'Despesas');
    await page.getByRole('button', { name: /Lançar despesa/i }).first().click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    await dialogo.getByLabel(/^Descrição/).fill(descricao);
    await dialogo.getByLabel(/^Valor \(R\$\)/).fill('123,45');
    await dialogo.getByLabel(/^Categoria/).selectOption('FUEL');

    await clicarEsperando(page, dialogo.getByRole('button', { name: 'Lançar despesa' }), '/financial/expenses', {
      metodo: 'POST',
    });

    // Efeito 1: o dado está mesmo na lista relida do servidor.
    await expect(page.getByText(descricao)).toBeVisible();

    // Efeito 2: o DRE do período mudou exatamente no valor lançado.
    const depois = await despesaDoDre(page);
    expect(depois - antes, 'o DRE precisa somar os R$ 123,45 lançados').toBe(12_345);

    // Desfazer: excluir com confirmação nomeando o item.
    await aba(page, 'Despesas');
    const cartao = page.locator('li', { hasText: descricao }).first();
    await cartao.getByRole('button', { name: /^Excluir/ }).click();
    const confirmar = page.getByRole('dialog');
    await expect(confirmar).toContainText(descricao);
    await clicarEsperando(
      page,
      confirmar.getByRole('button', { name: 'Excluir', exact: true }),
      '/financial/expenses/',
      { metodo: 'DELETE' },
    );

    await expect(page.getByText(descricao)).toHaveCount(0);
    expect(await despesaDoDre(page), 'excluída a despesa, o DRE volta ao que era').toBe(antes);
  });

  test('o filtro de categoria da despesa consulta o servidor com o filtro certo', async ({
    page,
  }) => {
    await abrirFinanceiro(page);
    await aba(page, 'Despesas');

    const espera = page.waitForResponse(
      (r) => r.url().includes('/financial/expenses') && r.url().includes('category=TAXES'),
    );
    await page.getByLabel(/^Categoria/).selectOption('TAXES');
    expect((await espera).status()).toBeLessThan(400);
  });

  test('lançar mensalidade e dar baixa muda a situação de verdade', async ({ page }) => {
    await abrirFinanceiro(page);
    await aba(page, 'Mensalidades');

    // Valor simbólico e único: o banco é compartilhado e o lançamento fica.
    const centavosDoTeste = 100 + Math.floor(Math.random() * 800);
    const valor = `${(centavosDoTeste / 100).toFixed(2).replace('.', ',')}`;

    await page.getByRole('button', { name: /Lançar mensalidade/i }).first().click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();

    await escolherPrimeiraOpcao(dialogo.getByLabel(/^Aluno/));
    await dialogo.getByLabel(/^Valor \(R\$\)/).fill(valor);

    await clicarEsperando(
      page,
      dialogo.getByRole('button', { name: 'Lançar', exact: true }),
      '/financial/transactions',
      { metodo: 'POST' },
    );

    // Só as em aberto: prova que o filtro consulta o servidor.
    const emAberto = page.waitForResponse(
      (r) => r.url().includes('/financial/transactions') && r.url().includes('paid=false'),
    );
    await page.getByLabel(/^Situação/).selectOption('false');
    expect((await emAberto).status()).toBeLessThan(400);

    const linha = page.locator('li', { hasText: `R$ ${valor}` }).first();
    await expect(linha).toBeVisible();
    await expect(linha.getByText('Em aberto')).toBeVisible();

    await linha.getByRole('button', { name: /Dar baixa/i }).click();
    const confirmar = page.getByRole('dialog');
    await expect(confirmar).toContainText(`R$ ${valor}`);
    await clicarEsperando(
      page,
      confirmar.getByRole('button', { name: /Confirmar recebimento/i }),
      '/settle',
      { metodo: 'POST' },
    );

    // Efeito real: some da lista "em aberto"...
    await expect(page.locator('li', { hasText: `R$ ${valor}` })).toHaveCount(0);

    // ...e aparece na lista "pagas", relida do servidor.
    const pagas = page.waitForResponse(
      (r) => r.url().includes('/financial/transactions') && r.url().includes('paid=true'),
    );
    await page.getByLabel(/^Situação/).selectOption('true');
    expect((await pagas).status()).toBeLessThan(400);
    const paga = page.locator('li', { hasText: `R$ ${valor}` }).first();
    await expect(paga).toBeVisible();
    await expect(paga.getByText('Paga')).toBeVisible();
  });

  test('a paginação das mensalidades navega e volta', async ({ page }) => {
    await abrirFinanceiro(page);
    await aba(page, 'Mensalidades');

    // O seed cria seis meses de mensalidades para 18 alunos: mais de uma pagina
    // sempre. Asercao em vez de `test.skip` condicional — pulo que depende do
    // volume de dados e um teste que se auto-aprova no dia em que os dados
    // somem.
    const proxima = page.getByRole('button', { name: 'Próxima' });
    await expect(proxima).toBeVisible();
    await expect(proxima, 'seis meses de mensalidades passam de uma página').toBeEnabled();

    await clicarEsperando(page, proxima, '/financial/transactions', { metodo: 'GET' });
    await expect(page.getByText(/Página 2 de/)).toBeVisible();

    await clicarEsperando(page, page.getByRole('button', { name: 'Anterior' }), '/financial/transactions', {
      metodo: 'GET',
    });
    await expect(page.getByText(/Página 1 de/)).toBeVisible();
  });
});

test.describe('Folha e exportação', () => {
  test('o resultado avisa quando há diária apurada e não lançada', async ({ page }) => {
    /*
     * O lucro do DRE é de caixa e só conta despesa lançada — o que reconcilia
     * com o extrato e produzia um número sistematicamente otimista, porque a
     * diária do motorista só entrava se alguém lembrasse de digitar.
     *
     * O seed tem ponto batido e folha lançada; qual dos dois é maior depende do
     * mês. Por isso o teste não fixa o valor: ele confere que os dois números
     * existem, que a conta fecha, e que o aviso aparece exatamente quando falta
     * lançamento — nunca "às vezes".
     */
    await abrirFinanceiro(page);
    await aba(page, 'Resultado');

    const dre = await apiGet<{
      lucroLiquido: { cents: number };
      lucroConsiderandoFolhaApurada: { cents: number };
      folha: {
        apuradaPeloPonto: { cents: number };
        lancadaComoDespesa: { cents: number };
        naoLancada: { cents: number };
        diasApurados: number;
      };
    }>(page, '/financial/dre');

    // A conta que sustenta o aviso.
    expect(dre.folha.naoLancada.cents).toBe(
      Math.max(0, dre.folha.apuradaPeloPonto.cents - dre.folha.lancadaComoDespesa.cents),
    );
    expect(dre.lucroConsiderandoFolhaApurada.cents).toBe(
      dre.lucroLiquido.cents - dre.folha.naoLancada.cents,
    );

    const aviso = page.getByText(/Faltam .* de diárias no resultado/);
    if (dre.folha.naoLancada.cents > 0) {
      await expect(aviso).toBeVisible();
      // Quem deve, e quanto: sem isso o aviso é um número sem endereço.
      await expect(page.getByTestId('dre-folha-motoristas')).toBeVisible();
    } else {
      await expect(aviso).toHaveCount(0);
    }
  });

  test('exportar para planilha baixa um CSV com o período pedido', async ({ page }) => {
    await abrirFinanceiro(page);
    await aba(page, 'Resultado');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar para planilha' }).click();
    const arquivo = await download;

    expect(arquivo.suggestedFilename()).toMatch(/^vanpro-financeiro-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv$/);

    const caminho = await arquivo.path();
    const conteudo = await readFile(caminho, 'utf8');

    // BOM primeiro: sem ele o Excel em português abre "José" como "JosÃ©".
    expect(conteudo.charCodeAt(0)).toBe(0xfeff);
    const linhas = conteudo.slice(1).split('\r\n');
    expect(linhas[0]).toBe('data;tipo;categoria;descricao;competencia;valor');
    expect(linhas.length, 'o período do seed tem lançamentos').toBeGreaterThan(1);

    // Vírgula decimal e despesa negativa: aberto na planilha, a coluna soma
    // sozinha e dá o resultado do período.
    for (const linha of linhas.slice(1).filter(Boolean)) {
      expect(linha.split(';').pop()).toMatch(/^-?\d+,\d{2}$/);
    }
    expect(linhas.some((l) => l.includes(';DESPESA;'))).toBe(true);
  });
});
