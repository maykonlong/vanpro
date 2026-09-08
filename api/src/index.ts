import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger';
import { createServer } from 'http';
import { Server } from 'socket.io';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { logger } from './utils/logger';

import vehicleRoutes from './routes/vehicleRoutes';
import studentRoutes from './routes/studentRoutes';
import financialRoutes from './routes/financialRoutes';
import timecardRoutes from './routes/timecardRoutes';
import authRoutes from './routes/authRoutes';
import webhookRoutes from './routes/webhookRoutes';
import uploadRoutes from './routes/uploadRoutes';
import privacyRoutes from './routes/privacyRoutes';
import { authMiddleware } from './middlewares/authMiddleware';
import { setupWebSockets } from './websockets';
import './jobs/billingCron'; // Iniciar CronJobs
import './jobs/lgpdCron'; // Iniciar Purge LGPD
import path from 'path';

const app = express();

// Sentry Config (Crash Reporting)
Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});
Sentry.setupExpressErrorHandler(app);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

const port = process.env.PORT || 3000;

// Security Hardening (Blindar Phase 2)
app.use(compression());
app.use(helmet({ crossOriginResourcePolicy: false })); // false para permitir acesso local às imagens do /uploads
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '100kb' })); // Previne payload bombing
app.use(cookieParser());

// WAF Local - Escudo Sentinela (Bloqueia SQLi/NoSQLi/XSS)
import { sentinelaShield } from './middlewares/sentinelaShield';
app.use(sentinelaShield());

// Expor pasta de uploads estaticamente
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// Rate Limiting Global (Proteção Anti-DDoS Básica)
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  limit: 200, // Limite de 200 requisições por IP por minuto
  message: { error: 'Tráfego excessivo. Rate limit global ativado.' }
});

app.use('/api/', globalLimiter);

// Rate Limiting mais estrito para prevenir Brute Force em Login
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 5, // Limite de 5 requisições por IP
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' }
});

app.use('/api/v1/auth', authLimiter);

// Documentação Swagger OpenAPI
app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0 (VANOS)' });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/webhooks', webhookRoutes);

// Rotas Protegidas (Exigem JWT Fingerprint)
app.use('/api/v1/vehicles', authMiddleware, vehicleRoutes);
app.use('/api/v1/students', authMiddleware, studentRoutes);
app.use('/api/v1/financial', authMiddleware, financialRoutes);
app.use('/api/v1/timecards', authMiddleware, timecardRoutes);
app.use('/api/v1/uploads', authMiddleware, uploadRoutes);
app.use('/api/v1/privacy', authMiddleware, privacyRoutes);

// Inicializar WebSockets
setupWebSockets(io);

httpServer.listen(port, () => {
  console.log(`🚀 API VANOS rodando na porta ${port} (HTTP & WebSockets)`);
});
