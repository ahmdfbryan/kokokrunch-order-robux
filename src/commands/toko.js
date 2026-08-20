const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../config');
const db = require('../db');
const ticketManager = require('../ticketManager');
const { refreshOrderPanelMessage } = require('../panel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('toko')
    .setDescription('[Staff] Buka atau tutup layanan order Robux')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('status')
        .setDescription('Pilih status toko')
        .setRequired(true)
        .addChoices({ name: '🟢 Buka', value: 'buka' }, { name: '🔴 Tutup', value: 'tutup' })
    ),

  async execute(interaction) {
    const isStaff = interaction.member.roles.cache.has(config.staffRoleId) || interaction.member.permissions.has('ManageGuild');
    if (!isStaff) {
      await interaction.reply({ content: '⛔ Hanya staff yang bisa memakai command ini.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const wantOpen = interaction.options.getString('status', true) === 'buka';
    db.setShopOpen({ isOpen: wantOpen, updatedBy: interaction.user.id });

    let cancelledCount = 0;
    if (!wantOpen) {
      // Toko ditutup -> hentikan semua ticket yang MASIH ANTRE (belum mulai
      // diproses). User yang tadi klik "Beli Robux" dan sekarang menunggu di
      // antrian akan langsung dapat notifikasi pembatalan (lihat amountSelect.js).
      // Ticket yang sudah TERLANJUR jadi (sedang diproses saat ini) tetap dibiarkan selesai.
      cancelledCount = ticketManager.cancelQueuedTickets('Toko ditutup oleh staff');
    }

    const { refreshed, reason } = await refreshOrderPanelMessage(interaction.guild);

    const statusText = wantOpen ? '🟢 **BUKA**' : '🔴 **TUTUP**';
    let reply = `✅ Toko sekarang ${statusText}.`;
    if (cancelledCount > 0) {
      reply += `\n🧹 ${cancelledCount} ticket yang masih dalam antrian otomatis dibatalkan (hanya ticket yang sudah terbuat yang tetap ada).`;
    }
    if (!refreshed) {
      reply +=
        reason === 'no_panel'
          ? '\n⚠️ Belum ada panel order yang terpasang, jalankan `/setup-order-panel` dulu supaya tombolnya ikut menyesuaikan.'
          : '\n⚠️ Gagal update tampilan panel (mungkin pesannya sudah terhapus manual) -- jalankan ulang `/setup-order-panel` untuk pasang panel baru.';
    }

    await interaction.editReply(reply);
  },
};
