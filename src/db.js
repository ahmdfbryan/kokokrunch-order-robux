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

const insertOrderStmt = db.prepare(`
  INSERT INTO orders (ticket_id, channel_id, buyer_discord_id, roblox_username, robux_amount, price_rupiah, unique_code, payment_amount, status, created_at)
  VALUES (@ticketId, @channelId, @buyerDiscordId, @robloxUsername, @robuxAmount, @priceRupiah, @uniqueCode, @paymentAmount, 'pending', @createdAt)
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
 * Sekalian generate KODE UNIK nominal (3 digit dari ticket ID) dan pastikan
 * nominal pembayaran akhir (harga + kode unik) tidak bentrok dengan order lain
 * yang masih terbuka -- kalau bentrok, generate ulang ticket ID (looping).
 *
 * @returns {{ ok: true, ticketId: string, uniqueCode: number, paymentAmount: number } | { ok: false, reason: 'buyer'|'roblox', existingOrder: object }}
 */
function reserveOrder({ buyerDiscordId, robloxUsername, robuxAmount, priceRupiah }) {
  const existingByBuyer = getOpenOrderByBuyerStmt.get(buyerDiscordId);
  if (existingByBuyer) return { ok: false, reason: 'buyer', existingOrder: existingByBuyer };

  const existingByRoblox = getOpenOrderByRobloxUsernameStmt.get(robloxUsername);
  if (existingByRoblox) return { ok: false, reason: 'roblox', existingOrder: existingByRoblox };

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
      robuxAmount,
      priceRupiah,
      uniqueCode,
      paymentAmount,
      createdAt: Date.now(),
    });
  } catch (err) {
    // Extremely jarang: 50x percobaan masih bentrok. Lempar error yang jelas
    // supaya pemanggil (amountSelect.js) bisa kasih pesan wajar ke user,
    // bukan crash mentah.
    throw new Error(`Gagal generate ticket ID unik setelah ${MAX_ATTEMPTS} percobaan: ${err.message}`);
  }
  return { ok: true, ticketId, uniqueCode, paymentAmount };
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

const getShopSettingsStmt = db.prepare(`SELECT * FROM shop_settings WHERE id = 1`);
const setShopOpenStmt = db.prepare(`
  UPDATE shop_settings SET is_open = @isOpen, updated_at = @updatedAt, updated_by = @updatedBy WHERE id = 1
`);
const setPanelMessageStmt = db.prepare(`
  UPDATE shop_settings SET panel_channel_id = @channelId, panel_message_id = @messageId WHERE id = 1
`);

function getShopSettings() {
  return getShopSettingsStmt.get();
}

function isShopOpen() {
  return getShopSettingsStmt.get().is_open === 1;
}

function setShopOpen({ isOpen, updatedBy }) {
  setShopOpenStmt.run({ isOpen: isOpen ? 1 : 0, updatedAt: Date.now(), updatedBy });
}

function setPanelMessage({ channelId, messageId }) {
  setPanelMessageStmt.run({ channelId, messageId });
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
  closeOrder,
  closeOrderAsDeleted,
  markPaymentConfirmed,
  getShopSettings,
  isShopOpen,
  setShopOpen,
  setPanelMessage,
  addOverflowCategory,
  getAllOverflowCategories,
  generateTicketId,
};
