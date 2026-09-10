/** Tipos do contrato da API. Espelham os serializadores dos controllers. */

/** Dinheiro chega sempre assim: exiba `formatted`, calcule com `cents`. */
export interface Money {
  cents: number;
  formatted: string;
}

export interface PageMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

export type Role = 'SUPER_ADMIN' | 'OWNER' | 'MANAGER' | 'DRIVER' | 'ASSISTANT' | 'PARENT';

export interface Permissions {
  canManageFinance: boolean;
  canManageHR: boolean;
  canManageRoutes: boolean;
}

export type PermissionFlag = keyof Permissions;

export interface CompanySummary {
  id: string;
  name: string;
  tenantStatus: string;
  trialEndsAt: string | null;
}

/**
 * Vinculo ativo da pessoa com uma frota.
 *
 * `role` e o papel DENTRO daquela empresa, e nao um papel global: a mesma
 * pessoa pode ser proprietaria de uma frota e motorista em outra.
 */
export interface CompanyMembership {
  companyId: string;
  companyName: string;
  role: Role;
  contractType: 'FULL_TIME' | 'FREELANCE';
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface Me {
  id: string;
  name: string;
  email: string;
  /** Papel na empresa ATIVA — vem da sessão, não do cadastro do usuário. */
  role: Role;
  /** Empresa ativa da sessão. */
  tenantId: string | null;
  permissions: Permissions;
  /** Vínculo do usuário com a empresa ativa: ACTIVE ou ARCHIVED (só leitura). */
  contractStatus: string;
  company: CompanySummary | null;
  /** Todas as frotas em que a pessoa pode entrar hoje. */
  companies: CompanyMembership[];
}

export type Shift = 'MORNING' | 'AFTERNOON' | 'FULL';
export type StudentStatus = 'PENDING' | 'BOARDED' | 'DELIVERED' | 'ABSENT';

export interface Student {
  id: string;
  name: string;
  school: string;
  grade: string;
  shift: Shift;
  status: StudentStatus;
  monthlyFee: Money;
  parentId: string | null;
  photoUrl: string | null;
  address: string | null;
  dateOfBirth: string | null;
  lgpdConsent: boolean;
  imageConsent: boolean;
  deleteRequestStatus: string;
  createdAt: string;
}

export type VehicleStatus = 'IDLE' | 'ON_ROUTE' | 'MAINTENANCE';

export interface Vehicle {
  id: string;
  plate: string;
  model: string;
  capacity: number;
  km: number;
  status: VehicleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Driver {
  id: string;
  name: string;
  userId: string | null;
  shiftType: Shift;
  dailyRate: Money;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
  updatedAt: string;
}

export interface DriverEarnings {
  driver: { id: string; name: string };
  month: string;
  dailyRate: Money;
  workedDays: number;
  dailies: Money;
  total: Money;
  charters: Array<{
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    status: CharterStatus;
  }>;
}

export type PunchType = 'CLOCK_IN' | 'BREAK_START' | 'BREAK_END' | 'CLOCK_OUT';

export interface Punch {
  id: string;
  type: PunchType;
  km: number | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
}

export interface Timecard {
  id: string;
  driverId: string;
  vehicleId: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  date: string;
  createdAt: string;
  updatedAt: string;
  punches: Punch[];
}

export type ExpenseCategory = 'FUEL' | 'MAINTENANCE' | 'PAYROLL' | 'TAXES' | 'OTHER';

export interface Dre {
  receitas: { mensalidades: Money; fretamentos: Money; total: Money };
  despesasPorCategoria: Array<{ categoria: ExpenseCategory; valor: Money }>;
  despesaTotal: Money;
  lucroLiquido: Money;
  margemPercentual: number;
  periodo: { from: string; to: string };
}

export interface DreByVehicle {
  itens: Array<{
    vehicleId: string;
    plate: string;
    model: string;
    receita: Money;
    despesa: Money;
    resultado: Money;
    margemPercentual: number;
  }>;
  periodo: { from: string; to: string };
}

export interface Transaction {
  id: string;
  studentId: string;
  amount: Money;
  paid: boolean;
  paidAt: string | null;
  dueDate: string;
  externalId: string | null;
  createdAt: string;
}

export interface Expense {
  id: string;
  description: string;
  amount: Money;
  category: ExpenseCategory;
  date: string;
  vehicleId: string | null;
  employeeId: string | null;
  receiptUrl: string | null;
  createdAt: string;
}

export interface Invoice {
  id: string;
  studentId: string;
  amount: Money;
  status: 'PENDING' | 'RECEIVED' | 'OVERDUE' | 'CANCELED';
  dueDate: string;
  gatewayId: string | null;
  paymentUrl: string | null;
  createdAt: string;
}

export type CharterStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';

export interface Charter {
  id: string;
  title: string;
  contractor: string;
  price: Money;
  startDate: string;
  endDate: string;
  status: CharterStatus;
  vehicleId: string | null;
  driverId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  contractType: 'FULL_TIME' | 'FREELANCE';
  permissions: Permissions;
  inviteExpiresAt: string | null;
  joinedAt: string;
  leftAt: string | null;
  isActive: boolean;
}

export interface PlanUsage {
  plan: string;
  status: string;
  trialEndsAt: string | null;
  usage: {
    vehicles: { used: number; limit: number };
    drivers: { used: number; limit: number };
    students: { used: number; limit: number };
  };
}

export interface CompanyProfile {
  company: {
    id: string;
    name: string;
    document: string;
    latitude: number | null;
    longitude: number | null;
    tenantStatus: string;
    trialEndsAt: string | null;
    createdAt: string;
  };
  plan: PlanUsage;
}

export interface SessionInfo {
  id: string;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  createdById: string;
  createdAt: string;
}

export interface Note {
  id: string;
  studentId: string;
  authorId: string;
  content: string;
  isSecret: boolean;
  createdAt: string;
}

export interface TeamMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  template: string;
  target: 'ALL_STUDENTS' | 'ALL_PARENTS' | 'SPECIFIC';
  channel: 'WHATSAPP' | 'INSTAGRAM' | 'EMAIL';
  isActive: boolean;
  createdAt: string;
}

export interface AiPost {
  id: string;
  campaignId: string | null;
  content: string;
  imageUrl: string | null;
  targetId: string | null;
  channel: 'WHATSAPP' | 'INSTAGRAM' | 'EMAIL';
  status: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'REJECTED';
  scheduledTo: string | null;
  createdAt: string;
}

export interface Birthday {
  id: string;
  name: string;
  dateOfBirth: string;
  emDias: number;
}

export interface Consent {
  id: string;
  name: string;
  lgpdConsent: boolean;
  imageConsent: boolean;
  consentDate: string | null;
  deleteRequestStatus: string;
}

export interface DeletionRequest {
  id: string;
  name: string;
  school: string;
  parentId: string | null;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  description: string;
  userId: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditTrail extends Paginated<AuditEntry> {
  chainIntegrity: unknown;
}

/**
 * Integrações ligadas no ambiente (`GET /health/features`).
 *
 * Espelha EXATAMENTE o que a rota devolve hoje. Já houve aqui um terceiro
 * campo `maps` que a API nunca enviou: a tela mostrava "Mapas: não
 * configurada" para uma integração que não existe no contrato, o que é
 * inventar ausência com a mesma leviandade com que se inventaria presença.
 */
export interface FeatureFlags {
  billing: boolean;
  whatsapp: boolean;
}

export interface VehiclePosition {
  vehicleId: string;
  latitude: number;
  longitude: number;
  at: string;
}
