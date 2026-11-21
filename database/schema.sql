-- =============================================================================
-- MALTAJAYA INTERNAL OPS & ADMIN SYSTEM (Tim Asah 2026 A26-CS197)
-- Deliverable T02-D03: PostgreSQL Database Schema v1.1 (Reviewed Baseline)
-- Target DBMS: PostgreSQL 15+ (Kompatibel Neon Free Tier / Local PostgreSQL)
-- Disusun oleh: Dwi Yoanda Febriarsa (Full-Stack / PIC Integrasi & T02)
-- Tanggal: 21 November 2026
-- Catatan:
--   * File ini HANYA berisi struktur skema (DDL), tanpa data riil UMKM.
--   * Selaras dengan Project Plan [S1], Wawancara [S2], dan Struktur Data Kenan [S5].
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. HELPER FUNCTION: Auto-update kolom updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- DOMAIN 1: KEPEGAWAIAN, AUTENTIKASI & HAK AKSES (T03, T09)
-- =============================================================================

-- 1. Master Karyawan (Harian, Borongan, Prodo) - terpisah dari akun login
CREATE TABLE IF NOT EXISTS employees (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_code   VARCHAR(32) NOT NULL UNIQUE,
    full_name       VARCHAR(120) NOT NULL,
    alias_name      VARCHAR(120),
    employment_type VARCHAR(20) NOT NULL CHECK (employment_type IN ('harian', 'borongan', 'prodo')),
    team_group      VARCHAR(50),
    daily_rate      BIGINT NOT NULL DEFAULT 0 CHECK (daily_rate >= 0),
    hourly_rate     BIGINT NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_type_active
    ON employees (employment_type, is_active);

-- 2. Akun Pengguna Aplikasi (4 Role sesuai Project Plan)
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(50) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(120) NOT NULL,
    role            VARCHAR(20) NOT NULL CHECK (role IN ('inventory', 'produksi', 'qc', 'owner_manager')),
    employee_id     UUID UNIQUE REFERENCES employees(id) ON DELETE SET NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role
    ON users (role);

-- =============================================================================
-- DOMAIN 2: PELANGGAN, KATALOG PRODUK & MUTASI STOK (T05 - PIC: Dwi)
-- =============================================================================

-- 3. Master Pelanggan / Mitra Toko / Gereja
CREATE TABLE IF NOT EXISTS customers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_code     VARCHAR(32) NOT NULL UNIQUE,
    name              VARCHAR(150) NOT NULL,
    city              VARCHAR(100),
    address           TEXT,
    phone             VARCHAR(30),
    customer_type     VARCHAR(20) NOT NULL DEFAULT 'toko'
                      CHECK (customer_type IN ('toko', 'gereja', 'perorangan', 'lainnya')),
    default_term_days INTEGER NOT NULL DEFAULT 60 CHECK (default_term_days >= 0),
    notes             TEXT,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_name
    ON customers (LOWER(name));

-- 4. Master Produk Barang Jadi (Patung, Salib, Tempat Lilin, Perlengkapan)
CREATE TABLE IF NOT EXISTS products (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku_code             VARCHAR(50) NOT NULL UNIQUE
                         CHECK (sku_code = UPPER(BTRIM(sku_code)) AND sku_code <> ''),
    name                 VARCHAR(200) NOT NULL,
    main_category        VARCHAR(30) NOT NULL
                         CHECK (main_category IN ('patung', 'salib', 'perlengkapan', 'lainnya')),
    sub_category         VARCHAR(100),
    size_label           VARCHAR(50),
    variant_label        VARCHAR(100),
    unit                 VARCHAR(20) NOT NULL DEFAULT 'pcs',
    selling_price        BIGINT CHECK (selling_price IS NULL OR selling_price >= 0),
    piecework_rate       BIGINT NOT NULL DEFAULT 0 CHECK (piecework_rate >= 0),
    current_stock        INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
    stock_initialized_at TIMESTAMPTZ,
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_category
    ON products (main_category, sub_category);

CREATE INDEX IF NOT EXISTS idx_products_name_lower
    ON products (LOWER(name));

-- 5. Riwayat Mutasi Stok Barang Jadi (Append-only Audit Log)
CREATE TABLE IF NOT EXISTS stock_movements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    movement_type   VARCHAR(30) NOT NULL
                    CHECK (movement_type IN (
                        'initial_stock',
                        'qc_in',
                        'invoice_out',
                        'invoice_void_in',
                        'adjustment_in',
                        'adjustment_out'
                    )),
    qty_change      INTEGER NOT NULL CHECK (qty_change <> 0),
    stock_before    INTEGER NOT NULL CHECK (stock_before >= 0),
    stock_after     INTEGER NOT NULL CHECK (stock_after >= 0),
    reference_type  VARCHAR(30) CHECK (reference_type IN ('invoice', 'production_qc', 'manual')),
    reference_id    UUID,
    reason          TEXT NOT NULL,
    created_by      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product_time
    ON stock_movements (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_ref
    ON stock_movements (reference_type, reference_id);

-- =============================================================================
-- DOMAIN 3: NOTA PENJUALAN A4 & BUKU BESAR PIUTANG (T06, T08 - PIC: Dwi)
-- =============================================================================

-- 6. Header Nota Penjualan A4
CREATE TABLE IF NOT EXISTS sales_invoices (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number    VARCHAR(40) NOT NULL UNIQUE,
    invoice_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    payment_type      VARCHAR(20) NOT NULL CHECK (payment_type IN ('tunai', 'tempo')),
    due_date          DATE,
    subtotal          BIGINT NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    shipping_cost     BIGINT NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
    shipping_courier  VARCHAR(100),
    total_amount      BIGINT NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    status            VARCHAR(20) NOT NULL DEFAULT 'confirmed'
                      CHECK (status IN ('draft', 'confirmed', 'void')),
    stock_deducted_at TIMESTAMPTZ,
    print_count       INTEGER NOT NULL DEFAULT 0 CHECK (print_count >= 0),
    notes             TEXT,
    created_by        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    voided_by         UUID REFERENCES users(id) ON DELETE RESTRICT,
    voided_at         TIMESTAMPTZ,
    void_reason       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (total_amount = subtotal + shipping_cost)
);

CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer_date
    ON sales_invoices (customer_id, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_sales_invoices_date_status
    ON sales_invoices (invoice_date DESC, status);

-- 7. Detail Item Nota (Dengan Snapshot Kode, Nama, dan Harga Saat Transaksi)
CREATE TABLE IF NOT EXISTS invoice_items (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id            UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
    product_id            UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    line_no               INTEGER NOT NULL CHECK (line_no > 0),
    sku_snapshot          VARCHAR(50) NOT NULL,
    product_name_snapshot VARCHAR(200) NOT NULL,
    qty                   INTEGER NOT NULL CHECK (qty > 0),
    unit_price_snapshot   BIGINT NOT NULL CHECK (unit_price_snapshot >= 0),
    line_total            BIGINT NOT NULL CHECK (line_total >= 0),
    UNIQUE (invoice_id, line_no),
    CHECK (line_total = qty * unit_price_snapshot)
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice
    ON invoice_items (invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_items_product
    ON invoice_items (product_id);

-- 8. Buku Besar (Ledger) Piutang per Pelanggan (Sesuai Kartu Piutang Maltajaya)
CREATE TABLE IF NOT EXISTS receivable_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    invoice_id      UUID REFERENCES sales_invoices(id) ON DELETE SET NULL,
    entry_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date        DATE,
    entry_type      VARCHAR(20) NOT NULL
                    CHECK (entry_type IN ('bon', 'ongkir', 'pembayaran', 'penyesuaian')),
    description     VARCHAR(200) NOT NULL,
    debit           BIGINT NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit          BIGINT NOT NULL DEFAULT 0 CHECK (credit >= 0),
    payment_method  VARCHAR(30)
                    CHECK (payment_method IN ('tunai', 'transfer_bca', 'transfer_lain', 'lainnya')),
    created_by      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE INDEX IF NOT EXISTS idx_receivable_entries_customer_date
    ON receivable_entries (customer_id, entry_date ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_receivable_entries_invoice
    ON receivable_entries (invoice_id);

-- =============================================================================
-- DOMAIN 4: PRODUKSI/QC, ABSENSI, PAYROLL & KAS BULANAN (T07, T09, T10 - Arif)
-- =============================================================================

-- 9. Pencatatan Produksi & Pemeriksaan QC (Hanya passed_qty menambah stok jadi)
CREATE TABLE IF NOT EXISTS production_qc_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_code      VARCHAR(40) NOT NULL UNIQUE,
    production_date DATE NOT NULL DEFAULT CURRENT_DATE,
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    employee_id     UUID REFERENCES employees(id) ON DELETE SET NULL,
    produced_qty    INTEGER NOT NULL CHECK (produced_qty > 0),
    qc_status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (qc_status IN ('pending', 'passed', 'rework', 'rejected')),
    passed_qty      INTEGER NOT NULL DEFAULT 0 CHECK (passed_qty >= 0),
    rework_qty      INTEGER NOT NULL DEFAULT 0 CHECK (rework_qty >= 0),
    rejected_qty    INTEGER NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
    qc_notes        TEXT,
    recorded_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    qc_by           UUID REFERENCES users(id) ON DELETE RESTRICT,
    qc_at           TIMESTAMPTZ,
    stock_added_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (passed_qty + rework_qty + rejected_qty <= produced_qty)
);

CREATE INDEX IF NOT EXISTS idx_production_qc_date_status
    ON production_qc_records (production_date DESC, qc_status);

CREATE INDEX IF NOT EXISTS idx_production_qc_employee
    ON production_qc_records (employee_id, production_date DESC);

-- 10. Absensi Harian Karyawan (M = Masuk, L = Lembur jam, T = Telat menit, P = Premi)
CREATE TABLE IF NOT EXISTS daily_attendances (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id          UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    attendance_date      DATE NOT NULL,
    work_day_credit      NUMERIC(4,2) NOT NULL DEFAULT 1.00 CHECK (work_day_credit >= 0),
    overtime_hours       NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (overtime_hours >= 0),
    late_minutes         INTEGER NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
    craft_bonus_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    notes                TEXT,
    recorded_by          UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_attendances_date
    ON daily_attendances (attendance_date DESC);

-- 11. Periode Penggajian (Rekap 2 Mingguan)
CREATE TABLE IF NOT EXISTS payroll_periods (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_name       VARCHAR(100) NOT NULL,
    start_date        DATE NOT NULL,
    end_date          DATE NOT NULL,
    craft_bonus_rate  BIGINT NOT NULL DEFAULT 10000 CHECK (craft_bonus_rate >= 0),
    prodo_pool_total  BIGINT NOT NULL DEFAULT 0 CHECK (prodo_pool_total >= 0),
    status            VARCHAR(20) NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'finalized', 'paid')),
    created_by        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date >= start_date)
);

-- 12. Rincian Slip Gaji per Karyawan (Harian & Borongan)
CREATE TABLE IF NOT EXISTS payroll_items (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_period_id      UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
    employee_id            UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    payroll_type           VARCHAR(20) NOT NULL CHECK (payroll_type IN ('harian', 'borongan', 'prodo')),
    days_worked            NUMERIC(5,2) NOT NULL DEFAULT 0,
    overtime_hours         NUMERIC(6,2) NOT NULL DEFAULT 0,
    late_minutes           INTEGER NOT NULL DEFAULT 0,
    craft_bonus_days       INTEGER NOT NULL DEFAULT 0,
    qc_passed_units        INTEGER NOT NULL DEFAULT 0,
    base_pay               BIGINT NOT NULL DEFAULT 0 CHECK (base_pay >= 0),
    overtime_pay           BIGINT NOT NULL DEFAULT 0 CHECK (overtime_pay >= 0),
    craft_bonus_pay        BIGINT NOT NULL DEFAULT 0 CHECK (craft_bonus_pay >= 0),
    gross_pay              BIGINT NOT NULL DEFAULT 0 CHECK (gross_pay >= 0),
    late_deduction         BIGINT NOT NULL DEFAULT 0 CHECK (late_deduction >= 0),
    prodo_deduction        BIGINT NOT NULL DEFAULT 0 CHECK (prodo_deduction >= 0),
    cash_advance_deduction BIGINT NOT NULL DEFAULT 0 CHECK (cash_advance_deduction >= 0),
    other_deduction        BIGINT NOT NULL DEFAULT 0 CHECK (other_deduction >= 0),
    net_pay                BIGINT NOT NULL DEFAULT 0,
    notes                  TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (payroll_period_id, employee_id)
);

-- 13. Transaksi Kas Bulanan (Pemasukan & Pengeluaran)
CREATE TABLE IF NOT EXISTS cash_transactions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    direction        VARCHAR(10) NOT NULL CHECK (direction IN ('in', 'out')),
    category         VARCHAR(40) NOT NULL
                     CHECK (category IN (
                         'penjualan_tunai',
                         'pelunasan_piutang',
                         'tambah_modal',
                         'gaji_payroll',
                         'kasbon_karyawan',
                         'cicilan_kasbon',
                         'operasional',
                         'paket_cod',
                         'lainnya'
                     )),
    description      VARCHAR(255) NOT NULL,
    amount           BIGINT NOT NULL CHECK (amount > 0),
    reference_type   VARCHAR(30) CHECK (reference_type IN ('invoice', 'receivable', 'payroll', 'manual')),
    reference_id     UUID,
    created_by       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_transactions_date_dir
    ON cash_transactions (transaction_date DESC, direction);

-- =============================================================================
-- DOMAIN 5: MODUL AI PENDUKUNG & RIWAYAT HASIL (T13, T14 - Naufal, Robbi, Dwi)
-- =============================================================================

-- 14. Riwayat Prediksi Skor Risiko Keterlambatan Piutang (FastAPI ML Service)
CREATE TABLE IF NOT EXISTS ai_risk_predictions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    model_name          VARCHAR(60) NOT NULL,
    model_version       VARCHAR(30) NOT NULL DEFAULT '1.0',
    input_features_json JSONB NOT NULL,
    risk_score          NUMERIC(5,4) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 1),
    risk_label          VARCHAR(20) NOT NULL CHECK (risk_label IN ('rendah', 'sedang', 'tinggi')),
    predicted_late      BOOLEAN NOT NULL,
    is_synthetic_data   BOOLEAN NOT NULL DEFAULT TRUE,
    requested_by        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_risk_predictions_customer_time
    ON ai_risk_predictions (customer_id, created_at DESC);

-- 15. Riwayat Ringkasan Naratif Generatif (Owner/Manajer + Fallback Template)
CREATE TABLE IF NOT EXISTS ai_narrative_summaries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    summary_scope       VARCHAR(30) NOT NULL
                        CHECK (summary_scope IN ('overall_receivables', 'customer_risk', 'monthly_overview')),
    customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
    provider            VARCHAR(40) NOT NULL,
    prompt_context_json JSONB NOT NULL,
    summary_text        TEXT NOT NULL,
    is_fallback         BOOLEAN NOT NULL DEFAULT FALSE,
    requested_by        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_narrative_summaries_time
    ON ai_narrative_summaries (created_at DESC);

-- =============================================================================
-- VIEWS ANALITIK & RINGKASAN (Untuk Express Backend & Dasbor Streamlit Ezra)
-- =============================================================================

-- View 1: Saldo Piutang Berjalan per Pelanggan
CREATE OR REPLACE VIEW v_customer_receivable_balances AS
SELECT
    c.id AS customer_id,
    c.customer_code,
    c.name AS customer_name,
    c.city,
    c.customer_type,
    c.default_term_days,
    COALESCE(SUM(r.debit), 0)::BIGINT AS total_debit,
    COALESCE(SUM(r.credit), 0)::BIGINT AS total_credit,
    COALESCE(SUM(r.debit - r.credit), 0)::BIGINT AS current_balance,
    MAX(r.entry_date) AS last_activity_date,
    COUNT(r.id)::INTEGER AS total_entries
FROM customers c
LEFT JOIN receivable_entries r ON r.customer_id = c.id
GROUP BY c.id, c.customer_code, c.name, c.city, c.customer_type, c.default_term_days;

-- View 2: Ringkasan Kas Bulanan
CREATE OR REPLACE VIEW v_monthly_cash_summary AS
SELECT
    TO_CHAR(transaction_date, 'YYYY-MM') AS month_key,
    COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0)::BIGINT AS total_in,
    COALESCE(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0)::BIGINT AS total_out,
    COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0)::BIGINT AS net_cashflow,
    COUNT(*)::INTEGER AS transaction_count
FROM cash_transactions
GROUP BY TO_CHAR(transaction_date, 'YYYY-MM')
ORDER BY month_key DESC;

-- View 3: Ringkasan Penjualan per Produk (Hanya Detail dari Nota Confirmed)
CREATE OR REPLACE VIEW v_product_sales_summary AS
SELECT
    p.id AS product_id,
    p.sku_code,
    p.name AS product_name,
    p.main_category,
    p.sub_category,
    p.current_stock,
    p.stock_initialized_at,
    COALESCE(SUM(ci.qty), 0)::BIGINT AS total_qty_sold,
    COALESCE(SUM(ci.line_total), 0)::BIGINT AS total_revenue
FROM products p
LEFT JOIN (
    SELECT
        ii.product_id,
        ii.qty,
        ii.line_total
    FROM invoice_items ii
    INNER JOIN sales_invoices si
        ON si.id = ii.invoice_id
       AND si.status = 'confirmed'
) ci ON ci.product_id = p.id
GROUP BY
    p.id,
    p.sku_code,
    p.name,
    p.main_category,
    p.sub_category,
    p.current_stock,
    p.stock_initialized_at;

-- =============================================================================
-- TRIGGERS: Auto-update updated_at pada tabel mutable
-- =============================================================================
DROP TRIGGER IF EXISTS trg_employees_updated_at ON employees;
CREATE TRIGGER trg_employees_updated_at
    BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sales_invoices_updated_at ON sales_invoices;
CREATE TRIGGER trg_sales_invoices_updated_at
    BEFORE UPDATE ON sales_invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_production_qc_updated_at ON production_qc_records;
CREATE TRIGGER trg_production_qc_updated_at
    BEFORE UPDATE ON production_qc_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_payroll_periods_updated_at ON payroll_periods;
CREATE TRIGGER trg_payroll_periods_updated_at
    BEFORE UPDATE ON payroll_periods FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
