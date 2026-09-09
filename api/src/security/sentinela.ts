import type { NextFunction, Request, Response } from 'express';
import { audit } from '../lib/audit';
import { logger } from '../lib/logger';
import { AppError } from '../lib/errors';
import { registrarBloqueioSentinela } from '../lib/metrics';

/**
 * SENTINELA — escudo de borda.
 *
 * A versao anterior era um regex que bloqueava qualquer apostrofo no payload.
 * Isso reprovava "Maria D'Avila" e senhas com aspa, e nao impedia injecao
 * nenhuma — o Prisma ja parametriza. Firewall que barra o cliente legitimo e
 * deixa passar o ataque e pior que firewall nenhum: da a sensacao de defesa.
 *
 * O que este escudo faz e o que so pode ser feito na borda, antes do parser e
 * do handler, e que o ORM e o zod nao cobrem:
 *
 *   1. Content-Type allowlist em verbos que mutam estado.
 *   2. Poluicao de prototipo (`__proto__`, `constructor`, `prototype` como CHAVE).
 *   3. Estrutura abusiva: profundidade, numero de chaves, tamanho de array.
 *      (CVEs de DoS de 2025/2026 em parsers de multipart e querystring sao disso.)
 *   4. Byte nulo e travessia de caminho em parametros de rota.
 *   5. Poluicao de parametro HTTP (array onde o contrato pede escalar).
 *   6. Assinaturas de alta confianca em VALOR: `<script`, `javascript:`,
 *      `onerror=`, operador Mongo como chave. Nada que texto humano produza.
 *
 * Regra que o resto do sistema herda: erro interno aqui BLOQUEIA (fail-closed).
 * Escudo que libera quando quebra e escudo que o atacante desliga de proposito.
 */

export interface SentinelaOptions {
  maxDepth?: number;
  maxKeys?: number;
  maxArrayLength?: number;
  maxStringLength?: number;
  /** Teto para corpo binario (webhook). O parser ja limita; aqui e defesa em profundidade. */
  maxRawBytes?: number;
}

const DEFAULTS: Required<SentinelaOptions> = {
  maxDepth: 8,
  maxKeys: 300,
  maxArrayLength: 500,
  maxStringLength: 20_000,
  maxRawBytes: 256 * 1024,
};

/** Chaves que nunca tem uso legitimo vindas do cliente. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Operadores de query NoSQL: perigosos como CHAVE, inofensivos como texto. */
const NOSQL_OPERATOR_KEY = /^\$(where|ne|gt|gte|lt|lte|in|nin|regex|expr|function|accumulator)$/i;

/**
 * Assinaturas em VALOR. Cada uma escolhida por nao ocorrer em conteudo humano
 * de um sistema de transporte escolar — nomes, escolas, enderecos e recados
 * passam intactos, inclusive com apostrofo, hifen e acento.
 */
const HIGH_CONFIDENCE_VALUE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'XSS_SCRIPT_TAG', re: /<\s*script\b[^>]*>/i },
  { name: 'XSS_SVG_ONLOAD', re: /<\s*(svg|img|iframe|body|object|embed)\b[^>]*\son\w+\s*=/i },
  { name: 'XSS_JS_URI', re: /\bjavascript\s*:/i },
  { name: 'XSS_DATA_HTML', re: /\bdata:text\/html/i },
  { name: 'SSTI', re: /\{\{\s*[\w.]+\s*\}\}\s*$/ },
  // SQL so conta quando ha comando + estrutura de injecao junto. "Rua Uni' Bar"
  // nao dispara; "' OR 1=1 --" dispara.
  { name: 'SQLI_TAUTOLOGY', re: /('|%27)\s*(or|and)\s+('?\d+'?\s*=\s*'?\d+'?|'[^']*'\s*=\s*'[^']*')/i },
  { name: 'SQLI_STACKED', re: /;\s*(drop|delete|truncate|update|insert|alter)\s+(table|from|into|database)\b/i },
  { name: 'SQLI_UNION', re: /\bunion\b[\s/*]+\bselect\b/i },
  { name: 'SQLI_COMMENT_TAIL', re: /('|%27)\s*(--|#|\/\*)/ },
  { name: 'CMD_INJECTION', re: /[;&|`]\s*(curl|wget|nc|bash|sh|powershell|cmd)\s/i },
  { name: 'PATH_TRAVERSAL', re: /(\.\.[/\\]){2,}|(%2e%2e[/\\%])/i },
  { name: 'NULL_BYTE', re: /\u0000|%00/ },
  { name: 'LOG4SHELL', re: /\$\{jndi:/i },
];

export class SentinelaBlock extends AppError {
  constructor(
    readonly attackType: string,
    readonly location: string,
  ) {
    super(
      400,
      'REQUEST_REJECTED',
      'A requisicao foi recusada por conter um padrao considerado inseguro. ' +
        'Se voce acredita que isso e um engano, revise o campo enviado e tente novamente.',
      undefined,
      'warn',
    );
  }
}

interface ScanState {
  keys: number;
  limits: Required<SentinelaOptions>;
}

function scan(value: unknown, path: string, depth: number, state: ScanState): void {
  if (depth > state.limits.maxDepth) {
    throw new SentinelaBlock('STRUCTURE_DEPTH', path);
  }

  // Corpo binario (o webhook chega como Buffer, por causa do `express.raw` que a
  // conferencia de HMAC exige) nao e estrutura: `Object.keys(buffer)` devolve UM
  // INDICE POR BYTE, entao o teto de chaves reprovava qualquer payload acima de
  // ~300 bytes. O aviso real do Asaas tem ~700 — nenhuma cobranca era baixada.
  // O tamanho ja e limitado pelo parser; a validacao de conteudo e do zod, depois
  // do HMAC.
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    if ((value as { byteLength: number }).byteLength > state.limits.maxRawBytes) {
      throw new SentinelaBlock('STRUCTURE_RAW_LENGTH', path);
    }
    return;
  }

  if (typeof value === 'string') {
    if (value.length > state.limits.maxStringLength) {
      throw new SentinelaBlock('STRUCTURE_STRING_LENGTH', path);
    }
    for (const sig of HIGH_CONFIDENCE_VALUE_PATTERNS) {
      if (sig.re.test(value)) throw new SentinelaBlock(sig.name, path);
    }
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > state.limits.maxArrayLength) {
      throw new SentinelaBlock('STRUCTURE_ARRAY_LENGTH', path);
    }
    value.forEach((v, i) => scan(v, `${path}[${i}]`, depth + 1, state));
    return;
  }

  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (++state.keys > state.limits.maxKeys) {
        throw new SentinelaBlock('STRUCTURE_KEY_COUNT', path);
      }
      if (FORBIDDEN_KEYS.has(key)) {
        throw new SentinelaBlock('PROTOTYPE_POLLUTION', `${path}.${key}`);
      }
      if (NOSQL_OPERATOR_KEY.test(key)) {
        throw new SentinelaBlock('NOSQL_OPERATOR_KEY', `${path}.${key}`);
      }
      if (key.includes('\u0000')) {
        throw new SentinelaBlock('NULL_BYTE_KEY', path);
      }
      scan((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1, state);
    }
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_CONTENT_TYPES = ['application/json', 'multipart/form-data', 'application/x-www-form-urlencoded'];

export function sentinela(options: SentinelaOptions = {}) {
  const limits = { ...DEFAULTS, ...options };

  return async function sentinelaMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
      // 1. Content-Type: recusa o que nao sabemos interpretar em verbo que muta.
      if (MUTATING.has(req.method) && req.get('content-length') !== '0') {
        const ct = (req.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
        if (ct && !ALLOWED_CONTENT_TYPES.includes(ct)) {
          throw new SentinelaBlock('CONTENT_TYPE_NOT_ALLOWED', `content-type:${ct}`);
        }
      }

      // 2. Parametros de rota: travessia e byte nulo.
      for (const [k, v] of Object.entries(req.params ?? {})) {
        if (typeof v === 'string' && (/\.\.[/\\]/.test(v) || v.includes('\u0000'))) {
          throw new SentinelaBlock('PATH_TRAVERSAL_PARAM', `params.${k}`);
        }
      }

      // 3. Poluicao de parametro HTTP: `?role=PARENT&role=OWNER` faz validador
      //    ingenuo ler o primeiro e autorizador ler o ultimo.
      for (const [k, v] of Object.entries(req.query ?? {})) {
        if (Array.isArray(v) && v.length > 10) {
          throw new SentinelaBlock('HTTP_PARAM_POLLUTION', `query.${k}`);
        }
      }

      const state: ScanState = { keys: 0, limits };
      scan(req.query, 'query', 0, state);
      scan(req.body, 'body', 0, state);

      next();
    } catch (err) {
      if (err instanceof SentinelaBlock) {
        registrarBloqueioSentinela();
        logger.warn(
          { attackType: err.attackType, location: err.location, path: req.path, ip: req.ip },
          'sentinela bloqueou requisicao',
        );
        // Aguardado, e nao `void`: em fire-and-forget uma queda do banco faria o
        // bloqueio ser registrado como se tivesse sido gravado. `audit()` nunca
        // lanca — no pior caso o incidente vira log de erro, mas nunca some em
        // silencio. Ausencia de sinal nao pode virar aprovacao nem aqui.
        await audit({
          action: 'SECURITY_SHIELD_BLOCK',
          description: `Sentinela bloqueou ${err.attackType} em ${err.location} na rota ${req.method} ${req.path}`,
          ipAddress: req.ip ?? null,
          userAgent: req.get('user-agent') ?? null,
        });
        return next(err);
      }
      // Fail-closed: escudo que nao consegue avaliar nao autoriza.
      logger.error({ err, path: req.path }, 'sentinela falhou ao avaliar requisicao — bloqueando');
      return next(
        new AppError(503, 'SHIELD_UNAVAILABLE', 'Nao foi possivel validar a requisicao com seguranca. Tente novamente.'),
      );
    }
  };
}

/** Exportado para teste: permite exercitar as assinaturas sem subir o Express. */
export const __testing = { scan, HIGH_CONFIDENCE_VALUE_PATTERNS, DEFAULTS };
