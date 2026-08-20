const pendingOrders = require('../pendingOrders');

const CUSTOM_ID_PREFIX = 'confirm_roblox_no';

async function handle(interaction) {
  const [, token] = interaction.customId.split(':');
  pendingOrders.remove(token);

  await interaction.update({
    content: '❌ Oke, dibatalkan. Silakan klik **Beli Robux** lagi dan masukkan username Roblox yang benar.',
    embeds: [],
    components: [],
  });
}

module.exports = { customIdPrefix: CUSTOM_ID_PREFIX, handle };
