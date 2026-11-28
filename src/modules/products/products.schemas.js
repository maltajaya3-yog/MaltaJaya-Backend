// Skema validasi Joi untuk modul produk.

import Joi from 'joi';

export const MAX_STOCK = 100_000;
export const MAX_RUPIAH = 1_000_000_000;
export const CATEGORIES = ['patung', 'salib', 'perlengkapan', 'lainnya'];

const sku = Joi.string()
  .trim()
  .uppercase()
  .pattern(/^[A-Z0-9][A-Z0-9 ./-]{0,49}$/)
  .messages({ 'string.pattern.base': 'Kode barang hanya boleh huruf, angka, spasi, titik, garis miring, atau tanda hubung.' });
const text = (max) => Joi.string().trim().max(max);
const optionalText = (max) => Joi.string().trim().max(max).allow('', null).empty('').default(null);
const reason = Joi.string().trim().min(3).max(500);
const rupiah = Joi.number().integer().min(0).max(MAX_RUPIAH);

export const listProductsSchema = Joi.object({
  search: Joi.string().trim().max(100).allow('').label('Pencarian'),
  main_category: Joi.string().valid(...CATEGORIES).label('Kategori'),
  stock_status: Joi.string().valid('uninitialized', 'empty', 'available').label('Status stok'),
  page: Joi.number().integer().min(1).default(1).label('page'),
  limit: Joi.number().integer().min(1).max(500).default(25).label('limit'),
});

export const listDeletedSchema = Joi.object({
  search: Joi.string().trim().max(100).allow('').label('Pencarian'),
  page: Joi.number().integer().min(1).default(1).label('page'),
  limit: Joi.number().integer().min(1).max(100).default(10).label('limit'),
});

export const deleteProductSchema = Joi.object({
  reason: reason.required().label('Alasan hapus'),
});

export const createProductSchema = Joi.object({
  sku_code: sku.required().label('Kode barang'),
  name: text(200).min(1).required().label('Nama produk'),
  main_category: Joi.string().valid(...CATEGORIES).required().label('Kategori'),
  sub_category: optionalText(100).label('Sub kategori'),
  size_label: optionalText(50).label('Ukuran'),
  variant_label: optionalText(100).label('Varian/bahan'),
  unit: text(20).default('pcs').label('Satuan'),
  selling_price: rupiah.allow(null).default(null).label('Harga jual'),
  piecework_rate: rupiah.default(0).label('Tarif borongan'),
  // Opsional: verifikasi saldo awal sekaligus saat produk dibuat (dalam transaksi yang sama).
  initial_qty: Joi.number().integer().min(0).max(MAX_STOCK).label('Stok awal'),
  initial_reason: reason.default('Verifikasi saldo awal fisik').label('Keterangan saldo awal'),
});

// Field yang tidak dikirim tetap undefined (tidak diubah). Kirim null untuk mengosongkan.
export const updateProductSchema = Joi.object({
  name: text(200).min(1).label('Nama produk'),
  main_category: Joi.string().valid(...CATEGORIES).label('Kategori'),
  sub_category: text(100).allow(null, '').empty('').label('Sub kategori'),
  size_label: text(50).allow(null, '').empty('').label('Ukuran'),
  variant_label: text(100).allow(null, '').empty('').label('Varian/bahan'),
  unit: text(20).label('Satuan'),
  selling_price: rupiah.allow(null).label('Harga jual'),
  piecework_rate: rupiah.label('Tarif borongan'),
}).min(1);

export const initializeStockSchema = Joi.object({
  initial_qty: Joi.number().integer().min(0).max(MAX_STOCK).required().label('Stok awal'),
  reason: reason.default('Verifikasi saldo awal fisik').label('Keterangan'),
});

// Dua bentuk: stok opname { physical_qty, reason } atau { adjustment_type, qty, reason }.
export const adjustStockSchema = Joi.object({
  physical_qty: Joi.number().integer().min(0).max(MAX_STOCK).label('Jumlah fisik'),
  adjustment_type: Joi.string().valid('adjustment_in', 'adjustment_out').label('Jenis penyesuaian'),
  qty: Joi.number().integer().min(1).max(MAX_STOCK).label('Jumlah'),
  reason: reason.required().label('Alasan'),
})
  .xor('physical_qty', 'adjustment_type')
  .with('adjustment_type', 'qty')
  .messages({
    'object.missing': 'Isi jumlah fisik (physical_qty) atau jenis penyesuaian (adjustment_type).',
    'object.xor': 'Pilih salah satu: jumlah fisik atau jenis penyesuaian.',
    'object.with': 'Jumlah wajib diisi untuk jenis penyesuaian.',
  });
