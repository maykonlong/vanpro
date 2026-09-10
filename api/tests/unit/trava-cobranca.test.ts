import { describe, it, expect } from 'vitest';
import {
  exigirModoSeguro,
  modoDoEndpoint,
  CobrancaBloqueada,
  VARIAVEL_LIBERACAO,
  VALOR_LIBERACAO,
} from '../../src/modules/financial/trava-cobranca';

const CHAVE = '$aact_chave_qualquer_com_tamanho_suficiente';
const SANDBOX = 'https://sandbox.asaas.com/api/v3';
const PRODUCAO = 'https://api.asaas.com/api/v3';

/**
 * O teste que importa aqui e o da liberacao: ele prova que a unica forma de
 * mover dinheiro de verdade fora de producao e alguem ter escrito a frase
 * exata. Se um dia `'true'` passar a servir, este arquivo tem de ficar vermelho.
 */
describe('trava de cobranca — leitura do endpoint', () => {
  const casos: Array<[string, string | undefined, ReturnType<typeof modoDoEndpoint>]> = [
    ['sandbox oficial', SANDBOX, 'sandbox'],
    ['producao oficial', PRODUCAO, 'producao'],
    ['host ausente', undefined, 'desconhecida'],
    ['url ilegivel', 'nao-e-url', 'desconhecida'],
    ['string vazia', '', 'desconhecida'],
    // Um `includes('asaas.com')` aprovaria este host, que nao e do Asaas.
    ['sufixo enganoso', 'https://api.asaas.com.atacante.net/api/v3', 'desconhecida'],
    // E um `includes('sandbox')` aprovaria este.
    ['prefixo enganoso', 'https://sandbox.atacante.net/api/v3', 'desconhecida'],
    ['host em caixa alta', 'https://API.ASAAS.COM/api/v3', 'producao'],
  ];

  for (const [nome, url, esperado] of casos) {
    it(`${nome} -> ${esperado}`, () => {
      expect(modoDoEndpoint(url)).toBe(esperado);
    });
  }
});

describe('trava de cobranca — tres estados', () => {
  it('sem credencial nao ha o que travar: a feature ja responde 503', () => {
    expect(exigirModoSeguro({ ASAAS_API_URL: PRODUCAO })).toBeNull();
    expect(exigirModoSeguro({ ASAAS_API_KEY: '   ', ASAAS_API_URL: PRODUCAO })).toBeNull();
  });

  it('sandbox libera sem cerimonia e declara que nao move dinheiro real', () => {
    expect(exigirModoSeguro({ ASAAS_API_KEY: CHAVE, ASAAS_API_URL: SANDBOX, APP_ENV: 'local' })).toEqual({
      modo: 'sandbox',
      real: false,
    });
  });

  it('endpoint desconhecido RECUSA — nunca assume seguro por omissao', () => {
    expect(() => exigirModoSeguro({ ASAAS_API_KEY: CHAVE, ASAAS_API_URL: 'https://gateway.interno/v3' })).toThrow(
      CobrancaBloqueada,
    );
    // Sem a variavel definida de nenhuma forma — o caso do .env incompleto.
    expect(() => exigirModoSeguro({ ASAAS_API_KEY: CHAVE })).toThrow(CobrancaBloqueada);
  });

  it('producao com APP_ENV=production sobe: e o ambiente onde cobrar e o certo', () => {
    expect(
      exigirModoSeguro({ ASAAS_API_KEY: CHAVE, ASAAS_API_URL: PRODUCAO, APP_ENV: 'production' }),
    ).toEqual({ modo: 'producao', real: true });
  });

  it('producao fora de producao LANCA — e o .env copiado para a maquina do dev', () => {
    const chamada = () =>
      exigirModoSeguro({ ASAAS_API_KEY: CHAVE, ASAAS_API_URL: PRODUCAO, APP_ENV: 'local' });
    expect(chamada).toThrow(CobrancaBloqueada);
    // A mensagem tem de ensinar a saida, senao o proximo passo de quem esta
    // travado e desligar a trava.
    expect(chamada).toThrow(new RegExp(VARIAVEL_LIBERACAO));
    expect(chamada).toThrow(/sandbox\.asaas\.com/);
  });

  it('APP_ENV ausente conta como fora de producao', () => {
    expect(() => exigirModoSeguro({ ASAAS_API_KEY: CHAVE, ASAAS_API_URL: PRODUCAO })).toThrow(
      CobrancaBloqueada,
    );
  });
});

describe('trava de cobranca — liberacao explicita', () => {
  const base = { ASAAS_API_KEY: CHAVE, ASAAS_API_URL: PRODUCAO, APP_ENV: 'staging' };

  it('a frase exata libera e declara que dinheiro real se move', () => {
    expect(exigirModoSeguro({ ...base, [VARIAVEL_LIBERACAO]: VALOR_LIBERACAO })).toEqual({
      modo: 'producao',
      real: true,
    });
  });

  it.each([
    ['true', 'true'],
    ['1', '1'],
    ['sim', 'sim'],
    ['yes', 'yes'],
    ['caixa diferente', VALOR_LIBERACAO.toUpperCase()],
    ['com espaco em volta', ` ${VALOR_LIBERACAO} `],
    ['vazio', ''],
  ])('valor herdado por acidente nao libera: %s', (_nome, valor) => {
    expect(() => exigirModoSeguro({ ...base, [VARIAVEL_LIBERACAO]: valor })).toThrow(CobrancaBloqueada);
  });

  it('a liberacao nao resgata endpoint desconhecido', () => {
    // Liberar "cobranca real" e dizer que se aceita cobrar; nao e dizer que se
    // sabe para onde a cobranca vai.
    expect(() =>
      exigirModoSeguro({
        ASAAS_API_KEY: CHAVE,
        ASAAS_API_URL: 'https://gateway.interno/v3',
        [VARIAVEL_LIBERACAO]: VALOR_LIBERACAO,
      }),
    ).toThrow(CobrancaBloqueada);
  });

  it('o erro carrega codigo estavel e status de erro de servidor', () => {
    try {
      exigirModoSeguro({ ...base });
      expect.unreachable('a trava deveria ter lancado');
    } catch (err) {
      expect(err).toBeInstanceOf(CobrancaBloqueada);
      const e = err as CobrancaBloqueada;
      expect(e.code).toBe('COBRANCA_BLOQUEADA');
      expect(e.status).toBe(500);
    }
  });
});
