// Endpoint /products. Handler di sini tipis: validasi -> panggil service -> bentuk respons.

import { Router } from 'express';
import { withTransaction } from '../../db.js';
import { requireRole } from '../../middleware/auth.js';
import { ACCESS, canAccess } from '../../roles.js';
import { ApiError, asyncHandler, ok, pageMeta } from '../../utils/http.js';
import { requireUuid, validate } from '../../utils/validate.js';
import { adjustToPhysical, applyMovement, initializeStock } from '../stock/stock.service.js';
import { recentMovements } from '../stock/stockMovements.service.js';
import { deleteProductImage, saveProductImage, uploadProductImage } from './productImage.js';
import {
  adjustStockSchema,
  createProductSchema,
  deleteProductSchema,
  initializeStockSchema,
  listDeletedSchema,
  listProductsSchema,
  updateProductSchema,
} from './products.schemas.js';
import {
  archiveProduct,
  findProduct,
  findProductBySku,
  insertProduct,
  listDeletedProducts,
  listProducts,
  restoreProduct,
  setProductImage,
  toProductResponse,
  updateProduct,
} from './products.service.js';

const router = Router();
const canView = requireRole(...ACCESS.stockView);
const canEdit = requireRole(...ACCESS.stockEdit);
const respond = (req) => (row) => toProductResponse(row, req.user.role);

// GET /products
router.get(
  '/',
  canView,
  asyncHandler(async (req, res) => {
    const q = validate(listProductsSchema, req.query);
    const { items, total } = await listProducts({ search: q.search, category: q.main_category, stockStatus: q.stock_status, page: q.page, limit: q.limit });
    return ok(res, items.map(respond(req)), { message: 'Data produk berhasil dimuat', meta: pageMeta(q, total) });
  }),
);

// GET /products/deleted  (riwayat hapus; harus didaftarkan sebelum /:id)
router.get(
  '/deleted',
  requireRole(...ACCESS.movementView),
  asyncHandler(async (req, res) => {
    const q = validate(listDeletedSchema, req.query);
    const { items, total } = await listDeletedProducts({ search: q.search, page: q.page, limit: q.limit });
    return ok(res, items.map(respond(req)), { message: 'Riwayat hapus berhasil dimuat', meta: pageMeta(q, total) });
  }),
);

// GET /products/lookup/:sku_code  (isi otomatis form nota)
router.get(
  '/lookup/:sku_code',
  canView,
  asyncHandler(async (req, res) => {
    const product = await findProductBySku(String(req.params.sku_code).trim().toUpperCase().slice(0, 50));
    return ok(res, respond(req)(product));
  }),
);

// GET /products/:id  (+ 10 mutasi terakhir untuk role yang boleh melihat mutasi)
router.get(
  '/:id',
  canView,
  asyncHandler(async (req, res) => {
    const product = respond(req)(await findProduct(requireUuid(req.params.id, 'Produk')));
    if (canAccess(req.user.role, 'movementView')) product.recent_movements = await recentMovements(product.id);
    return ok(res, product);
  }),
);

// POST /products
router.post(
  '/',
  canEdit,
  asyncHandler(async (req, res) => {
    const b = validate(createProductSchema, req.body);
    if (b.piecework_rate > 0 && !canAccess(req.user.role, 'rateEdit')) {
      throw new ApiError(403, 'FORBIDDEN', 'Tarif borongan hanya bisa diatur oleh Owner & Manajer.');
    }
    const product = await withTransaction(async (client) => {
      const created = await insertProduct(client, b);
      if (b.initial_qty === undefined) return created;
      return initializeStock(client, { productId: created.id, qty: b.initial_qty, reason: b.initial_reason, userId: req.user.id });
    });
    return ok(res, respond(req)(product), { status: 201, message: 'Produk berhasil ditambahkan' });
  }),
);

// PATCH /products/:id  (kode barang & jumlah stok tidak bisa diubah di sini)
router.patch(
  '/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'Produk');
    const changes = validate(updateProductSchema, req.body);
    const product = await withTransaction((client) => updateProduct(client, id, changes, req.user.role));
    return ok(res, respond(req)(product), { message: 'Produk berhasil diperbarui' });
  }),
);

// DELETE /products/:id  body { reason }  (arsipkan + catat riwayat hapus; riwayat mutasi tetap tersimpan)
router.delete(
  '/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'Produk');
    const { reason } = validate(deleteProductSchema, req.body);
    const product = await archiveProduct(id, { userId: req.user.id, reason });
    return ok(res, { id: product.id }, { message: `Produk ${product.sku_code} dihapus` });
  }),
);

// POST /products/:id/restore  (pulihkan produk yang dihapus)
router.post(
  '/:id/restore',
  canEdit,
  asyncHandler(async (req, res) => {
    const product = await restoreProduct(requireUuid(req.params.id, 'Produk'));
    return ok(res, respond(req)(product), { message: `Produk ${product.sku_code} dipulihkan` });
  }),
);

// PUT /products/:id/image  (multipart/form-data, field `image`)
router.put(
  '/:id/image',
  canEdit,
  uploadProductImage,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'Produk');
    if (!req.file) throw new ApiError(400, 'VALIDATION_ERROR', 'Pilih foto terlebih dahulu.', [{ field: 'image' }]);
    const newPath = await saveProductImage(req.file.buffer);
    let result;
    try {
      result = await withTransaction((client) => setProductImage(client, id, newPath));
    } catch (err) {
      await deleteProductImage(newPath); // DB gagal -> jangan tinggalkan file yatim
      throw err;
    }
    await deleteProductImage(result.oldPath);
    return ok(res, respond(req)(result.product), { message: 'Foto produk disimpan' });
  }),
);

// DELETE /products/:id/image
router.delete(
  '/:id/image',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'Produk');
    const result = await withTransaction((client) => setProductImage(client, id, null));
    await deleteProductImage(result.oldPath);
    return ok(res, respond(req)(result.product), { message: 'Foto produk dihapus' });
  }),
);

// POST /products/:id/initialize-stock
router.post(
  '/:id/initialize-stock',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'Produk');
    const b = validate(initializeStockSchema, req.body);
    const product = await withTransaction((client) => initializeStock(client, { productId: id, qty: b.initial_qty, reason: b.reason, userId: req.user.id }));
    return ok(res, respond(req)(product), { message: 'Saldo awal berhasil diverifikasi' });
  }),
);

// POST /products/:id/adjust-stock
router.post(
  '/:id/adjust-stock',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'Produk');
    const b = validate(adjustStockSchema, req.body);
    const { product } = await withTransaction((client) =>
      b.physical_qty !== undefined
        ? adjustToPhysical(client, { productId: id, physicalQty: b.physical_qty, reason: b.reason, userId: req.user.id })
        : applyMovement(client, {
            productId: id,
            type: b.adjustment_type,
            qtyChange: b.adjustment_type === 'adjustment_in' ? b.qty : -b.qty,
            reason: b.reason,
            userId: req.user.id,
          }),
    );
    return ok(res, respond(req)(product), { message: 'Stok berhasil disesuaikan' });
  }),
);

export default router;
