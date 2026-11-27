// Akses data akun login. Password hanya disimpan sebagai hash bcrypt dan tidak pernah dikirim balik.

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query } from '../../db.js';
import { ROLES } from '../../roles.js';
import { ApiError } from '../../utils/http.js';

const USER_COLUMNS = 'id, full_name, email, role, is_active, last_login_at, created_at, updated_at';
const BCRYPT_ROUNDS = 12;

// username wajib unik di skema tapi tidak dipakai login; dibuat otomatis sebagai penanda internal.
const internalUsername = (role) => `${role}-${crypto.randomBytes(4).toString('hex')}`;

function duplicateEmail(err) {
  if (err.code === '23505' && String(err.constraint).includes('email')) {
    return new ApiError(409, 'DUPLICATE_EMAIL', 'Email sudah dipakai akun lain.', [{ field: 'email' }]);
  }
  return err;
}

export async function listUsers({ role, status, search, page, limit }) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replaceAll('?', `$${params.length}`));
  };
  if (search) add('(full_name ILIKE ? OR email ILIKE ?)', `%${search.replace(/[\\%_]/g, '\\$&')}%`);
  if (status === 'active') where.push('is_active');
  if (status === 'inactive') where.push('NOT is_active');

  // Jumlah per role (untuk badge tab) mengikuti filter pencarian & status, tapi bukan filter role.
  const baseWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows: counts } = await query(`SELECT role, COUNT(*) AS total FROM users ${baseWhere} GROUP BY role`, params);

  if (role) add('role = ?', role);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows: count } = await query(`SELECT COUNT(*) AS total FROM users ${whereSql}`, params);
  const { rows } = await query(
    `SELECT ${USER_COLUMNS} FROM users ${whereSql}
      ORDER BY is_active DESC, CASE role WHEN 'owner_manager' THEN 0 WHEN 'inventory' THEN 1 WHEN 'produksi' THEN 2 ELSE 3 END, full_name
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit],
  );
  const roleCounts = Object.fromEntries(Object.values(ROLES).map((r) => [r, 0]));
  for (const c of counts) roleCounts[c.role] = c.total;
  return { items: rows, total: count[0].total, roleCounts };
}

export async function createUser({ full_name, email, role, password }) {
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const { rows } = await query(
      `INSERT INTO users (username, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5) RETURNING ${USER_COLUMNS}`,
      [internalUsername(role), email, hash, full_name, role],
    );
    return rows[0];
  } catch (err) {
    throw duplicateEmail(err);
  }
}

/** Pastikan tetap ada minimal satu Owner & Manajer aktif selain akun `excludeId`. */
async function assertAnotherActiveOwner(client, excludeId) {
  const { rows } = await client.query("SELECT COUNT(*) AS total FROM users WHERE role = 'owner_manager' AND is_active AND id <> $1", [excludeId]);
  if (rows[0].total === 0) {
    throw new ApiError(409, 'LAST_OWNER', 'Harus ada minimal satu akun Owner & Manajer yang aktif.');
  }
}

export async function updateUser(client, id, changes, actorId) {
  const { rows: cur } = await client.query('SELECT id, role, is_active FROM users WHERE id = $1 FOR UPDATE', [id]);
  const user = cur[0];
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'Akun tidak ditemukan.');

  const isSelf = id === actorId;
  const losesOwner = user.role === ROLES.OWNER_MANAGER && user.is_active && ((changes.role && changes.role !== ROLES.OWNER_MANAGER) || changes.is_active === false);
  if (isSelf && changes.is_active === false) throw new ApiError(409, 'SELF_ACTION', 'Anda tidak bisa menonaktifkan akun sendiri.');
  if (isSelf && changes.role && changes.role !== user.role) throw new ApiError(409, 'SELF_ACTION', 'Anda tidak bisa mengubah role akun sendiri.');
  if (losesOwner) await assertAnotherActiveOwner(client, id);

  const sets = [];
  const params = [id];
  const set = (col, value) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  for (const col of ['full_name', 'email', 'role', 'is_active']) if (changes[col] !== undefined) set(col, changes[col]);
  if (changes.password) set('password_hash', await bcrypt.hash(changes.password, BCRYPT_ROUNDS));
  if (sets.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'Tidak ada data yang diubah.');

  try {
    const { rows } = await client.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${USER_COLUMNS}`, params);
    return rows[0];
  } catch (err) {
    throw duplicateEmail(err);
  }
}

/**
 * Hapus akun. Bila akun sudah punya riwayat aktivitas (direferensikan tabel lain, mis. stock_movements),
 * akun dinonaktifkan agar riwayat tetap utuh. Mengembalikan { mode: 'deleted' | 'deactivated', user }.
 */
export async function deleteUser(client, id, actorId) {
  if (id === actorId) throw new ApiError(409, 'SELF_ACTION', 'Anda tidak bisa menghapus akun sendiri.');
  const { rows: cur } = await client.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`, [id]);
  const user = cur[0];
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'Akun tidak ditemukan.');
  if (user.role === ROLES.OWNER_MANAGER && user.is_active) await assertAnotherActiveOwner(client, id);

  await client.query('SAVEPOINT before_delete');
  try {
    await client.query('DELETE FROM users WHERE id = $1', [id]);
    return { mode: 'deleted', user };
  } catch (err) {
    if (err.code !== '23503') throw err; // 23503 = masih direferensikan (foreign key)
    await client.query('ROLLBACK TO SAVEPOINT before_delete');
    const { rows } = await client.query(`UPDATE users SET is_active = FALSE WHERE id = $1 RETURNING ${USER_COLUMNS}`, [id]);
    return { mode: 'deactivated', user: rows[0] };
  }
}
