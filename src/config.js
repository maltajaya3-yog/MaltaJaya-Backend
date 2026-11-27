import path from 'node:path';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} wajib diisi (lihat .env.example).`);
  return value;
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) throw new Error('JWT_SECRET minimal 32 karakter.');

const port = Number(process.env.PORT) || 5000;

export const config = Object.freeze({
  port,
  databaseUrl: required('DATABASE_URL'),
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  isProduction: process.env.NODE_ENV === 'production',
  // URL publik API (dipakai untuk membentuk URL foto produk).
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  // Folder penyimpanan file upload (foto produk). Di hosting tanpa disk permanen, ganti ke object storage.
  uploadDir: path.resolve(process.env.UPLOAD_DIR || 'uploads'),
});
