import { expect, test as base, type Page } from '@playwright/test';

import {
  alvosDeToqueGrandes,
  barraInferior,
  contextoComo,
  pouparCotaDeLogin,
  testeComo,
  focoVisivel,
  semRolagemHorizontal,
  telaNaoFicaMuda,
} from './helpers';

/**
 * Acessibilidade e celular.
 *
 * As regras aqui não são estéticas. Rolagem horizontal em 375 px esconde
 * coluna de tabela; alvo menor que 44 px erra o toque de quem está de pé com a
 * van ligada; foco invisível deixa quem navega por teclado sem saber onde
 * está. São falhas de uso, e cada uma é medida contra o produto real.
 */

const CELULAR = { width: 375, height: 812 };

/**
 * TODO controle tocável do conteúdo — não só o que tem `role="button"`.
 *
 * Medir apenas `getByRole('button')` deixaria de fora justamente os filtros do
 * `Segmented`, que são `role="radio"`, e são eles que o motorista toca com a
 * van andando. Alvo que escapa da medição é alvo que ninguém garante.
 */
function alvosDaTela(page: Page) {
  return page.locator('main').locator('button, a[href], select, input:not([type="hidden"])');
}

async function conferirTela(page: Page, rota: string): Promise<void> {
  await page.goto(rota);
  /*
   * Espera a tela DE VERDADE, e não o esqueleto.
   *
   * O pedaço da página desce sob demanda e, enquanto desce, o `main` já tem
   * texto ("Carregando conteúdo…"). Medir aí acharia zero botão e aprovaria a
   * tela sem ter olhado para ela — o mesmo engano de "não mediu nada, logo
   * está tudo bem".
   */
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('main').getByText('Carregando conteúdo…')).toHaveCount(0);
  await telaNaoFicaMuda(page);
  await semRolagemHorizontal(page);
}

const test = testeComo('OWNER');

test.describe('375 px — gestão', () => {
  test.use({ viewport: CELULAR });

  test('nenhuma tela do proprietário rola na horizontal no celular', async ({ page }) => {
    test.setTimeout(120_000);
    for (const rota of [
      '/app/painel',
      '/app/financeiro',
      '/app/alunos',
      '/app/frota',
      '/app/equipe',
      '/app/fretamentos',
      '/app/crm',
      '/app/privacidade-auditoria',
      '/app/configuracoes',
    ]) {
      await conferirTela(page, rota);
    }
  });

  test('a tabela larga rola dentro do próprio contêiner, sem arrastar a página', async ({
    page,
  }) => {
    await page.goto('/app/financeiro');
    const tabela = page.getByRole('table');
    await expect(tabela).toBeVisible();

    // A tabela tem largura mínima maior que a tela — e é por isso que ela
    // precisa ter o próprio contêiner rolável.
    const rolavel = await tabela.evaluate((el) => {
      const caixa = el.parentElement as HTMLElement | null;
      if (!caixa) return null;
      return {
        conteudo: caixa.scrollWidth,
        visivel: caixa.clientWidth,
        overflow: getComputedStyle(caixa).overflowX,
      };
    });
    expect(rolavel, 'a tabela precisa estar dentro de um contêiner').not.toBeNull();
    expect(rolavel!.overflow, 'o contêiner da tabela precisa rolar sozinho').toBe('auto');
    await semRolagemHorizontal(page);
  });

  test('a barra inferior do celular navega e o "Mais" abre as demais áreas', async ({ page }) => {
    await page.goto('/app/painel');

    const barra = barraInferior(page);
    await expect(barra).toBeVisible();

    /*
     * No celular existe UMA navegação e só.
     *
     * O menu lateral do desktop continua no DOM, mas com `display:none` — e o
     * que interessa aqui é o que chega à árvore de acessibilidade: se as duas
     * barras aparecessem ao mesmo tempo, quem usa leitor de tela ouviria dois
     * marcos de navegação com o mesmo nome e o mesmo conteúdo.
     */
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toHaveCount(1);

    await barra.getByRole('link', { name: 'Alunos' }).click();
    await expect(page).toHaveURL(/\/app\/alunos/);

    // "Mais" é diálogo, e cada item leva a algum lugar e FECHA a folha.
    await barra.getByRole('button', { name: 'Mais' }).click();
    const folha = page.getByRole('dialog');
    await expect(folha).toBeVisible();
    await folha.getByRole('link', { name: 'Configurações' }).click();
    await expect(page).toHaveURL(/\/app\/configuracoes/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('375 px — motorista e monitor', () => {
  test.use({ viewport: CELULAR });

  /**
   * DEFEITO DE PRODUTO — estes dois testes falham de propósito.
   *
   * `Segmented` (em `web/src/components/ui/index.tsx`) desenha os filtros com
   * `min-h-[40px]`, abaixo dos 44 px que o próprio cabeçalho daquele arquivo
   * estabelece como piso ("Alvo de toque nunca abaixo de 44×44. O motorista usa
   * isto de pé, com a van ligada, com uma mão só."). São exatamente os controles
   * de turno e de situação nas telas do motorista e do monitor — as duas pessoas
   * para quem a regra foi escrita.
   *
   * Os testes NÃO foram afrouxados para 40 px: baixar a régua até o que o código
   * faz transforma o teste num carimbo.
   */
  test('a tela do motorista cabe no celular e tem alvos de 44 px', async ({ browser }) => {
    const contexto = await contextoComo(browser, 'DRIVER', { viewport: CELULAR });
    const page = await contexto.newPage();

    for (const rota of ['/app/rota', '/app/ponto', '/app/meus-ganhos']) {
      await conferirTela(page, rota);
      await alvosDeToqueGrandes(alvosDaTela(page));
    }

    // A barra inferior é o alcance do polegar: também precisa ser tocável.
    await alvosDeToqueGrandes(barraInferior(page).getByRole('link'), 44);

    await contexto.close();
  });

  test('a tela do monitor cabe no celular e tem alvos de 44 px', async ({ browser }) => {
    const contexto = await contextoComo(browser, 'ASSISTANT', { viewport: CELULAR });
    const page = await contexto.newPage();

    await conferirTela(page, '/app/embarque');
    await alvosDeToqueGrandes(alvosDaTela(page));
    await alvosDeToqueGrandes(barraInferior(page).getByRole('link'), 44);

    await contexto.close();
  });

  test('as telas do responsável cabem no celular', async ({ browser }) => {
    const contexto = await contextoComo(browser, 'PARENT', { viewport: CELULAR });
    const page = await contexto.newPage();

    for (const rota of ['/app/acompanhamento', '/app/faturas', '/app/privacidade']) {
      await conferirTela(page, rota);
    }
    await contexto.close();
  });
});

base.describe('Teclado e foco', () => {
  base.beforeEach(async ({ page }) => {
    await pouparCotaDeLogin(page);
  });

  base('dá para entrar no sistema sem tocar no mouse, com foco sempre visível', async ({ page }) => {
    await page.goto('/entrar');

    // Percorre a página até chegar no campo de e-mail, exigindo que TODO
    // elemento focado no caminho mostre onde o foco está.
    const rotulos: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const atual = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? `${el.tagName}:${el.getAttribute('name') ?? el.textContent?.trim().slice(0, 20)}` : '';
      });
      rotulos.push(atual);
      expect(await focoVisivel(page), `elemento sem foco visível: ${atual}`).toBe(true);
      if (atual.startsWith('INPUT:email')) break;
    }
    expect(rotulos.some((r) => r.startsWith('INPUT:email')), `não cheguei ao campo de e-mail: ${rotulos.join(' → ')}`).toBe(true);

    // Preenche e submete só com o teclado.
    await page.keyboard.type('quem.nao.existe@exemplo.com.br');
    await page.keyboard.press('Tab');
    expect(await focoVisivel(page)).toBe(true);
    await page.keyboard.type('SenhaQualquer#12345');

    const resposta = page.waitForResponse((r) => r.url().includes('/api/v1/auth/login'));
    await page.keyboard.press('Enter');
    // O Enter dentro do formulário precisa SUBMETER: sem isso, quem usa
    // teclado fica preso na tela sem entender por quê.
    expect((await resposta).status(), 'o Enter precisa enviar o formulário').toBeGreaterThan(0);
    await expect(page.getByRole('alert').first()).toBeVisible();
  });

  base('o atalho "pular para o conteúdo" aparece no foco e leva ao conteúdo', async ({ page }) => {
    await page.goto('/entrar');
    await page.keyboard.press('Tab');
    const atalho = page.getByRole('link', { name: 'Pular para o conteúdo' });
    await expect(atalho).toBeFocused();
    await expect(atalho).toBeVisible();
    await atalho.press('Enter');
    expect(await page.evaluate(() => window.location.hash)).toBe('#conteudo');
  });
});

test.describe('Diálogo', () => {

  test('o modal prende o foco, fecha no Esc e devolve o foco a quem o abriu', async ({ page }) => {
    await page.goto('/app/alunos');
    const abridor = page.getByRole('button', { name: 'Novo aluno' });
    await abridor.click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toHaveAttribute('aria-modal', 'true');

    // O foco entra no diálogo e não escapa para a página de trás.
    for (let i = 0; i < 25; i++) {
      const dentro = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        return dlg ? dlg.contains(document.activeElement) : false;
      });
      expect(dentro, 'o foco não pode passear pela página de trás do diálogo').toBe(true);
      await page.keyboard.press('Tab');
    }

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // E volta para o botão que abriu, e não para o topo da página.
    await expect(abridor).toBeFocused();
  });
});
