import express, { Request, Response } from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { dbManager } from './database/pgDatabase';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] },
});

app.use(cors());
app.use(express.json());

// Servir Frontend Estático no mesmo servidor HTTP
app.use(express.static(path.join(__dirname, '../../frontend')));

// WebSockets
io.on('connection', (socket) => {
  console.log(`⚡ Cliente Conectado: ${socket.id}`);
  socket.on('van:location_update', (data) => io.emit('van:location', data));
  socket.on('disconnect', () => console.log(`🔌 Cliente Desconectado: ${socket.id}`));
});

// Health Check
app.get('/api/v1/health', (req: Request, res: Response) => {
  return res.json({ status: 'OK', message: 'Plataforma VanPro Operacional (Fases 1 a 9 Ativas em Produção)' });
});

// --- AUTENTICAÇÃO MULTI-PERFIL ---
app.post('/api/v1/auth/login', (req: Request, res: Response) => {
  try {
    const auth = dbManager.loginUser(req.body);
    return res.json(auth);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// Dashboard Summary Real
app.get('/api/v1/dashboard/summary', (req: Request, res: Response) => {
  const vehicles = dbManager.getVehicles();
  const students = dbManager.getStudents();
  const freights = dbManager.getFreights();
  const leads = dbManager.getCrmLeads();
  const dre = dbManager.getDre();

  return res.json({
    today: {
      vehiclesCount: vehicles.length,
      studentsCount: students.length,
      routesCount: 5,
      driversCount: vehicles.filter(v => v.driver).length,
      monthlyRevenue: dre.totalIncome,
      pendingPaymentsCount: dbManager.getFinancials().filter(f => !f.paid).length,
      maintenanceAlertsCount: dbManager.getMaintenances().length,
      freightsScheduledCount: freights.length,
      crmLeadsCount: leads.filter(l => l.status === 'NEW' || l.status === 'PROPOSAL_SENT').length,
    },
    actionableAlerts: [
      { id: '1', level: 'RED', text: 'Alerta de Consumo: Van 02 apresentou consumo 18% acima da média!' },
      { id: '2', level: 'YELLOW', text: 'Lead Novo: Fernando Alcantara solicitou cotação para 2 alunos' },
      { id: '3', level: 'BLUE', text: 'Revisão: Van 01 necessita de troca de óleo em 800 km' },
      { id: '4', level: 'GREEN', text: 'WhatsApp: 4 Lembretes de cobrança enviados com sucesso aos pais' },
    ],
  });
});

// --- FASE 1: MANUTENÇÃO & ABASTECIMENTO ---
app.get('/api/v1/vehicles/maintenances', (req: Request, res: Response) => {
  const vehicleId = req.query.vehicleId as string | undefined;
  return res.json(dbManager.getMaintenances(vehicleId));
});

app.post('/api/v1/vehicles/maintenances', (req: Request, res: Response) => {
  try {
    const record = dbManager.addMaintenance(req.body);
    return res.status(201).json(record);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

app.get('/api/v1/vehicles/fuel', (req: Request, res: Response) => {
  const vehicleId = req.query.vehicleId as string | undefined;
  return res.json(dbManager.getFuelLogs(vehicleId));
});

app.post('/api/v1/vehicles/fuel', (req: Request, res: Response) => {
  try {
    const log = dbManager.addFuelLog(req.body);

    if (log.isConsumptionAnomaly) {
      io.emit('vehicle:fuel_anomaly', {
        vehicleId: log.vehicleId,
        calculatedKmPerLiter: log.calculatedKmPerLiter,
        message: '⚠️ Alerta de desvio anormal de consumo de combustível!',
      });
    }

    return res.status(201).json(log);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// --- FASE 2: CRM LEADS & CONTRATOS ---
app.get('/api/v1/crm/leads', (req: Request, res: Response) => {
  return res.json(dbManager.getCrmLeads());
});

app.post('/api/v1/crm/leads', (req: Request, res: Response) => {
  try {
    const lead = dbManager.addCrmLead(req.body);
    return res.status(201).json(lead);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

app.patch('/api/v1/crm/leads/:id/status', (req: Request, res: Response) => {
  const updated = dbManager.updateLeadStatus(req.params.id, req.body.status);
  if (!updated) return res.status(404).json({ error: 'Lead não encontrado' });
  return res.json(updated);
});

app.get('/api/v1/contracts', (req: Request, res: Response) => {
  return res.json(dbManager.getContracts());
});

app.post('/api/v1/contracts/generate', (req: Request, res: Response) => {
  const contract = dbManager.generateContract(req.body.studentId);
  if (!contract) return res.status(404).json({ error: 'Aluno não encontrado' });
  return res.status(201).json(contract);
});

// --- FASE 3: NOTIFICAÇÕES WHATSAPP & OCORRÊNCIAS ---
app.get('/api/v1/notifications/whatsapp', (req: Request, res: Response) => {
  return res.json(dbManager.getNotifications());
});

app.post('/api/v1/notifications/whatsapp/send', (req: Request, res: Response) => {
  const notification = dbManager.sendWhatsappNotification(req.body);

  io.emit('whatsapp:sent', {
    recipientName: notification.recipientName,
    message: notification.message,
    timestamp: new Date(),
  });

  return res.status(201).json(notification);
});

// --- FASE 4: OCORRÊNCIAS & GPS DE ROTA ---
app.get('/api/v1/occurrences', (req: Request, res: Response) => {
  return res.json(dbManager.getOccurrences());
});

app.post('/api/v1/occurrences', (req: Request, res: Response) => {
  const occurrence = dbManager.addOccurrence(req.body);
  io.emit('occurrence:created', occurrence);
  return res.status(201).json(occurrence);
});

// --- FASE 5: MARKETING & ANÚNCIOS SOCIAIS ---
app.get('/api/v1/marketing/posts', (req: Request, res: Response) => {
  return res.json(dbManager.getSocialPosts());
});

app.post('/api/v1/marketing/posts', (req: Request, res: Response) => {
  try {
    const post = dbManager.createSocialPost(req.body);
    return res.status(201).json(post);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// --- FASE 6: BI ANALYTICS (MARGEM POR ESCOLA E OCUPAÇÃO) ---
app.get('/api/v1/bi/analytics', (req: Request, res: Response) => {
  return res.json(dbManager.getBiAnalytics());
});

// --- FASE 7: CONCILIAÇÃO PIX & EMISSÃO NFS-e ---
app.get('/api/v1/financial/pix', (req: Request, res: Response) => {
  return res.json(dbManager.getPixPayments());
});

app.post('/api/v1/financial/pix/generate', (req: Request, res: Response) => {
  const pix = dbManager.generatePixPayment(req.body.studentId, req.body.amount);
  return res.status(201).json(pix);
});

app.post('/api/v1/financial/pix/webhook', (req: Request, res: Response) => {
  const confirmed = dbManager.confirmPixPayment(req.body.txid || req.body.id);
  if (!confirmed) return res.status(404).json({ error: 'Pagamento Pix não encontrado' });
  io.emit('financial:pix_confirmed', confirmed);
  return res.json({ success: true, confirmed });
});

app.get('/api/v1/financial/nfse', (req: Request, res: Response) => {
  return res.json(dbManager.getNfseRecords());
});

app.post('/api/v1/financial/nfse/issue', (req: Request, res: Response) => {
  const nfse = dbManager.issueNfse(req.body.studentId, req.body.amount, req.body.description);
  return res.status(201).json(nfse);
});

// --- FASE 8: FECHAMENTO DE DIÁRIAS, PONTO 4 BATIDAS & TOKEN DE AJUSTE ---
app.get('/api/v1/drivers/timecards', (req: Request, res: Response) => {
  return res.json(dbManager.getDriverTimecards());
});

app.post('/api/v1/drivers/timecards/punch', (req: Request, res: Response) => {
  const card = dbManager.punchTimecard(req.body);
  io.emit('driver:timecard_punched', { driverName: card.driverName, punchType: req.body.punchType, timestamp: new Date() });
  return res.status(201).json(card);
});

app.post('/api/v1/drivers/timecards/request-adjustment', (req: Request, res: Response) => {
  const result = dbManager.requestTimecardAdjustment(req.body);
  if (!result) return res.status(404).json({ error: 'Cartão de ponto não encontrado' });
  io.emit('driver:adjustment_requested', { driverName: result.timecard.driverName, token: result.token, notes: result.timecard.adjustmentNotes });
  return res.json(result);
});

app.post('/api/v1/drivers/timecards/approve-adjustment', (req: Request, res: Response) => {
  const approved = dbManager.approveTimecardAdjustment(req.body.timecardId, req.body.token);
  if (!approved) return res.status(400).json({ error: 'Token inválido ou cartão não encontrado' });
  io.emit('driver:adjustment_approved', { driverName: approved.driverName, timecardId: approved.id });
  return res.json({ success: true, approved });
});

app.get('/api/v1/drivers/payroll', (req: Request, res: Response) => {
  return res.json(dbManager.getDriverPayroll());
});

// --- FASE 9: ROTEIRIZADOR INTELIGENTE (TSP OPTIMIZATION) ---
app.post('/api/v1/routes/optimize', (req: Request, res: Response) => {
  const optimized = dbManager.optimizeRoute(req.body.vehicleId || 'v1', req.body.dayOfWeek || 'MON');
  return res.json(optimized);
});

// --- CRUD EXISTENTES ---
app.get('/api/v1/vehicles', (req: Request, res: Response) => res.json(dbManager.getVehicles()));
app.post('/api/v1/vehicles', (req: Request, res: Response) => res.status(201).json(dbManager.addVehicle(req.body)));
app.delete('/api/v1/vehicles/:id', (req: Request, res: Response) => res.json({ success: dbManager.deleteVehicle(req.params.id) }));

app.get('/api/v1/students', (req: Request, res: Response) => {
  const day = (req.query.dayOfWeek as string) || 'MON';
  return res.json(dbManager.getStudents().map(s => ({
    ...s,
    todayPickupAddress: dbManager.getStudentAddressForDay(s, day).pickup,
    todayDropoffAddress: dbManager.getStudentAddressForDay(s, day).dropoff,
    todayAddressLabel: dbManager.getStudentAddressForDay(s, day).label,
  })));
});

app.post('/api/v1/students', (req: Request, res: Response) => res.status(201).json(dbManager.addStudent(req.body)));
app.post('/api/v1/students/checkin', (req: Request, res: Response) => {
  const updated = dbManager.updateStudentStatus(req.body.studentId, req.body.status);
  if (updated) io.emit('student:attendance_update', { studentId: updated.id, studentName: updated.name, status: req.body.status, timestamp: new Date() });
  return res.json(updated);
});

app.get('/api/v1/financial/dre', (req: Request, res: Response) => res.json(dbManager.getDre(req.query.vehicleId as string, req.query.month as string)));
app.post('/api/v1/financial/transactions', (req: Request, res: Response) => res.status(201).json(dbManager.addFinancialRecord(req.body)));

app.get('/api/v1/freights', (req: Request, res: Response) => res.json(dbManager.getFreights()));
app.post('/api/v1/freights', (req: Request, res: Response) => res.status(201).json(dbManager.addFreight(req.body)));
app.post('/api/v1/freights/quote', (req: Request, res: Response) => {
  const { distanceKm, hasToll } = req.body;
  const estimatedFuelCost = Number(((distanceKm / 8.5) * 5.95).toFixed(2));
  const tollCost = hasToll ? 42.00 : 0;
  const baseCost = estimatedFuelCost + tollCost + 90.00;
  const suggestedPrice = Number((baseCost * 1.65).toFixed(2));
  return res.json({ distanceKm, estimatedFuelCost, tollCost, suggestedPrice, netProfit: Number((suggestedPrice - baseCost).toFixed(2)) });
});

// SPA Fallback
app.get('*', (req: Request, res: Response) => res.sendFile(path.join(__dirname, '../../frontend/index.html')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Plataforma VanPro Operacional! (Fases 1 a 9 Ativas)`);
  console.log(`   - App Web & Mobile:  http://localhost:${PORT}`);
  console.log(`   - API REST & Socket: http://localhost:${PORT}/api/v1`);
  console.log(`=======================================================`);
});
