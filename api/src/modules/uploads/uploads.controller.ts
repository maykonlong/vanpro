import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import { validate } from '../../http/validate';
import { requireRole } from '../../http/middlewares/authenticate';
import { uploadLimiter } from '../../security/rate-limit';

/**
 * Arquivos (foto de aluno, comprovante de despesa).
 *
 * Tres defeitos da versao anterior morrem aqui:
 *   1. pasta unica compartilhada — vazamento entre empresas esperando um
 *      `../` no nome do arquivo; agora cada empresa tem a propria subpasta;
 *   2. nome vindo de `originalname` — `../../.env` e `foto.png.php` entravam
 *      inteiros; agora o nome e um UUID e a extensao vem do conteudo;
 *   3. `express.static` na pasta de uploads — foto de crianca em URL publica
 *      adivinhavel; agora servir arquivo e rota autenticada e com dono conferido.
 */

const router = Router();

const OPERACAO = ['OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT'] as const;

const MIME_PERMITIDOS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
} as const;

type MimePermitido = keyof typeof MIME_PERMITIDOS;

const RAIZ = path.resolve(env.UPLOAD_DIR);

/**
 * Assinatura real do arquivo.
 *
 * O `Content-Type` do multipart e escrito pelo cliente: aceita-lo como verdade
 * e aceitar a palavra do atacante. Os primeiros bytes, nao. Um PHP renomeado
 * para `.png` com `Content-Type: image/png` passa pela allowlist de MIME e
 * para aqui.
 */
function mimePorAssinatura(buf: Buffer): MimePermitido | null {
  if (buf.length < 12) return null;

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';

  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => buf[i] === b)) return 'image/png';

  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  return null;
}

/**
 * `memoryStorage` de proposito: gravar primeiro e inspecionar depois deixa o
 * arquivo hostil em disco durante a janela da checagem — e, se o processo cair
 * no meio, para sempre.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype in MIME_PERMITIDOS) return cb(null, true);
    cb(
      Errors.validation([
        { campo: 'file', erro: `Tipo não permitido. Aceitos: ${Object.keys(MIME_PERMITIDOS).join(', ')}.` },
      ]),
    );
  },
});

/** Traduz o erro do multer para o formato estavel do handler global. */
function receberArquivo(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          Errors.validation([
            { campo: 'file', erro: `Arquivo acima do limite de ${Math.floor(env.UPLOAD_MAX_BYTES / 1024)} KB.` },
          ]),
        );
      }
      return next(Errors.validation([{ campo: 'file', erro: 'Envio inválido. Mande um único arquivo em "file".' }]));
    }
    next(err);
  });
}

/**
 * Resolve o caminho e confirma que ele continua dentro da pasta da empresa.
 * `path.resolve` normaliza `..`, `%2e%2e` ja decodificado e barras invertidas;
 * o `startsWith` e o que transforma essa normalizacao em recusa.
 */
function caminhoSeguro(companyId: string, filename: string): string {
  const pastaEmpresa = path.resolve(RAIZ, companyId);
  const destino = path.resolve(pastaEmpresa, filename);
  if (destino !== pastaEmpresa && !destino.startsWith(pastaEmpresa + path.sep)) {
    throw Errors.forbidden('Caminho de arquivo inválido.');
  }
  return destino;
}

/** Nome gerado por nos: UUID + extensao. Nada do cliente sobrevive no disco. */
const filenameParam = z.object({
  filename: z.string().regex(/^[0-9a-f-]{36}\.(jpg|png|webp)$/i, 'Nome de arquivo inválido'),
});

const companyFileParams = filenameParam.extend({
  companyId: z.string().uuid('identificador inválido'),
});

router.post('/', uploadLimiter, requireRole(...OPERACAO), receberArquivo, async (req, res) => {
  const auth = req.auth!;
  const tenantId = auth.tenantId;
  if (!tenantId) throw Errors.forbidden('Este acesso não está vinculado a uma empresa.');

  const file = req.file;
  if (!file) throw Errors.validation([{ campo: 'file', erro: 'Nenhum arquivo enviado.' }]);

  const real = mimePorAssinatura(file.buffer);
  if (!real || real !== file.mimetype) {
    logger.warn(
      { declarado: file.mimetype, detectado: real ?? 'desconhecido', userId: auth.userId },
      'upload recusado: conteúdo não corresponde ao tipo declarado',
    );
    throw Errors.validation([
      { campo: 'file', erro: 'O conteúdo do arquivo não corresponde a uma imagem JPEG, PNG ou WebP.' },
    ]);
  }

  const filename = `${crypto.randomUUID()}${MIME_PERMITIDOS[real]}`;
  const pastaEmpresa = path.resolve(RAIZ, tenantId);
  await fs.mkdir(pastaEmpresa, { recursive: true });
  // `wx` falha se o nome ja existir em vez de sobrescrever: colisao de UUID e
  // improvavel, sobrescrever silenciosamente o arquivo de outro nao e aceitavel.
  await fs.writeFile(path.join(pastaEmpresa, filename), file.buffer, { flag: 'wx' });

  await audit({
    action: 'FILE_UPLOADED',
    description: `Arquivo ${filename} (${real}, ${file.size} bytes) enviado para a pasta da empresa.`,
    ipAddress: req.ip ?? null,
  });

  res.status(201).json({
    filename,
    mimeType: real,
    size: file.size,
    // URL relativa a rota autenticada. Nao existe caminho publico para este arquivo.
    url: `/uploads/${tenantId}/${filename}`,
  });
});

/**
 * Servir o arquivo e rota autenticada, com o dono conferido no caminho.
 * `express.static` aqui significaria: quem adivinhar o UUID ve a foto da
 * crianca de qualquer empresa, sem login e sem deixar rastro.
 */
router.get(
  '/:companyId/:filename',
  requireRole(...OPERACAO, 'PARENT'),
  validate({ params: companyFileParams }),
  async (req, res) => {
    const { companyId, filename } = req.valid.params as z.infer<typeof companyFileParams>;
    const auth = req.auth!;

    if (auth.role !== 'SUPER_ADMIN' && companyId !== auth.tenantId) {
      logger.warn({ pedido: companyId, tenant: auth.tenantId, userId: auth.userId }, 'tentativa de acesso cruzado a arquivo');
      throw Errors.notFound('Arquivo');
    }

    const destino = caminhoSeguro(companyId, filename);
    const stat = await fs.stat(destino).catch(() => null);
    if (!stat || !stat.isFile()) throw Errors.notFound('Arquivo');

    const ext = path.extname(destino).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(stat.size));
    // Sem cache compartilhado: proxy guardando foto de aluno reintroduz o
    // acesso sem autenticacao que a rota acabou de fechar.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(await fs.readFile(destino));
  },
);

router.delete(
  '/:filename',
  requireRole('OWNER'),
  validate({ params: filenameParam }),
  async (req, res) => {
    const auth = req.auth!;
    const tenantId = auth.tenantId;
    if (!tenantId) throw Errors.forbidden('Este acesso não está vinculado a uma empresa.');

    const { filename } = req.valid.params as z.infer<typeof filenameParam>;
    const destino = caminhoSeguro(tenantId, filename);

    try {
      await fs.unlink(destino);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw Errors.notFound('Arquivo');
      throw err;
    }

    await audit({
      action: 'FILE_DELETED',
      description: `Arquivo ${filename} removido da pasta da empresa.`,
      ipAddress: req.ip ?? null,
    });

    res.status(204).send();
  },
);

export default router;
