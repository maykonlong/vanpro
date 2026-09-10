import { describe, it, expect } from 'vitest';
import { umaRodadaPorVez } from '../../src/lib/uma-rodada-por-vez';

/** Promessa que so resolve quando o teste mandar. */
function represa<T = void>() {
  let liberar!: (v: T) => void;
  let romper!: (e: unknown) => void;
  const promessa = new Promise<T>((res, rej) => {
    liberar = res;
    romper = rej;
  });
  return { promessa, liberar, romper };
}

describe('uma rodada por vez', () => {
  it('a segunda chamada durante a primeira nao executa nada', async () => {
    let execucoes = 0;
    const porta = represa();
    const rodada = umaRodadaPorVez(async () => {
      execucoes += 1;
      await porta.promessa;
      return 'pronto';
    });

    const primeira = rodada();
    const segunda = rodada();
    const terceira = rodada();

    // Sem esperar nada: as duas ultimas ja devolveram, e a primeira segue presa.
    await expect(segunda).resolves.toBeUndefined();
    await expect(terceira).resolves.toBeUndefined();
    expect(execucoes).toBe(1);

    porta.liberar();
    await expect(primeira).resolves.toBe('pronto');
    expect(execucoes).toBe(1);
  });

  it('depois que a rodada termina, a proxima roda normalmente', async () => {
    let execucoes = 0;
    const rodada = umaRodadaPorVez(async () => {
      execucoes += 1;
    });

    await rodada();
    await rodada();
    await rodada();

    expect(execucoes).toBe(3);
  });

  /**
   * A parte que importa. Sem o `finally`, a primeira falha de banco trancaria o
   * job ate o processo reiniciar — e sem log nenhum, porque ninguem chegaria a
   * executar de novo para falhar de novo.
   */
  it('rodada que lanca solta a trava', async () => {
    let execucoes = 0;
    const rodada = umaRodadaPorVez(async () => {
      execucoes += 1;
      throw new Error('banco fora');
    });

    await expect(rodada()).rejects.toThrow('banco fora');
    await expect(rodada()).rejects.toThrow('banco fora');
    expect(execucoes).toBe(2);
  });

  it('a rejeicao da rodada atravessa sem virar undefined', async () => {
    const porta = represa();
    const rodada = umaRodadaPorVez(async () => {
      await porta.promessa;
    });

    const primeira = rodada();
    const segunda = rodada();

    porta.romper(new Error('estourou'));

    await expect(primeira).rejects.toThrow('estourou');
    // A chamada engolida devolve undefined, nao a rejeicao da outra: quem
    // perdeu o tick nao tem erro a reportar.
    await expect(segunda).resolves.toBeUndefined();
  });

  it('argumentos e valor de retorno atravessam intactos', async () => {
    const rodada = umaRodadaPorVez(async (a: number, b: string) => `${b}:${a * 2}`);
    await expect(rodada(21, 'x')).resolves.toBe('x:42');
  });

  it('cada rotina tem a propria trava', async () => {
    const portaA = represa();
    let execucoesB = 0;

    const a = umaRodadaPorVez(async () => {
      await portaA.promessa;
    });
    const b = umaRodadaPorVez(async () => {
      execucoesB += 1;
    });

    const emVoo = a();
    await b();
    // A purga LGPD presa nao pode impedir a suspensao de trials de rodar.
    expect(execucoesB).toBe(1);

    portaA.liberar();
    await emVoo;
  });
});
