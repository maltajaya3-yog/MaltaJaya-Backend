import { Router } from 'express';
import Joi from 'joi';
import { requireRole } from '../../middleware/auth.js';
import { ACCESS } from '../../roles.js';
import { asyncHandler, ok, pageMeta } from '../../utils/http.js';
import { validate } from '../../utils/validate.js';
import { listMovements } from './stockMovements.service.js';

const router = Router();

const TYPES = ['initial_stock', 'qc_in', 'invoice_out', 'invoice_void_in', 'adjustment_in', 'adjustment_out'];

const listSchema = Joi.object({
  product_id: Joi.string().guid().label('product_id'),
  sku_code: Joi.string().trim().uppercase().max(50).label('Kode barang'),
  // Boleh lebih dari satu, dipisah koma: ?movement_type=initial_stock,qc_in
  movement_type: Joi.string()
    .custom((v, h) => {
      const list = v.split(',').map((s) => s.trim()).filter(Boolean);
      return list.length && list.every((t) => TYPES.includes(t)) ? list : h.error('any.invalid');
    })
    .messages({ 'any.invalid': `movement_type harus salah satu dari: ${TYPES.join(', ')}` }),
  date_from: Joi.date().iso().label('date_from'),
  date_to: Joi.date().iso().label('date_to'),
  page: Joi.number().integer().min(1).default(1).label('page'),
  limit: Joi.number().integer().min(1).max(500).default(25).label('limit'),
});

// GET /stock-movements
router.get(
  '/',
  requireRole(...ACCESS.movementView),
  asyncHandler(async (req, res) => {
    const q = validate(listSchema, req.query);
    const { items, total } = await listMovements({
      productId: q.product_id,
      skuCode: q.sku_code,
      types: q.movement_type,
      dateFrom: q.date_from,
      dateTo: q.date_to,
      page: q.page,
      limit: q.limit,
    });
    return ok(res, items, { message: 'Riwayat mutasi berhasil dimuat', meta: pageMeta(q, total) });
  }),
);

export default router;
