import { PrismaClient } from '@prisma/client';
import { fieldEncryptionExtension } from 'prisma-field-encryption';

// Cliente base
const prismaBase = new PrismaClient();

// Aplica o Middleware (Extensão) de Criptografia em Repouso
// Onde houver `/// @encrypted` no schema, os dados serão criptografados antes de salvar
// e descriptografados ao ler automaticamente.
export const prisma = prismaBase.$extends(
  fieldEncryptionExtension({
    encryptionKey: process.env.PRISMA_FIELD_ENCRYPTION_KEY || 'k1.aesgcm256.super-secret-key-that-should-be-in-env',
  })
);
