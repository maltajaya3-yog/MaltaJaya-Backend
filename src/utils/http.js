// Format respons baku sesuai API contract T02-D02.

export function ok(res, data, { status = 200, message = 'Berhasil', meta } = {}) {
  const body = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

export const pageMeta = ({ page, limit }, total) => ({ page, limit, total, total_pages: Math.ceil(total / limit) });

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
