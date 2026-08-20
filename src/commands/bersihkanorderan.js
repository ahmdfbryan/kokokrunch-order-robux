const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../config');
const { reconcileOrphanedOrders } = require('../reconcile');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bersihkan-orderan')
    .setDescription('[Staff] Bersihkan order lama yang channel-nya sudah terhapus tapi masih "terbuka" di database')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const isStaff = interaction.member.roles.cache.has(config.staffRoleId) || interaction.member.permissions.has('ManageGuild');
    if (!isStaff) {
      await interaction.reply({ content: '⛔ Hanya staff yang bisa memakai command ini.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { checked, fixed } = await reconcileOrphanedOrders(interaction.guild);

    if (checked === 0) {
      await interaction.editReply('✅ Tidak ada order yang berstatus "terbuka" di database sama sekali. Tidak ada yang perlu dibersihkan.');
      return;
    }

    if (fixed === 0) {
      await interaction.editReply(`✅ Dicek ${checked} order yang berstatus "terbuka" -- semuanya masih punya channel ticket yang valid, tidak ada yang macet.`);
      return;
    }

    await interaction.editReply(
      `🧹 Selesai! Dari ${checked} order yang berstatus "terbuka", **${fixed} di antaranya "macet"** (channel ticket-nya sudah tidak ada) dan sudah dibersihkan otomatis.\n` +
      'Pembeli & akun Roblox yang tadinya ke-block sekarang sudah bisa order lagi.'
    );
  },
};
