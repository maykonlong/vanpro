import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
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
 *
 * E um quarto, que so aparece quando se tenta crescer: os bytes ficavam no
 * DISCO DA MAQUINA. Com duas replicas, a foto enviada numa nao existe na outra
 * — a miniatura some e volta conforme o balanceador, intermitente e
 * impossivel de diagnosticar pelo suporte. Agora ficam no banco, que ja e
 * compartilhado, ja e isolado por empresa na camada de dados, ja viaja por TLS
 * e ja entra no backup que foi restaurado de verdade.
 */

const router = Router();

const OPERACAO = ['OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT'] as const;

const MIME_PERMITIDOS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
} as const;

type MimePermitido = keyof typeof MIME_PERMITIDOS;

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

/** Nome gerado por nos: UUID + extensao. Nada do cliente sobrevive no identificador. */
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

  // `create` e nao `upsert`: colisao de UUID e improvavel, e sobrescrever em
  // silencio o arquivo de outra pessoa nao e aceitavel. A chave primaria falha
  // alto se acontecer.
  await prisma.upload.create({
    data: {
      id: filename,
      companyId: tenantId,
      mimeType: real,
      sizeBytes: file.size,
      // `Uint8Array` e nao `Buffer`: o Prisma tipa `Bytes` como
      // `Uint8Array<ArrayBuffer>`, e o `Buffer` do Node pode estar apoiado num
      // `SharedArrayBuffer`. A conversao e de tipo, nao de dado — mesma memoria.
      conteudo: new Uint8Array(file.buffer),
      uploadedBy: auth.userId,
    },
  });

  await audit({
    action: 'FILE_UPLOADED',
    description: `Arquivo ${filename} (${real}, ${file.size} bytes) enviado para a empresa.`,
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

    // O `companyId` da URL ja foi conferido acima; o guard do Prisma injeta o
    // da sessao no `where` de qualquer jeito. As duas conferencias sao de
    // camadas diferentes de proposito — a de cima produz um 404 explicito, a de
    // baixo continua valendo se alguem apagar a de cima.
    const arquivo = await prisma.upload.findUnique({
      where: { id: filename },
      select: { mimeType: true, sizeBytes: true, conteudo: true },
    });
    if (!arquivo) throw Errors.notFound('Arquivo');

    res.setHeader('Content-Type', arquivo.mimeType);
    res.setHeader('Content-Length', String(arquivo.sizeBytes));
    // Sem cache compartilhado: proxy guardando foto de aluno reintroduz o
    // acesso sem autenticacao que a rota acabou de fechar.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(Buffer.from(arquivo.conteudo));
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

    // `deleteMany` e nao `delete`: o guard injeta a empresa no `where`, e um id
    // de outra frota simplesmente nao casa — zero linhas em vez de excecao. A
    // contagem distingue "nao existe" de "nao e seu" sem contar qual dos dois.
    const { count } = await prisma.upload.deleteMany({ where: { id: filename } });
    if (count === 0) throw Errors.notFound('Arquivo');

    await audit({
      action: 'FILE_DELETED',
      description: `Arquivo ${filename} removido da empresa.`,
      ipAddress: req.ip ?? null,
    });

    res.status(204).send();
  },
);

export default router;
