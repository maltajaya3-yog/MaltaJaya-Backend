import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

const server = app.listen(config.port, () => {
  console.log(`[api] Maltajaya API berjalan di http://localhost:${config.port}/api/v1`);
});

function shutdown(signal) {
  console.log(`[api] ${signal} diterima, menutup server...`);
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
