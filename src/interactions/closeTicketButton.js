const { ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const config = require('../config');

const CUSTOM_ID_PREFIX = 'close_ticket';

async function handle(interaction) {
  const [, ticketId] = interaction.customId.split(':');

  const isStaff = interaction.member.roles.cache.has(config.staffRoleId) || interaction.member.permissions.has('ManageGuild');
  if (!isStaff) {
    await interaction.reply({ content: '⛔ Hanya staff yang bisa menutup ticket ini.', flags: MessageFlags.Ephemeral });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`close_status_select:${ticketId}`)
    .setPlaceholder('Pilih status penyelesaian pesanan')
    .addOptions(
      { label: 'Completed — Robux terkirim', value: 'Completed', emoji: '✅' },
      { label: 'Cancelled — Dibatalkan', value: 'Cancelled', emoji: '❌' },
      { label: 'Refunded — Dana dikembalikan', value: 'Refunded', emoji: '↩️' }
    );

  await interaction.reply({
    content: 'Pilih status penyelesaian sebelum ticket ditutup:',
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { customIdPrefix: CUSTOM_ID_PREFIX, handle };
