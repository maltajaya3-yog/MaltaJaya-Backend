// Akses data produk. Perubahan jumlah stok TIDAK dilakukan di sini, tapi lewat stock.service.js.

import { config } from '../../config.js';
import { query } from '../../db.js';
import { canAccess } from '../../roles.js';
import { ApiError } from '../../utils/http.js';

export const PRODUCT_COLUMNS = `id, sku_code, name, main_category, sub_category, size_label, variant_label, unit,
  selling_price, piecework_rate, current_stock, stock_initialized_at, image_path, is_active, created_at, updated_at`;

const UPDATABLE = ['name', 'main_category', 'sub_category', 'size_label', 'variant_label', 'unit', 'selling_price', 'piecework_rate'];

/**
 * Bentuk respons produk untuk role tertentu:
 * - harga jual & tarif borongan dibuang untuk role tanpa izin (field-stripping, bukan sekadar disembunyikan di FE);
 * - image_path diganti URL publik foto.
 */
export function toProductResponse(row, role) {
  const { image_path: imagePath, deleted_by_id: deletedById, deleted_by_name: deletedByName, ...product } = row;
  product.image_url = imagePath ? `${config.publicUrl}/uploads/${imagePath}` : null;
  if ('deleted_at' in row) product.deleted_by = deletedById ? { id: deletedById, full_name: deletedByName } : null;
  if (!canAccess(role, 'priceView')) {
    delete product.selling_price;
    delete product.piecework_rate;
  }
  return product;
}

export async function listProducts({ search, category, stockStatus, page, limit }) {
  const where = ['is_active'];
  const params = [];
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(sku_code ILIKE $${params.length} OR name ILIKE $${params.length})`);
  }
  if (category) {
    params.push(category);
    where.push(`main_category = $${params.length}`);
  }
  if (stockStatus === 'uninitialized') where.push('stock_initialized_at IS NULL');
  if (stockStatus === 'empty') where.push('stock_initialized_at IS NOT NULL AND current_stock = 0');
  if (stockStatus === 'available') where.push('current_stock > 0');

  const whereSql = where.join(' AND ');
  const { rows: count } = await query(`SELECT COUNT(*) AS total FROM products WHERE ${whereSql}`, params);
  const { rows } = await query(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE ${whereSql} ORDER BY sku_code LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit],
  );
  return { items: rows, total: count[0].total };
}

export async function findProduct(id) {
  const { rows } = await query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1 AND is_active`, [id]);
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Produk tidak ditemukan.');
  return rows[0];
}

export async function findProductBySku(skuCode) {
  const { rows } = await query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE sku_code = $1 AND is_active`, [skuCode]);
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', `Kode barang ${skuCode} tidak ditemukan.`);
  return rows[0];
}

export async function insertProduct(client, p) {
  try {
    const { rows } = await client.query(
      `INSERT INTO products (sku_code, name, main_category, sub_category, size_label, variant_label, unit, selling_price, piecework_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${PRODUCT_COLUMNS}`,
      [p.sku_code, p.name, p.main_category, p.sub_category, p.size_label, p.variant_label, p.unit, p.selling_price, p.piecework_rate],
    );
    return rows[0];
  } catch (err) {
    if (err.code !== '23505') throw err;
    // Kode unik juga berlaku untuk produk yang sudah dihapus (diarsipkan), supaya riwayat lama tetap jelas.
    // Dicek lewat koneksi lain karena transaksi `client` sudah batal akibat pelanggaran UNIQUE.
    const { rows } = await query('SELECT is_active FROM products WHERE sku_code = $1', [p.sku_code]);
    const archived = rows[0] && !rows[0].is_active;
    throw new ApiError(
      409,
      'DUPLICATE_SKU',
      archived ? `Kode ${p.sku_code} pernah dipakai produk yang sudah dihapus. Gunakan kode lain.` : `Kode ${p.sku_code} sudah terdaftar.`,
      [{ field: 'sku_code' }],
    );
  }
}

/** Ubah data produk (bukan kode & stok). Tarif borongan hanya boleh diubah role dengan izin rateEdit. */
export async function updateProduct(client, id, changes, role) {
  const { rows: cur } = await client.query('SELECT piecework_rate FROM products WHERE id = $1 AND is_active FOR UPDATE', [id]);
  if (!cur[0]) throw new ApiError(404, 'NOT_FOUND', 'Produk tidak ditemukan.');
  if (changes.piecework_rate !== undefined && changes.piecework_rate !== cur[0].piecework_rate && !canAccess(role, 'rateEdit')) {
    throw new ApiError(403, 'FORBIDDEN', 'Tarif borongan hanya bisa diubah oleh Owner & Manajer.');
  }
  const fields = UPDATABLE.filter((k) => changes[k] !== undefined);
  if (fields.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'Tidak ada data yang diubah.');
  const sets = fields.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await client.query(`UPDATE products SET ${sets} WHERE id = $1 RETURNING ${PRODUCT_COLUMNS}`, [id, ...fields.map((k) => changes[k])]);
  return rows[0];
}

/**
 * Hapus produk = arsipkan (is_active = false) + catat siapa, kapan, dan alasannya.
 * Data tidak dihapus permanen karena riwayat mutasi dan nota lama tetap merujuk ke produk ini.
 * Produk arsip tidak muncul di daftar/pencarian, dan stoknya tidak bisa diubah sampai dipulihkan.
 */
export async function archiveProduct(id, { userId, reason }) {
  const { rows } = await query(
    `UPDATE products SET is_active = FALSE, deleted_at = NOW(), deleted_by = $2, delete_reason = $3
      WHERE id = $1 AND is_active RETURNING ${PRODUCT_COLUMNS}`,
    [id, userId, reason],
  );
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Produk tidak ditemukan.');
  return rows[0];
}

/** Pulihkan produk yang dihapus; jejak hapusnya dibersihkan, stok kembali seperti saat dihapus. */
export async function restoreProduct(id) {
  const { rows } = await query(
    `UPDATE products SET is_active = TRUE, deleted_at = NULL, deleted_by = NULL, delete_reason = NULL
      WHERE id = $1 AND NOT is_active RETURNING ${PRODUCT_COLUMNS}`,
    [id],
  );
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Produk terhapus tidak ditemukan.');
  return rows[0];
}

/** Riwayat hapus: produk arsip terbaru dulu, lengkap dengan nama penghapus. */
export async function listDeletedProducts({ search, page, limit }) {
  const where = ['NOT p.is_active'];
  const params = [];
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(p.sku_code ILIKE $${params.length} OR p.name ILIKE $${params.length})`);
  }
  const whereSql = where.join(' AND ');
  const { rows: count } = await query(`SELECT COUNT(*) AS total FROM products p WHERE ${whereSql}`, params);
  const { rows } = await query(
    `SELECT ${PRODUCT_COLUMNS.split(',').map((c) => `p.${c.trim()}`).join(', ')},
            p.deleted_at, p.delete_reason, u.id AS deleted_by_id, u.full_name AS deleted_by_name
       FROM products p
       LEFT JOIN users u ON u.id = p.deleted_by
      WHERE ${whereSql}
      ORDER BY p.deleted_at DESC NULLS LAST, p.sku_code
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit],
  );
  return { items: rows, total: count[0].total };
}

/** Ganti path foto; mengembalikan path lama agar filenya bisa dihapus setelah transaksi selesai. */
export async function setProductImage(client, id, imagePath) {
  const { rows: cur } = await client.query('SELECT image_path FROM products WHERE id = $1 AND is_active FOR UPDATE', [id]);
  if (!cur[0]) throw new ApiError(404, 'NOT_FOUND', 'Produk tidak ditemukan.');
  const { rows } = await client.query(`UPDATE products SET image_path = $2 WHERE id = $1 RETURNING ${PRODUCT_COLUMNS}`, [id, imagePath]);
  return { product: rows[0], oldPath: cur[0].image_path };
}
