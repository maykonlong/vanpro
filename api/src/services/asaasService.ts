import axios from 'axios';
import { logger } from '../utils/logger';

const ASAAS_API_URL = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3';
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || '';

const asaasClient = axios.create({
  baseURL: ASAAS_API_URL,
  headers: {
    'access_token': ASAAS_API_KEY,
    'Content-Type': 'application/json'
  }
});

export const createPixCharge = async (customerId: string, value: number, dueDate: string, description: string) => {
  try {
    const response = await asaasClient.post('/payments', {
      customer: customerId,
      billingType: 'PIX',
      value,
      dueDate,
      description
    });
    
    return {
      id: response.data.id,
      invoiceUrl: response.data.invoiceUrl,
      status: response.data.status
    };
  } catch (error: any) {
    logger.error(`❌ Erro ao gerar PIX no Asaas: ${error?.response?.data || error.message}`);
    throw new Error('Falha na integração com Gateway de Pagamento');
  }
};

export const createCustomer = async (name: string, cpfCnpj: string, email: string) => {
  try {
    const response = await asaasClient.post('/customers', {
      name,
      cpfCnpj,
      email
    });
    return response.data.id;
  } catch (error: any) {
    logger.error(`❌ Erro ao criar cliente no Asaas: ${error?.response?.data || error.message}`);
    throw new Error('Falha na criação de Cliente no Gateway');
  }
};
