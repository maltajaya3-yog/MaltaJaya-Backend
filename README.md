# MaltaJaya Backend

REST API `/api/v1` untuk Sistem Operasional Maltajaya (Express + PostgreSQL via `pg`).
Dokumen rancangan ada di [docs/](docs/) dan skema database di [database/schema.sql](database/schema.sql).

**Status:** modul autentikasi dan modul stok (produk, foto produk, mutasi stok) sudah jalan. Modul lain mengikuti API contract.

## Menjalankan secara lokal

Butuh Node.js 20+ dan Docker Desktop.

```bash
cp .env.example .env      # lalu isi POSTGRES_PASSWORD, DATABASE_URL, dan JWT_SECRET
npm install
npm run db:up             # PostgreSQL 16 di Docker; schema.sql dijalankan otomatis saat pertama kali
npm run db:migrate        # terapkan database/migrations/*.sql (aman diulang)
npm run seed:users        # buat 1 akun per role (email + password acak)
npm run dev               # API di http://localhost:5000/api/v1
```

Opsional: `npm run seed:products` mengisi 12 produk contoh **sintetis** (aman dijalankan ulang).

Kalau port 5432 sudah dipakai PostgreSQL lain, ganti `POSTGRES_PORT` (mis. `5433`) dan port di `DATABASE_URL`.

## Struktur kode

```
src/
  app.js, server.js        rakit Express, middleware global, daftar route
  config.js                semua environment variable dibaca di sini
  db.js                    pool PostgreSQL + withTransaction()
  roles.js                 matriks hak akses per role (ACCESS)
  middleware/              requireAuth, requireRole, error handler
  utils/                   format respons (ok, ApiError), validasi Joi berbahasa Indonesia
  modules/<nama>/
    <nama>.routes.js       handler tipis: validasi -> service -> respons
    <nama>.schemas.js      skema Joi
    <nama>.service.js      query database & aturan bisnis
database/
  schema.sql               skema lengkap (untuk database baru)
  migrations/NNN_*.sql     perubahan untuk database yang sudah ada (wajib idempotent)
scripts/                   migrate, seed
```

Menambah modul baru (mis. nota): buat `src/modules/invoices/` dengan pola yang sama, daftarkan di `src/app.js`,
dan tambahkan hak aksesnya di `src/roles.js`. **Perubahan stok wajib lewat `modules/stock/stock.service.js`**
(mengunci baris produk, memperbarui stok, dan mencatat `stock_movements` dalam satu transaksi).

Perubahan skema: ubah `schema.sql` **dan** tambahkan file migrasi baru, lalu `npm run db:migrate`.

## Akun login

Login memakai **email + password**. Semua ID data berupa **UUID acak**, bukan angka berurutan, sehingga endpoint
seperti `/products/:id` tidak bisa ditebak dengan `/products/1`, `/products/2`. Setiap endpoint tetap mengecek role,
karena UUID mencegah tebakan tapi bukan pengganti otorisasi.

`npm run seed:users` membuat `owner.manager@`, `inventory@`, `produksi@`, `qc@` dengan domain `SEED_EMAIL_DOMAIN`
(default `maltajaya.test`) dan menyimpan kredensial ke `seed-credentials.local.txt` (di-gitignore; jangan dibagikan).
Password di file itu dipakai lagi saat seed ulang. Buat ulang akun dengan `npm run seed:users -- --reset`.

| Role | Akses |
|---|---|
| `owner_manager` | Semua modul |
| `inventory` | Stok (kelola produk, foto, stok opname, riwayat mutasi), nota, toko, kebutuhan produksi |
| `produksi` | Lihat stok tanpa harga, kebutuhan produksi, catat batch, perbaikan |
| `qc` | Antrean dan riwayat QC |

## Endpoint yang sudah ada

| Method | Endpoint | Keterangan |
|---|---|---|
| `GET` | `/api/v1/health` | Status server dan koneksi database |
| `POST` | `/api/v1/auth/login` | `{ email, password }` → `{ access_token, expires_at, user }`. Salah → `401 INVALID_CREDENTIALS`. Maks. 10 gagal / 15 menit → `429` |
| `GET` | `/api/v1/auth/me` | Profil dari token (`Authorization: Bearer <token>`) |
| `POST` | `/api/v1/auth/logout` | Logout (token dihapus di client) |
| `GET` | `/api/v1/products` | Daftar produk aktif. Query `search`, `main_category`, `stock_status`, `page`, `limit` (maks. 500). Produksi tidak menerima `selling_price` & `piecework_rate` |
| `GET` | `/api/v1/products/lookup/:sku_code` | Cari produk dari kode (huruf besar/kecil sama) |
| `GET` | `/api/v1/products/:id` | Detail + 10 mutasi terakhir (mutasi hanya owner_manager & inventory) |
| `POST` | `/api/v1/products` | Tambah produk; `initial_qty` opsional (saldo awal dalam transaksi yang sama). Kode duplikat → `409 DUPLICATE_SKU` |
| `PATCH` | `/api/v1/products/:id` | Ubah data (bukan kode & stok). `piecework_rate` hanya owner_manager |
| `DELETE` | `/api/v1/products/:id` | Body `{ reason }` (wajib). Hapus = arsipkan (`is_active = false`) + catat `deleted_at`, `deleted_by`, `delete_reason`. Riwayat mutasi tetap ada, kode tidak bisa dipakai ulang |
| `GET` | `/api/v1/products/deleted` | Riwayat hapus (terbaru dulu): siapa, kapan, alasan, stok saat dihapus. Query `search`, `page`, `limit`. Role: owner_manager, inventory |
| `POST` | `/api/v1/products/:id/restore` | Pulihkan produk yang dihapus (stok kembali seperti saat dihapus) |
| `PUT` | `/api/v1/products/:id/image` | Upload foto (`multipart/form-data`, field `image`, JPG/PNG/WebP maks. 3 MB). Diproses ulang jadi WebP maks. 800 px, metadata dibuang |
| `DELETE` | `/api/v1/products/:id/image` | Hapus foto |
| `POST` | `/api/v1/products/:id/initialize-stock` | Verifikasi saldo awal sekali per produk |
| `POST` | `/api/v1/products/:id/adjust-stock` | `{ physical_qty, reason }` (stok opname) atau `{ adjustment_type, qty, reason }`. Stok tidak boleh minus |
| `GET` | `/api/v1/users` | Kelola akun (owner_manager). Query `role`, `status=active\|inactive\|all`, `search`, `page`, `limit`. `meta.role_counts` = jumlah akun per role |
| `POST` | `/api/v1/users` | `{ full_name, email, role, password }`. Password min. 8 karakter, berisi huruf & angka. Email duplikat → `409 DUPLICATE_EMAIL` |
| `PATCH` | `/api/v1/users/:id` | Ubah nama/email/role/status; isi `password` untuk reset. Tidak bisa menonaktifkan / mengubah role akun sendiri |
| `DELETE` | `/api/v1/users/:id` | Hapus permanen bila belum ada aktivitas; bila sudah (mis. pernah mencatat mutasi) akun dinonaktifkan (`mode: deactivated`). Tidak bisa menghapus akun sendiri; minimal 1 owner_manager aktif |
| `GET` | `/api/v1/stock-movements` | Riwayat mutasi. Query `product_id`, `sku_code`, `movement_type` (dipisah koma), `date_from`, `date_to`, `page`, `limit` |

Foto disajikan di `GET /uploads/products/<uuid>.webp`. Folder `uploads/` disimpan di disk lokal; di hosting tanpa
disk permanen (mis. Render free tier) foto perlu dipindah ke object storage.

## Perintah lain

```bash
npm run db:down     # matikan container (data tetap)
npm run db:reset    # hapus data, buat ulang database dari schema.sql
```
