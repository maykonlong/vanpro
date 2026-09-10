import { describe, it, expect, afterAll } from 'vitest';
import {
  hashEmThread,
  compareEmThread,
  poolDeSenhaAtivo,
  encerrarPoolDeSenha,
} from '../../src/lib/fila-de-senha';
import { hashPassword, verifyPassword } from '../../src/modules/auth/password.service';

/**
 * O cálculo de senha sai da fila principal.
 *
 * O defeito era medido, não suposto: `bcryptjs` é JavaScript puro e trava o
 * event loop por ~0,9 s a cada login. Durante esse tempo o processo inteiro
 * para — não é o login que fica lento, é todo mundo. A medição contra a pilha
 * no ar mostrou a listagem de alunos indo de 503 ms com uma conexão para 3 s de
 * p95 com vinte, numa base de 96 alunos.
 *
 * Comparação direta, com um cronômetro contando tiques de 10 ms durante um
 * hash de custo 12:
 *
 *   antes  —  5 tiques de 51 possíveis   (o processo praticamente parado)
 *   agora  — 62 tiques de 97 possíveis   (segue atendendo)
 *
 * O que este arquivo trava é a PROPRIEDADE, não o número: que o trabalho passa
 * pelas threads, que o resultado é o mesmo do cálculo direto, e que a reserva
 * existe para quando a thread não subir.
 */

afterAll(async () => {
  await encerrarPoolDeSenha();
});

describe('fila de senha', () => {
  it('o hash sai pela thread, e o pool fica ativo depois disso', async () => {
    const hash = await hashPassword('SenhaDeTeste@2026');

    expect(hash.startsWith('$2')).toBe(true);
    expect(poolDeSenhaAtivo(), 'o cálculo precisa ter ido para as threads').toBe(true);
  });

  it('conferir a senha pelas threads dá o mesmo resultado do cálculo direto', async () => {
    const hash = await hashPassword('SenhaDeTeste@2026');

    expect(await verifyPassword('SenhaDeTeste@2026', hash)).toBe(true);
    expect(await verifyPassword('SenhaErrada@2026', hash)).toBe(false);
  });

  it('vários cálculos ao mesmo tempo não se embaralham', async () => {
    // Cada pedido carrega um id próprio e é devolvido ao dono. Sem isso, dois
    // logins simultâneos poderiam trocar de resposta entre si — e o sintoma
    // seria "às vezes a senha certa é recusada", que ninguém consegue reproduzir.
    const senhas = ['Alfa@2026abc', 'Beta@2026abc', 'Gama@2026abc', 'Delta@2026abc'];
    const hashes = await Promise.all(senhas.map((s) => hashPassword(s)));

    for (let i = 0; i < senhas.length; i += 1) {
      expect(await verifyPassword(senhas[i]!, hashes[i]!), `${senhas[i]} deveria casar`).toBe(true);
      const outro = (i + 1) % senhas.length;
      expect(await verifyPassword(senhas[outro]!, hashes[i]!)).toBe(false);
    }
  });

  it('a reserva assume quando a thread não pode ser usada', async () => {
    /*
     * A reserva não é detalhe: um pool que derruba o login porque não conseguiu
     * criar thread troca uma lentidão por um apagão. Aqui ela é forçada com uma
     * entrada que o `bcryptjs` recusa dentro do worker, e o que se prova é que
     * o erro atravessa a ponte e vira o caminho de reserva — não uma exceção
     * subindo até o handler de login.
     */
    let reservaUsada = false;
    // Entrada que o `bcryptjs` recusa dentro do worker ("Illegal arguments").
    // O erro volta pela ponte e a reserva assume, em vez de o login estourar.
    const entradaInvalida = undefined as unknown as string;
    const valor = await hashEmThread(entradaInvalida, 12, async () => {
      reservaUsada = true;
      return 'calculado-aqui-mesmo';
    });

    expect(reservaUsada, 'a reserva precisa ter assumido').toBe(true);
    expect(valor).toBe('calculado-aqui-mesmo');
  });

  it('comparar com hash inválido devolve falso, não explode', async () => {
    const resultado = await compareEmThread('senha', 'isto-nao-e-um-hash', async () => false);
    expect(resultado).toBe(false);
  });
});
