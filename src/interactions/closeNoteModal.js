const { MessageFlags } = require('discord.js');
const config = require('../config');
const db = require('../db');
const { buildReviewEmbed } = require('../embeds');

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
