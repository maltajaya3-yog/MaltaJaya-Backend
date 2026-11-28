// Jalankan terhadap database uji lokal dengan seed akun demo dan seed T05/T06.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const base = new URL(process.env.TEST_API_URL ?? 'http://127.0.0.1:5051/api/v1/');
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Gunakan API uji lokal.');
const accounts = readFileSync('seed-credentials.local.txt', 'utf8').split(/\r?\n/);
const suffix = randomUUID().slice(0, 8).toUpperCase();
const sku = 'DEMO API ' + suffix;
const invoiceDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format();

async function request(path, { method = 'GET', body, token, status = 200 } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${result.error?.message ?? ''}`);
  return result;
}

async function login(role) {
  const [, email, password] = accounts.find((line) => line.startsWith(role + ' ')).match(/Email: (\S+)\s+Password: (\S+)/);
  return (await request('auth/login', { method: 'POST', body: { email, password } })).data.access_token;
}

const [owner, inventory, produksi] = await Promise.all(['owner_manager', 'inventory', 'produksi'].map(login));
const post = (path, body, token = inventory, status = 201) => request(path, { method: 'POST', token, body, status });
const lookup = async (code, token = inventory) => (await request('products/lookup/' + encodeURIComponent(code), { token })).data;
const fixture = (await post('products', { sku_code: sku, name: 'Produk sintetis untuk uji API', main_category: 'patung', selling_price: 120000, initial_qty: 10 }, owner)).data;
assert.equal((await lookup(sku.toLowerCase())).current_stock, 10);
assert.equal((await lookup('DEMO SL-NULL')).selling_price, null);
assert.equal((await lookup('DEMO SL-NULL')).stock_initialized_at, null);
assert.ok((await lookup('DEMO SL-0')).stock_initialized_at);
assert.equal((await lookup('DEMO SL-0')).current_stock, 0);
assert.equal(Object.hasOwn(await lookup(sku, produksi), 'selling_price'), false);

const catalog = (await request('customers?search=DEMO-TOKO-01', { token: inventory })).data;
const customer = catalog.find((row) => row.customer_code === 'DEMO-TOKO-01');
const uninitialized = (await post('products', { sku_code: 'DEMO ZERO ' + suffix, name: 'Saldo awal nol sintetis', main_category: 'salib' })).data;
const verifiedZero = (await post('products/' + uninitialized.id + '/initialize-stock',
  { initial_qty: 0, reason: 'Hasil hitung stok sintetis' }, inventory, 200)).data;
assert.ok(verifiedZero.stock_initialized_at);
assert.equal(verifiedZero.current_stock, 0);
const body = { request_id: randomUUID(), invoice_date: invoiceDate, customer_id: customer.id, payment_type: 'tempo', items: [{ product_id: fixture.id, qty: 3 }] };

await request('invoices', { token: produksi, status: 403 });
await request('products/' + fixture.id, { method: 'PATCH', token: inventory, body: { selling_price: 100 }, status: 403 });
const rejected = await post('invoices', { ...body, request_id: randomUUID(), items: [{ product_id: fixture.id, qty: 5 }, { product_id: fixture.id, qty: 6 }] }, inventory, 422);
assert.equal(rejected.error.code, 'INSUFFICIENT_STOCK');
assert.equal((await lookup(sku)).current_stock, 10);

const parallel = await Promise.all([1, 2].map(async () => {
  const res = await fetch(new URL('invoices', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + inventory }, body: JSON.stringify(body),
  });
  return { status: res.status, payload: await res.json() };
}));
assert.deepEqual(parallel.map((e) => e.status).sort(), [200, 201], JSON.stringify(parallel));
const [saved, retry] = parallel.map((e) => e.payload.data);
assert.equal(saved.id, retry.id);
assert.equal(saved.customer_code, 'DEMO-TOKO-01');
assert.equal(saved.total_amount, 360000);
const conflict = await post('invoices', { ...body, notes: 'Isi berbeda' }, inventory, 409);
assert.equal(conflict.error.code, 'REQUEST_CONFLICT');

await request('products/' + fixture.id, { method: 'PATCH', token: owner, body: { selling_price: 150000 } });
const reload = (await request('invoices/' + saved.id, { token: inventory })).data;
assert.equal(reload.items[0].unit_price_snapshot, 120000);
assert.equal((await lookup(sku)).current_stock, 7);
const movement = (await request('stock-movements?sku_code=' + encodeURIComponent(sku) + '&movement_type=invoice_out', { token: inventory })).data;
assert.deepEqual(movement.map((row) => [row.qty_change, row.stock_before, row.stock_after]), [[-3, 10, 7]]);

const cash = (await post('invoices', { request_id: randomUUID(), invoice_date: invoiceDate, buyer_name: 'Pembeli demo', payment_type: 'tunai', items: [{ product_id: fixture.id, qty: 1 }] })).data;
assert.equal(cash.customer_id, null);
assert.equal(cash.total_amount, 150000);
console.log('PASS: SKU berspasi, saldo 0 dan null, RBAC, total SKU gabungan, retry serentak 201/200, snapshot harga dan nota tunai.');
