import express from 'express';
import cors from 'cors';
import vehicleRoutes from './routes/vehicleRoutes';
import studentRoutes from './routes/studentRoutes';
import financialRoutes from './routes/financialRoutes';
import timecardRoutes from './routes/timecardRoutes';
import authRoutes from './routes/authRoutes';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0 (VANOS)' });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/vehicles', vehicleRoutes);
app.use('/api/v1/students', studentRoutes);
app.use('/api/v1/financial', financialRoutes);
app.use('/api/v1/timecards', timecardRoutes);

app.listen(port, () => {
  console.log(`🚀 API VANOS rodando na porta ${port}`);
});
