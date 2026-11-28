import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { query } from './db.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';
import authRoutes from './modules/auth/auth.routes.js';
import productRoutes from './modules/products/products.routes.js';
import stockMovementRoutes from './modules/stock/stockMovements.routes.js';
import { customerRoutes, invoiceRoutes } from './modules/invoices/invoices.routes.js';
import userRoutes from './modules/users/users.routes.js';
import { ok } from './utils/http.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(express.json({ limit: '100kb' }));

// Foto produk (nama file UUID, isi tidak pernah berubah -> boleh di-cache lama).
// Cross-Origin-Resource-Policy dilonggarkan khusus folder ini agar <img> dari frontend bisa memuatnya.
app.use(
  '/uploads',
  helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }),
  express.static(config.uploadDir, { index: false, dotfiles: 'deny', fallthrough: false, immutable: true, maxAge: '30d' }),
);

const api = express.Router();

api.get('/health', async (_req, res) => {
  let database = 'ok';
  try {
    await query('SELECT 1');
  } catch {
    database = 'down';
  }
  const status = database === 'ok' ? 200 : 503;
  return ok(res, { status: database === 'ok' ? 'ok' : 'degraded', database }, { status });
});

api.use('/auth', authRoutes);
api.use('/products', requireAuth, productRoutes);
api.use('/stock-movements', requireAuth, stockMovementRoutes);
api.use('/users', requireAuth, userRoutes);
api.use('/customers', requireAuth, customerRoutes);
api.use('/invoices', requireAuth, invoiceRoutes);

app.use('/api/v1', api);
app.use(notFound);
app.use(errorHandler);
