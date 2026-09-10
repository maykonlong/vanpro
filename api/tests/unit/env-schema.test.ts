import { describe, it, expect } from 'vitest';
import { envSchema } from '../../src/config/env';

/**
 * As regras que impedem o sistema de subir inseguro.
 *
 * Cada uma delas existe por causa de um incidente conhecido — segredo de
 * exemplo publicado no GitHub, banco falando em claro entre contêineres, chave
 * de criptografia trocada sem lista de leitura. Enquanto o schema ficou
 * privado, nenhuma tinha prova: a única forma de exercitá-las era subir o
 * processo com o ambiente errado e ver se ele morria, e nenhum teste fazia
 * isso. Regra de segurança que nunca falhou em teste não está verificada.
 */

/** Ambiente mínimo que passa. Cada teste estraga UM campo por vez. */
function ambienteValido(extra: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    APP_ENV: 'local',
    DATABASE_URL: 'postgresql://app:senha@localhost:5432/vanpro',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    PRISMA_FIELD_ENCRYPTION_KEY: `k1.aesgcm256.${'A'.repeat(43)}=`,
    ...extra,
  };
}

function erros(entrada: Record<string, string>): string[] {
  const r = envSchema.safeParse(entrada);
  if (r.success) return [];
  return r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('ambiente mínimo', () => {
  it('o conjunto mínimo é aceito e os padrões entram', () => {
    const r = envSchema.safeParse(ambienteValido());
    expect(r.success, JSON.stringify(erros(ambienteValido()))).toBe(true);
    if (r.success) {
      expect(r.data.PORT).toBe(3000);
      expect(r.data.APP_ENV).toBe('local');
      // Sem credencial, a integração não existe — e é isso que `features` lê.
      expect(r.data.ASAAS_API_KEY).toBeUndefined();
    }
  });

  it('variável opcional vazia conta como AUSENTE, não como preenchida inválida', () => {
    // O `docker compose` expande `${VAR:-}` para string vazia. Antes do
    // preprocessador, isso era lido como "preenchida, porém inválida" e o
    // contêiner abortava no boot por causa de uma integração desligada.
    const r = envSchema.safeParse(ambienteValido({ ASAAS_API_KEY: '', COOKIE_DOMAIN: '   ' }));
    expect(r.success, JSON.stringify(erros(ambienteValido({ ASAAS_API_KEY: '' })))).toBe(true);
    if (r.success) {
      expect(r.data.ASAAS_API_KEY).toBeUndefined();
      expect(r.data.COOKIE_DOMAIN).toBeUndefined();
    }
  });
});

describe('segredos', () => {
  it('segredo curto é recusado', () => {
    const e = erros(ambienteValido({ JWT_ACCESS_SECRET: 'curto' }));
    expect(e.join()).toContain('JWT_ACCESS_SECRET');
  });

  it('segredo de exemplo é recusado mesmo com tamanho suficiente', () => {
    // Foi assim que a versão original chegou ao GitHub: `super_secret_...`
    // como valor padrão em quatro arquivos.
    for (const prefixo of ['changeme', 'secret', 'password', 'super_secret']) {
      const valor = `${prefixo}${'x'.repeat(40)}`;
      const e = erros(ambienteValido({ JWT_REFRESH_SECRET: valor }));
      expect(e.join(), `"${prefixo}" precisa ser recusado`).toContain('JWT_REFRESH_SECRET');
    }
  });

  it('segredo ausente é recusado — não existe valor padrão', () => {
    const base = ambienteValido();
    delete base.JWT_ACCESS_SECRET;
    expect(erros(base).join()).toContain('JWT_ACCESS_SECRET');
  });
});

describe('chave de criptografia em repouso', () => {
  it('chave fora do formato é recusada', () => {
    for (const valor of ['', 'k1.aesgcm256.curta', 'abc', `k2.aesgcm256.${'A'.repeat(43)}=`]) {
      expect(
        erros(ambienteValido({ PRISMA_FIELD_ENCRYPTION_KEY: valor })).join(),
        `"${valor}" precisa ser recusada`,
      ).toContain('PRISMA_FIELD_ENCRYPTION_KEY');
    }
  });

  it('a lista de chaves antigas aceita várias, e recusa se UMA delas estiver quebrada', () => {
    const boa = `k1.aesgcm256.${'A'.repeat(43)}=`;
    const outra = `k1.aesgcm256.${'B'.repeat(43)}=`;

    expect(erros(ambienteValido({ PRISMA_FIELD_DECRYPTION_KEYS: `${boa}, ${outra}` }))).toEqual([]);

    // Uma chave inválida no meio da lista tornaria ilegível o acervo cifrado
    // com ela, e em silêncio: os campos passariam a exibir `v1.aesgcm256.…`.
    expect(
      erros(ambienteValido({ PRISMA_FIELD_DECRYPTION_KEYS: `${boa}, quebrada` })).join(),
    ).toContain('PRISMA_FIELD_DECRYPTION_KEYS');
  });
});

describe('banco', () => {
  it('SQLite é recusado explicitamente', () => {
    const e = erros(ambienteValido({ DATABASE_URL: 'file:./dev.db' }));
    expect(e.join()).toContain('DATABASE_URL');
  });

  it('URL que não é banco nenhum é recusada', () => {
    expect(erros(ambienteValido({ DATABASE_URL: 'não-é-url' })).join()).toContain('DATABASE_URL');
    expect(erros(ambienteValido({ DATABASE_URL: 'mysql://x:y@h:3306/d' })).join()).toContain(
      'PostgreSQL',
    );
  });
});

describe('produção exige mais', () => {
  const producao = (extra: Record<string, string> = {}) =>
    ambienteValido({
      APP_ENV: 'production',
      NODE_ENV: 'production',
      DATABASE_URL:
        'postgresql://app:senha@db:5432/vanpro?sslmode=require&sslaccept=strict&sslcert=/certs/ca.crt',
      WEBAUTHN_RP_ID: 'vanpro.com.br',
      FRONTEND_URL: 'https://vanpro.com.br',
      WEBAUTHN_ORIGIN: 'https://vanpro.com.br',
      ...extra,
    });

  it('o ambiente de produção bem formado passa', () => {
    expect(erros(producao())).toEqual([]);
  });

  it('banco sem TLS é recusado em produção', () => {
    const e = erros(producao({ DATABASE_URL: 'postgresql://app:senha@db:5432/vanpro' }));
    expect(e.join()).toContain('sslmode=require');
  });

  it('TLS sem verificação da outra ponta é recusado', () => {
    // Cifrado sem verificar certificado protege contra escuta passiva e contra
    // mais nada: quem se põe no caminho apresenta o próprio certificado.
    const e = erros(
      producao({ DATABASE_URL: 'postgresql://app:senha@db:5432/vanpro?sslmode=require' }),
    );
    expect(e.join()).toContain('sslaccept=strict');
  });

  it('`sslaccept=strict` sem âncora de confiança é recusado', () => {
    const e = erros(
      producao({
        DATABASE_URL: 'postgresql://app:senha@db:5432/vanpro?sslmode=require&sslaccept=strict',
      }),
    );
    expect(e.join()).toContain('âncora de confiança');
  });

  it('WEBAUTHN_RP_ID em localhost é recusado em produção', () => {
    const e = erros(producao({ WEBAUTHN_RP_ID: 'localhost' }));
    expect(e.join()).toContain('WEBAUTHN_RP_ID');
  });

  it('gateway ligado sem token de webhook é recusado', () => {
    // Webhook sem token é fatura de terceiro sendo quitada por qualquer um.
    const e = erros(producao({ ASAAS_API_KEY: 'chave-real-do-gateway' }));
    expect(e.join()).toContain('ASAAS_WEBHOOK_TOKEN');
  });

  it('gateway ligado COM token passa', () => {
    expect(
      erros(producao({ ASAAS_API_KEY: 'chave-real-do-gateway', ASAAS_WEBHOOK_TOKEN: 't'.repeat(32) })),
    ).toEqual([]);
  });

  it('em local as exigências de produção não se aplicam — senão ninguém desenvolve', () => {
    expect(erros(ambienteValido({ APP_ENV: 'local', WEBAUTHN_RP_ID: 'localhost' }))).toEqual([]);
  });
});
