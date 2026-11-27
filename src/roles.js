// Hak akses per role (selaras dengan src/config/roles.js di frontend dan matriks role tim).
export const ROLES = Object.freeze({
  OWNER_MANAGER: 'owner_manager',
  INVENTORY: 'inventory',
  PRODUKSI: 'produksi',
  QC: 'qc',
});

const { OWNER_MANAGER, INVENTORY, PRODUKSI } = ROLES;

export const ACCESS = Object.freeze({
  stockView: [OWNER_MANAGER, INVENTORY, PRODUKSI],
  stockEdit: [OWNER_MANAGER, INVENTORY],
  movementView: [OWNER_MANAGER, INVENTORY],
  // Harga jual & tarif borongan rahasia: tidak dikirim ke Produksi dan QC.
  priceView: [OWNER_MANAGER, INVENTORY],
  // Tarif borongan menentukan gaji perajin, jadi hanya Owner & Manajer yang boleh mengubahnya.
  rateEdit: [OWNER_MANAGER],
  // Kelola akun login (tambah, ubah, hapus, reset password).
  userManage: [OWNER_MANAGER],
});

export const canAccess = (role, key) => ACCESS[key].includes(role);

export const ALL_ROLES = Object.values(ROLES);
