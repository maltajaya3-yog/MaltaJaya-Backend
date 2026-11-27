import multer from 'multer';
import { ApiError } from '../utils/http.js';

export function notFound(req, _res, next) {
  next(new ApiError(404, 'NOT_FOUND', `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan.`));
}

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: 'Ukuran foto maksimal 3 MB.',
  LIMIT_FILE_COUNT: 'Hanya boleh satu foto.',
  LIMIT_UNEXPECTED_FILE: 'Foto harus dikirim di field "image".',
};

const send = (res, status, code, message, details) =>
  res.status(status).json({ success: false, error: details ? { code, message, details } : { code, message } });

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) return send(res, err.status, err.code, err.message, err.details);
  if (err instanceof multer.MulterError) {
    return send(res, 400, 'VALIDATION_ERROR', MULTER_MESSAGES[err.code] ?? 'Upload foto gagal.', [{ field: 'image' }]);
  }
  if (err.type === 'entity.parse.failed') return send(res, 400, 'VALIDATION_ERROR', 'Body JSON tidak valid.');
  if (err.status === 404 || err.code === 'ENOENT') return send(res, 404, 'NOT_FOUND', 'File tidak ditemukan.'); // express.static
  console.error('[api] error tak terduga:', err);
  return send(res, 500, 'INTERNAL_ERROR', 'Terjadi kesalahan pada server.');
}
