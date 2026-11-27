// Upload foto produk: diterima di memori (multer), lalu diproses ulang dengan sharp menjadi WebP.
// Proses ulang ini memastikan file benar-benar gambar, membuang metadata (EXIF/GPS), dan
// menyeragamkan ukuran. Nama file selalu UUID baru, tidak pernah memakai nama dari pengguna.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { config } from '../../config.js';
import { ApiError } from '../../utils/http.js';

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SUBDIR = 'products';

/** Middleware multer: satu file di field `image`, maks. 3 MB, hanya JPG/PNG/WebP. */
export const uploadProductImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) return cb(null, true);
    return cb(new ApiError(400, 'VALIDATION_ERROR', 'Foto harus berformat JPG, PNG, atau WebP.', [{ field: 'image' }]));
  },
}).single('image');

/** Proses & simpan foto. Mengembalikan path relatif terhadap folder uploads. */
export async function saveProductImage(buffer) {
  let output;
  try {
    output = await sharp(buffer, { limitInputPixels: 40_000_000 })
      .rotate() // ikuti orientasi kamera HP, lalu metadata dibuang saat encode ulang
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'File tidak bisa dibaca sebagai gambar.', [{ field: 'image' }]);
  }
  const relPath = `${SUBDIR}/${crypto.randomUUID()}.webp`;
  await fs.mkdir(path.join(config.uploadDir, SUBDIR), { recursive: true });
  await fs.writeFile(path.join(config.uploadDir, relPath), output, { flag: 'wx' });
  return relPath;
}

/** Hapus file foto lama. Path dicek agar tidak pernah keluar dari folder uploads. */
export async function deleteProductImage(relPath) {
  if (!relPath) return;
  const full = path.resolve(config.uploadDir, relPath);
  if (!full.startsWith(path.join(config.uploadDir, SUBDIR) + path.sep)) return;
  await fs.rm(full, { force: true });
}
