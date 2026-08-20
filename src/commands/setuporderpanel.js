const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../config');
const db = require('../db');
const { buildOrderPanelMessagePayload } = require('../panel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-order-panel')
    .setDescription('[Admin] Pasang ulang panel order Robux di #order-robux')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = await interaction.guild.channels.fetch(config.orderChannelId).catch(() => null);
    if (!channel) {
      await interaction.editReply('❌ Channel ORDER_CHANNEL_ID tidak ditemukan. Cek kembali .env kamu.');
      return;
    }

    const isOpen = db.isShopOpen();
    const message = await channel.send(buildOrderPanelMessagePayload(isOpen));
    db.setPanelMessage({ channelId: channel.id, messageId: message.id });

    await interaction.editReply(`✅ Panel order berhasil dipasang di <#${channel.id}> (status saat ini: ${isOpen ? '🟢 Buka' : '🔴 Tutup'}).`);
  },
};
