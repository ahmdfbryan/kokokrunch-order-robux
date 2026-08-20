const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

const CUSTOM_ID_PREFIX = 'close_status_select';

async function handle(interaction) {
  const [, ticketId] = interaction.customId.split(':');
  const status = interaction.values[0];

  const modal = new ModalBuilder()
    .setCustomId(`close_note_modal:${ticketId}:${status}`)
    .setTitle('Catatan Progress Pesanan');

  const noteInput = new TextInputBuilder()
    .setCustomId('progress_note')
    .setLabel('Progress / catatan singkat')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Contoh: Robux berhasil dikirim ke akun tujuan.')
    .setMaxLength(300)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(noteInput));
  await interaction.showModal(modal);
}

module.exports = { customIdPrefix: CUSTOM_ID_PREFIX, handle };
