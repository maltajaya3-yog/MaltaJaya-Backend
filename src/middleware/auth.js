import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { ApiError, asyncHandler } from '../utils/http.js';

/** Wajib login. Profil & role selalu dibaca ulang dari DB, bukan dipercaya dari isi token. */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw new ApiError(401, 'UNAUTHORIZED', 'Silakan masuk terlebih dahulu.');

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new ApiError(401, 'UNAUTHORIZED', 'Sesi berakhir. Silakan masuk kembali.');
  }

  const { rows } = await query('SELECT id, full_name, role, is_active FROM users WHERE id = $1', [payload.sub]);
  const user = rows[0];
  if (!user || !user.is_active) throw new ApiError(401, 'UNAUTHORIZED', 'Akun tidak aktif. Hubungi manajer.');

  req.user = { id: user.id, full_name: user.full_name, role: user.role };
  next();
});

/** Batasi endpoint ke role tertentu. Dipakai setelah requireAuth. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.user?.role)) {
      return next(new ApiError(403, 'FORBIDDEN', 'Anda tidak memiliki akses untuk aksi ini.'));
    }
    next();
  };
}
