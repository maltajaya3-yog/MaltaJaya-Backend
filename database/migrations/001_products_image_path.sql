-- Foto produk. Untuk database yang dibuat sebelum kolom ini ada di schema.sql.
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_path VARCHAR(255);
