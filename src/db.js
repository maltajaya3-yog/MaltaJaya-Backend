import pg from 'pg';
import { config } from './config.js';

// BIGINT (harga, nominal rupiah, COUNT) dikembalikan pg sebagai string. Nilai di aplikasi ini
// jauh di bawah Number.MAX_SAFE_INTEGER, jadi aman diubah ke number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[db] koneksi idle error:', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

/** Jalankan fn dalam satu transaksi: semua berhasil (COMMIT) atau tidak sama sekali (ROLLBACK). */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
