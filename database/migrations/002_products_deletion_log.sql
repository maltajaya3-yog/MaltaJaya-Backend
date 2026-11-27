-- Riwayat hapus produk (siapa, kapan, alasan). Produk diarsipkan, bukan dihapus permanen.
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS delete_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_products_deleted_at ON products (deleted_at DESC) WHERE NOT is_active;
