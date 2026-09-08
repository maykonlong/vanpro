import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';

const router = Router();

// Garantir que a pasta uploads existe
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configuração do Multer (Armazenamento Local)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Filtro de Segurança (Apenas Imagens)
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Apenas imagens são permitidas (JPG, PNG).'));
  }
};

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limite de 5MB
  fileFilter 
});

// Rota POST para upload de imagem
router.post('/', upload.single('photo'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }
    
    // URL Pública para acessar a imagem (assumindo que o Express vai expor a pasta estática)
    const fileUrl = `/uploads/${req.file.filename}`;
    
    logger.info(`📸 Novo upload realizado: ${fileUrl}`);
    res.json({ url: fileUrl });
  } catch (error) {
    logger.error(`❌ Erro no upload: ${(error as Error).message}`);
    res.status(500).json({ error: 'Falha ao salvar a imagem.' });
  }
});

export default router;
