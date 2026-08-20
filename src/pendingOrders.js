// Alur order berlangsung dalam hitungan menit (modal -> select nominal -> ticket
// dibuat), jadi state sementara ini cukup disimpan di memory proses, tidak perlu
// database. Kalau bot restart di tengah alur, user tinggal klik "Beli Robux" lagi.

const TTL_MS = 10 * 60 * 1000; // 10 menit
const store = new Map();

function put(discordUserId, data) {
  const token = `${discordUserId}-${Date.now().toString(36)}`;
  store.set(token, { ...data, expiresAt: Date.now() + TTL_MS });
  return token;
}

function get(token) {
  const entry = store.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(token);
    return null;
  }
  return entry;
}

function remove(token) {
  store.delete(token);
}

// Bersih-bersih entri kadaluarsa tiap 5 menit supaya memory tidak bocor.
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of store.entries()) {
    if (entry.expiresAt < now) store.delete(token);
  }
}, 5 * 60 * 1000).unref();

module.exports = { put, get, remove };
