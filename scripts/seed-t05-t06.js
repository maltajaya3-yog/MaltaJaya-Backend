import { pool, withTransaction } from '../src/db.js';
import { initializeStock } from '../src/modules/stock/stock.service.js';

if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname) || process.env.NODE_ENV === 'production') {
  throw new Error('Seed sintetis hanya untuk PostgreSQL lokal nonproduksi.');
}

try {
  await withTransaction(async (client) => {
    const { rows: [user] } = await client.query(
      "SELECT id FROM users WHERE role = 'owner_manager' AND is_active ORDER BY created_at, id LIMIT 1",
    );
    if (!user) throw new Error('Jalankan seed akun terlebih dahulu.');
    const products = [
      ['DEMO PT-120', 'Patung Demo 40 cm', 'patung', 120000, 10],
      ['DEMO SL-NULL', 'Salib Demo belum diverifikasi', 'salib', null, null],
      ['DEMO SL-0', 'Salib Demo stok kosong', 'salib', 90000, 0],
    ];
    for (const [sku, name, category, price, quantity] of products) {
      const { rows: [product] } = await client.query(
        `INSERT INTO products (sku_code, name, main_category, selling_price)
         VALUES ($1, $2, $3, $4) ON CONFLICT (sku_code) DO NOTHING RETURNING id`,
        [sku, name, category, price],
      );
      if (product && quantity !== null) {
        await initializeStock(client, { productId: product.id, qty: quantity, reason: 'Saldo awal data sintetis', userId: user.id });
      }
    }
    await client.query(`INSERT INTO customers (customer_code, name, city)
      VALUES ('DEMO-TOKO-01','Toko Demo','Bantul') ON CONFLICT (customer_code) DO NOTHING`);
  });
  console.log('Data sintetis T05 dan T06 tersedia.');
} finally {
  await pool.end();
}
