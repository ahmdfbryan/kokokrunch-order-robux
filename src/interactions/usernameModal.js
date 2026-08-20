const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const roblox = require('../roblox');
const pendingOrders = require('../pendingOrders');
const { buildNotFoundEmbed, buildRobloxErrorEmbed, buildConfirmRobloxAccountEmbed } = require('../embeds');

const CUSTOM_ID = 'buy_robux_modal';

async function handle(interaction) {
  const inputUsername = interaction.fields.getTextInputValue('roblox_username').trim();

  // defer supaya Discord tidak timeout 3 detik sementara kita panggil API Roblox
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let resolved;
  try {
    resolved = await roblox.resolveUsername(inputUsername);
  } catch (err) {
    console.error('[Order] Gagal resolve username Roblox:', err);
    await interaction.editReply({ embeds: [buildRobloxErrorEmbed()] });
    return;
  }

  if (!resolved) {
    await interaction.editReply({ embeds: [buildNotFoundEmbed(inputUsername)] });
    return;
  }

  const avatarUrl = await roblox.getAvatarUrl(resolved.userId);

  // Simpan sementara hasil resolve, tunggu user konfirmasi "Yes" baru lanjut cek eligibility.
  const token = pendingOrders.put(interaction.user.id, {
    robloxUsername: resolved.username,
    robloxUserId: resolved.userId,
    robloxDisplayName: resolved.displayName,
    avatarUrl,
  });

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_roblox_yes:${token}`).setLabel('Yes').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`confirm_roblox_no:${token}`).setLabel('No').setEmoji('❌').setStyle(ButtonStyle.Danger)
  );

  await interaction.editReply({
    embeds: [buildConfirmRobloxAccountEmbed({ username: resolved.username, displayName: resolved.displayName, avatarUrl })],
    components: [confirmRow],
  });
}

module.exports = { customId: CUSTOM_ID, handle };
