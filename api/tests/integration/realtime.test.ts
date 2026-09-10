import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { runUnscoped } from '../../src/lib/request-context';
import {
  autenticarHandshake,
  podePublicarPosicao,
  posicaoValida,
  veiculoDaEmpresa,
} from '../../src/realtime/server';
import { cenarioDuasEmpresas, autenticar, criarUsuario, type Empresa } from '../helpers/factory';

/**
 * Tempo real: quem pode acompanhar a van, e quem pode dizer onde ela esta.
 *
 * A versao anterior do socket aceitava qualquer conexao e deixava o CLIENTE
 * escolher a sala: bastava o endereco do socket para acompanhar a van de
 * qualquer empresa e ver a posicao das criancas ao vivo. O codigo foi
 * corrigido, mas ficou sem teste nenhum — 0% de cobertura no arquivo — o que
 * significa que a correcao mais sensivel do produto vivia sem prova.
 *
 * Estes testes exercitam as decisoes reais do handshake e das salas.
 */

let alfa: Empresa;
let beta: Empresa;

async function cookieDeLogin(email: string): Promise<string> {
  const c = await autenticar(email);
  // `Cliente` guarda os cookies para as proximas chamadas; o handshake do
  // socket recebe exatamente a mesma string.
  return (c as unknown as { cookies: string[] }).cookies.join('; ');
}

async function criarVeiculo(companyId: string, plate: string) {
  return runUnscoped('fixture', () =>
    prisma.vehicle.create({
      data: { companyId, plate, model: 'Van de teste', capacity: 15, status: 'IDLE' },
    }),
  );
}

beforeEach(async () => {
  const cenario = await cenarioDuasEmpresas();
  alfa = cenario.alfa;
  beta = cenario.beta;
  await criarUsuario(alfa, 'DRIVER', 'motorista.alfa@teste.com.br');
  await criarUsuario(alfa, 'PARENT', 'mae.alfa@teste.com.br');
});

describe('handshake do socket', () => {
  it('conexao sem cookie nenhum e recusada', async () => {
    const r = await autenticarHandshake(undefined);
    expect(r.ok).toBe(false);
  });

  it('cookie com token inventado e recusado', async () => {
    const r = await autenticarHandshake('access_token=nao.e.um.jwt');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('não autenticado');
  });

  it('sessao valida entra e traz a empresa da SESSAO', async () => {
    const cookie = await cookieDeLogin('dono.alfa@teste.com.br');
    const r = await autenticarHandshake(cookie);

    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) {
      expect(r.auth.tenantId).toBe(alfa.id);
      expect(r.auth.role).toBe('OWNER');
    }
  });

  it('sessao revogada nao abre socket — logout precisa derrubar o tempo real', async () => {
    const cookie = await cookieDeLogin('dono.alfa@teste.com.br');
    expect((await autenticarHandshake(cookie)).ok).toBe(true);

    await runUnscoped('fixture', () =>
      prisma.session.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } }),
    );

    const depois = await autenticarHandshake(cookie);
    expect(depois.ok).toBe(false);
    if (!depois.ok) expect(depois.motivo).toBe('sessão encerrada');
  });

  it('sessao expirada nao abre socket', async () => {
    const cookie = await cookieDeLogin('dono.alfa@teste.com.br');
    await runUnscoped('fixture', () =>
      prisma.session.updateMany({
        where: { revokedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      }),
    );

    expect((await autenticarHandshake(cookie)).ok).toBe(false);
  });

  it('cookie malformado nao derruba o handshake — so recusa', async () => {
    for (const entrada of ['', 'lixo', 'a=b; ; c', 'access_token=']) {
      const r = await autenticarHandshake(entrada);
      expect(r.ok).toBe(false);
    }
  });
});

describe('salas de veiculo', () => {
  it('a van da propria empresa e aceita', async () => {
    const van = await criarVeiculo(alfa.id, 'AAA1B23');
    expect(await veiculoDaEmpresa(van.id, alfa.id)).toBe(true);
  });

  it('a van de outra empresa e recusada — era exatamente o buraco antigo', async () => {
    const vanDaBeta = await criarVeiculo(beta.id, 'BBB2C34');
    expect(await veiculoDaEmpresa(vanDaBeta.id, alfa.id)).toBe(false);
  });

  it('id que nao existe e recusado sem erro', async () => {
    expect(await veiculoDaEmpresa('00000000-0000-4000-8000-000000000000', alfa.id)).toBe(false);
  });
});

describe('quem publica posicao', () => {
  it('motorista, dono e gestor publicam', () => {
    for (const papel of ['DRIVER', 'OWNER', 'MANAGER']) {
      expect(podePublicarPosicao(papel)).toBe(true);
    }
  });

  it('responsavel, monitor e admin de plataforma NAO publicam', () => {
    // Responsavel acompanha; se pudesse publicar, poderia mentir sobre onde a
    // van esta para quem confia no mapa.
    for (const papel of ['PARENT', 'ASSISTANT', 'SUPER_ADMIN', '']) {
      expect(podePublicarPosicao(papel)).toBe(false);
    }
  });
});

describe('validacao da coordenada', () => {
  const van = '11111111-1111-4111-8111-111111111111';

  it('aceita coordenada plausivel', () => {
    expect(posicaoValida({ vehicleId: van, latitude: -23.55, longitude: -46.63 })).toBe(true);
  });

  it('recusa fora do intervalo geografico', () => {
    expect(posicaoValida({ vehicleId: van, latitude: 91, longitude: 0 })).toBe(false);
    expect(posicaoValida({ vehicleId: van, latitude: 0, longitude: 181 })).toBe(false);
  });

  it('recusa tipo errado, ausencia e id que nao e uuid', () => {
    expect(posicaoValida(null)).toBe(false);
    expect(posicaoValida({})).toBe(false);
    expect(posicaoValida({ vehicleId: 'x', latitude: 0, longitude: 0 })).toBe(false);
    expect(posicaoValida({ vehicleId: van, latitude: '-23.5', longitude: -46.6 })).toBe(false);
    expect(posicaoValida({ vehicleId: van, latitude: -23.5 })).toBe(false);
  });
});

describe('handshake e sala combinados', () => {
  it('o responsavel entra, mas nao alcanca a van de outra frota', async () => {
    const cookie = await cookieDeLogin('mae.alfa@teste.com.br');
    const r = await autenticarHandshake(cookie);
    expect(r.ok).toBe(true);

    const vanDaBeta = await criarVeiculo(beta.id, 'CCC3D45');
    if (r.ok) {
      expect(r.auth.tenantId).toBe(alfa.id);
      expect(await veiculoDaEmpresa(vanDaBeta.id, r.auth.tenantId!)).toBe(false);
      expect(podePublicarPosicao(r.auth.role)).toBe(false);
    }
  });

  it('o motorista entra e publica na van da propria frota', async () => {
    const cookie = await cookieDeLogin('motorista.alfa@teste.com.br');
    const r = await autenticarHandshake(cookie);
    expect(r.ok, JSON.stringify(r)).toBe(true);

    const van = await criarVeiculo(alfa.id, 'DDD4E56');
    if (r.ok) {
      expect(podePublicarPosicao(r.auth.role)).toBe(true);
      expect(await veiculoDaEmpresa(van.id, r.auth.tenantId!)).toBe(true);
      expect(posicaoValida({ vehicleId: van.id, latitude: -23.56, longitude: -46.65 })).toBe(true);
    }
  });
});
