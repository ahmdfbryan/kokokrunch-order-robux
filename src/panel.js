const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('./config');
const db = require('./db');
const { buildOrderPanelEmbed } = require('./embeds');
const { toButtonEmoji } = require('./util');

function buildOrderPanelRow(isOpen) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('buy_robux')
      .setLabel(isOpen ? 'Beli Robux' : 'Order Ditutup')
      .setEmoji(toButtonEmoji(config.robuxEmoji))
      .setStyle(isOpen ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!isOpen),
    new ButtonBuilder()
      .setLabel('Cara Beli')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${config.discordGuildId}/${config.caraBeliChannelId}`)
  );
}

function buildOrderPanelMessagePayload(isOpen) {
  return { embeds: [buildOrderPanelEmbed({ isOpen })], components: [buildOrderPanelRow(isOpen)] };
}

/**
 * Edit pesan panel yang sudah terpasang di #order-robux supaya tombolnya ikut
 * ter-disable/enable sesuai status terbaru. Dipanggil setiap kali /toko dipakai.
 * Aman kalau pesan panel belum pernah dipasang / sudah terhapus -- diam-diam
 * di-skip, staff tinggal jalankan /setup-order-panel lagi.
 */
async function refreshOrderPanelMessage(guild) {
  const settings = db.getShopSettings();
  if (!settings.panel_channel_id || !settings.panel_message_id) return { refreshed: false, reason: 'no_panel' };

  try {
    const channel = await guild.channels.fetch(settings.panel_channel_id);
    const message = await channel.messages.fetch(settings.panel_message_id);
    await message.edit(buildOrderPanelMessagePayload(settings.is_open === 1));
    return { refreshed: true };
  } catch (err) {
    console.warn('[Panel] Gagal refresh pesan panel (mungkin sudah dihapus manual):', err.message);
    return { refreshed: false, reason: 'fetch_failed' };
  }
}

module.exports = { buildOrderPanelRow, buildOrderPanelMessagePayload, refreshOrderPanelMessage };
