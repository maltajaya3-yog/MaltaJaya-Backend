// Endpoint /users — kelola akun login. Hanya Owner & Manajer.

import { Router } from 'express';
import { withTransaction } from '../../db.js';
import { requireRole } from '../../middleware/auth.js';
import { ACCESS } from '../../roles.js';
import { asyncHandler, ok, pageMeta } from '../../utils/http.js';
import { requireUuid, validate } from '../../utils/validate.js';
import { createUserSchema, listUsersSchema, updateUserSchema } from './users.schemas.js';
import { createUser, deleteUser, listUsers, updateUser } from './users.service.js';

const router = Router();
router.use(requireRole(...ACCESS.userManage));

// GET /users?role=&status=&search=&page=&limit=   (meta.role_counts untuk badge per role)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = validate(listUsersSchema, req.query);
    const { items, total, roleCounts } = await listUsers(q);
    return ok(res, items, { message: 'Daftar akun berhasil dimuat', meta: { ...pageMeta(q, total), role_counts: roleCounts } });
  }),
);

// POST /users
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = await createUser(validate(createUserSchema, req.body));
    return ok(res, user, { status: 201, message: `Akun ${user.full_name} berhasil dibuat` });
  }),
);

// PATCH /users/:id  (password opsional = reset password)
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'Akun');
    const changes = validate(updateUserSchema, req.body);
    const user = await withTransaction((client) => updateUser(client, id, changes, req.user.id));
    return ok(res, user, { message: `Akun ${user.full_name} diperbarui` });
  }),
);

// DELETE /users/:id  (akun dengan riwayat aktivitas dinonaktifkan, bukan dihapus permanen)
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'Akun');
    const { mode, user } = await withTransaction((client) => deleteUser(client, id, req.user.id));
    const message =
      mode === 'deleted'
        ? `Akun ${user.full_name} dihapus`
        : `Akun ${user.full_name} punya riwayat aktivitas, jadi dinonaktifkan (tidak bisa login) agar riwayatnya tetap utuh`;
    return ok(res, { id: user.id, mode }, { message });
  }),
);

export default router;
