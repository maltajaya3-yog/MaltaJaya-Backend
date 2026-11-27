// Membuat 1 akun login per role. Login memakai email + password; ID akun berupa UUID acak
// (kolom users.id), jadi endpoint seperti /users/:id tidak bisa ditebak dengan /users/1, /users/2.
// Kredensial hanya ditampilkan sekali dan disimpan ke seed-credentials.local.txt (di-gitignore).
//
//   npm run seed:users            -> buat akun untuk role yang belum punya akun
//   npm run seed:users -- --reset -> hapus akun seed lama lalu buat ulang
//
// Password yang sudah ada di seed-credentials.local.txt dipakai lagi (password tetap);
// role yang belum punya password dibuatkan password acak baru.

import crypto from 'node:crypto';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const CRED_FILE = 'seed-credentials.local.txt';
const DOMAIN = (process.env.SEED_EMAIL_DOMAIN || 'maltajaya.test').toLowerCase();

const ROLES = [
  { role: 'owner_manager', full_name: 'Owner & Manajer', local: 'owner.manager' },
  { role: 'inventory', full_name: 'Staf Inventory', local: 'inventory' },
  { role: 'produksi', full_name: 'Staf Produksi', local: 'produksi' },
  { role: 'qc', full_name: 'Staf QC', local: 'qc' },
];

const PASS_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newPassword = () => Array.from({ length: 14 }, () => PASS_ALPHABET[crypto.randomInt(PASS_ALPHABET.length)]).join('');

function previousPasswords() {
  if (!fs.existsSync(CRED_FILE)) return {};
  const map = {};
  for (const line of fs.readFileSync(CRED_FILE, 'utf8').split('\n')) {
    const m = line.match(/^(\S+)\s+.*Password: (\S+)/);
    if (m) map[m[1]] = m[2];
  }
  return map;
}

const reset = process.argv.includes('--reset');
const oldPasswords = previousPasswords();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const created = [];
try {
  await client.query('BEGIN');
  if (reset) await client.query('DELETE FROM users WHERE role = ANY($1)', [ROLES.map((r) => r.role)]);
  for (const { role, full_name, local } of ROLES) {
    const { rowCount } = await client.query('SELECT 1 FROM users WHERE role = $1', [role]);
    if (rowCount > 0) {
      console.log(`- ${role}: sudah ada akun, dilewati (pakai --reset untuk membuat ulang)`);
      continue;
    }
    const email = `${local}@${DOMAIN}`;
    const password = oldPasswords[role] ?? newPassword();
    const hash = await bcrypt.hash(password, 12);
    // username hanya penanda internal (tidak dipakai login maupun di URL).
    const username = `${role}-${crypto.randomBytes(3).toString('hex')}`;
    const { rows } = await client.query(
      'INSERT INTO users (username, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [username, email, hash, full_name, role],
    );
    created.push({ role, email, password, id: rows[0].id, reused: Boolean(oldPasswords[role]) });
  }
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  await client.end();
}

if (created.length) {
  const lines = [
    `# Kredensial akun Maltajaya (dibuat ${new Date().toISOString()})`,
    '# RAHASIA - jangan di-commit / dibagikan di grup publik.',
    '',
    ...created.map((c) => `${c.role.padEnd(14)} Email: ${c.email.padEnd(28)} Password: ${c.password}`),
    '',
  ];
  fs.writeFileSync(CRED_FILE, lines.join('\n'), { mode: 0o600 });
  for (const c of created) {
    console.log(`+ ${c.role.padEnd(14)} ${c.email.padEnd(28)} id=${c.id} ${c.reused ? '(password lama dipakai)' : '(password baru)'}`);
  }
  console.log(`Kredensial disimpan ke ${CRED_FILE}`);
}
