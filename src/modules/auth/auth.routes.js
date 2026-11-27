import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import { config } from '../../config.js';
import { query } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { ApiError, asyncHandler, ok } from '../../utils/http.js';

const router = Router();

const loginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(254).required(),
  password: Joi.string().min(1).max(128).required(),
});

// Hash palsu agar waktu respons sama saat UID tidak terdaftar (mencegah enumerasi akun).
const DUMMY_HASH = bcrypt.hashSync('maltajaya-dummy-password', 10);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, res) =>
    res.status(429).json({
      success: false,
      error: { code: 'TOO_MANY_REQUESTS', message: 'Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.' },
    }),
});

const publicUser = (u) => ({ id: u.id, full_name: u.full_name, role: u.role });

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { value, error } = loginSchema.validate(req.body ?? {}, { abortEarly: false, stripUnknown: true });
    if (error) {
      const emailInvalid = error.details.some((d) => d.path[0] === 'email' && d.type === 'string.email');
      throw new ApiError(400, 'VALIDATION_ERROR', emailInvalid ? 'Format email tidak valid.' : 'Email dan password wajib diisi.');
    }

    const { rows } = await query(
      'SELECT id, password_hash, full_name, role, is_active FROM users WHERE email = $1',
      [value.email],
    );
    const user = rows[0];
    const valid = await bcrypt.compare(value.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email atau password salah.');
    if (!user.is_active) throw new ApiError(403, 'ACCOUNT_INACTIVE', 'Akun tidak aktif. Hubungi manajer.');

    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const accessToken = jwt.sign({ role: user.role }, config.jwtSecret, {
      subject: user.id,
      expiresIn: config.jwtExpiresIn,
      algorithm: 'HS256',
    });
    const { exp } = jwt.decode(accessToken);

    return ok(
      res,
      { access_token: accessToken, token_type: 'Bearer', expires_at: exp * 1000, user: publicUser(user) },
      { message: 'Berhasil masuk' },
    );
  }),
);

router.get('/me', requireAuth, (req, res) => ok(res, publicUser(req.user)));

// JWT bersifat stateless: logout cukup menghapus token di client. Endpoint ini tetap ada
// agar FE punya satu titik logout (nanti bisa ditambah blacklist / cookie httpOnly).
router.post('/logout', requireAuth, (_req, res) => ok(res, null, { message: 'Berhasil keluar' }));

export default router;
