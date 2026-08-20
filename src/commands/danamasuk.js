const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../config');
const db = require('../db');
const { buildPaymentConfirmedEmbed } = require('../embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dana-masuk')
    .setDescription('[Staff] Tandai pembayaran sudah masuk & pesanan masuk antrian proses'),

  async execute(interaction) {
    const order = db.getOrderByChannelId(interaction.channel.id);
    if (!order) {
      await interaction.reply({
        content: '❌ Command ini cuma bisa dipakai di dalam channel ticket order Robux.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const isStaff = interaction.member.roles.cache.has(config.staffRoleId) || interaction.member.permissions.has('ManageGuild');
    if (!isStaff) {
      await interaction.reply({ content: '⛔ Hanya staff yang bisa memakai command ini.', flags: MessageFlags.Ephemeral });
      return;
    }

    db.markPaymentConfirmed({ ticketId: order.ticket_id, confirmedBy: interaction.user.id });

    await interaction.reply({
      content: `<@${order.buyer_discord_id}>`,
      embeds: [
        buildPaymentConfirmedEmbed({
          ticketId: order.ticket_id,
          buyerDiscordId: order.buyer_discord_id,
          robloxUsername: order.roblox_username,
          robuxAmount: order.robux_amount,
          priceRupiah: order.payment_amount ?? order.price_rupiah,
          confirmedByDiscordId: interaction.user.id,
        }),
      ],
    });
  },
};
