const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const db = require('../db');
const roblox = require('../roblox');
const pendingOrders = require('../pendingOrders');
const { ROBUX_AMOUNTS, priceForAmount } = require('../constants');
const { formatRupiah } = require('../util');
const {
  buildNotMemberEmbed,
  buildNotEligibleEmbed,
  buildRobloxErrorEmbed,
  buildEligibleSelectAmountEmbed,
  buildAlreadyHasTicketMessage,
} = require('../embeds');

const CUSTOM_ID_PREFIX = 'confirm_roblox_yes';

async function handle(interaction) {
  const [, token] = interaction.customId.split(':');
  const pending = pendingOrders.get(token);

  if (!pending) {
    await interaction.update({
      content: '⚠️ Sesi order kamu sudah kadaluarsa. Silakan klik **Beli Robux** lagi dari awal.',
      embeds: [],
      components: [],
    });
    return;
  }

  // Cek dini: akun Roblox ini sudah punya ticket terbuka? (pengecekan final &
  // atomik tetap terjadi lagi di reserveOrder pas pilih nominal, ini cuma buat
  // kasih tahu user secepat mungkin tanpa buang-buang panggilan API Roblox.)
  const existingByRoblox = db.getOpenOrderByRobloxUsername(pending.robloxUsername);
  if (existingByRoblox) {
    await interaction.update({
      content: buildAlreadyHasTicketMessage({ reason: 'roblox', existingOrder: existingByRoblox }),
      embeds: [],
      components: [],
    });
    pendingOrders.remove(token);
    return;
  }

  await interaction.deferUpdate();

  let evaluation;
  try {
    evaluation = await roblox.evaluateMembershipEligibility(pending.robloxUserId);
  } catch (err) {
    console.error('[Order] Gagal cek eligibility:', err);
    await interaction.editReply({ embeds: [buildRobloxErrorEmbed()], components: [] });
    return;
  }

  if (evaluation.status === 'not_member') {
    await interaction.editReply({ embeds: [buildNotMemberEmbed(pending.robloxUsername)], components: [] });
    return;
  }
  if (evaluation.status === 'not_eligible') {
    await interaction.editReply({
      embeds: [buildNotEligibleEmbed({ username: pending.robloxUsername, daysSinceJoin: evaluation.daysSinceJoin })],
      components: [],
    });
    return;
  }

  // Eligible -> tampilkan select nominal
  const select = new StringSelectMenuBuilder()
    .setCustomId(`buy_robux_amount_select:${token}`)
    .setPlaceholder('Pilih jumlah Robux')
    .addOptions(
      ROBUX_AMOUNTS.map((amount) => ({
        label: `${amount.toLocaleString('id-ID')} Robux`,
        description: formatRupiah(priceForAmount(amount)),
        value: String(amount),
      }))
    );

  await interaction.editReply({
    content: null,
    embeds: [buildEligibleSelectAmountEmbed({ username: pending.robloxUsername })],
    components: [new ActionRowBuilder().addComponents(select)],
  });
}

module.exports = { customIdPrefix: CUSTOM_ID_PREFIX, handle };
