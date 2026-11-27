// Satu-satunya pintu perubahan stok. Setiap perubahan mengunci baris produk (FOR UPDATE),
// memperbarui products.current_stock, dan mencatat stock_movements dalam transaksi yang sama.
// Modul lain (nota, QC) wajib memakai fungsi di sini, jangan UPDATE current_stock langsung.

import { ApiError } from '../../utils/http.js';
import { PRODUCT_COLUMNS } from '../products/products.service.js';

export async function lockProduct(client, productId) {
  const { rows } = await client.query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1 AND is_active FOR UPDATE`, [productId]);
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Produk tidak ditemukan.');
  return rows[0];
}

/** Verifikasi saldo awal fisik (boleh 0). Hanya sekali per produk. */
export async function initializeStock(client, { productId, qty, reason, userId }) {
  const product = await lockProduct(client, productId);
  if (product.stock_initialized_at) {
    throw new ApiError(409, 'INVALID_STATUS_TRANSITION', `Saldo awal ${product.sku_code} sudah diverifikasi. Gunakan penyesuaian stok.`);
  }
  if (qty > 0) {
    await client.query(
      `INSERT INTO stock_movements (product_id, movement_type, qty_change, stock_before, stock_after, reference_type, reason, created_by)
       VALUES ($1, 'initial_stock', $2, $3, $4, 'manual', $5, $6)`,
      [productId, qty, product.current_stock, product.current_stock + qty, reason, userId],
    );
  }
  const { rows } = await client.query(
    `UPDATE products SET current_stock = current_stock + $2, stock_initialized_at = NOW() WHERE id = $1 RETURNING ${PRODUCT_COLUMNS}`,
    [productId, qty],
  );
  return rows[0];
}

/** Tambah/kurangi stok produk yang saldo awalnya sudah diverifikasi. Stok tidak boleh minus. */
export async function applyMovement(client, { productId, type, qtyChange, reason, referenceType = 'manual', referenceId = null, userId }) {
  if (!Number.isSafeInteger(qtyChange) || qtyChange === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'Jumlah perubahan stok tidak valid.');
  const product = await lockProduct(client, productId);
  if (!product.stock_initialized_at) {
    throw new ApiError(422, 'STOCK_UNINITIALIZED', `Produk ${product.sku_code} belum punya saldo awal. Verifikasi saldo awal terlebih dahulu.`);
  }
  const after = product.current_stock + qtyChange;
  if (after < 0) {
    throw new ApiError(422, 'INSUFFICIENT_STOCK', `Stok ${product.sku_code} tidak mencukupi (tersedia: ${product.current_stock}, diminta: ${-qtyChange}).`, [
      { sku_code: product.sku_code, available_stock: product.current_stock, requested_qty: -qtyChange },
    ]);
  }
  const { rows: mv } = await client.query(
    `INSERT INTO stock_movements (product_id, movement_type, qty_change, stock_before, stock_after, reference_type, reference_id, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [productId, type, qtyChange, product.current_stock, after, referenceType, referenceId, reason, userId],
  );
  const { rows } = await client.query(`UPDATE products SET current_stock = $2 WHERE id = $1 RETURNING ${PRODUCT_COLUMNS}`, [productId, after]);
  return { product: rows[0], movementId: mv[0].id };
}

/** Stok opname: set stok ke jumlah fisik; selisih dicatat sebagai adjustment_in/out. */
export async function adjustToPhysical(client, { productId, physicalQty, reason, userId }) {
  const product = await lockProduct(client, productId);
  const qtyChange = physicalQty - product.current_stock;
  if (qtyChange === 0) throw new ApiError(422, 'NO_CHANGE', 'Stok fisik sama dengan stok sistem. Tidak ada yang perlu disesuaikan.');
  return applyMovement(client, { productId, type: qtyChange > 0 ? 'adjustment_in' : 'adjustment_out', qtyChange, reason, userId });
}
