const db = require('./db');

/**
 * Cek semua order yang masih berstatus "terbuka" di database, pastikan
 * channel ticket-nya beneran masih ada di Discord. Kalau ternyata sudah
 * dihapus (manual, atau kelewat event ChannelDelete pas bot lagi offline),
 * auto-close order-nya supaya pembeli/akun Roblox itu tidak ke-block
 * "masih punya ticket terbuka" gara-gara data lama yang nyangkut.
 *
 * Dipakai otomatis saat bot start (index.js), DAN bisa dipanggil manual
 * kapan saja lewat command /bersihkan-orderan (tanpa perlu restart bot).
 *
 * @returns {{ checked: number, fixed: number }}
 */
async function reconcileOrphanedOrders(guild) {
  const openOrders = db.getAllOpenOrders();
  if (openOrders.length === 0) return { checked: 0, fixed: 0 };

  let fixedCount = 0;
  for (const order of openOrders) {
    const channelExists = await guild.channels.fetch(order.channel_id).catch(() => null);
    if (!channelExists) {
      db.closeOrderAsDeleted(order.ticket_id);
      fixedCount++;
      console.log(`[Reconcile] Order ${order.ticket_id} channel-nya sudah tidak ada -> otomatis ditutup.`);
    }
  }
  if (fixedCount > 0) {
    console.log(`[Reconcile] Selesai. ${fixedCount} order "nyangkut" berhasil dibersihkan otomatis.`);
  }
  return { checked: openOrders.length, fixed: fixedCount };
}

module.exports = { reconcileOrphanedOrders };
