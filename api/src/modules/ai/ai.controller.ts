import { Router } from 'express';
import { tenantId } from '../../lib/tenant';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { features } from '../../config/env';
import { logger } from '../../lib/logger';
import {
  validate,
  pagination,
  paginate,
  skipTake,
  uuidParam,
  text,
} from '../../http/validate';
import { requireRole } from '../../http/middlewares/authenticate';

/**
 * Marketing assistido: campanhas, publicacoes e aniversariantes.
 *
 * Segue o molde de `students.controller.ts`. O modulo publica material que sai
 * da empresa, entao carrega duas travas que os outros nao tem: nada e gerado
 * sem provedor real, e nenhum aluno entra em peca de divulgacao sem
 * consentimento de imagem.
 */

const router = Router();

const GESTAO = ['OWNER', 'MANAGER'] as const;

const channelField = z.enum(['WHATSAPP', 'INSTAGRAM', 'EMAIL']);
const targetField = z.enum(['ALL_STUDENTS', 'ALL_PARENTS', 'SPECIFIC']);
const postStatusField = z.enum(['DRAFT', 'APPROVED', 'PUBLISHED', 'REJECTED']);

// ---------------------------------------------------------------------------
// Campanhas
// ---------------------------------------------------------------------------

type CampaignRow = Awaited<ReturnType<typeof prisma.aICampaign.findFirstOrThrow>>;

function serializeCampaign(c: CampaignRow) {
  return {
    id: c.id,
    name: c.name,
    template: c.template,
    target: c.target,
    channel: c.channel,
    isActive: c.isActive,
    createdAt: c.createdAt,
  };
}

const campaignListQuery = pagination.extend({
  channel: channelField.optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

router.get(
  '/campaigns',
  requireRole(...GESTAO),
  validate({ query: campaignListQuery }),
  async (req, res) => {
    const { page, perPage, channel, isActive } = req.valid.query as z.infer<typeof campaignListQuery>;
    const where = {
      ...(channel ? { channel } : {}),
      ...(isActive === undefined ? {} : { isActive }),
    };

    const [rows, total] = await Promise.all([
      prisma.aICampaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake({ page, perPage }),
      }),
      prisma.aICampaign.count({ where }),
    ]);

    res.json(paginate(rows.map(serializeCampaign), total, { page, perPage }));
  },
);

router.post(
  '/campaigns',
  requireRole(...GESTAO),
  validate({
    body: z.object({
      name: text(120, 'Nome da campanha'),
      template: text(4000, 'Modelo da mensagem'),
      target: targetField,
      channel: channelField,
      isActive: z.boolean().default(true),
    }),
  }),
  async (req, res) => {
    const data = req.valid.body as {
      name: string;
      template: string;
      target: string;
      channel: string;
      isActive: boolean;
    };

    const campaign = await prisma.aICampaign.create({
      data: {
        companyId: tenantId(),
        name: data.name,
        template: data.template,
        target: data.target,
        channel: data.channel,
        isActive: data.isActive,
      },
    });

    await audit({
      action: 'AI_CAMPAIGN_CREATED',
      description: `Campanha ${campaign.id} criada no canal ${campaign.channel}.`,
      ipAddress: req.ip ?? null,
    });

    res.status(201).json(serializeCampaign(campaign));
  },
);

router.patch(
  '/campaigns/:id',
  requireRole(...GESTAO),
  validate({ params: uuidParam(), body: z.object({ isActive: z.boolean() }) }),
  async (req, res) => {
    const id = req.valid.params.id as string;
    const { isActive } = req.valid.body as { isActive: boolean };

    const existing = await prisma.aICampaign.findFirst({ where: { id }, select: { id: true } });
    if (!existing) throw Errors.notFound('Campanha');

    const campaign = await prisma.aICampaign.update({ where: { id }, data: { isActive } });

    await audit({
      action: 'AI_CAMPAIGN_UPDATED',
      description: `Campanha ${id} ${isActive ? 'ativada' : 'desativada'}.`,
      ipAddress: req.ip ?? null,
    });

    res.json(serializeCampaign(campaign));
  },
);

// ---------------------------------------------------------------------------
// Publicacoes
// ---------------------------------------------------------------------------

type PostRow = Awaited<ReturnType<typeof prisma.aIPost.findFirstOrThrow>>;

function serializePost(p: PostRow) {
  return {
    id: p.id,
    campaignId: p.campaignId,
    content: p.content,
    imageUrl: p.imageUrl,
    targetId: p.targetId,
    channel: p.channel,
    status: p.status,
    scheduledTo: p.scheduledTo,
    createdAt: p.createdAt,
  };
}

const postListQuery = pagination.extend({ status: postStatusField.optional() });

router.get(
  '/posts',
  requireRole(...GESTAO),
  validate({ query: postListQuery }),
  async (req, res) => {
    const { page, perPage, status } = req.valid.query as z.infer<typeof postListQuery>;
    const where = status ? { status } : {};

    const [rows, total] = await Promise.all([
      prisma.aIPost.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake({ page, perPage }) }),
      prisma.aIPost.count({ where }),
    ]);

    res.json(paginate(rows.map(serializePost), total, { page, perPage }));
  },
);

/**
 * Geracao de rascunho.
 *
 * NAO existe provedor de LLM configurado neste ambiente (`features` nao expoe
 * `llm`), entao a rota devolve 503 e nao grava nada. A versao anterior
 * montava frase de template, gravava como rascunho e chamava aquilo de "IA":
 * o usuario aprovava e publicava um texto que nenhum modelo escreveu, sem ter
 * como saber. Texto inventado apresentado como gerado e defeito, nao fallback.
 */
router.post(
  '/posts/generate',
  requireRole(...GESTAO),
  validate({
    body: z.object({
      campaignId: z.string().uuid().nullish(),
      channel: channelField,
      prompt: text(2000, 'Instrução para a geração'),
      quantity: z.coerce.number().int().min(1).max(10).default(1),
    }),
  }),
  async (_req, _res) => {
    throw Errors.featureDisabled('Assistente de IA');
  },
);

router.post(
  '/posts/:id/approve',
  requireRole(...GESTAO),
  validate({ params: uuidParam() }),
  async (req, res) => {
    const id = req.valid.params.id as string;

    const existing = await prisma.aIPost.findFirst({ where: { id }, select: { id: true, status: true } });
    if (!existing) throw Errors.notFound('Publicação');
    if (existing.status !== 'DRAFT') {
      throw Errors.conflict(`Só rascunho pode ser aprovado. Esta publicação está em ${existing.status}.`);
    }

    const post = await prisma.aIPost.update({ where: { id }, data: { status: 'APPROVED' } });

    await audit({
      action: 'AI_POST_APPROVED',
      description: `Publicação ${id} aprovada para o canal ${post.channel}.`,
      ipAddress: req.ip ?? null,
    });

    res.json(serializePost(post));
  },
);

router.post(
  '/posts/:id/reject',
  requireRole(...GESTAO),
  validate({
    params: uuidParam(),
    body: z.object({ reason: z.string().trim().max(500).default('') }),
  }),
  async (req, res) => {
    const id = req.valid.params.id as string;
    const { reason } = req.valid.body as { reason: string };

    const existing = await prisma.aIPost.findFirst({ where: { id }, select: { id: true, status: true } });
    if (!existing) throw Errors.notFound('Publicação');
    if (existing.status === 'PUBLISHED') {
      throw Errors.conflict('Publicação já veiculada não pode ser rejeitada.');
    }

    const post = await prisma.aIPost.update({ where: { id }, data: { status: 'REJECTED' } });

    await audit({
      action: 'AI_POST_REJECTED',
      description: `Publicação ${id} rejeitada.${reason ? ` Motivo: ${reason}` : ''}`,
      ipAddress: req.ip ?? null,
    });

    res.json(serializePost(post));
  },
);

/**
 * Publicacao efetiva. Cada canal exige a sua credencial: marcar PUBLISHED sem
 * ter chamado o provedor e o painel dizendo "enviado" para uma mensagem que
 * ninguem recebeu.
 */
router.post(
  '/posts/:id/publish',
  requireRole(...GESTAO),
  validate({ params: uuidParam() }),
  async (req, res) => {
    const id = req.valid.params.id as string;

    const existing = await prisma.aIPost.findFirst({
      where: { id },
      select: { id: true, status: true, channel: true },
    });
    if (!existing) throw Errors.notFound('Publicação');
    if (existing.status !== 'APPROVED') {
      throw Errors.conflict(
        `Só publicação aprovada pode ir ao ar. Esta está em ${existing.status}.`,
      );
    }

    /*
     * NENHUM canal publica hoje — e o motivo do WhatsApp e mais grave que o
     * dos outros dois.
     *
     * A versao anterior deixava passar quando `features.whatsapp` era
     * verdadeiro, e entao marcava PUBLISHED sem NUNCA chamar
     * `whatsapp.service`. Bastava existir credencial no ambiente para o painel
     * dizer "veiculada" a respeito de uma mensagem que ninguem enviou — o
     * defeito exato que o comentario do proprio servico promete impedir.
     *
     * E nao era so falta de fiacao: o schema NAO TEM campo de telefone. Nem
     * `User`, nem `Student`, nem responsavel. Nao existe destinatario para
     * quem enviar. Ligar o servico sem isso trocaria uma mentira por um erro
     * de execucao.
     *
     * Enquanto nao houver telefone no cadastro (com consentimento e cifrado em
     * repouso, como o resto do dado pessoal), a resposta honesta e recusar
     * dizendo o que falta.
     */
    logger.warn({ postId: id, channel: existing.channel }, 'publicacao recusada: canal sem destinatario');
    throw Errors.featureDisabled(
      `Publicação em ${existing.channel} — não há canal de envio configurado neste ambiente`,
    );

    const post = await prisma.aIPost.update({ where: { id }, data: { status: 'PUBLISHED' } });

    await audit({
      action: 'AI_POST_PUBLISHED',
      description: `Publicação ${id} veiculada no canal ${post.channel}.`,
      ipAddress: req.ip ?? null,
    });

    res.json(serializePost(post));
  },
);

// ---------------------------------------------------------------------------
// Aniversariantes
// ---------------------------------------------------------------------------

const birthdayQuery = pagination.extend({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

/**
 * Teto de varredura. O filtro de dia/mes acontece em memoria (o banco guarda a
 * data completa, e comparar so dia e mes exigiria funcao de indice que o schema
 * nao tem), entao a leitura precisa de limite explicito.
 */
const MAX_VARREDURA = 2000;

function chaveDiaMes(d: Date): string {
  // UTC dos dois lados: misturar fuso local com data gravada em UTC desloca o
  // aniversario em um dia para quem nasceu perto da virada.
  return `${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

router.get(
  '/birthdays',
  requireRole(...GESTAO),
  validate({ query: birthdayQuery }),
  async (req, res) => {
    const { page, perPage, days } = req.valid.query as z.infer<typeof birthdayQuery>;

    const hoje = new Date();
    const janela = new Map<string, number>();
    for (let i = 0; i <= days; i++) {
      const d = new Date(
        Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + i),
      );
      const chave = chaveDiaMes(d);
      if (!janela.has(chave)) janela.set(chave, i);
    }

    // `imageConsent` no `where`, nao no filtro depois: aluno sem consentimento
    // de imagem nao pode nem aparecer na lista que alimenta material de
    // divulgacao (LGPD Art. 14 e ECA — crianca exige consentimento especifico).
    const rows = await prisma.student.findMany({
      where: { imageConsent: true, dateOfBirth: { not: null } },
      select: { id: true, name: true, dateOfBirth: true },
      take: MAX_VARREDURA,
      orderBy: { createdAt: 'asc' },
    });

    if (rows.length === MAX_VARREDURA) {
      // Resultado possivelmente truncado precisa aparecer: lista incompleta que
      // se parece com lista completa e pior que erro.
      logger.warn({ limite: MAX_VARREDURA }, 'varredura de aniversariantes atingiu o teto');
    }

    const aniversariantes = rows
      .flatMap((s) => {
        if (!s.dateOfBirth) return [];
        const offset = janela.get(chaveDiaMes(s.dateOfBirth));
        if (offset === undefined) return [];
        // Somente nome e data. Endereco, telefone e escola nao tem nada que
        // fazer numa lista que existe para montar post de aniversario.
        return [{ id: s.id, name: s.name, dateOfBirth: s.dateOfBirth, emDias: offset }];
      })
      .sort((a, b) => a.emDias - b.emDias);

    const total = aniversariantes.length;
    const { skip, take } = skipTake({ page, perPage });

    res.json(paginate(aniversariantes.slice(skip, skip + take), total, { page, perPage }));
  },
);

export default router;
