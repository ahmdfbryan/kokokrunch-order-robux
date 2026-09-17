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
 * PENTING (bugfix): sebelumnya fungsi ini fetch channel SATU-SATU per order
 * (`guild.channels.fetch(order.channel_id)`), dengan `.catch(() => null)`
 * yang generik -- artinya SEMUA jenis error dianggap "channel sudah
 * dihapus", termasuk yang sebenarnya cuma gagal sementara (kena rate limit
 * 429 dari Discord, timeout, dll). Di hari dengan banyak ticket terbuka
 * sekaligus (ratusan), fetch satu-satu seperti itu gampang kena rate limit,
 * dan setiap kegagalan itu salah dianggap "ticket hilang" lalu ORDER-NYA
 * IKUT DITUTUP PAKSA padahal ticket-nya masih aktif normal -- inilah
 * penyebab "antrian berjalan" di dashboard jadi lebih sedikit dari jumlah
 * ticket yang sebenarnya masih terbuka.
 *
 * Sekarang diperbaiki: ambil SEMUA channel guild dalam SATU kali panggilan
 * API (jauh lebih ringan & tidak mungkin kena rate limit per-order), lalu
 * cek keberadaan tiap order cukup dari cache hasil fetch itu. Kalau
 * pengambilan daftar channel gagal total (misal koneksi Discord lagi
 * bermasalah), sweep langsung DIBATALKAN tanpa menutup order apapun --
 * lebih aman "tidak melakukan apa-apa" daripada salah menutup ticket yang
 * masih aktif.
 *
 * @returns {{ checked: number, fixed: number }}
 */
async function reconcileOrphanedOrders(guild) {
  const openOrders = db.getAllOpenOrders();
  if (openOrders.length === 0) return { checked: 0, fixed: 0 };

  let channels;
  try {
    channels = await guild.channels.fetch();
  } catch (err) {
    console.error(
      '[Reconcile] Gagal ambil daftar channel dari Discord, sweep dibatalkan (tidak ada order yang ditutup). ' +
        'Ini aman -- akan dicoba lagi di kesempatan berikutnya (restart bot / /bersihkan-orderan):',
      err.message
    );
    return { checked: openOrders.length, fixed: 0 };
  }

  let fixedCount = 0;
  for (const order of openOrders) {
    const channelExists = channels.has(order.channel_id);
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
