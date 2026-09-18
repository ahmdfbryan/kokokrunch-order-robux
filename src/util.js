function formatRupiah(amount) {
  return `Rp${amount.toLocaleString('id-ID')}`;
}

/**
 * Ubah string emoji dari config (unicode "🪙" ATAU custom "<:robux:123...>")
 * jadi bentuk yang diterima ButtonBuilder#setEmoji. Custom emoji butuh object
 * {id, name, animated}, sedangkan unicode emoji cukup string apa adanya.
 */
function toButtonEmoji(emojiString) {
  const { parseEmoji } = require('discord.js');
  const parsed = parseEmoji(emojiString);
  if (parsed?.id) {
    return { id: parsed.id, name: parsed.name, animated: parsed.animated };
  }
  return emojiString; // unicode emoji biasa (misal 🪙)
}

/**
 * Blur username seperti contoh di channel #review: tampilkan beberapa karakter
 * pertama, sisanya diganti titik. Minimal 1 karakter tersisa disembunyikan
 * supaya tidak pernah menampilkan username utuh.
 */
function maskUsername(username, visibleChars = 3) {
  if (!username) return '•••••';
  const visible = username.slice(0, Math.min(visibleChars, Math.max(1, username.length - 1)));
  const hiddenCount = Math.max(username.length - visible.length, 3);
  return `${visible}${'•'.repeat(hiddenCount)}`;
}

/** Nama channel Discord: huruf kecil, spasi -> dash, buang karakter aneh. */
function slugifyChannelName(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

/**
 * Tampilkan Player ID Roblox dengan bersih. Data lama (sebelum diperbaiki di
 * db.js) sempat kesimpen dengan akhiran ".0" (kuirk konversi angka->teks di
 * SQLite) -- fungsi ini buang akhiran itu kalau ada, supaya data lama & baru
 * sama-sama tampil benar tanpa perlu migrasi ulang database.
 */
function formatPlayerId(robloxUserId) {
  if (robloxUserId === null || robloxUserId === undefined) return '-';
  return String(robloxUserId).replace(/\.0$/, '');
}

/**
 * Format nomor urut ticket dalam SATU sesi buka-toko (reset ke 1 tiap kali
 * /toko status:Buka dijalankan) jadi "001", "002", dst -- minimal 3 digit,
 * tapi tetap tampil lengkap kalau lebih dari 999 (misal "1000", bukan
 * "1000" dipotong). Order lama dari sebelum fitur ini ada tidak punya nomor
 * ini (null di database), jadi ditampilkan "-" biar jelas bukan angka 0.
 */
function formatSessionTicketNumber(sessionTicketNumber) {
  if (sessionTicketNumber === null || sessionTicketNumber === undefined) return '-';
  return String(sessionTicketNumber).padStart(3, '0');
}

module.exports = { formatRupiah, maskUsername, slugifyChannelName, toButtonEmoji, formatPlayerId, formatSessionTicketNumber };
