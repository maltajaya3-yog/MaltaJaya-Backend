BEGIN;

CREATE SEQUENCE IF NOT EXISTS sales_invoice_number_seq;

ALTER TABLE sales_invoices
    ALTER COLUMN customer_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS buyer_name_snapshot VARCHAR(150),
    ADD COLUMN IF NOT EXISTS buyer_code_snapshot VARCHAR(32),
    ADD COLUMN IF NOT EXISTS buyer_city_snapshot VARCHAR(100),
    ADD COLUMN IF NOT EXISTS buyer_phone_snapshot VARCHAR(30),
    ADD COLUMN IF NOT EXISTS request_fingerprint CHAR(64);

COMMIT;
