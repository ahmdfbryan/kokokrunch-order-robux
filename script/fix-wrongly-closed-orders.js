/**
 * Script pemulihan SEKALI JALAN untuk order yang SALAH ditutup otomatis oleh
 * bug lama di src/reconcile.js (fetch channel satu-satu tanpa retry, jadi
 * salah anggap channel "hilang" gara-gara rate limit/timeout, padahal
 * channel-nya masih ada dan ticket-nya masih aktif normal).
 *
 * Cara pakai (dari root folder project, setelah reconcile.js & db.js versi
 * baru sudah terpasang):
 *
 *   node scripts/fix-wrongly-closed-orders.js
 *
 * Yang dilakukan:
 *   1. Login ke Discord pakai token yang sama dari .env (read-only, tidak
 *      perlu jalanin bot penuh).
 *   2. Ambil SEMUA order yang tercatat "Cancelled" OTOMATIS oleh sistem
 *      (bukan ditutup manual oleh staff lewat tombol Tutup Ticket).
 *   3. Untuk tiap order itu, cek: channel-nya di Discord BENERAN masih ada
 *      atau tidak.
 *      - Kalau masih ADA -> berarti dulu salah ditutup (false positive),
 *        order dibuka kembali (status dikembalikan ke 'queued' kalau dulu
 *        dana sudah pernah dikonfirmasi via /dana-masuk, atau 'pending'
 *        kalau belum).
 *      - Kalau memang sudah TIDAK ADA -> dibiarkan tetap "Cancelled" (benar).
 *   4. Refresh channel log pesanan + dashboard status supaya ticket yang
 *      dipulihkan langsung muncul lagi di CSV/list dan hitungan "Antrian
 *      Berjalan" tanpa perlu restart bot.
 *
 * AMAN dijalankan berkali-kali -- kalau tidak ada order yang perlu
 * dipulihkan, script cuma laporan "0 order" dan tidak mengubah apapun.
 */

const { Client, GatewayIntentBits } = require('discord.js');
const config = require('../src/config');
const db = require('../src/db');
const { refreshProcessingLog } = require('../src/processingLog');
const { refreshStatusDashboard } = require('../src/statusDashboard');

async function main() {
  const candidates = db.getReconcileAutoclosedOrders();
  if (candidates.length === 0) {
    console.log('Tidak ada order yang ditutup otomatis oleh sistem. Tidak ada yang perlu dipulihkan.');
    return;
  }

  console.log(`Ditemukan ${candidates.length} order yang dulu ditutup otomatis oleh sistem. Mengecek channel-nya satu per satu di Discord...`);

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(config.discordToken);

  await new Promise((resolve) => client.once('ready', resolve));

  const guild = await client.guilds.fetch(config.discordGuildId);
  const channels = await guild.channels.fetch(); // satu kali panggilan API untuk semua channel

  let restoredCount = 0;
  let confirmedGoneCount = 0;

  for (const order of candidates) {
    const channelStillExists = channels.has(order.channel_id);
    if (channelStillExists) {
      const result = db.reopenOrder(order.ticket_id);
      restoredCount++;
      console.log(`  [PULIHKAN] ${order.ticket_id} (${order.roblox_username}) -- channel masih ada, status dikembalikan ke '${result.status}'.`);
    } else {
      confirmedGoneCount++;
      console.log(`  [TETAP CANCELLED] ${order.ticket_id} (${order.roblox_username}) -- channel memang sudah tidak ada, dibiarkan.`);
    }
  }

  console.log(`\nSelesai. ${restoredCount} order dipulihkan, ${confirmedGoneCount} order memang benar sudah tidak ada channel-nya (dibiarkan Cancelled).`);

  if (restoredCount > 0) {
    console.log('Me-refresh channel log pesanan + dashboard status supaya perubahan langsung terlihat...');
    const logResult = await refreshProcessingLog(guild);
    const dashboardResult = await refreshStatusDashboard(guild);
    console.log(`  Channel log: ${logResult.refreshed ? 'berhasil di-refresh' : `tidak di-refresh (${logResult.reason})`}`);
    console.log(`  Dashboard status: ${dashboardResult.refreshed ? 'berhasil di-refresh' : `tidak di-refresh (${dashboardResult.reason})`}`);
  }

  await client.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('Script pemulihan gagal:', err);
  process.exit(1);
});
