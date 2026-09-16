// Pelacak sinyal rate-limit Discord yang dipakai bersama antara discordRetry.js
// (yang MENDETEKSI kena rate limit) dan ticketQueue.js (yang MENGATUR jeda
// antrian berdasarkan itu). Ini yang bikin jeda antrian "adaptif": mulai
// cepat, otomatis melambat sementara kalau Discord beneran kasih sinyal
// rate-limit (429), lalu pelan-pelan cepat lagi begitu kondisi normal.

const FLOOR_MS = 700; // jeda tercepat saat kondisi normal/lancar
const CEILING_MS = 5000; // jeda paling lambat saat sedang kena rate limit parah
const BUMP_MULTIPLIER = 2.5; // seberapa agresif jeda dinaikkan begitu kena 429
const MIN_BUMP_MS = 2000; // begitu kena 429, minimal langsung naik ke segini
const DECAY_FACTOR = 0.85; // seberapa cepat jeda turun lagi tiap ada request sukses

let currentDelay = FLOOR_MS;

/** Dipanggil setiap kali Discord API membalas 429 (rate limited). */
function reportRateLimited() {
  const before = currentDelay;
  currentDelay = Math.min(CEILING_MS, Math.max(currentDelay * BUMP_MULTIPLIER, MIN_BUMP_MS));
  if (currentDelay !== before) {
    console.warn(`[RateLimit] Terdeteksi rate limit dari Discord -> jeda antrian dinaikkan dari ${Math.round(before)}ms ke ${Math.round(currentDelay)}ms`);
  }
}

/** Dipanggil setiap kali sebuah Discord API call berhasil (tanpa 429). */
function reportSuccess() {
  if (currentDelay > FLOOR_MS) {
    currentDelay = Math.max(FLOOR_MS, currentDelay * DECAY_FACTOR);
  }
}

/** Jeda yang sedang dipakai saat ini (berubah-ubah secara dinamis). */
function getDelay() {
  return currentDelay;
}

module.exports = { reportRateLimited, reportSuccess, getDelay, FLOOR_MS, CEILING_MS };
