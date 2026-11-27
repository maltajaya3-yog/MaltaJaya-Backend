// Menjalankan semua file database/migrations/*.sql secara berurutan (nama file).
// Setiap file harus aman dijalankan berulang (pakai IF NOT EXISTS), jadi tidak perlu tabel riwayat.
//
//   npm run db:migrate

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const dir = path.resolve('database/migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  for (const file of files) {
    await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    console.log(`✓ ${file}`);
  }
} finally {
  await client.end();
}
