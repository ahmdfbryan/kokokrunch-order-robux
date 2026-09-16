const path = require('node:path');
const Database = require('better-sqlite3');

// SQLite dipilih (bukan JSON file) karena ini data transaksi: butuh tulis atomik
// dan tahan terhadap crash/restart proses di tengah jalan. better-sqlite3 sinkron
// dan sudah pakai WAL, jadi aman dipakai bersamaan oleh banyak interaction handler.
const db = new Database(path.join(__dirname, '..', 'orders.sqlite3'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    ticket_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    buyer_discord_id TEXT NOT NULL,
    roblox_username TEXT NOT NULL,
    robux_amount INTEGER NOT NULL,
    price_rupiah INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    progress_note TEXT,
    created_at INTEGER NOT NULL,
    closed_at INTEGER,
    closed_by_discord_id TEXT
  );
`);

// Migrasi ringan: tambah kolom baru kalau belum ada (aman dijalankan berkali-kali
// setiap bot start, tidak akan menghapus data lama).
const existingColumns = new Set(db.prepare(`PRAGMA table_info(orders)`).all().map((c) => c.name));
if (!existingColumns.has('payment_confirmed_at')) {
  db.exec(`ALTER TABLE orders ADD COLUMN payment_confirmed_at INTEGER`);
}
if (!existingColumns.has('payment_confirmed_by')) {
  db.exec(`ALTER TABLE orders ADD COLUMN payment_confirmed_by TEXT`);
}
if (!existingColumns.has('unique_code')) {
  db.exec(`ALTER TABLE orders ADD COLUMN unique_code INTEGER`);
}
if (!existingColumns.has('payment_amount')) {
  db.exec(`ALTER TABLE orders ADD COLUMN payment_amount INTEGER`);
}
if (!existingColumns.has('roblox_user_id')) {
  db.exec(`ALTER TABLE orders ADD COLUMN roblox_user_id TEXT`);
}

// Tabel settings satu baris untuk status buka/tutup toko + lokasi pesan panel
// (dipakai supaya command /toko bisa langsung EDIT pesan panel yang sudah
// terpasang, bukan cuma balas ephemeral doang).
db.exec(`
  CREATE TABLE IF NOT EXISTS shop_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    is_open INTEGER NOT NULL DEFAULT 1,
    panel_channel_id TEXT,
    panel_message_id TEXT,
    updated_at INTEGER,
    updated_by TEXT
  );
`);
db.exec(`INSERT OR IGNORE INTO shop_settings (id, is_open) VALUES (1, 1)`);

const shopColumns = new Set(db.prepare(`PRAGMA table_info(shop_settings)`).all().map((c) => c.name));
if (!shopColumns.has('ticket_limit')) {
  db.exec(`ALTER TABLE shop_settings ADD COLUMN ticket_limit INTEGER`);
}
if (!shopColumns.has('tickets_created_since_open')) {
  db.exec(`ALTER TABLE shop_settings ADD COLUMN tickets_created_since_open INTEGER NOT NULL DEFAULT 0`);
}
if (!shopColumns.has('processing_log_message_id')) {
  db.exec(`ALTER TABLE shop_settings ADD COLUMN processing_log_message_id TEXT`);
}

// Discord membatasi KERAS maksimal 50 channel per kategori. Kalau kategori
// ticket utama (TICKET_CATEGORY_ID) penuh, bot otomatis bikin kategori
// tambahan ("overflow") dan dicatat di sini supaya bisa dipakai ulang terus,
// bukan bikin kategori baru setiap kali.
db.exec(`
  CREATE TABLE IF NOT EXISTS overflow_categories (
    category_id TEXT PRIMARY KEY,
    name TEXT,
    created_at INTEGER NOT NULL
  );
`);

// PENTING: bersihkan dulu sisa duplikat LAMA (dari bug sebelum index unik ini
// ada) sebelum index dipasang -- kalau masih ada baris duplikat, CREATE UNIQUE
// INDEX akan GAGAL dan bot tidak mau nyala. Untuk tiap grup buyer/akun Roblox
// yang punya lebih dari 1 order "terbuka", yang PALING BARU dibiarkan tetap
// terbuka, sisanya otomatis ditutup sebagai "Cancelled" (duplikat lama).
function cleanupDuplicateOpenOrders() {
  const dupBuyers = db.prepare(`
    SELECT buyer_discord_id FROM orders WHERE closed_at IS NULL
    GROUP BY buyer_discord_id HAVING COUNT(*) > 1
  `).all();
  const dupRoblox = db.prepare(`
    SELECT roblox_username FROM orders WHERE closed_at IS NULL
    GROUP BY roblox_username COLLATE NOCASE HAVING COUNT(*) > 1
  `).all();

  const ticketIdsToClose = new Set();
  for (const { buyer_discord_id } of dupBuyers) {
    const rows = db.prepare(`SELECT ticket_id FROM orders WHERE buyer_discord_id = ? AND closed_at IS NULL ORDER BY created_at DESC`).all(buyer_discord_id);
    rows.slice(1).forEach((r) => ticketIdsToClose.add(r.ticket_id)); // simpan yang terbaru (index 0), sisanya ditutup
  }
  for (const { roblox_username } of dupRoblox) {
    const rows = db.prepare(`SELECT ticket_id FROM orders WHERE roblox_username = ? COLLATE NOCASE AND closed_at IS NULL ORDER BY created_at DESC`).all(roblox_username);
    rows.slice(1).forEach((r) => ticketIdsToClose.add(r.ticket_id));
  }

  if (ticketIdsToClose.size > 0) {
    const closeDup = db.prepare(`
      UPDATE orders SET status = 'Cancelled', progress_note = @note, closed_at = @closedAt, closed_by_discord_id = NULL
      WHERE ticket_id = @ticketId
    `);
    for (const ticketId of ticketIdsToClose) {
      closeDup.run({
        ticketId,
        note: 'Ditutup otomatis oleh sistem: terdeteksi duplikat order terbuka untuk pembeli/akun Roblox yang sama (pembersihan migrasi).',
        closedAt: Date.now(),
      });
      console.warn(`[Migration] Order duplikat ${ticketId} otomatis ditutup (pembersihan sebelum pasang constraint unik).`);
    }
    console.warn(`[Migration] Total ${ticketIdsToClose.size} order duplikat dibersihkan. Cek channel Discord-nya manual kalau perlu.`);
  }
}
cleanupDuplicateOpenOrders();

// KUNCI GANDA di level database: walaupun logika JS di reserveOrder() sudah
// atomik (aman dari race condition SELAMA cuma ada 1 proses Node.js yang
// jalan), index unik parsial ini jadi jaring pengaman terakhir yang dipaksakan
// SQLite sendiri -- tetap melindungi walau (misalnya) sempat ada 2 proses bot
// jalan bersamaan tanpa sengaja (skenario yang sudah pernah kejadian sebelum
// ini terkait token). INSERT kedua akan GAGAL dengan error constraint kalau
// ada percobaan bikin order terbuka kedua untuk buyer/akun Roblox yang sama.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_open_buyer
  ON orders(buyer_discord_id) WHERE closed_at IS NULL
`);
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_open_roblox
  ON orders(roblox_username COLLATE NOCASE) WHERE closed_at IS NULL
`);

const insertOrderStmt = db.prepare(`
  INSERT INTO orders (ticket_id, channel_id, buyer_discord_id, roblox_username, roblox_user_id, robux_amount, price_rupiah, unique_code, payment_amount, status, created_at)
  VALUES (@ticketId, @channelId, @buyerDiscordId, @robloxUsername, @robloxUserId, @robuxAmount, @priceRupiah, @uniqueCode, @paymentAmount, 'pending', @createdAt)
`);

const getByChannelStmt = db.prepare(`SELECT * FROM orders WHERE channel_id = ?`);
const getByTicketIdStmt = db.prepare(`SELECT * FROM orders WHERE ticket_id = ?`);
const getOpenOrderByBuyerStmt = db.prepare(`
  SELECT * FROM orders WHERE buyer_discord_id = ? AND closed_at IS NULL ORDER BY created_at DESC LIMIT 1
`);
const getOpenOrderByRobloxUsernameStmt = db.prepare(`
  SELECT * FROM orders WHERE roblox_username = ? COLLATE NOCASE AND closed_at IS NULL ORDER BY created_at DESC LIMIT 1
`);
const getOpenOrderByPaymentAmountStmt = db.prepare(`
  SELECT * FROM orders WHERE payment_amount = ? AND closed_at IS NULL LIMIT 1
`);
const getAllOpenOrdersStmt = db.prepare(`SELECT * FROM orders WHERE closed_at IS NULL`);

const updateOrderChannelStmt = db.prepare(`UPDATE orders SET channel_id = @channelId WHERE ticket_id = @ticketId`);

const closeOrderStmt = db.prepare(`
  UPDATE orders
  SET status = @status, progress_note = @progressNote, closed_at = @closedAt, closed_by_discord_id = @closedByDiscordId
  WHERE ticket_id = @ticketId
`);

const markPaymentConfirmedStmt = db.prepare(`
  UPDATE orders
  SET status = 'queued', payment_confirmed_at = @confirmedAt, payment_confirmed_by = @confirmedBy
  WHERE ticket_id = @ticketId
`);

function getOrderByChannelId(channelId) {
  return getByChannelStmt.get(channelId);
}

function getOrderByTicketId(ticketId) {
  return getByTicketIdStmt.get(ticketId);
}

/** Cari ticket yang masih terbuka (belum di-close) milik seorang pembeli. */
function getOpenOrderByBuyer(buyerDiscordId) {
  return getOpenOrderByBuyerStmt.get(buyerDiscordId);
}

/** Cari ticket yang masih terbuka (belum di-close) untuk sebuah akun Roblox. */
function getOpenOrderByRobloxUsername(robloxUsername) {
  return getOpenOrderByRobloxUsernameStmt.get(robloxUsername);
}

/**
 * Cek + "kunci" slot order dalam SATU panggilan sinkron (tidak ada await di
 * dalamnya) -- ini yang bikin aman dari race condition. Karena Node.js
 * single-threaded, selama fungsi ini tidak nge-await apapun di tengah jalan,
 * tidak mungkin ada interaction lain yang "menyelip" di antara pengecekan dan
 * penguncian slot-nya, walaupun ada banyak klik hampir bersamaan.
 *
 * Sekalian: (1) generate KODE UNIK nominal (3 digit dari ticket ID) dan
 * pastikan nominal pembayaran akhir tidak bentrok dengan order lain yang
 * masih terbuka, (2) cek & kunci kuota ticket per sesi buka toko kalau
 * ada batasnya (lihat /toko status:Buka limit:N).
 *
 * @returns {{ ok: true, ticketId: string, uniqueCode: number, paymentAmount: number, limitJustReached: boolean }
 *          | { ok: false, reason: 'buyer'|'roblox'|'limit', existingOrder?: object }}
 */
function reserveOrder({ buyerDiscordId, robloxUsername, robloxUserId, robuxAmount, priceRupiah }) {
  const existingByBuyer = getOpenOrderByBuyerStmt.get(buyerDiscordId);
  if (existingByBuyer) return { ok: false, reason: 'buyer', existingOrder: existingByBuyer };

  const existingByRoblox = getOpenOrderByRobloxUsernameStmt.get(robloxUsername);
  if (existingByRoblox) return { ok: false, reason: 'roblox', existingOrder: existingByRoblox };

  const settings = getShopSettingsStmt.get();
  let limitJustReached = false;
  if (settings.ticket_limit !== null && settings.ticket_limit !== undefined) {
    if (settings.tickets_created_since_open >= settings.ticket_limit) {
      return { ok: false, reason: 'limit' };
    }
  }

  const MAX_ATTEMPTS = 50;
  let ticketId, uniqueCode, paymentAmount, foundFreeSlot = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    ticketId = generateTicketId();
    uniqueCode = extractUniqueCode(ticketId);
    paymentAmount = priceRupiah + uniqueCode;
    const paymentCollision = getOpenOrderByPaymentAmountStmt.get(paymentAmount);
    const ticketIdCollision = getByTicketIdStmt.get(ticketId); // jaga-jaga ticket ID kebetulan bentrok (sangat jarang)
    if (!paymentCollision && !ticketIdCollision) {
      foundFreeSlot = true;
      break;
    }
    console.warn(`[Order] Nominal/ticket ID bentrok (percobaan ${attempt + 1}), generate ulang...`);
  }

  if (!foundFreeSlot) {
    // Praktis mustahil kejadian di skala toko normal (butuh ratusan order
    // aktif dengan harga PERSIS sama di waktu bersamaan) -- tapi kalau
    // sampai kejadian, mending gagal jelas daripada diam-diam nominal bentrok.
    throw new Error(`Tidak bisa menemukan kode unik nominal yang tersedia setelah ${MAX_ATTEMPTS} percobaan (sistem sedang sangat padat).`);
  }

  try {
    insertOrderStmt.run({
      ticketId,
      channelId: 'PENDING', // placeholder, diisi channel asli lewat updateOrderChannel setelah channel berhasil dibuat
      buyerDiscordId,
      robloxUsername,
      robloxUserId: robloxUserId != null ? String(robloxUserId) : null,
      robuxAmount,
      priceRupiah,
      uniqueCode,
      paymentAmount,
      createdAt: Date.now(),
    });
  } catch (err) {
    // Jaring pengaman terakhir: kalau constraint UNIK di database yang
    // menolak (misal karena 2 proses bot sempat jalan bersamaan), bukan cuma
    // "ticket ID bentrok" -- deteksi dan kembalikan pesan yang benar ke user,
    // bukan error mentah.
    if (String(err.message).includes('idx_unique_open_buyer')) {
      return { ok: false, reason: 'buyer', existingOrder: getOpenOrderByBuyerStmt.get(buyerDiscordId) };
    }
    if (String(err.message).includes('idx_unique_open_roblox')) {
      return { ok: false, reason: 'roblox', existingOrder: getOpenOrderByRobloxUsernameStmt.get(robloxUsername) };
    }
    throw new Error(`Gagal generate ticket ID unik setelah ${MAX_ATTEMPTS} percobaan: ${err.message}`);
  }

  // Kalau ada limit ticket per sesi, naikkan counter-nya sekarang (bagian dari
  // langkah atomik yang sama), dan tandai kalau limit baru saja tercapai
  // persis di reservasi ini -- pemanggil (amountSelect.js) akan pakai flag ini
  // buat otomatis nutup tombol "Beli Robux" setelah ticket ini selesai dibuat.
  if (settings.ticket_limit !== null && settings.ticket_limit !== undefined) {
    const newCount = settings.tickets_created_since_open + 1;
    db.prepare(`UPDATE shop_settings SET tickets_created_since_open = @newCount WHERE id = 1`).run({ newCount });
    limitJustReached = newCount >= settings.ticket_limit;
  }

  return { ok: true, ticketId, uniqueCode, paymentAmount, limitJustReached };
}

/** Tempel channel_id asli ke order yang tadinya cuma "PENDING" (dipanggil setelah channel berhasil dibuat). */
function updateOrderChannel({ ticketId, channelId }) {
  updateOrderChannelStmt.run({ ticketId, channelId });
}

/** Semua order yang masih berstatus terbuka -- dipakai untuk sweep saat bot start. */
function getAllOpenOrders() {
  return getAllOpenOrdersStmt.all();
}

function closeOrder({ ticketId, status, progressNote, closedByDiscordId }) {
  closeOrderStmt.run({
    ticketId,
    status,
    progressNote: progressNote ?? null,
    closedAt: Date.now(),
    closedByDiscordId,
  });
}

/**
 * Auto-close order kalau channel ticket-nya ternyata sudah hilang (dihapus
 * manual oleh staff, bukan lewat tombol "Tutup Ticket"). Supaya pembeli tidak
 * terus-menerus ke-block "masih punya ticket terbuka" gara-gara data lama
 * yang tidak pernah ke-update statusnya.
 */
function closeOrderAsDeleted(ticketId) {
  closeOrderStmt.run({
    ticketId,
    status: 'Cancelled',
    progressNote: 'Channel ticket dihapus manual (bukan lewat tombol Tutup Ticket), order ditutup otomatis oleh sistem.',
    closedAt: Date.now(),
    closedByDiscordId: null,
  });
}

function markPaymentConfirmed({ ticketId, confirmedBy }) {
  markPaymentConfirmedStmt.run({ ticketId, confirmedAt: Date.now(), confirmedBy });
}

/**
 * Semua order yang dana-nya sudah dikonfirmasi ("/dana-masuk") tapi ticket-nya
 * belum ditutup -- dipakai buat CSV export & channel log pesanan. Diurutkan
 * berdasarkan kapan TICKET-nya awal dibuat (urutan order asli masuk), BUKAN
 * kapan dana dikonfirmasi -- supaya kalau ada 2+ staff konfirmasi bersamaan
 * di ticket berbeda, urutan yang muncul tetap sesuai urutan pembeli order,
 * bukan sesuai siapa staff yang lebih cepat mengonfirmasi.
 */
const getQueuedOrdersForLogStmt = db.prepare(`
  SELECT * FROM orders WHERE status = 'queued' AND closed_at IS NULL ORDER BY created_at ASC
`);
function getQueuedOrdersForLog() {
  return getQueuedOrdersForLogStmt.all();
}

const getShopSettingsStmt = db.prepare(`SELECT * FROM shop_settings WHERE id = 1`);
const setShopOpenStmt = db.prepare(`
  UPDATE shop_settings SET is_open = @isOpen, updated_at = @updatedAt, updated_by = @updatedBy WHERE id = 1
`);
const setShopOpenWithLimitStmt = db.prepare(`
  UPDATE shop_settings
  SET is_open = @isOpen, ticket_limit = @ticketLimit, tickets_created_since_open = 0, updated_at = @updatedAt, updated_by = @updatedBy
  WHERE id = 1
`);
const setPanelMessageStmt = db.prepare(`
  UPDATE shop_settings SET panel_channel_id = @channelId, panel_message_id = @messageId WHERE id = 1
`);
const setProcessingLogMessageStmt = db.prepare(`
  UPDATE shop_settings SET processing_log_message_id = @messageId WHERE id = 1
`);

function getShopSettings() {
  return getShopSettingsStmt.get();
}

function isShopOpen() {
  return getShopSettingsStmt.get().is_open === 1;
}

/**
 * @param {{ isOpen: boolean, updatedBy: string, ticketLimit?: number|null }} opts
 * ticketLimit HANYA dipakai saat isOpen=true -- setiap kali toko dibuka,
 * counter ticket sesi ini di-reset ke 0 dan limit baru dipasang (atau null
 * kalau tidak dibatasi). Saat isOpen=false, limit lama dibiarkan apa adanya
 * (tidak relevan lagi sampai dibuka ulang).
 */
function setShopOpen({ isOpen, updatedBy, ticketLimit }) {
  if (isOpen) {
    setShopOpenWithLimitStmt.run({
      isOpen: 1,
      ticketLimit: ticketLimit ?? null,
      updatedAt: Date.now(),
      updatedBy,
    });
  } else {
    setShopOpenStmt.run({ isOpen: 0, updatedAt: Date.now(), updatedBy });
  }
}

function setPanelMessage({ channelId, messageId }) {
  setPanelMessageStmt.run({ channelId, messageId });
}

function setProcessingLogMessageId(messageId) {
  setProcessingLogMessageStmt.run({ messageId });
}

const insertOverflowCategoryStmt = db.prepare(`
  INSERT OR IGNORE INTO overflow_categories (category_id, name, created_at) VALUES (@categoryId, @name, @createdAt)
`);
const getAllOverflowCategoriesStmt = db.prepare(`SELECT * FROM overflow_categories ORDER BY created_at ASC`);

function addOverflowCategory({ categoryId, name }) {
  insertOverflowCategoryStmt.run({ categoryId, name, createdAt: Date.now() });
}

function getAllOverflowCategories() {
  return getAllOverflowCategoriesStmt.all();
}

/** Ticket ID format tetap: 2 huruf + 3 angka acak, contoh: KKS-LW102 */
function generateTicketId() {
  const letters = Array.from({ length: 2 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
  const digits = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `KKS-${letters}${digits}`;
}

/** Ambil 3 digit terakhir dari ticket ID -- ini yang jadi kode unik nominal. */
function extractUniqueCode(ticketId) {
  return Number(ticketId.slice(-3));
}

module.exports = {
  getOrderByChannelId,
  getOrderByTicketId,
  getOpenOrderByBuyer,
  getOpenOrderByRobloxUsername,
  reserveOrder,
  updateOrderChannel,
  getAllOpenOrders,
  getQueuedOrdersForLog,
  closeOrder,
  closeOrderAsDeleted,
  markPaymentConfirmed,
  getShopSettings,
  isShopOpen,
  setShopOpen,
  setPanelMessage,
  setProcessingLogMessageId,
  addOverflowCategory,
  getAllOverflowCategories,
  generateTicketId,
};
