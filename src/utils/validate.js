import { ApiError } from './http.js';

// Pesan error Joi dalam bahasa Indonesia ({#label} = nama field dari .label()).
const MESSAGES = {
  'any.required': '{#label} wajib diisi.',
  'string.empty': '{#label} wajib diisi.',
  'string.base': '{#label} harus berupa teks.',
  'string.min': '{#label} minimal {#limit} karakter.',
  'string.max': '{#label} maksimal {#limit} karakter.',
  'number.base': '{#label} harus berupa angka.',
  'number.integer': '{#label} harus bilangan bulat.',
  'number.min': '{#label} minimal {#limit}.',
  'number.max': '{#label} maksimal {#limit}.',
  'boolean.base': '{#label} harus true atau false.',
  'date.base': '{#label} harus tanggal yang valid (YYYY-MM-DD).',
  'date.format': '{#label} harus tanggal yang valid (YYYY-MM-DD).',
  'any.only': '{#label} tidak valid.',
  'string.guid': '{#label} tidak valid.',
  'string.email': 'Format {#label} tidak valid.',
  'object.min': 'Tidak ada data yang diubah.',
};

/** Validasi dengan skema Joi; gagal -> 400 VALIDATION_ERROR dengan daftar field yang salah. */
export function validate(schema, input) {
  const { value, error } = schema.validate(input ?? {}, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
    messages: MESSAGES,
    errors: { wrap: { label: false } },
  });
  if (error) {
    const details = error.details.map((d) => ({ field: d.path.join('.'), message: d.message.replace(/"/g, '') }));
    throw new ApiError(400, 'VALIDATION_ERROR', details[0]?.message ?? 'Data tidak valid.', details);
  }
  return value;
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tolak :id yang bukan UUID sebelum menyentuh database (404 agar tidak membocorkan format). */
export function requireUuid(value, label = 'Data') {
  if (!UUID_PATTERN.test(String(value))) throw new ApiError(404, 'NOT_FOUND', `${label} tidak ditemukan.`);
  return value;
}
