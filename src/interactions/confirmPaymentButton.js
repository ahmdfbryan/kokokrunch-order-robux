const { MessageFlags } = require('discord.js');
const config = require('../config');
const db = require('../db');
const { buildRequestPaymentProofEmbed } = require('../embeds');

const CUSTOM_ID_PREFIX = 'confirm_payment';

async function handle(interaction) {
  const [, ticketId] = interaction.customId.split(':');

  const order = db.getOrderByTicketId(ticketId);
  if (!order) {
    await interaction.reply({ content: '❌ Data order untuk ticket ini tidak ditemukan di database.', flags: MessageFlags.Ephemeral });
    return;
  }

  const isStaff = interaction.member.roles.cache.has(config.staffRoleId) || interaction.member.permissions.has('ManageGuild');
  const isBuyer = interaction.user.id === order.buyer_discord_id;
  if (!isStaff && !isBuyer) {
    await interaction.reply({ content: '⛔ Hanya pembeli ticket ini atau staff yang bisa memakai tombol ini.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: `<@${order.buyer_discord_id}>`,
    // Fallback ke price_rupiah untuk ticket LAMA yang dibuat sebelum fitur kode
    // unik ada (payment_amount belum terisi) -- QR yang sudah mereka scan
    // memang masih pakai harga polos, jadi ini tetap akurat buat ticket lama.
    embeds: [buildRequestPaymentProofEmbed({ ticketId, priceRupiah: order.payment_amount ?? order.price_rupiah })],
  });
}

module.exports = { customIdPrefix: CUSTOM_ID_PREFIX, handle };
