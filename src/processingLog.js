const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const config = require('./config');
const db = require('./db');

const COLOR_BRAND = 0x5865f2;

/** Escape nilai CSV kalau ada koma/petik di dalamnya (jaga-jaga username aneh). */
function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/** Bikin isi file CSV: field 1 username, field 2 Player ID, field 3 jumlah Robux -- berurutan sesuai kapan dana dikonfirmasi. */
function buildCsvContent(orders) {
  const header = 'Username,PlayerID,JumlahRobux';
  const rows = orders.map((o) => [csvEscape(o.roblox_username), csvEscape(o.roblox_user_id ?? ''), csvEscape(o.robux_amount)].join(','));
  return [header, ...rows].join('\n');
}

/** Bikin embed daftar pesanan yang lagi diproses, ditampilkan di channel log. */
function buildLogEmbed(orders) {
  const embed = new EmbedBuilder()
    .setColor(COLOR_BRAND)
    .setTitle('📋 Daftar Pesanan Diproses')
    .setFooter({ text: 'KokoKrunch Studios · Update otomatis' })
    .setTimestamp();

  if (orders.length === 0) {
    embed.setDescription('Tidak ada pesanan yang sedang diproses saat ini.');
    return embed;
  }

  const lines = orders.map(
    (o, i) => `**${i + 1}.** \`${o.roblox_username}\` — Player ID: \`${o.roblox_user_id ?? '-'}\` — ${o.robux_amount.toLocaleString('id-ID')} Robux (${o.ticket_id})`
  );
  embed.setDescription(lines.join('\n'));
  return embed;
}

/**
 * Update (atau pasang pertama kali) pesan channel log pesanan + lampirkan CSV
 * terbaru. Dipanggil setiap kali /dana-masuk dijalankan ATAU setiap kali
 * sebuah ticket ditutup. Aman di-skip diam-diam kalau PROCESSING_LOG_CHANNEL_ID
 * belum diisi di .env (fitur opsional).
 */
async function refreshProcessingLog(guild) {
  if (!config.processingLogChannelId) return { refreshed: false, reason: 'not_configured' };

  const orders = db.getQueuedOrdersForLog();
  const csvContent = buildCsvContent(orders);
  const csvAttachment = new AttachmentBuilder(Buffer.from(csvContent, 'utf-8'), { name: 'pesanan-diproses.csv' });
  const embed = buildLogEmbed(orders);

  try {
    const channel = await guild.channels.fetch(config.processingLogChannelId);
    const settings = db.getShopSettings();

    if (settings.processing_log_message_id) {
      try {
        const message = await channel.messages.fetch(settings.processing_log_message_id);
        await message.edit({ embeds: [embed], files: [csvAttachment], attachments: [] });
        return { refreshed: true };
      } catch (err) {
        console.warn('[ProcessingLog] Pesan lama tidak ditemukan (mungkin terhapus manual), bikin pesan baru:', err.message);
      }
    }

    const newMessage = await channel.send({ embeds: [embed], files: [csvAttachment] });
    db.setProcessingLogMessageId(newMessage.id);
    return { refreshed: true };
  } catch (err) {
    console.error('[ProcessingLog] Gagal update channel log pesanan:', err.message);
    return { refreshed: false, reason: 'error' };
  }
}

module.exports = { refreshProcessingLog, buildCsvContent, buildLogEmbed };
