import { createHash, randomUUID } from 'node:crypto';
import { query, withTransaction } from '../../db.js';
import { applyMovement, lockProduct } from '../stock/stock.service.js';
import { ApiError } from '../../utils/http.js';

const projection = `
  SELECT i.id, i.invoice_number, i.invoice_date::text, i.payment_type, i.due_date::text,
         i.subtotal, i.shipping_cost, i.total_amount, i.status, i.notes, i.customer_id,
         COALESCE(i.buyer_name_snapshot, c.name) AS buyer_name,
         COALESCE(i.buyer_code_snapshot, c.customer_code) AS customer_code,
         COALESCE(i.buyer_city_snapshot, c.city) AS customer_city,
         COALESCE(i.buyer_phone_snapshot, c.phone) AS customer_phone,
         u.full_name AS created_by_name,
         COALESCE(lines.quantity, 0) AS quantity,
         CASE WHEN i.payment_type = 'tempo'
           THEN GREATEST(0, i.total_amount - COALESCE(paid.amount, 0)) ELSE 0 END AS outstanding
  FROM sales_invoices i
  LEFT JOIN customers c ON c.id = i.customer_id
  JOIN users u ON u.id = i.created_by
  LEFT JOIN LATERAL (SELECT SUM(qty) AS quantity FROM invoice_items WHERE invoice_id = i.id) lines ON TRUE
  LEFT JOIN LATERAL (
    SELECT SUM(credit) AS amount FROM receivable_entries WHERE invoice_id = i.id AND entry_type = 'pembayaran'
  ) paid ON TRUE`;

const statusProjection = `SELECT data.*,
  CASE WHEN outstanding = 0 THEN 'lunas'
       WHEN due_date::date < (NOW() AT TIME ZONE 'Asia/Jakarta')::date THEN 'jatuh_tempo'
       ELSE 'belum_lunas' END AS payment_status
  FROM data`;

export async function listInvoices({ page, limit, search = '', payment_status = '' }) {
  const scoped = `WITH data AS (${projection}
    WHERE i.status = 'confirmed' AND ($1 = '' OR i.invoice_number ILIKE '%' || $1 || '%'
      OR COALESCE(i.buyer_name_snapshot, c.name) ILIKE '%' || $1 || '%'
      OR COALESCE(i.buyer_code_snapshot, c.customer_code) ILIKE '%' || $1 || '%')),
    scoped AS (${statusProjection})
    SELECT * FROM scoped WHERE ($2 = '' OR payment_status = $2)`;
  const [list, count] = await Promise.all([
    query(`SELECT * FROM (${scoped}) invoices
           ORDER BY invoice_date DESC, invoice_number DESC LIMIT $3 OFFSET $4`, [search, payment_status, limit, (page - 1) * limit]),
    query(`SELECT count(*) AS total FROM (${scoped}) invoices`, [search, payment_status]),
  ]);
  return { rows: list.rows, total: count.rows[0].total };
}

async function readInvoice(db, id, role) {
  const { rows: [invoice] } = await db.query(`WITH data AS (${projection} WHERE i.id = $1 AND i.status = 'confirmed')
    ${statusProjection}`, [id]);
  if (!invoice) throw new ApiError(404, 'NOT_FOUND', 'Nota tidak ditemukan.');
  const { rows: items } = await db.query(
    `SELECT id, product_id, sku_snapshot, product_name_snapshot, qty, unit_price_snapshot, line_total
     FROM invoice_items WHERE invoice_id = $1 ORDER BY line_no`, [id],
  );
  const payments = role === 'owner_manager' && invoice.payment_type === 'tempo'
    ? (await db.query(`SELECT r.id, r.entry_date::text, r.description, r.credit, u.full_name
                       FROM receivable_entries r JOIN users u ON r.created_by = u.id
                       WHERE r.invoice_id = $1 AND r.entry_type = 'pembayaran'
                       ORDER BY r.entry_date, r.created_at, r.id`, [id])).rows
    : [];
  return { ...invoice, items, payments };
}

export function getInvoice(id, role) {
  return readInvoice({ query }, id, role);
}

function validateInvoiceDate(date) {
  const parsed = new Date(date + 'T00:00:00Z');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format();
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > today || date.startsWith('0000')) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Tanggal nota tidak valid atau melebihi hari ini.', [{ field: 'invoice_date' }]);
  }
}

export async function createInvoice(input, user) {
  validateInvoiceDate(input.invoice_date);
  const { request_id, ...payload } = input;
  const id = request_id ?? randomUUID();
  const fingerprint = request_id ? createHash('sha256').update(JSON.stringify(payload)).digest('hex') : null;

  return withTransaction(async (client) => {
    if (request_id) {
      // Serialisasi retry untuk ID yang sama sebelum memeriksa atau membuat nota.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id]);
      const { rows: [existing] } = await client.query('SELECT created_by, request_fingerprint FROM sales_invoices WHERE id = $1', [id]);
      if (existing) {
        if (existing.created_by !== user.id || existing.request_fingerprint !== fingerprint) {
          throw new ApiError(409, 'REQUEST_CONFLICT', 'Permintaan nota ini sudah dipakai untuk data yang berbeda.');
        }
        return { invoice: await readInvoice(client, id, user.role), reused: true };
      }
    }

    let customer;
    if (input.customer_id) {
      ({ rows: [customer] } = await client.query(
        `SELECT id, customer_code, name, city, phone, default_term_days
         FROM customers WHERE id = $1 AND is_active`, [input.customer_id],
      ));
      if (!customer) throw new ApiError(404, 'NOT_FOUND', 'Pelanggan aktif tidak ditemukan.');
    }

    const totalsByProduct = new Map();
    for (const item of input.items) totalsByProduct.set(item.product_id, (totalsByProduct.get(item.product_id) ?? 0) + item.qty);

    const products = new Map();
    // Semua transaksi mengunci produk dengan urutan yang sama.
    for (const [productId, qty] of [...totalsByProduct].sort(([a], [b]) => a.localeCompare(b))) {
      const p = await lockProduct(client, productId);
      if (p.selling_price == null) throw new ApiError(422, 'PRICE_UNVERIFIED', `Harga ${p.sku_code} belum terverifikasi.`);
      if (!p.stock_initialized_at) throw new ApiError(422, 'STOCK_UNINITIALIZED', `${p.sku_code} belum memiliki saldo awal.`);
      if (qty > p.current_stock) {
        throw new ApiError(422, 'INSUFFICIENT_STOCK', `Stok ${p.sku_code} tersedia ${p.current_stock}, diminta ${qty}.`, [
          { sku_code: p.sku_code, available_stock: p.current_stock, requested_qty: qty },
        ]);
      }
      products.set(productId, p);
    }

    const subtotal = input.items.reduce((sum, item) => sum + products.get(item.product_id).selling_price * item.qty, 0);
    const total = subtotal + input.shipping_cost;
    const { rows: [{ serial }] } = await client.query("SELECT nextval('sales_invoice_number_seq') AS serial");
    const month = input.invoice_date.slice(0, 7).replace('-', '/');
    const no = `MJ/${month}/${String(serial).padStart(4, '0')}`;
    const tempo = input.payment_type === 'tempo';
    const days = tempo ? (input.term_days ?? customer.default_term_days) : null;
    await client.query(
      `INSERT INTO sales_invoices (id, invoice_number, invoice_date, customer_id, buyer_name_snapshot, buyer_code_snapshot,
       buyer_city_snapshot, buyer_phone_snapshot, request_fingerprint, payment_type, due_date, subtotal, shipping_cost,
       shipping_courier, total_amount, status, stock_deducted_at, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$3::date + $11::int,$12,$13,$14,$15,'confirmed',NOW(),$16,$17)`,
      [id, no, input.invoice_date, customer?.id ?? null, customer?.name ?? input.buyer_name, customer?.customer_code ?? null,
        customer?.city ?? null, customer?.phone ?? null, fingerprint, input.payment_type, days, subtotal, input.shipping_cost,
        input.shipping_courier ?? null, total, input.notes, user.id],
    );
    for (const [line, item] of input.items.entries()) {
      const p = products.get(item.product_id);
      await client.query(
        `INSERT INTO invoice_items (invoice_id, product_id, line_no, sku_snapshot, product_name_snapshot, qty, unit_price_snapshot, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, p.id, line + 1, p.sku_code, p.name, item.qty, p.selling_price, item.qty * p.selling_price],
      );
    }
    for (const [productId, qty] of totalsByProduct) {
      await applyMovement(client, { productId, type: 'invoice_out', qtyChange: -qty, reason: `Nota ${no}`,
        referenceType: 'invoice', referenceId: id, userId: user.id });
    }
    if (tempo) {
      // Bon hanya untuk subtotal dan ongkir dicatat sekali sebagai debit terpisah.
      for (const [type, amount] of [['bon', subtotal], ['ongkir', input.shipping_cost]]) {
        if (!amount) continue;
        await client.query(
          `INSERT INTO receivable_entries (customer_id, invoice_id, entry_date, due_date, entry_type, description, debit, created_by)
           SELECT customer_id, id, invoice_date, due_date, $2, $3, $4, created_by FROM sales_invoices WHERE id = $1`,
          [id, type, `${type === 'bon' ? 'Nota' : 'Ongkir nota'} ${no}`, amount],
        );
      }
    } else if (total > 0) {
      await client.query(
        `INSERT INTO cash_transactions (transaction_date, direction, category, description, amount, reference_type, reference_id, created_by)
         VALUES ($1,'in','penjualan_tunai',$2,$3,'invoice',$4,$5)`,
        [input.invoice_date, `Nota ${no}`, total, id, user.id],
      );
    }
    return { invoice: await readInvoice(client, id, user.role), reused: false };
  });
}
