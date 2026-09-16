const { EmbedBuilder } = require('discord.js');
const config = require('./config');
const db = require('./db');

const COLOR_GOLD = 0xf2c94c;
const COLOR_RED = 0xed4245;

/** Bikin embed dashboard status -- publik, jadi TIDAK ada info keuangan (Rupiah) di sini. */
function buildStatusDashboardEmbed({ isOpen, activeOrdersCount, totalTransactions, totalRobuxSold }) {
  const statusBadge = isOpen ? '🟢 `BUKA`' : '🔴 `TUTUP`';
  const statusNote = isOpen ? 'Order Robux tersedia sekarang — yuk order! 🚀' : 'Order sementara tidak tersedia, cek lagi nanti ya.';

  return new EmbedBuilder()
    .setColor(isOpen ? COLOR_GOLD : COLOR_RED)
    .setTitle('👑 KokoKrunch Store — Live Dashboard')
    .setDescription(
      [
        '\u200b',
        '📊 **Status Sistem & Statistik Toko**',
        'Dashboard ini otomatis memantau status toko, antrian order, dan statistik transaksi KokoKrunch Store secara real-time.',
        '',
        `🤖 **Status Sistem :** ✅ \`ACTIVE\``,
        `🛒 **Toko :** ${statusBadge}  ${statusNote}`,
        `⏳ **Antrian Berjalan :** ${activeOrdersCount.toLocaleString('id-ID')} ticket sedang diproses`,
      ].join('\n')
    )
    .addFields(
      { name: '\u200b', value: `**📈 STATISTIK KESELURUHAN**\n${'━'.repeat(28)}`, inline: false },
      { name: '🧾 Total Transaksi', value: `**${totalTransactions.toLocaleString('id-ID')}**`, inline: true },
      { name: '🪙 Total Robux Terjual', value: `**${totalRobuxSold.toLocaleString('id-ID')}** Robux`, inline: true }
    )
    .setFooter({ text: '👑 KokoKrunch Store' })
    .setTimestamp();
}

/**
 * Update (atau pasang pertama kali) pesan dashboard status di channel publik.
 * Dipanggil setiap kali ada kejadian yang mengubah angka-angka ini: ticket
 * baru dibuat, ticket ditutup, atau toko dibuka/ditutup lewat /toko. Aman
 * di-skip diam-diam kalau STATUS_DASHBOARD_CHANNEL_ID belum diisi di .env.
 */
async function refreshStatusDashboard(guild) {
  if (!config.statusDashboardChannelId) return { refreshed: false, reason: 'not_configured' };

  const settings = db.getShopSettings();
  const stats = db.getCompletedStats();
  const embed = buildStatusDashboardEmbed({
    isOpen: settings.is_open === 1,
    ticketLimit: settings.ticket_limit,
    ticketsCreated: settings.tickets_created_since_open,
    activeOrdersCount: db.getActiveOrdersCount(),
    totalTransactions: stats.totalTransactions,
    totalRobuxSold: stats.totalRobuxSold,
  });

  try {
    const channel = await guild.channels.fetch(config.statusDashboardChannelId);

    if (settings.status_dashboard_message_id) {
      try {
        const message = await channel.messages.fetch(settings.status_dashboard_message_id);
        await message.edit({ embeds: [embed] });
        return { refreshed: true };
      } catch (err) {
        console.warn('[StatusDashboard] Pesan lama tidak ditemukan (mungkin terhapus manual), bikin pesan baru:', err.message);
      }
    }

    const newMessage = await channel.send({ embeds: [embed] });
    db.setStatusDashboardMessageId(newMessage.id);
    return { refreshed: true };
  } catch (err) {
    console.error('[StatusDashboard] Gagal update dashboard status:', err.message);
    return { refreshed: false, reason: 'error' };
  }
}

module.exports = { refreshStatusDashboard, buildStatusDashboardEmbed };
