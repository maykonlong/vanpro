"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('🌱 Populando banco de dados VanPro...');
    // Limpeza prévia
    await prisma.attendance.deleteMany();
    await prisma.routeWaypoint.deleteMany();
    await prisma.route.deleteMany();
    await prisma.contract.deleteMany();
    await prisma.student.deleteMany();
    await prisma.school.deleteMany();
    await prisma.freight.deleteMany();
    await prisma.maintenance.deleteMany();
    await prisma.fuelLog.deleteMany();
    await prisma.financialTransaction.deleteMany();
    await prisma.crmLead.deleteMany();
    await prisma.occurrence.deleteMany();
    await prisma.vehicle.deleteMany();
    await prisma.user.deleteMany();
    await prisma.tenant.deleteMany();
    const passwordHash = await bcryptjs_1.default.hash('123456', 10);
    // 1. Criar Tenant Frotista
    const tenant = await prisma.tenant.create({
        data: {
            name: 'TransVan Transportes Escolares & Turismo',
            tradeName: 'TransVan Frota',
            document: '12.345.678/0001-90',
            slug: 'transvan',
            plan: client_1.PlanType.FROTA,
        },
    });
    // 2. Criar Usuários
    const owner = await prisma.user.create({
        data: {
            tenantId: tenant.id,
            name: 'Roberto Silva (Frotista)',
            email: 'roberto@transvan.com.br',
            passwordHash,
            role: client_1.Role.OWNER,
            phone: '(11) 98888-1001',
        },
    });
    const driverCarlos = await prisma.user.create({
        data: {
            tenantId: tenant.id,
            name: 'Carlos Oliveira (Motorista)',
            email: 'carlos@transvan.com.br',
            passwordHash,
            role: client_1.Role.DRIVER,
            phone: '(11) 97777-2002',
            cnhNumber: '12345678900',
            cnhCategory: 'D',
        },
    });
    const driverPedro = await prisma.user.create({
        data: {
            tenantId: tenant.id,
            name: 'Pedro Santos (Motorista)',
            email: 'pedro@transvan.com.br',
            passwordHash,
            role: client_1.Role.DRIVER,
            phone: '(11) 97777-3003',
            cnhNumber: '98765432100',
            cnhCategory: 'D',
        },
    });
    const parentMaria = await prisma.user.create({
        data: {
            tenantId: tenant.id,
            name: 'Maria Rodrigues (Mãe do João e Ana)',
            email: 'maria@gmail.com',
            passwordHash,
            role: client_1.Role.PARENT,
            phone: '(11) 96666-4004',
        },
    });
    // 3. Criar Veículos (Vans)
    const van01 = await prisma.vehicle.create({
        data: {
            tenantId: tenant.id,
            name: 'Van 01 - Ford Transit 2024',
            plate: 'ABC-1D23',
            model: 'Ford Transit Executive 15L',
            year: 2024,
            capacity: 15,
            currentKm: 42800,
            avgKmPerLiter: 8.8,
            driverId: driverCarlos.id,
        },
    });
    const van02 = await prisma.vehicle.create({
        data: {
            tenantId: tenant.id,
            name: 'Van 02 - Mercedes Sprinter 516',
            plate: 'XYZ-9E87',
            model: 'Mercedes-Benz Sprinter 516 CDi',
            year: 2023,
            capacity: 19,
            currentKm: 78500,
            avgKmPerLiter: 7.9,
            driverId: driverPedro.id,
        },
    });
    const van03 = await prisma.vehicle.create({
        data: {
            tenantId: tenant.id,
            name: 'Van 03 - Renault Master 2022',
            plate: 'KRM-4F55',
            model: 'Renault Master Minibus 16L',
            year: 2022,
            capacity: 16,
            currentKm: 112000,
            avgKmPerLiter: 8.2,
        },
    });
    // 4. Manutenções e Abastecimentos
    await prisma.maintenance.create({
        data: {
            tenantId: tenant.id,
            vehicleId: van01.id,
            description: 'Troca de Óleo 5W30 + Filtros de Ar e Combustível',
            serviceType: 'OIL_CHANGE',
            kmAtService: 42000,
            nextDueKm: 50000,
            cost: 650.00,
            workshopName: 'Oficina Central Diesel',
            performedAt: new Date('2026-08-15'),
        },
    });
    await prisma.fuelLog.create({
        data: {
            tenantId: tenant.id,
            vehicleId: van01.id,
            kmAtFill: 42800,
            liters: 65,
            pricePerLiter: 5.95,
            totalCost: 386.75,
            stationName: 'Posto Shell Rota 101',
            calculatedKmPerLiter: 8.8,
        },
    });
    // 5. Criar Escolas
    const schoolA = await prisma.school.create({
        data: {
            tenantId: tenant.id,
            name: 'Colégio Dom Pedro II',
            address: 'Av. Paulista, 1500 - Bela Vista, São Paulo - SP',
            contactPhone: '(11) 3210-9000',
        },
    });
    const schoolB = await prisma.school.create({
        data: {
            tenantId: tenant.id,
            name: 'Escola Santa Catarina',
            address: 'Rua Augusta, 800 - Consolação, São Paulo - SP',
            contactPhone: '(11) 3100-4400',
        },
    });
    // 6. Criar Alunos
    const student1 = await prisma.student.create({
        data: {
            tenantId: tenant.id,
            parentId: parentMaria.id,
            schoolId: schoolA.id,
            name: 'João Rodrigues',
            grade: '6º Ano A',
            shift: client_1.Shift.MORNING,
            pickupAddress: 'Rua Haddock Lobo, 400 - Cerqueira César',
            dropoffAddress: 'Av. Paulista, 1500',
            monthlyFee: 580.00,
            dueDay: 10,
        },
    });
    const student2 = await prisma.student.create({
        data: {
            tenantId: tenant.id,
            parentId: parentMaria.id,
            schoolId: schoolA.id,
            name: 'Ana Rodrigues',
            grade: '3º Ano B',
            shift: client_1.Shift.MORNING,
            pickupAddress: 'Rua Haddock Lobo, 400 - Cerqueira César',
            dropoffAddress: 'Av. Paulista, 1500',
            monthlyFee: 520.00,
            dueDay: 10,
        },
    });
    const student3 = await prisma.student.create({
        data: {
            tenantId: tenant.id,
            schoolId: schoolB.id,
            name: 'Pedro Henrique Lima',
            grade: '7º Ano C',
            shift: client_1.Shift.MORNING,
            pickupAddress: 'Rua Bela Cintra, 950 - Consolação',
            dropoffAddress: 'Rua Augusta, 800',
            monthlyFee: 600.00,
            dueDay: 5,
        },
    });
    // 7. Criar Rota Escolar e Waypoints
    const routeMorning = await prisma.route.create({
        data: {
            tenantId: tenant.id,
            vehicleId: van01.id,
            driverId: driverCarlos.id,
            name: 'Rota Manhã - Colégio Dom Pedro II',
            shift: client_1.Shift.MORNING,
            estimatedDistanceKm: 18.5,
            estimatedDurationMin: 45,
        },
    });
    await prisma.routeWaypoint.createMany({
        data: [
            { routeId: routeMorning.id, studentId: student1.id, orderIndex: 1, estimatedTime: '06:30', type: 'PICKUP' },
            { routeId: routeMorning.id, studentId: student2.id, orderIndex: 2, estimatedTime: '06:32', type: 'PICKUP' },
            { routeId: routeMorning.id, studentId: student3.id, orderIndex: 3, estimatedTime: '06:45', type: 'PICKUP' },
        ],
    });
    // Presença do dia
    const today = new Date();
    await prisma.attendance.create({
        data: {
            tenantId: tenant.id,
            routeId: routeMorning.id,
            studentId: student1.id,
            date: today,
            status: client_1.AttendanceStatus.BOARDED,
            pickupTime: new Date(),
        },
    });
    await prisma.attendance.create({
        data: {
            tenantId: tenant.id,
            routeId: routeMorning.id,
            studentId: student2.id,
            date: today,
            status: client_1.AttendanceStatus.BOARDED,
            pickupTime: new Date(),
        },
    });
    await prisma.attendance.create({
        data: {
            tenantId: tenant.id,
            routeId: routeMorning.id,
            studentId: student3.id,
            date: today,
            status: client_1.AttendanceStatus.PENDING,
        },
    });
    // 8. Fretes Agendados
    await prisma.freight.create({
        data: {
            tenantId: tenant.id,
            vehicleId: van02.id,
            clientName: 'Empresa TechCorp - Viagem Corporativa',
            clientPhone: '(11) 99999-5555',
            serviceType: 'EVENT',
            originAddress: 'Av. Brigadeiro Faria Lima, 2000',
            destinationAddress: 'Hotel Fasano Boa Vista - Porto Feliz/SP',
            distanceKm: 110.0,
            estimatedFuelCost: 145.00,
            tollCost: 48.00,
            suggestedPrice: 950.00,
            finalPrice: 1100.00,
            scheduledDate: new Date('2026-09-12T14:00:00Z'),
            status: client_1.FreightStatus.APPROVED,
        },
    });
    // 9. Lançamentos Financeiros (DRE Agasto e Setembro)
    await prisma.financialTransaction.createMany({
        data: [
            // Receitas
            { tenantId: tenant.id, vehicleId: van01.id, type: client_1.TransactionType.INCOME, category: client_1.TransactionCategory.MONTHLY_FEE, description: 'Mensalidades Escolares Van 01 (42 Alunos)', amount: 14800.00, dueDate: new Date('2026-09-10'), paymentDate: new Date('2026-09-08'), paid: true, referenceMonth: '2026-09' },
            { tenantId: tenant.id, vehicleId: van02.id, type: client_1.TransactionType.INCOME, category: client_1.TransactionCategory.FREIGHT_REVENUE, description: 'Frete Fim de Semana - Viagem Campos do Jordão', amount: 2400.00, dueDate: new Date('2026-09-05'), paymentDate: new Date('2026-09-05'), paid: true, referenceMonth: '2026-09' },
            // Despesas
            { tenantId: tenant.id, vehicleId: van01.id, type: client_1.TransactionType.EXPENSE, category: client_1.TransactionCategory.FUEL, description: 'Abastecimentos Diesel S10 - Van 01', amount: 2150.00, dueDate: new Date('2026-09-08'), paymentDate: new Date('2026-09-08'), paid: true, referenceMonth: '2026-09' },
            { tenantId: tenant.id, vehicleId: van01.id, type: client_1.TransactionType.EXPENSE, category: client_1.TransactionCategory.MAINTENANCE, description: 'Troca de Óleo e Filtros Van 01', amount: 650.00, dueDate: new Date('2026-08-15'), paymentDate: new Date('2026-08-15'), paid: true, referenceMonth: '2026-09' },
            { tenantId: tenant.id, vehicleId: van01.id, type: client_1.TransactionType.EXPENSE, category: client_1.TransactionCategory.SALARY, description: 'Salário Motorista Carlos', amount: 3500.00, dueDate: new Date('2026-09-05'), paymentDate: new Date('2026-09-05'), paid: true, referenceMonth: '2026-09' },
            { tenantId: tenant.id, vehicleId: van01.id, type: client_1.TransactionType.EXPENSE, category: client_1.TransactionCategory.INSURANCE, description: 'Seguro Mensal Frota Van 01', amount: 420.00, dueDate: new Date('2026-09-15'), paid: false, referenceMonth: '2026-09' },
        ],
    });
    // 10. CRM Leads
    await prisma.crmLead.create({
        data: {
            tenantId: tenant.id,
            parentName: 'Fernando Alcantara',
            phone: '(11) 94444-8888',
            schoolName: 'Colégio Dom Pedro II',
            neighborhood: 'Jardins',
            shift: client_1.Shift.MORNING,
            status: client_1.LeadStatus.PROPOSAL_SENT,
            notes: 'Solicitou cotação para 2 filhos no turno da manhã.',
        },
    });
    console.log('✅ Seed executado com sucesso!');
    console.log('🔑 Credenciais de Acesso:');
    console.log('   Frotista:  roberto@transvan.com.br / 123456');
    console.log('   Motorista: carlos@transvan.com.br  / 123456');
    console.log('   Mãe/Pais:  maria@gmail.com        / 123456');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
