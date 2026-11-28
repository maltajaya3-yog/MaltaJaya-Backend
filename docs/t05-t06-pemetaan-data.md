# Pemetaan data stok dan nota Maltajaya

Antarmuka mengikuti desain Arif pada branch `feat/integrasi-backend`. Contoh integrasi memakai data sintetis.

| Field UI | Sumber | API | Saat belum tersedia |
|---|---|---|---|
| Kode, nama, kategori | KENAN.xlsx, tab PATUNG dan SALIB | `sku_code`, `name`, `main_category` | Kode kosong atau ganda masuk daftar pemeriksaan. Kategori dari tab, bukan awalan kode. Simpan spasi di tengah kode. |
| Ukuran, bahan, foto | Master barang terverifikasi | `size_label`, `variant_label`, `image_url` | Tetap kosong. Gunakan placeholder visual untuk foto. |
| Harga jual | Nominal katalog setelah persetujuan | `selling_price` | `null`. Tampilkan Harga belum terverifikasi. |
| Saldo awal | Hitung fisik per kode dan tanggal | `current_stock`, `stock_initialized_at` | Tampilkan Belum ada saldo awal. Verifikasi 0 secara eksplisit bila hasil hitung 0. |
| Mutasi | Transaksi stok | `movement_type`, `qty_change`, `stock_after`, `reference_id` | Riwayat kosong hingga ada perubahan. |
| Toko dan kode pelanggan | Master pelanggan | `customer_id`, `customer_code` | Nota tempo membutuhkan toko aktif. Untuk pembeli perorangan tunai, gunakan `buyer_name`. Kode toko tidak dicantumkan. |
| Item nota | Pencarian SKU pada master barang | Request `product_id`, `qty`. Respons `sku_snapshot`, `product_name_snapshot`, `unit_price_snapshot` | Konfirmasi ditolak jika harga atau saldo awal belum terverifikasi, atau stok tidak cukup. |
| Kop, tanggal, total | Contoh nota A4 dan nota tersimpan | `invoice_date`, `invoice_number`, `customer_code`, `total_amount` | Logo dan detail kop final menunggu review C08. |

## Skenario sintetis

Gunakan kode `DEMO PT-120` dengan harga Rp120.000 dan saldo awal 10 serta pelanggan `DEMO-TOKO-01`. Simpan nota tempo 3 unit. Total Rp360.000, saldo 7, dan muncul mutasi keluar 3 yang merujuk ke nota. Ulangi request dengan ID yang sama untuk memeriksa saldo tetap 7. Cetak ulang memakai detail yang sama. Uji juga `DEMO SL-NULL` (harga kosong, saldo belum diverifikasi) dan `DEMO SL-0` (saldo nol terverifikasi).

## Hasil verifikasi 28 November 2026

- Audit internal KENAN.xlsx mencakup 2.917 baris calon produk. Sebanyak 163 baris berkode kosong dan 52 baris dalam 25 kelompok kode ganda dipisahkan. Sisa 2.702 baris masuk data persiapan dengan harga jual dan saldo awal kosong. Data persiapan dan daftar review tersimpan di `data/private/` serta diabaikan Git.
- Di frontend, cari SKU berspasi, koreksi 10 menjadi 9 lalu kembali ke 10, dan periksa riwayat. Simpan nota tempo 3 unit seharga Rp120.000 per unit. Hasilnya stok 7, satu mutasi keluar, total Rp360.000, dan saldo tetap 7 setelah cetak ulang. Pesanan 11 unit diblokir saat stok 10.
- Uji HTTP pada PostgreSQL 16 mencakup hak akses, stok kosong dan saldo belum terverifikasi, gabungan kuantitas dari SKU yang sama, retry serentak (HTTP 201 dan 200 untuk satu nota), harga historis setelah harga katalog diubah, serta nota tunai tanpa toko.
- PDF hasil demo memiliki satu halaman A4 dan menampilkan kode toko di kanan atas. File ada di `artifacts/T06-Nota-A4-Sintetis.pdf` dan dapat dilampirkan untuk review D06/C08.

## Batas integrasi

T06 memakai operasi simpan terkonfirmasi, daftar, dan detail nota. Pratinjau dan cetak ulang memakai detail nota tanpa transaksi stok tambahan. D02 mendokumentasikan juga operasi masa depan untuk draft, pembatalan, dan pelacakan cetak. Modul piutang pada frontend masih simulasi sampai T08, walaupun backend nota sudah mencatat debit nota tempo dan pemasukan nota tunai.

Jalankan `npm run db:migrate` untuk database pengujian yang sudah ada. Untuk menyiapkan data di database lokal, jalankan `node --env-file=.env scripts/seed-t05-t06.js` setelah seed akun. Script data contoh mempertahankan saldo yang sudah dicatat. Gunakan database lokal uji dan jalankan `node scripts/verify-t05-t06.js` saat API uji berjalan. Secara default skrip menguji port 5051, atau gunakan `TEST_API_URL` dengan URL API lokal yang diakhiri garis miring.
