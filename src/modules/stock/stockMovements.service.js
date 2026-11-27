import { query } from '../../db.js';

const MOVEMENT_SELECT = `
  SELECT m.id, m.product_id, p.sku_code, p.name AS product_name, m.movement_type, m.qty_change,
         m.stock_before, m.stock_after, m.reference_type, m.reference_id, m.reason, m.created_at,
         u.id AS created_by_id, u.full_name AS created_by_name
    FROM stock_movements m
    JOIN products p ON p.id = m.product_id
    JOIN users u ON u.id = m.created_by`;

function toMovement(r) {
  const { created_by_id, created_by_name, ...rest } = r;
  return { ...rest, created_by: { id: created_by_id, full_name: created_by_name } };
}

/** Daftar mutasi terbaru dulu, dengan filter opsional dan paginasi. */
export async function listMovements({ productId, skuCode, types, dateFrom, dateTo, page, limit }) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (productId) add('m.product_id = ?', productId);
  if (skuCode) add('p.sku_code = ?', skuCode);
  if (types) add('m.movement_type = ANY(?)', types);
  if (dateFrom) add('m.created_at >= ?::date', dateFrom);
  if (dateTo) add("m.created_at < (?::date + INTERVAL '1 day')", dateTo);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows: count } = await query(`SELECT COUNT(*) AS total FROM stock_movements m JOIN products p ON p.id = m.product_id ${whereSql}`, params);
  const { rows } = await query(
    `${MOVEMENT_SELECT} ${whereSql} ORDER BY m.created_at DESC, m.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit],
  );
  return { items: rows.map(toMovement), total: count[0].total };
}

export async function recentMovements(productId, limit = 10) {
  const { rows } = await query(`${MOVEMENT_SELECT} WHERE m.product_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT $2`, [productId, limit]);
  return rows.map(toMovement);
}
