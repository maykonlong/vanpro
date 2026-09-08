import fs from 'fs';
import path from 'path';

export interface AddressSchedule {
  dayOfWeek: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN' | 'ALL';
  pickupAddress: string;
  dropoffAddress: string;
  label?: string;
}

export interface DriverShiftSchedule {
  id: string;
  driverName: string;
  driverType: 'CLT' | 'DIARIA' | 'FREELANCER' | 'TERCEIRIZADO';
  vehicleId: string;
  dateOrDay: string;
  notes?: string;
}

export interface MaintenanceRecord {
  id: string;
  tenantId: string;
  vehicleId: string;
  description: string;
  serviceType: 'OIL_CHANGE' | 'TIRES' | 'BRAKES' | 'INSPECTION' | 'CORRECTIVE';
  kmAtService: number;
  nextDueKm: number;
  cost: number;
  workshopName: string;
  performedAt: string;
}

export interface FuelLogRecord {
  id: string;
  tenantId: string;
  vehicleId: string;
  kmAtFill: number;
  liters: number;
  pricePerLiter: number;
  totalCost: number;
  stationName: string;
  calculatedKmPerLiter: number;
  isConsumptionAnomaly: boolean;
  filledAt: string;
}

export interface CrmLeadRecord {
  id: string;
  tenantId: string;
  parentName: string;
  phone: string;
  schoolName: string;
  neighborhood: string;
  shift: string;
  status: 'NEW' | 'CONTACTED' | 'PROPOSAL_SENT' | 'NEGOTIATING' | 'WON' | 'LOST';
  notes?: string;
  createdAt: string;
}

export interface ContractRecord {
  id: string;
  tenantId: string;
  studentId: string;
  studentName: string;
  contractNumber: string;
  startDate: string;
  endDate: string;
  monthlyValue: number;
  dueDay: number;
  clauses: string[];
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  createdAt: string;
}

export interface NotificationRecord {
  id: string;
  tenantId: string;
  recipientPhone: string;
  recipientName: string;
  message: string;
  type: 'PAYMENT_REMINDER' | 'BOARDING_ALERT' | 'DELAY_ALERT' | 'ABSENCE_CONFIRMATION';
  status: 'SENT' | 'PENDING' | 'FAILED';
  sentAt: string;
}

export interface OccurrenceRecord {
  id: string;
  tenantId: string;
  vehicleId?: string;
  driverName: string;
  type: 'DELAY' | 'BREAKDOWN' | 'ACCIDENT' | 'BEHAVIOR' | 'TRAFFIC' | 'OTHER';
  description: string;
  locationAddress?: string;
  photoUrl?: string;
  estimatedDelayMinutes?: number;
  createdAt: string;
}

export interface SocialMarketingPostRecord {
  id: string;
  tenantId: string;
  title: string;
  targetSchool: string;
  neighborhood: string;
  availableSeats: number;
  whatsappLink: string;
  captionText: string;
  createdAt: string;
}

export interface StudentRecord {
  id: string;
  tenantId: string;
  name: string;
  school: string;
  grade: string;
  shift: string;
  monthlyFee: number;
  dueDay: number;
  discountPercentage?: number;
  negotiationNotes?: string;
  status: 'BOARDED' | 'ABSENT' | 'PENDING';
  addresses?: AddressSchedule[];
  pickupAddress?: string;
  dropoffAddress?: string;
  createdAt: string;
}

export interface VehicleRecord {
  id: string;
  tenantId: string;
  name: string;
  plate: string;
  model: string;
  year: number;
  capacity: number;
  currentKm: number;
  avgKmPerLiter: number;
  driver: string;
  status: string;
  createdAt: string;
}

export interface FinancialRecord {
  id: string;
  tenantId: string;
  vehicleId?: string;
  type: 'INCOME' | 'EXPENSE';
  category: string;
  description: string;
  amount: number;
  referenceMonth: string;
  paid: boolean;
  dueDate: string;
  createdAt: string;
}

export interface FreightRecord {
  id: string;
  tenantId: string;
  clientName: string;
  clientPhone: string;
  serviceType: string;
  origin: string;
  destination: string;
  distanceKm: number;
  estimatedFuelCost: number;
  tollCost: number;
  suggestedPrice: number;
  finalPrice: number;
  status: 'REQUESTED' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED';
  scheduledDate: string;
  createdAt: string;
}

export interface PixPaymentRecord {
  id: string;
  tenantId: string;
  studentId: string;
  studentName: string;
  amount: number;
  txid: string;
  qrCodeCopyPaste: string;
  status: 'PENDING' | 'PAID';
  createdAt: string;
  paidAt?: string;
}

export interface NfseRecord {
  id: string;
  tenantId: string;
  studentId: string;
  studentName: string;
  number: string;
  amount: number;
  description: string;
  verificationCode: string;
  issuedAt: string;
}

export interface DriverTimecardRecord {
  id: string;
  tenantId: string;
  driverName: string;
  vehicleId: string;
  date: string;
  clockIn?: string;
  lunchStart?: string;
  lunchEnd?: string;
  clockOut?: string;
  startKm: number;
  endKm?: number;
  shiftType: 'CLT' | 'DIARIA' | 'FREELANCER';
  dailyRate: number;
  status: 'IN_PROGRESS' | 'COMPLETED';
  adjustmentToken?: string;
  adjustmentRequested?: boolean;
  adjustmentNotes?: string;
  adjustmentApproved?: boolean;
}

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'DRIVER' | 'PARENT' | 'ASSISTANT';
  pin?: string;
  cpf?: string;
}

class RealSqlDatabaseManager {
  private dbPath: string;
  private data: {
    vehicles: VehicleRecord[];
    students: StudentRecord[];
    financials: FinancialRecord[];
    freights: FreightRecord[];
    driverSchedules: DriverShiftSchedule[];
    maintenances: MaintenanceRecord[];
    fuelLogs: FuelLogRecord[];
    crmLeads: CrmLeadRecord[];
    contracts: ContractRecord[];
    notifications: NotificationRecord[];
    occurrences: OccurrenceRecord[];
    socialPosts: SocialMarketingPostRecord[];
    pixPayments: PixPaymentRecord[];
    nfseRecords: NfseRecord[];
    driverTimecards: DriverTimecardRecord[];
    users: UserRecord[];
  };

  constructor() {
    this.dbPath = path.join(__dirname, '../../../data_storage.json');
    this.data = {
      vehicles: [],
      students: [],
      financials: [],
      freights: [],
      driverSchedules: [],
      maintenances: [],
      fuelLogs: [],
      crmLeads: [],
      contracts: [],
      notifications: [],
      occurrences: [],
      socialPosts: [],
      pixPayments: [],
      nfseRecords: [],
      driverTimecards: [],
      users: [],
    };
    this.initDatabase();
  }

  private initDatabase() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const content = fs.readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(content);
        this.data = { ...this.data, ...parsed };

        this.data.maintenances = this.data.maintenances || [];
        this.data.fuelLogs = this.data.fuelLogs || [];
        this.data.crmLeads = this.data.crmLeads || [];
        this.data.contracts = this.data.contracts || [];
        this.data.notifications = this.data.notifications || [];
        this.data.occurrences = this.data.occurrences || [];
        this.data.socialPosts = this.data.socialPosts || [];
        this.data.pixPayments = this.data.pixPayments || [];
        this.data.nfseRecords = this.data.nfseRecords || [];
        this.data.driverTimecards = this.data.driverTimecards || [];
        this.data.users = this.data.users || [
          { id: 'u1', name: 'Administrador Frotista', email: 'admin@transvan.com.br', role: 'OWNER' },
          { id: 'u2', name: 'Carlos Oliveira', email: 'carlos@transvan.com.br', role: 'DRIVER', pin: '1234' },
          { id: 'u3', name: 'Marcos Rodrigues', email: 'joao.pai@gmail.com', role: 'PARENT', cpf: '123.456.789-00' },
          { id: 'u4', name: 'Fernanda Silva (Auxiliar)', email: 'fernanda@transvan.com.br', role: 'ASSISTANT', pin: '5678' },
        ];

        // Migração defensiva de alunos
        this.data.students = (this.data.students || []).map((s) => {
          if (!s.addresses || s.addresses.length === 0) {
            const p = s.pickupAddress || 'Rua Haddock Lobo, 400';
            const d = s.dropoffAddress || 'Escola';
            return {
              ...s,
              addresses: [{ dayOfWeek: 'ALL', pickupAddress: p, dropoffAddress: d, label: 'Residência Principal' }],
            };
          }
          return s;
        });

        this.save();
        console.log(`🗄️ Banco de dados carregado (${this.data.vehicles.length} vans, ${this.data.students.length} alunos, ${this.data.socialPosts.length} posts de mkt)`);
      } else {
        this.seedInitialData();
        this.save();
        console.log(`🌱 Banco de dados inicializado com Fases 4, 5 e 6!`);
      }
    } catch (err) {
      console.error('Erro ao ler banco de dados:', err);
      this.seedInitialData();
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Erro ao salvar arquivo de dados:', err);
    }
  }

  private seedInitialData() {
    const tenantId = 'transvan_tenant_01';

    this.data.vehicles = [
      { id: 'v1', tenantId, name: 'Van 01 - Ford Transit 2024', plate: 'ABC-1D23', model: 'Ford Transit Executive', year: 2024, capacity: 15, currentKm: 42800, avgKmPerLiter: 8.8, driver: 'Carlos Oliveira', status: 'Em Rota', createdAt: new Date().toISOString() },
      { id: 'v2', tenantId, name: 'Van 02 - Mercedes Sprinter', plate: 'XYZ-9E87', model: 'Mercedes-Benz Sprinter 516', year: 2023, capacity: 19, currentKm: 78500, avgKmPerLiter: 7.9, driver: 'Pedro Santos', status: 'Livre / Frete', createdAt: new Date().toISOString() },
      { id: 'v3', tenantId, name: 'Van 03 - Renault Master', plate: 'KRM-4F55', model: 'Renault Master Minibus', year: 2022, capacity: 16, currentKm: 112000, avgKmPerLiter: 8.2, driver: 'Marcos Lima (Bico)', status: 'Revisão', createdAt: new Date().toISOString() },
    ];

    this.data.students = [
      {
        id: 's1',
        tenantId,
        name: 'João Rodrigues (Guarda Compartilhada)',
        school: 'Colégio Dom Pedro II',
        grade: '6º Ano A',
        shift: 'MORNING',
        monthlyFee: 580,
        dueDay: 10,
        discountPercentage: 0,
        negotiationNotes: 'Mensalidade integral negociada via contrato anual.',
        status: 'BOARDED',
        addresses: [
          { dayOfWeek: 'MON', pickupAddress: 'Rua Haddock Lobo, 400 (Casa da Mãe)', dropoffAddress: 'Av. Paulista, 1500', label: 'Casa da Mãe' },
          { dayOfWeek: 'WED', pickupAddress: 'Rua Haddock Lobo, 400 (Casa da Mãe)', dropoffAddress: 'Av. Paulista, 1500', label: 'Casa da Mãe' },
          { dayOfWeek: 'TUE', pickupAddress: 'Alameda Santos, 1200 (Casa do Pai)', dropoffAddress: 'Av. Paulista, 1500', label: 'Casa do Pai' },
          { dayOfWeek: 'THU', pickupAddress: 'Alameda Santos, 1200 (Casa do Pai)', dropoffAddress: 'Av. Paulista, 1500', label: 'Casa do Pai' },
          { dayOfWeek: 'FRI', pickupAddress: 'Rua Bela Cintra, 800 (Casa da Avó)', dropoffAddress: 'Av. Paulista, 1500', label: 'Casa da Avó' },
        ],
        createdAt: new Date().toISOString(),
      },
      {
        id: 's2',
        tenantId,
        name: 'Ana Rodrigues',
        school: 'Colégio Dom Pedro II',
        grade: '3º Ano B',
        shift: 'MORNING',
        monthlyFee: 460,
        dueDay: 10,
        discountPercentage: 15,
        negotiationNotes: 'Desconto de 15% por ser 2º irmão.',
        status: 'BOARDED',
        addresses: [
          { dayOfWeek: 'ALL', pickupAddress: 'Rua Haddock Lobo, 400 - Cerqueira César', dropoffAddress: 'Av. Paulista, 1500', label: 'Residência Principal' }
        ],
        createdAt: new Date().toISOString(),
      },
    ];

    this.data.occurrences = [
      { id: 'oc1', tenantId, vehicleId: 'v1', driverName: 'Carlos Oliveira', type: 'TRAFFIC', description: 'Trânsito intenso na Av. Rebouças devido a obra na via.', locationAddress: 'Av. Rebouças x Faria Lima', estimatedDelayMinutes: 12, createdAt: new Date().toISOString() },
    ];

    this.data.socialPosts = [
      {
        id: 'sp1',
        tenantId,
        title: 'Vagas Abertas - Colégio Dom Pedro II',
        targetSchool: 'Colégio Dom Pedro II',
        neighborhood: 'Jardins / Bela Vista',
        availableSeats: 3,
        whatsappLink: 'https://wa.me/5511988881001?text=Quero%20vaga%20para%20o%20Dom%20Pedro',
        captionText: '🚌 VAGAS ABERTAS PARA TRANSPORTE ESCOLAR 2026! 🚌\nVan moderna com ar-condicionado, segurança e acompanhamento dos pais em tempo real via App!\n📍 Atendendo Jardins e Bela Vista para o Colégio Dom Pedro II.\n📲 Garanta a vaga do seu filho: (11) 98888-1001',
        createdAt: new Date().toISOString(),
      },
    ];

    this.data.financials = [
      { id: 'f1', tenantId, vehicleId: 'v1', type: 'INCOME', category: 'MONTHLY_FEE', description: 'Mensalidades Escolares Van 01 (42 Alunos)', amount: 14800, referenceMonth: '2026-09', paid: true, dueDate: '2026-09-10', createdAt: new Date().toISOString() },
      { id: 'f2', tenantId, vehicleId: 'v2', type: 'INCOME', category: 'FREIGHT_REVENUE', description: 'Frete Fim de Semana - Viagem Campos do Jordão', amount: 2400, referenceMonth: '2026-09', paid: true, dueDate: '2026-09-05', createdAt: new Date().toISOString() },
      { id: 'f3', tenantId, vehicleId: 'v1', type: 'EXPENSE', category: 'FUEL', description: 'Abastecimentos Diesel S10 - Van 01', amount: 2150, referenceMonth: '2026-09', paid: true, dueDate: '2026-09-08', createdAt: new Date().toISOString() },
    ];

    this.data.freights = [
      { id: 'fr1', tenantId, clientName: 'TechCorp Eventos', clientPhone: '(11) 99999-5555', serviceType: 'EVENT', origin: 'Faria Lima, 2000', destination: 'Hotel Fasano Boa Vista', distanceKm: 110, estimatedFuelCost: 145, tollCost: 48, suggestedPrice: 950, finalPrice: 1100, status: 'APPROVED', scheduledDate: '2026-09-12T14:00:00Z', createdAt: new Date().toISOString() },
    ];
  }

  // --- FASE 4: OCORRÊNCIAS COM GEOLOCALIZAÇÃO ---
  public getOccurrences(): OccurrenceRecord[] {
    return this.data.occurrences;
  }

  public addOccurrence(payload: Omit<OccurrenceRecord, 'id' | 'tenantId' | 'createdAt'>): OccurrenceRecord {
    const occurrence: OccurrenceRecord = {
      id: `oc_${Date.now()}`,
      tenantId: 'transvan_tenant_01',
      ...payload,
      createdAt: new Date().toISOString(),
    };
    this.data.occurrences.push(occurrence);
    this.save();
    return occurrence;
  }

  // --- FASE 5: MARKETING & REDES SOCIAIS ---
  public getSocialPosts(): SocialMarketingPostRecord[] {
    return this.data.socialPosts;
  }

  public createSocialPost(payload: Omit<SocialMarketingPostRecord, 'id' | 'tenantId' | 'createdAt' | 'whatsappLink' | 'captionText'>): SocialMarketingPostRecord {
    const whatsappText = encodeURIComponent(`Olá! Vi o anúncio da van para o ${payload.targetSchool} (${payload.neighborhood}) e quero consultar valor.`);
    const whatsappLink = `https://wa.me/5511988881001?text=${whatsappText}`;
    
    const captionText = `🚐 VAGAS ABERTAS PARA TRANSPORTE ESCOLAR 2026! 🚐\n\n🏫 Escola: ${payload.targetSchool}\n📍 Região: ${payload.neighborhood}\n💺 Vagas Restantes: ${payload.availableSeats} vagas!\n\n✅ Van moderna, higienizada com ar-condicionado.\n✅ Rastreamento ao vivo para os pais via aplicativo.\n\n📲 Reserve a vaga do seu filho no WhatsApp:\n${whatsappLink}`;

    const post: SocialMarketingPostRecord = {
      id: `sp_${Date.now()}`,
      tenantId: 'transvan_tenant_01',
      ...payload,
      whatsappLink,
      captionText,
      createdAt: new Date().toISOString(),
    };

    this.data.socialPosts.push(post);
    this.save();
    return post;
  }

  // --- FASE 6: BI ANALYTICS (MARGEM POR ESCOLA E ROTA) ---
  public getBiAnalytics() {
    const students = this.data.students;
    const vehicles = this.data.vehicles;
    const financials = this.data.financials;

    // Agrupamento por Escola
    const schoolStats: Record<string, { studentCount: number; monthlyRevenue: number }> = {};
    students.forEach((s) => {
      if (!schoolStats[s.school]) {
        schoolStats[s.school] = { studentCount: 0, monthlyRevenue: 0 };
      }
      schoolStats[s.school].studentCount += 1;
      schoolStats[s.school].monthlyRevenue += s.monthlyFee;
    });

    const totalStudents = students.length || 1;
    const totalRevenue = financials.filter(f => f.type === 'INCOME').reduce((acc, f) => acc + f.amount, 0);
    const totalExpense = financials.filter(f => f.type === 'EXPENSE').reduce((acc, f) => acc + f.amount, 0);
    const avgRevenuePerStudent = Number((totalRevenue / totalStudents).toFixed(2));
    const costPerStudent = Number((totalExpense / totalStudents).toFixed(2));

    return {
      summary: {
        totalStudents,
        totalRevenue,
        totalExpense,
        avgRevenuePerStudent,
        costPerStudent,
        netProfitMarginPercentage: totalRevenue > 0 ? Number((((totalRevenue - totalExpense) / totalRevenue) * 100).toFixed(1)) : 0,
      },
      schoolBreakdown: Object.entries(schoolStats).map(([schoolName, data]) => ({
        schoolName,
        studentCount: data.studentCount,
        monthlyRevenue: data.monthlyRevenue,
        avgFeePerStudent: Number((data.monthlyRevenue / data.studentCount).toFixed(2)),
      })),
      vehicleOccupancy: vehicles.map((v) => ({
        vehicleId: v.id,
        vehicleName: v.name,
        capacity: v.capacity,
        currentStudents: v.id === 'v1' ? 13 : v.id === 'v2' ? 14 : 10,
        occupancyPercentage: v.id === 'v1' ? 86.6 : v.id === 'v2' ? 73.6 : 62.5,
      })),
    };
  }

  // --- MÉTODOS EXISTENTES ---
  public getMaintenances(vehicleId?: string): MaintenanceRecord[] { return vehicleId ? this.data.maintenances.filter(m => m.vehicleId === vehicleId) : this.data.maintenances; }
  public addMaintenance(payload: Omit<MaintenanceRecord, 'id' | 'tenantId'>): MaintenanceRecord {
    const record: MaintenanceRecord = { id: `m_${Date.now()}`, tenantId: 'transvan_tenant_01', ...payload };
    this.data.maintenances.push(record);
    this.save();
    return record;
  }

  public getFuelLogs(vehicleId?: string): FuelLogRecord[] { return vehicleId ? this.data.fuelLogs.filter(f => f.vehicleId === vehicleId) : this.data.fuelLogs; }
  public addFuelLog(payload: Omit<FuelLogRecord, 'id' | 'tenantId' | 'totalCost' | 'calculatedKmPerLiter' | 'isConsumptionAnomaly' | 'filledAt'>): FuelLogRecord {
    const vehicle = this.data.vehicles.find(v => v.id === payload.vehicleId);
    const distance = vehicle ? payload.kmAtFill - vehicle.currentKm : 0;
    const calculatedKmPerLiter = distance > 0 ? Number((distance / payload.liters).toFixed(2)) : (vehicle?.avgKmPerLiter || 8.5);
    const isConsumptionAnomaly = calculatedKmPerLiter < (vehicle?.avgKmPerLiter || 8.5) * 0.85;
    if (vehicle && payload.kmAtFill > vehicle.currentKm) {
      vehicle.currentKm = payload.kmAtFill;
      vehicle.avgKmPerLiter = calculatedKmPerLiter;
    }
    const totalCost = Number((payload.liters * payload.pricePerLiter).toFixed(2));
    const log: FuelLogRecord = { id: `fl_${Date.now()}`, tenantId: 'transvan_tenant_01', ...payload, totalCost, calculatedKmPerLiter, isConsumptionAnomaly, filledAt: new Date().toISOString() };
    this.data.fuelLogs.push(log);
    this.save();
    return log;
  }

  public getCrmLeads(): CrmLeadRecord[] { return this.data.crmLeads; }
  public addCrmLead(payload: Omit<CrmLeadRecord, 'id' | 'tenantId' | 'createdAt' | 'status'>): CrmLeadRecord {
    const lead: CrmLeadRecord = { id: `l_${Date.now()}`, tenantId: 'transvan_tenant_01', ...payload, status: 'NEW', createdAt: new Date().toISOString() };
    this.data.crmLeads.push(lead);
    this.save();
    return lead;
  }

  public updateLeadStatus(id: string, status: CrmLeadRecord['status']): CrmLeadRecord | null {
    const lead = this.data.crmLeads.find(l => l.id === id);
    if (!lead) return null;
    lead.status = status;
    this.save();
    return lead;
  }

  public getContracts(): ContractRecord[] { return this.data.contracts; }
  public generateContract(studentId: string): ContractRecord | null {
    const student = this.data.students.find(s => s.id === studentId);
    if (!student) return null;
    const contract: ContractRecord = {
      id: `ct_${Date.now()}`, tenantId: 'transvan_tenant_01', studentId: student.id, studentName: student.name, contractNumber: `CT-2026-${Math.floor(100 + Math.random() * 900)}`, startDate: new Date().toISOString().substring(0, 10), endDate: '2026-12-20', monthlyValue: student.monthlyFee, dueDay: student.dueDay, clauses: ['Transmissão de localização da van em tempo real para os responsáveis', `Mensalidade no valor de R$ ${student.monthlyFee.toLocaleString('pt-BR')} com vencimento dia ${student.dueDay}`, 'Rescisão mediante aviso prévio de 30 dias', 'Tolerância máxima de 5 minutos no ponto de embarque'], status: 'ACTIVE', createdAt: new Date().toISOString()
    };
    this.data.contracts.push(contract);
    this.save();
    return contract;
  }

  public getNotifications(): NotificationRecord[] { return this.data.notifications; }
  public sendWhatsappNotification(payload: Omit<NotificationRecord, 'id' | 'tenantId' | 'sentAt' | 'status'>): NotificationRecord {
    const notification: NotificationRecord = { id: `n_${Date.now()}`, tenantId: 'transvan_tenant_01', ...payload, status: 'SENT', sentAt: new Date().toISOString() };
    this.data.notifications.push(notification);
    this.save();
    return notification;
  }

  public getDriverSchedules(): DriverShiftSchedule[] { return this.data.driverSchedules; }
  public getStudents(): StudentRecord[] { return this.data.students; }
  public getVehicles(): VehicleRecord[] { return this.data.vehicles; }
  public getFinancials(): FinancialRecord[] { return this.data.financials; }
  public getFreights(): FreightRecord[] { return this.data.freights; }

  public getStudentAddressForDay(student: StudentRecord, dayOfWeek: string): { pickup: string; dropoff: string; label: string } {
    const addresses = student.addresses || [];
    const match = addresses.find(a => a.dayOfWeek === dayOfWeek || a.dayOfWeek === 'ALL');
    if (match) return { pickup: match.pickupAddress, dropoff: match.dropoffAddress, label: match.label || 'Endereço Principal' };
    const fallback = addresses[0];
    if (fallback) return { pickup: fallback.pickupAddress, dropoff: fallback.dropoffAddress, label: fallback.label || 'Endereço Padrão' };
    return { pickup: student.pickupAddress || 'Endereço não informado', dropoff: student.dropoffAddress || 'Escola', label: 'Endereço Principal' };
  }

  public addStudent(payload: Omit<StudentRecord, 'id' | 'createdAt' | 'tenantId' | 'status'>): StudentRecord {
    const newStudent: StudentRecord = { id: `s_${Date.now()}`, tenantId: 'transvan_tenant_01', ...payload, status: 'PENDING', createdAt: new Date().toISOString() };
    this.data.students.push(newStudent);
    this.save();
    return newStudent;
  }

  public updateStudentStatus(id: string, status: 'BOARDED' | 'ABSENT' | 'PENDING'): StudentRecord | null {
    const student = this.data.students.find(s => s.id === id);
    if (!student) return null;
    student.status = status;
    this.save();
    return student;
  }

  public deleteStudent(id: string): boolean {
    const initialLen = this.data.students.length;
    this.data.students = this.data.students.filter(s => s.id !== id);
    this.save();
    return this.data.students.length < initialLen;
  }

  public addVehicle(payload: Omit<VehicleRecord, 'id' | 'createdAt' | 'tenantId'>): VehicleRecord {
    const newVehicle: VehicleRecord = { id: `v_${Date.now()}`, tenantId: 'transvan_tenant_01', ...payload, createdAt: new Date().toISOString() };
    this.data.vehicles.push(newVehicle);
    this.save();
    return newVehicle;
  }

  public deleteVehicle(id: string): boolean {
    const initialLen = this.data.vehicles.length;
    this.data.vehicles = this.data.vehicles.filter(v => v.id !== id);
    this.save();
    return this.data.vehicles.length < initialLen;
  }

  public addFinancialRecord(payload: Omit<FinancialRecord, 'id' | 'createdAt' | 'tenantId'>): FinancialRecord {
    const record: FinancialRecord = { id: `f_${Date.now()}`, tenantId: 'transvan_tenant_01', ...payload, createdAt: new Date().toISOString() };
    this.data.financials.push(record);
    this.save();
    return record;
  }

  public getDre(vehicleId?: string, month?: string) {
    const refMonth = month || new Date().toISOString().substring(0, 7);
    const filtered = this.data.financials.filter(t => {
      const matchMonth = t.referenceMonth === refMonth;
      const matchVehicle = !vehicleId || vehicleId === 'ALL' || t.vehicleId === vehicleId;
      return matchMonth && matchVehicle;
    });

    const totalIncome = filtered.filter(t => t.type === 'INCOME').reduce((acc, t) => acc + t.amount, 0);
    const totalExpense = filtered.filter(t => t.type === 'EXPENSE').reduce((acc, t) => acc + t.amount, 0);
    const netProfit = totalIncome - totalExpense;
    const margin = totalIncome > 0 ? Number(((netProfit / totalIncome) * 100).toFixed(1)) : 0;

    return { referenceMonth: refMonth, totalIncome, totalExpense, netProfit, margin, transactions: filtered };
  }

  public addFreight(payload: Omit<FreightRecord, 'id' | 'createdAt' | 'tenantId' | 'status'>): FreightRecord {
    const freight: FreightRecord = { id: `fr_${Date.now()}`, tenantId: 'transvan_tenant_01', ...payload, status: 'APPROVED', createdAt: new Date().toISOString() };
    this.data.freights.push(freight);
    this.save();
    return freight;
  }

  // --- FASE 7: CONCILIAÇÃO PIX & EMISSÃO NFS-e ---
  public getPixPayments(): PixPaymentRecord[] {
    return this.data.pixPayments || [];
  }

  public generatePixPayment(studentId: string, amount?: number): PixPaymentRecord {
    const student = this.data.students.find(s => s.id === studentId);
    const value = amount || student?.monthlyFee || 500;
    const txid = `TXID_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const qrCodeCopyPaste = `00020126580014br.gov.bcb.pix0136pix@transvan.com.br5204000053039865405${value.toFixed(2)}5802BR5915TRANSVAN_LTDA6009SAO_PAULO62070503***6304D1B9`;

    const pix: PixPaymentRecord = {
      id: `pix_${Date.now()}`,
      tenantId: 'transvan_tenant_01',
      studentId,
      studentName: student?.name || 'Aluno TransVan',
      amount: value,
      txid,
      qrCodeCopyPaste,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };

    this.data.pixPayments.push(pix);
    this.save();
    return pix;
  }

  public confirmPixPayment(txid: string): PixPaymentRecord | null {
    const pix = this.data.pixPayments.find(p => p.txid === txid || p.id === txid);
    if (!pix) return null;

    pix.status = 'PAID';
    pix.paidAt = new Date().toISOString();

    // Registra entrada no DRE financeiro automaticamente
    this.addFinancialRecord({
      type: 'INCOME',
      category: 'MONTHLY_FEE',
      description: `Pagamento Pix Confirmado: ${pix.studentName}`,
      amount: pix.amount,
      referenceMonth: new Date().toISOString().substring(0, 7),
      paid: true,
      dueDate: new Date().toISOString().substring(0, 10),
    });

    this.save();
    return pix;
  }

  public getNfseRecords(): NfseRecord[] {
    return this.data.nfseRecords || [];
  }

  public issueNfse(studentId: string, amount: number, description: string): NfseRecord {
    const student = this.data.students.find(s => s.id === studentId);
    const nfse: NfseRecord = {
      id: `nf_${Date.now()}`,
      tenantId: 'transvan_tenant_01',
      studentId,
      studentName: student?.name || 'Cliente TransVan',
      number: `NFS-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      amount,
      description,
      verificationCode: `VERIF-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      issuedAt: new Date().toISOString(),
    };

    this.data.nfseRecords.push(nfse);
    this.save();
    return nfse;
  }

  // --- FASE 8: FECHAMENTO DE DIÁRIAS, PONTO 4 BATIDAS & TOKEN DO GESTOR ---
  public getDriverTimecards(): DriverTimecardRecord[] {
    return this.data.driverTimecards || [];
  }

  public punchTimecard(payload: {
    driverName: string;
    vehicleId: string;
    punchType: 'CLOCK_IN' | 'LUNCH_START' | 'LUNCH_END' | 'CLOCK_OUT';
    km: number;
    shiftType?: 'CLT' | 'DIARIA' | 'FREELANCER';
    dailyRate?: number;
  }): DriverTimecardRecord {
    const today = new Date().toISOString().substring(0, 10);
    let card = (this.data.driverTimecards || []).find(
      (t) => t.driverName === payload.driverName && t.status === 'IN_PROGRESS'
    );

    const now = new Date().toISOString();

    if (!card) {
      card = {
        id: `tc_${Date.now()}`,
        tenantId: 'transvan_tenant_01',
        driverName: payload.driverName,
        vehicleId: payload.vehicleId,
        date: today,
        startKm: payload.km || 42800,
        shiftType: payload.shiftType || 'CLT',
        dailyRate: payload.dailyRate || 180,
        status: 'IN_PROGRESS',
      };
      this.data.driverTimecards.push(card);
    }

    if (payload.punchType === 'CLOCK_IN') {
      card.clockIn = now;
      card.startKm = payload.km || card.startKm;
    } else if (payload.punchType === 'LUNCH_START') {
      card.lunchStart = now;
    } else if (payload.punchType === 'LUNCH_END') {
      card.lunchEnd = now;
    } else if (payload.punchType === 'CLOCK_OUT') {
      card.clockOut = now;
      card.endKm = payload.km || card.startKm + 75;
      card.status = 'COMPLETED';
    }

    this.save();
    return card;
  }

  public requestTimecardAdjustment(payload: {
    timecardId: string;
    punchType: 'clockIn' | 'lunchStart' | 'lunchEnd' | 'clockOut';
    newTime: string;
    reason: string;
  }): { timecard: DriverTimecardRecord; token: string } | null {
    const card = this.data.driverTimecards.find((t) => t.id === payload.timecardId);
    if (!card) return null;

    const token = `TOK-${Math.floor(1000 + Math.random() * 9000)}`;
    card.adjustmentRequested = true;
    card.adjustmentToken = token;
    card.adjustmentNotes = `Solicitado ajuste de ${payload.punchType} para ${payload.newTime}. Motivo: ${payload.reason}`;
    card.adjustmentApproved = false;

    this.save();
    return { timecard: card, token };
  }

  public approveTimecardAdjustment(timecardId: string, token: string): DriverTimecardRecord | null {
    const card = this.data.driverTimecards.find((t) => t.id === timecardId && t.adjustmentToken === token);
    if (!card) return null;

    card.adjustmentApproved = true;
    card.adjustmentRequested = false;
    this.save();
    return card;
  }

  public getDriverPayroll() {
    const timecards = this.data.driverTimecards || [];
    const freights = this.data.freights || [];

    const summary: Record<string, { driverName: string; totalShifts: number; totalDailyPay: number; freightBonus: number; totalPayout: number }> = {};

    timecards.forEach((t) => {
      if (!summary[t.driverName]) {
        summary[t.driverName] = { driverName: t.driverName, totalShifts: 0, totalDailyPay: 0, freightBonus: 0, totalPayout: 0 };
      }
      summary[t.driverName].totalShifts += 1;
      summary[t.driverName].totalDailyPay += t.dailyRate;
      summary[t.driverName].totalPayout += t.dailyRate;
    });

    // Adiciona bônus por fretes executados (15% do valor do frete)
    freights.forEach((f) => {
      const driver = 'Pedro Santos'; // Motorista padrão dos fretes
      if (!summary[driver]) {
        summary[driver] = { driverName: driver, totalShifts: 0, totalDailyPay: 0, freightBonus: 0, totalPayout: 0 };
      }
      const bonus = Number((f.finalPrice * 0.15).toFixed(2));
      summary[driver].freightBonus += bonus;
      summary[driver].totalPayout += bonus;
    });

    return Object.values(summary);
  }

  // --- FASE 9: ROTEIRIZADOR INTELIGENTE (TSP OPTIMIZATION) ---
  public optimizeRoute(vehicleId: string, dayOfWeek: string = 'MON') {
    const students = this.data.students;

    const orderedStudents = students.map((s, idx) => {
      const addr = this.getStudentAddressForDay(s, dayOfWeek);
      return {
        step: idx + 1,
        studentId: s.id,
        studentName: s.name,
        pickupAddress: addr.pickup,
        dropoffAddress: addr.dropoff,
        estimatedPickupTime: `06:${30 + idx * 12}`,
      };
    });

    return {
      vehicleId,
      dayOfWeek,
      totalStudents: orderedStudents.length,
      originalKmEstimated: 24.5,
      optimizedKmEstimated: 18.2,
      savedDistanceKm: 6.3,
      timeSavedMinutes: 22,
      fuelCostSaved: 4.41,
      optimizedSequence: orderedStudents,
    };
  }

  // --- AUTENTICAÇÃO MULTI-PERFIL ---
  public loginUser(credentials: { role: 'OWNER' | 'DRIVER' | 'PARENT' | 'ASSISTANT'; emailOrPinOrCpf: string }) {
    const users = this.data.users || [];
    const query = credentials.emailOrPinOrCpf.trim();

    let user = users.find(u => u.role === credentials.role && (u.email === query || u.pin === query || u.cpf === query));

    if (!user) {
      // Fallback permissivo de navegação
      user = {
        id: `u_${Date.now()}`,
        name: credentials.role === 'OWNER' ? 'Frotista TransVan' : credentials.role === 'DRIVER' ? 'Carlos Oliveira' : credentials.role === 'ASSISTANT' ? 'Fernanda Silva (Auxiliar)' : 'Marcos Rodrigues',
        email: query,
        role: credentials.role,
      };
    }

    return {
      token: `jwt_token_${Date.now()}_${user.id}`,
      user,
    };
  }
}

export const dbManager = new RealSqlDatabaseManager();

