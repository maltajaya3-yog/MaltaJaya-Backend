// Mengisi katalog produk SINTETIS untuk pengembangan (bukan data riil Maltajaya),
// lengkap dengan saldo awal terverifikasi + mutasi 'initial_stock'.
// Kode barang sama dengan data contoh di frontend agar modul yang masih mock tetap nyambung.
//
//   npm run seed:products   (aman dijalankan ulang: kode yang sudah ada dilewati)

import pg from 'pg';

// [kode, nama, kategori, bahan, ukuran, harga jual, tarif borongan, saldo awal]
const PRODUCTS = [
  ['P-001', 'Patung Bunda Maria', 'patung', 'Fiberglass', '30 cm', 175_000, 15_000, 40],
  ['P-002', 'Patung Bunda Maria', 'patung', 'Fiberglass', '60 cm', 450_000, 35_000, 18],
  ['P-003', 'Patung Hati Kudus Yesus', 'patung', 'Fiberglass', '40 cm', 275_000, 22_000, 25],
  ['P-004', 'Patung Santo Yosef', 'patung', 'Fiberglass', '40 cm', 265_000, 20_000, 22],
  ['P-005', 'Patung Santo Antonius', 'patung', 'Fiberglass', '30 cm', 185_000, 15_000, 26],
  ['P-006', 'Patung Malaikat Pelindung', 'patung', 'Fiberglass', '25 cm', 150_000, 12_000, 35],
  ['P-007', 'Patung Pieta', 'patung', 'Fiberglass', '35 cm', 395_000, 30_000, 14],
  ['P-008', 'Patung Keluarga Kudus', 'patung', 'Fiberglass', '30 cm', 325_000, 25_000, 20],
  ['P-009', 'Patung Bunda Maria Fatima', 'patung', 'Fiberglass', '100 cm', 1_450_000, 110_000, 5],
  ['S-001', 'Salib Dinding', 'salib', 'Kayu', '30 cm', 120_000, 10_000, 45],
  ['S-002', 'Salib Dinding', 'salib', 'Kayu', '50 cm', 210_000, 16_000, 30],
  ['S-003', 'Salib Altar', 'salib', 'Fiberglass', '60 cm', 520_000, 40_000, 10],
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  const { rows: owner } = await client.query("SELECT id FROM users WHERE role = 'owner_manager' ORDER BY created_at LIMIT 1");
  if (!owner[0]) throw new Error('Belum ada akun owner_manager. Jalankan npm run seed:users terlebih dahulu.');
  let added = 0;
  for (const [sku, name, category, bahan, size, price, rate, qty] of PRODUCTS) {
    const { rows } = await client.query(
      `INSERT INTO products (sku_code, name, main_category, variant_label, size_label, selling_price, piecework_rate, current_stock, stock_initialized_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (sku_code) DO NOTHING RETURNING id`,
      [sku, name, category, bahan, size, price, rate, qty],
    );
    if (!rows[0]) continue;
    added += 1;
    if (qty > 0) {
      await client.query(
        `INSERT INTO stock_movements (product_id, movement_type, qty_change, stock_before, stock_after, reference_type, reason, created_by)
         VALUES ($1, 'initial_stock', $2, 0, $2, 'manual', 'Saldo awal data contoh [SINTETIS]', $3)`,
        [rows[0].id, qty, owner[0].id],
      );
    }
  }
  await client.query('COMMIT');
  console.log(`Produk ditambahkan: ${added} (dilewati karena sudah ada: ${PRODUCTS.length - added})`);
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  await client.end();
}
