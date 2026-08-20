const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const db = require('../db');
const { buildAlreadyHasTicketMessage } = require('../embeds');

const CUSTOM_ID = 'buy_robux';

async function handle(interaction) {
  // Jaga-jaga kalau tombol yang diklik belum ter-refresh ke status disabled
  // (misal panel lama belum di-update ulang lewat /toko).
  if (!db.isShopOpen()) {
    await interaction.reply({ content: '🔴 Maaf, order Robux sedang **tutup** sementara. Coba lagi nanti.', flags: MessageFlags.Ephemeral });
    return;
  }

  const existingOrder = db.getOpenOrderByBuyer(interaction.user.id);
  if (existingOrder) {
    await interaction.reply({
      content: buildAlreadyHasTicketMessage({ reason: 'buyer', existingOrder }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = new ModalBuilder().setCustomId('buy_robux_modal').setTitle('Order Robux — KokoKrunch Studios');

  const usernameInput = new TextInputBuilder()
    .setCustomId('roblox_username')
    .setLabel('Username Roblox kamu')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Contoh: builderman')
    .setMinLength(3)
    .setMaxLength(20)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(usernameInput));
  await interaction.showModal(modal);
}

module.exports = { customId: CUSTOM_ID, handle };
