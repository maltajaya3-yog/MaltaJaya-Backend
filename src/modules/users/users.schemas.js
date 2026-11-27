// Skema validasi Joi untuk modul akun (users).

import Joi from 'joi';
import { ALL_ROLES } from '../../roles.js';

const email = Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(254);
const fullName = Joi.string().trim().min(2).max(120);
// bcrypt hanya memakai 72 byte pertama, jadi batas atas 72.
const password = Joi.string()
  .min(8)
  .max(72)
  .pattern(/[A-Za-z]/, 'huruf')
  .pattern(/\d/, 'angka')
  .messages({ 'string.pattern.name': 'Password harus mengandung huruf dan angka.' });

export const listUsersSchema = Joi.object({
  role: Joi.string().valid(...ALL_ROLES).label('Role'),
  status: Joi.string().valid('active', 'inactive', 'all').default('all').label('Status'),
  search: Joi.string().trim().max(100).allow('').label('Pencarian'),
  page: Joi.number().integer().min(1).default(1).label('page'),
  limit: Joi.number().integer().min(1).max(100).default(10).label('limit'),
});

export const createUserSchema = Joi.object({
  full_name: fullName.required().label('Nama lengkap'),
  email: email.required().label('Email'),
  role: Joi.string().valid(...ALL_ROLES).required().label('Role'),
  password: password.required().label('Password'),
});

export const updateUserSchema = Joi.object({
  full_name: fullName.label('Nama lengkap'),
  email: email.label('Email'),
  role: Joi.string().valid(...ALL_ROLES).label('Role'),
  is_active: Joi.boolean().label('Status aktif'),
  // Opsional: isi untuk reset password.
  password: password.allow('').empty('').label('Password baru'),
}).min(1);
