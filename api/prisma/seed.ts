import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando migração de dados (data_storage.json -> PostgreSQL)...');

  // Caminho para o data_storage original
  const dataPath = path.resolve(__dirname, '../../data_storage.json');
  
  if (!fs.existsSync(dataPath)) {
    console.log('⚠️ Arquivo data_storage.json não encontrado. Ignorando migração.');
    return;
  }

  const rawData = fs.readFileSync(dataPath, 'utf-8');
  const oldData = JSON.parse(rawData);

  // Criar tenant padrão se não existir
  let tenant = await prisma.tenant.findFirst({ where: { slug: 'transvan' } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'TransVan Transportes Escolares & Turismo',
        tradeName: 'TransVan Frota',
        document: '12.345.678/0001-90',
        slug: 'transvan',
        plan: 'FROTA',
      },
    });
  }

  // Criar usuário Owner padrão
  const passwordHash = await bcrypt.hash('123456', 10);
  await prisma.user.upsert({
    where: { email: 'roberto@transvan.com.br' },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Roberto Silva (Frotista)',
      email: 'roberto@transvan.com.br',
      passwordHash,
      role: 'OWNER',
      phone: '(11) 98888-1001',
    },
  });

  console.log('✅ Base (Tenant + Owner) garantida.');

  // Mapear Motoristas conhecidos a partir dos veículos e alunos
  const driverNames = new Set<string>();
  if (oldData.vehicles) {
    for (const v of oldData.vehicles) {
      if (v.driver) driverNames.add(v.driver);
    }
  }

  const driverMap = new Map<string, string>(); // name -> userId
  
  for (const dName of Array.from(driverNames)) {
    const slug = dName.toLowerCase().replace(/\s+/g, '.');
    const email = `${slug}@transvan.com.br`;
    const driver = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        tenantId: tenant.id,
        name: `${dName} (Motorista)`,
        email,
        passwordHash,
        role: 'DRIVER',
        phone: '(11) 90000-0000',
      },
    });
    driverMap.set(dName, driver.id);
  }

  console.log(`✅ ${driverNames.size} Motoristas migrados.`);

  // Migrar Veículos
  if (oldData.vehicles) {
    for (const v of oldData.vehicles) {
      await prisma.vehicle.upsert({
        where: { plate: v.plate },
        update: {
          currentKm: v.currentKm,
        },
        create: {
          tenantId: tenant.id,
          name: v.name,
          plate: v.plate,
          model: v.model,
          year: v.year,
          capacity: v.capacity,
          currentKm: v.currentKm,
          avgKmPerLiter: v.avgKmPerLiter,
          driverId: driverMap.get(v.driver) || null,
        },
      });
    }
    console.log(`✅ ${oldData.vehicles.length} Veículos migrados.`);
  }

  // Migrar Escolas (extraídas dos alunos)
  const schoolNames = new Set<string>();
  if (oldData.students) {
    for (const s of oldData.students) {
      if (s.school) schoolNames.add(s.school);
    }
  }

  const schoolMap = new Map<string, string>();
  for (const sName of Array.from(schoolNames)) {
    // Usamos um campo provisório ou nome exato para buscar. Não temos restrição de uniq no name, então fazemos findFirst
    let school = await prisma.school.findFirst({ where: { name: sName, tenantId: tenant.id } });
    if (!school) {
      school = await prisma.school.create({
        data: {
          tenantId: tenant.id,
          name: sName,
          address: 'Endereço não informado',
        },
      });
    }
    schoolMap.set(sName, school.id);
  }

  // Criar responsável padrão genérico (já que oldData não tem parentId explícito no aluno)
  const parentMaria = await prisma.user.upsert({
    where: { email: 'maria@gmail.com' },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Maria (Responsável Genérico)',
      email: 'maria@gmail.com',
      passwordHash,
      role: 'PARENT',
      phone: '(11) 96666-4004',
    },
  });

  // Migrar Alunos
  if (oldData.students) {
    for (const s of oldData.students) {
      // O banco usa name+tenantId para distinguir alunos, mas não temos constraint única no Prisma para name.
      // Vamos tentar buscar pelo nome para idempotência
      const existing = await prisma.student.findFirst({ where: { name: s.name, tenantId: tenant.id } });
      
      if (!existing) {
        await prisma.student.create({
          data: {
            tenantId: tenant.id,
            parentId: parentMaria.id,
            schoolId: schoolMap.get(s.school) || '',
            name: s.name,
            grade: s.grade || '',
            shift: s.shift === 'AFTERNOON' ? 'AFTERNOON' : s.shift === 'NIGHT' ? 'NIGHT' : 'MORNING',
            pickupAddress: s.pickupAddress || '',
            dropoffAddress: s.dropoffAddress || '',
            monthlyFee: s.monthlyFee || 0,
            dueDay: s.dueDay || 10,
          },
        });
      }
    }
    console.log(`✅ ${oldData.students.length} Alunos migrados.`);
  }

  console.log('🚀 Migração de dados concluída com sucesso!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
