import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { runUnscoped } from '../src/lib/request-context';
import { logger } from '../src/lib/logger';
import { toCents } from '../src/lib/money';

/**
 * Semente de dados REAIS no PostgreSQL.
 *
 * Duas empresas de proposito: um sistema multi-tenant com um unico tenant no
 * banco parece correto ate o dia em que entra o segundo. Com duas, qualquer
 * consulta que esqueceu o filtro aparece na hora — e a suite tem um teste
 * dedicado a tentar atravessar de uma para a outra.
 *
 * Um motorista (Joana) trabalha nas DUAS empresas de proposito: e o caso de
 * freelancer que o produto promete suportar e que quebra implementacao
 * ingenua de multi-tenancy.
 */

const SENHA_DEMO = 'VanPro@Demo2026';

/**
 * Id estavel derivado de uma chave natural.
 *
 * A primeira versao procurava o registro por campo de exibicao (escola + serie)
 * antes de criar. Bastou corrigir a acentuacao de "Colegio" para "Colégio" para
 * a busca nao casar mais e o seed DUPLICAR alunos e mensalidades — o problema
 * classico de usar dado mutavel como chave.
 *
 * Com UUIDv5 sobre uma chave que nao muda, `upsert` por id converge sempre:
 * rodar o seed dez vezes deixa o banco igual a rodar uma.
 */
const NAMESPACE = '6f1c2a54-0b3d-4e7a-9c15-8d2f4b6e0a91';
function idFixo(...partes: string[]): string {
  const hash = crypto.createHash('sha1').update(`${NAMESPACE}:${partes.join('|')}`).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50; // versao 5
  b[8] = (b[8]! & 0x3f) | 0x80; // variante RFC 4122
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function main() {
  await runUnscoped('seed', async () => {
    const senha = await bcrypt.hash(SENHA_DEMO, 12);

    // --- planos -----------------------------------------------------------
    const [free, pro] = await Promise.all([
      prisma.subscriptionPlan.upsert({
        where: { name: 'FREE' },
        update: {},
        create: { name: 'FREE', maxVehicles: 2, maxDrivers: 3, maxStudents: 30, priceCents: 0 },
      }),
      prisma.subscriptionPlan.upsert({
        where: { name: 'PRO' },
        update: {},
        create: { name: 'PRO', maxVehicles: 20, maxDrivers: 40, maxStudents: 500, priceCents: toCents(249.9) },
      }),
    ]);

    // --- plataforma -------------------------------------------------------
    await prisma.user.upsert({
      where: { email: 'admin@vanpro.com.br' },
      update: {},
      create: {
        name: 'Administrador da Plataforma',
        email: 'admin@vanpro.com.br',
        password: senha,
        role: 'SUPER_ADMIN',
        tenantId: null,
      },
    });

    // --- empresa A: TransVan Escolar --------------------------------------
    const transvan = await prisma.company.upsert({
      where: { document: '11222333000181' },
      update: {},
      create: {
        name: 'TransVan Escolar',
        document: '11222333000181',
        subscriptionId: pro.id,
        tenantStatus: 'ACTIVE',
        latitude: -23.5613,
        longitude: -46.6565,
      },
    });

    // --- empresa B: Rota Segura -------------------------------------------
    const rotaSegura = await prisma.company.upsert({
      where: { document: '44555666000199' },
      update: {},
      create: {
        name: 'Rota Segura Transportes',
        document: '44555666000199',
        subscriptionId: free.id,
        tenantStatus: 'TRIAL',
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        latitude: -23.5985,
        longitude: -46.6885,
      },
    });

    async function pessoa(
      email: string,
      name: string,
      role: 'OWNER' | 'MANAGER' | 'DRIVER' | 'ASSISTANT' | 'PARENT',
      companyId: string,
      flags: Partial<{ canManageFinance: boolean; canManageHR: boolean; canManageRoutes: boolean }> = {},
      contractType: 'FULL_TIME' | 'FREELANCE' = 'FULL_TIME',
    ) {
      const user = await prisma.user.upsert({
        where: { email },
        // Converge o nome exibido, e so ele. Reexecutar o seed nao pode
        // reescrever senha nem papel de alguem que ja usa o ambiente — mas um
        // seed que nunca atualiza nada deixa o dado de demonstracao velho para
        // sempre, que foi o que aconteceu ao corrigir a acentuacao.
        update: { name },
        create: { name, email, password: senha, role, tenantId: companyId },
      });
      await prisma.userCompany.upsert({
        where: { userId_companyId: { userId: user.id, companyId } },
        update: {},
        create: {
          userId: user.id,
          companyId,
          role,
          status: 'ACTIVE',
          contractType,
          canManageFinance: flags.canManageFinance ?? role === 'OWNER',
          canManageHR: flags.canManageHR ?? role === 'OWNER',
          canManageRoutes: flags.canManageRoutes ?? role === 'OWNER',
        },
      });
      return user;
    }

    // Empresa A — quadro completo, um papel de cada.
    await pessoa('roberto@transvan.com.br', 'Roberto Almeida', 'OWNER', transvan.id);
    await pessoa('secretaria@transvan.com.br', 'Patrícia Nunes', 'MANAGER', transvan.id, {
      canManageFinance: true,
      canManageHR: false,
      canManageRoutes: false, // delegacao parcial: mostra a feature flag funcionando
    });
    const carlos = await pessoa('carlos@transvan.com.br', 'Carlos Oliveira', 'DRIVER', transvan.id);
    await pessoa('monitora@transvan.com.br', 'Sílvia Ramos', 'ASSISTANT', transvan.id);
    const maria = await pessoa('maria@exemplo.com.br', 'Maria Rodrigues', 'PARENT', transvan.id);

    // Empresa B — inclui a motorista freelancer que atende as duas.
    await pessoa('helena@rotasegura.com.br', 'Helena Prado', 'OWNER', rotaSegura.id);
    const joana = await pessoa('joana@freelancer.com.br', 'Joana Martins', 'DRIVER', rotaSegura.id, {}, 'FREELANCE');
    await prisma.userCompany.upsert({
      where: { userId_companyId: { userId: joana.id, companyId: transvan.id } },
      update: {},
      create: {
        userId: joana.id,
        companyId: transvan.id,
        role: 'DRIVER',
        status: 'ACTIVE',
        contractType: 'FREELANCE',
      },
    });
    const joao = await pessoa('joao.pai@exemplo.com.br', 'João Pereira', 'PARENT', rotaSegura.id);

    // --- frota ------------------------------------------------------------
    const vanA = await prisma.vehicle.upsert({
      where: { companyId_plate: { companyId: transvan.id, plate: 'ABC1D23' } },
      update: {},
      create: {
        companyId: transvan.id,
        plate: 'ABC1D23',
        model: 'Ford Transit Executive 2024',
        capacity: 15,
        km: 42_800,
        status: 'IDLE',
      },
    });
    await prisma.vehicle.upsert({
      where: { companyId_plate: { companyId: transvan.id, plate: 'XYZ9E87' } },
      update: {},
      create: {
        companyId: transvan.id,
        plate: 'XYZ9E87',
        model: 'Mercedes-Benz Sprinter 516',
        capacity: 19,
        km: 78_500,
        status: 'MAINTENANCE',
      },
    });
    await prisma.vehicle.upsert({
      where: { companyId_plate: { companyId: rotaSegura.id, plate: 'KRM4F55' } },
      update: {},
      create: {
        companyId: rotaSegura.id,
        plate: 'KRM4F55',
        model: 'Renault Master Minibus',
        capacity: 16,
        km: 112_000,
      },
    });

    // A chave passou a ser (empresa, usuario): a mesma pessoa tem um cadastro
    // de motorista por frota.
    const motoristaCarlos = await prisma.driver.upsert({
      where: { companyId_userId: { companyId: transvan.id, userId: carlos.id } },
      update: { name: 'Carlos Oliveira' },
      create: {
        companyId: transvan.id,
        userId: carlos.id,
        name: 'Carlos Oliveira',
        shiftType: 'FULL',
        dailyRateCents: toCents(180),
      },
    });

    // Joana atende as DUAS frotas, com diaria diferente em cada uma. E o caso
    // que o produto promete e que a versao anterior nao conseguia representar.
    await prisma.driver.upsert({
      where: { companyId_userId: { companyId: rotaSegura.id, userId: joana.id } },
      update: { name: 'Joana Martins' },
      create: {
        companyId: rotaSegura.id,
        userId: joana.id,
        name: 'Joana Martins',
        shiftType: 'AFTERNOON',
        dailyRateCents: toCents(160),
      },
    });
    await prisma.driver.upsert({
      where: { companyId_userId: { companyId: transvan.id, userId: joana.id } },
      update: { name: 'Joana Martins' },
      create: {
        companyId: transvan.id,
        userId: joana.id,
        name: 'Joana Martins',
        shiftType: 'MORNING',
        dailyRateCents: toCents(200),
      },
    });

    // --- alunos e financeiro ---------------------------------------------
    const alunosA = [
      { name: 'Lucas Rodrigues', school: 'Colégio Dom Pedro II', grade: '6º Ano A', shift: 'MORNING', fee: 480 },
      { name: 'Beatriz Rodrigues', school: 'Colégio Dom Pedro II', grade: '3º Ano B', shift: 'MORNING', fee: 480 },
      { name: 'Enzo Cardoso', school: 'Escola Vila Nova', grade: '8º Ano C', shift: 'AFTERNOON', fee: 520 },
    ];

    for (const [i, a] of alunosA.entries()) {
      const studentId = idFixo('student', transvan.document, String(i));
      const student = await prisma.student.upsert({
        where: { id: studentId },
        update: {
          name: a.name,
          school: a.school,
          grade: a.grade,
          monthlyFeeCents: toCents(a.fee),
        },
        create: {
          id: studentId,
          companyId: transvan.id,
          name: a.name,
          school: a.school,
          grade: a.grade,
          shift: a.shift,
          monthlyFeeCents: toCents(a.fee),
          parentId: i < 2 ? maria.id : null,
          address: 'Rua Haddock Lobo, 400 — São Paulo/SP',
          dateOfBirth: new Date(2014 + i, (i * 3) % 12, 12),
          lgpdConsent: true,
          imageConsent: i === 0,
          consentDate: new Date(),
          latitude: -23.5563 - i * 0.004,
          longitude: -46.6625 + i * 0.003,
        },
      });

      // Historico de 3 meses: uma inadimplente de proposito, para o DRE e o
      // painel de cobranca terem o que mostrar sem dado inventado no front.
      for (let m = 2; m >= 0; m--) {
        const due = new Date();
        due.setMonth(due.getMonth() - m, 10);
        const pago = !(m === 0 && i === 2);
        const lancamentoId = idFixo('financial', student.id, String(m));
        await prisma.financialTransaction.upsert({
          where: { id: lancamentoId },
          update: { amountCents: toCents(a.fee), paid: pago, paidAt: pago ? due : null, dueDate: due },
          create: {
            id: lancamentoId,
            companyId: transvan.id,
            studentId: student.id,
            amountCents: toCents(a.fee),
            paid: pago,
            paidAt: pago ? due : null,
            dueDate: due,
          },
        });
      }
    }

    const alunoBId = idFixo('student', rotaSegura.document, '0');
    {
      await prisma.student.upsert({
        where: { id: alunoBId },
        update: { name: 'Sofia Pereira', school: 'Instituto Aurora' },
        create: {
          id: alunoBId,
          companyId: rotaSegura.id,
          name: 'Sofia Pereira',
          school: 'Instituto Aurora',
          grade: '5º Ano A',
          shift: 'AFTERNOON',
          monthlyFeeCents: toCents(430),
          parentId: joao.id,
          lgpdConsent: true,
          address: 'Av. Faria Lima, 1500 — São Paulo/SP',
        },
      });
    }

    // --- despesas ---------------------------------------------------------
    {
      const despesas = [
          {
            id: idFixo('expense', transvan.document, 'fuel'),
            companyId: transvan.id,
            description: 'Diesel S-10 — abastecimento quinzenal',
            amountCents: toCents(1_240.5),
            category: 'FUEL',
            vehicleId: vanA.id,
          },
          {
            id: idFixo('expense', transvan.document, 'maintenance'),
            companyId: transvan.id,
            description: 'Revisão de 40.000 km',
            amountCents: toCents(890),
            category: 'MAINTENANCE',
            vehicleId: vanA.id,
          },
          {
            id: idFixo('expense', transvan.document, 'payroll'),
            companyId: transvan.id,
            description: 'Folha de pagamento — motoristas',
            amountCents: toCents(3_600),
            category: 'PAYROLL',
          },
      ];
      for (const d of despesas) {
        const { id, ...resto } = d;
        await prisma.expense.upsert({ where: { id }, update: resto, create: { id, ...resto } });
      }
    }

    // --- fretamento -------------------------------------------------------
    {
      const charterId = idFixo('charter', transvan.document, 'excursao');
      const inicio = new Date();
      inicio.setDate(inicio.getDate() + 12);
      const fim = new Date(inicio);
      fim.setDate(fim.getDate() + 1);

      await prisma.charter.upsert({
        where: { id: charterId },
        update: { title: 'Excursão Praia Grande — 6º Ano', contractor: 'Colégio Dom Pedro II' },
        create: {
          id: charterId,
          companyId: transvan.id,
          title: 'Excursão Praia Grande — 6º Ano',
          contractor: 'Colégio Dom Pedro II',
          priceCents: toCents(2_800),
          startDate: inicio,
          endDate: fim,
          status: 'PENDING',
          vehicleId: vanA.id,
          driverId: motoristaCarlos.id,
        },
      });
    }

    logger.info(
      {
        empresas: 2,
        usuarios: 8,
        senhaDemo: SENHA_DEMO,
      },
      'seed concluido',
    );
  });
}

main()
  .catch((err) => {
    logger.fatal({ err }, 'seed falhou');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
