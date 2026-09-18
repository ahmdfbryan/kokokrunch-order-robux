const { MessageFlags } = require('discord.js');
const config = require('../config');
const db = require('../db');
const { buildReviewEmbed } = require('../embeds');
const { refreshProcessingLog } = require('../processingLog');
const { refreshStatusDashboard } = require('../statusDashboard');

const CUSTOM_ID_PREFIX = 'close_note_modal';

async function handle(interaction) {
  const [, ticketId, status] = interaction.customId.split(':');
  const progressNote = interaction.fields.getTextInputValue('progress_note').trim();

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const order = db.getOrderByTicketId(ticketId);
  if (!order) {
    await interaction.editReply('❌ Data order untuk ticket ini tidak ditemukan di database.');
    return;
  }

  db.closeOrder({
    ticketId,
    status,
    progressNote,
    closedByDiscordId: interaction.user.id,
  });

  // Kalau order ini sebelumnya sempat masuk channel log pesanan (sudah pernah
  // /dana-masuk), sekarang otomatis hilang dari daftar & CSV karena sudah ditutup.
  // Dijalankan di BELAKANG LAYAR (tidak di-"await" di sini) -- sejak daftar log
  // bisa kepecah jadi beberapa pesan (lihat processingLog.js), proses ini bisa
  // butuh beberapa kali panggilan API Discord berurutan kalau antriannya lagi
  // panjang. Kalau ditunggu (await) di sini, staff yang nutup ticket akan
  // kelihatan "loading" lama padahal ticketnya sendiri sudah beres ditutup --
  // jadi balasan ke staff (editReply di bawah) TIDAK perlu menunggu ini selesai.
  refreshProcessingLog(interaction.guild).catch((err) => console.error('[Close] Gagal update processing log:', err.message));

  // Sama seperti di atas -- update dashboard status publik juga tidak perlu
  // ditunggu, tidak memengaruhi balasan yang dilihat staff.
  refreshStatusDashboard(interaction.guild).catch((err) => console.error('[Close] Gagal update status dashboard:', err.message));

  const reviewEmbed = buildReviewEmbed({
    ticketId,
    robloxUsername: order.roblox_username,
    robuxAmount: order.robux_amount,
    status,
    progressNote,
  });

  const reviewChannel = await interaction.guild.channels.fetch(config.reviewChannelId).catch(() => null);
  let reviewSendFailed = false;
  if (reviewChannel) {
    try {
      await reviewChannel.send({
        content: `Pembeli: <@${order.buyer_discord_id}>`,
        embeds: [reviewEmbed],
      });
    } catch (err) {
      reviewSendFailed = true;
      console.error(
        `[Close] Gagal kirim ringkasan ke #review (channel ${config.reviewChannelId}). ` +
        `Kemungkinan besar bot belum punya izin "Send Messages"/"Embed Links" di channel itu. Detail:`,
        err.message
      );
    }
  } else {
    reviewSendFailed = true;
    console.error('[Close] REVIEW_CHANNEL_ID tidak ditemukan, ringkasan tidak terkirim.');
  }

  const reviewWarning = reviewSendFailed
    ? '\n⚠️ Ringkasan GAGAL terkirim ke #review (cek permission bot di channel itu — butuh Send Messages & Embed Links). Data order tetap tersimpan di database, bisa dikirim ulang manual.'
    : '';
  await interaction.editReply(`✅ Ticket ditutup dengan status **${status}**. Channel ini akan dihapus dalam 10 detik.${reviewWarning}`);

  setTimeout(() => {
    interaction.channel.delete(`Ticket ${ticketId} ditutup oleh ${interaction.user.tag}`).catch((err) => {
      console.error(`[Close] Gagal menghapus channel ticket ${ticketId}:`, err.message);
    });
  }, 10_000);
}

module.exports = { customIdPrefix: CUSTOM_ID_PREFIX, handle };
