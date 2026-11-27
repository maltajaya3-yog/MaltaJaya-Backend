-- Login memakai email. Untuk database yang dibuat sebelum kolom ini ada di schema.sql.
-- Akun lama tanpa email perlu dibuat ulang: npm run seed:users -- --reset
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(254);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_key') THEN
    ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
  END IF;
END $$;
