import { Router } from 'express';
import Joi from 'joi';
import { query } from '../../db.js';
import { requireRole } from '../../middleware/auth.js';
import { ApiError, asyncHandler, ok, pageMeta } from '../../utils/http.js';
import { requireUuid, validate } from '../../utils/validate.js';
import { createInvoice, getInvoice, listInvoices } from './invoices.service.js';

const canUseInvoices = requireRole('owner_manager', 'inventory');
const uuid = Joi.string().guid({ version: ['uuidv4'] });
const text = (max) => Joi.string().trim().min(1).max(max);
const pagination = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(25),
};

const listSchema = Joi.object({
  ...pagination,
  search: text(100),
  payment_status: Joi.string().valid('lunas', 'belum_lunas', 'jatuh_tempo'),
});

const createSchema = Joi.object({
  request_id: uuid,
  customer_id: uuid,
  buyer_name: text(150),
  invoice_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  payment_type: Joi.string().valid('tunai', 'tempo').required(),
  term_days: Joi.number().integer().min(7).max(180).when('payment_type', {
    is: 'tempo', then: Joi.optional(), otherwise: Joi.forbidden(),
  }),
  notes: text(200).allow('', null).default(null),
  status: Joi.string().valid('confirmed').default('confirmed'),
  shipping_cost: Joi.number().integer().min(0).max(1_000_000_000).default(0),
  shipping_courier: text(100).allow('', null),
  items: Joi.array().items(Joi.object({
    product_id: uuid.required(),
    qty: Joi.number().integer().min(1).max(10_000).required(),
  })).min(1).max(50).required(),
}).xor('customer_id', 'buyer_name').when(Joi.object({ payment_type: 'tempo' }).unknown(), {
  then: Joi.object({ customer_id: uuid.required(), buyer_name: Joi.forbidden() }),
});

const customerList = Joi.object({ ...pagination, search: text(100) });
const customerCreate = Joi.object({
  customer_code: text(32).uppercase().required(),
  name: text(150).required(),
  city: text(100).required(),
  phone: text(30).pattern(/^\+?[0-9 ()-]{8,29}$/).allow('', null),
});

export const invoiceRoutes = Router();
export const customerRoutes = Router();

invoiceRoutes.get('/', canUseInvoices, asyncHandler(async (req, res) => {
  const filters = validate(listSchema, req.query);
  const { rows, total } = await listInvoices(filters);
  return ok(res, rows, { meta: pageMeta(filters, total) });
}));

invoiceRoutes.get('/:id', canUseInvoices, asyncHandler(async (req, res) => {
  const invoice = await getInvoice(requireUuid(req.params.id, 'Nota'), req.user.role);
  return ok(res, invoice);
}));

invoiceRoutes.post('/', canUseInvoices, asyncHandler(async (req, res) => {
  const { invoice, reused } = await createInvoice(validate(createSchema, req.body), req.user);
  return ok(res, invoice, { status: reused ? 200 : 201, message: 'Nota disimpan' });
}));

customerRoutes.get('/', canUseInvoices, asyncHandler(async (req, res) => {
  const filters = validate(customerList, req.query);
  const search = filters.search ?? '';
  const where = "WHERE is_active AND ($1 = '' OR customer_code ILIKE '%' || $1 || '%' OR name ILIKE '%' || $1 || '%')";
  const [data, count] = await Promise.all([
    query(`SELECT id, customer_code, name, city, phone, default_term_days
           FROM customers ${where} ORDER BY name, id LIMIT $2 OFFSET $3`,
    [search, filters.limit, (filters.page - 1) * filters.limit]),
    query(`SELECT count(*) AS total FROM customers ${where}`, [search]),
  ]);
  return ok(res, data.rows, { meta: pageMeta(filters, count.rows[0].total) });
}));

customerRoutes.post('/', canUseInvoices, asyncHandler(async (req, res) => {
  const b = validate(customerCreate, req.body);
  const { rows } = await query(
    `INSERT INTO customers (customer_code, name, city, phone)
     VALUES ($1, $2, $3, $4) ON CONFLICT (customer_code) DO NOTHING
     RETURNING id, customer_code, name, city, phone, default_term_days`,
    [b.customer_code, b.name, b.city, b.phone || null],
  );
  if (!rows.length) throw new ApiError(409, 'DUPLICATE_CODE', 'Kode pelanggan sudah dipakai.');
  return ok(res, rows[0], { status: 201 });
}));
