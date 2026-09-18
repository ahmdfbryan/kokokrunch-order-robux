const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const config = require('./config');
const db = require('./db');
const { formatPlayerId, formatSessionTicketNumber } = require('./util');

const COLOR_BRAND = 0x5865f2;

// Discord: embed description keras dibatasi 4096 karakter. Kita pakai batas
// yang lebih kecil dari itu supaya ada ruang aman untuk baris "Total" di
// halaman terakhir dan variasi panjang username/ticket ID -- daripada pas-pasan
// mepet ke batas asli lalu kena reject/kepotong pas daftarnya sudah panjang.
const SAFE_DESCRIPTION_LIMIT = 3500;

/** Escape nilai CSV kalau ada koma/petik di dalamnya (jaga-jaga username aneh). */
function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/**
 * Bikin isi file CSV -- SATU file utuh berisi SEMUA pesanan yang sedang
 * diproses, tidak pernah dipecah (beda dengan tampilan list di channel yang
 * bisa kepecah jadi beberapa pesan/embed karena limit karakter Discord).
 * Urutannya sesuai `orders` yang dikirim (sudah diurutkan oleh db.js
 * berdasarkan kapan ticket-nya awal dibuat).
 */
function buildCsvContent(orders) {
  const header = 'NoTiket,Username,PlayerID,JumlahRobux';
  const rows = orders.map((o) =>
    [csvEscape(formatSessionTicketNumber(o.session_ticket_number)), csvEscape(o.roblox_username), csvEscape(formatPlayerId(o.roblox_user_id)), csvEscape(o.robux_amount)].join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * Susun daftar pesanan jadi satu ATAU LEBIH embed, supaya tidak pernah kena
 * limit 4096 karakter per embed description dari Discord. Kalau daftarnya
 * pendek, hasilnya cuma 1 embed seperti biasa. Kalau sudah panjang (misalnya
 * 90+ pesanan), daftar otomatis dipecah jadi "Bagian 1/2/3/dst" -- baris
 * "Total" keseluruhan cuma muncul sekali di halaman terakhir.
 */
function buildLogEmbeds(orders) {
  if (orders.length === 0) {
    return [
      new EmbedBuilder()
        .setColor(COLOR_BRAND)
        .setTitle('📋 Daftar Pesanan Diproses')
        .setDescription('Tidak ada pesanan yang sedang diproses saat ini.')
        .setFooter({ text: 'KokoKrunch Studios · Update otomatis' })
        .setTimestamp(),
    ];
  }

  const lines = orders.map(
    (o, i) => `**${i + 1}.** \`${o.roblox_username}\` — \`${formatPlayerId(o.roblox_user_id)}\` — ${o.robux_amount.toLocaleString('id-ID')} Robux (${o.ticket_id})`
  );

  const totalRobux = orders.reduce((sum, o) => sum + o.robux_amount, 0);
  const totalLine = `**Total: ${orders.length} pesanan · ${totalRobux.toLocaleString('id-ID')} Robux**`;

  // Kelompokkan baris-baris di atas jadi beberapa "halaman" (chunk) yang
  // masing-masing tetap di bawah SAFE_DESCRIPTION_LIMIT karakter.
  const pages = [];
  let currentLines = [];
  let currentLength = 0;

  for (const line of lines) {
    const addedLength = currentLines.length === 0 ? line.length : line.length + 1; // +1 untuk newline
    if (currentLines.length > 0 && currentLength + addedLength > SAFE_DESCRIPTION_LIMIT) {
      pages.push(currentLines);
      currentLines = [line];
      currentLength = line.length;
    } else {
      currentLines.push(line);
      currentLength += addedLength;
    }
  }
  if (currentLines.length > 0) pages.push(currentLines);

  // Baris "Total" ditaruh di halaman terakhir -- kalau ternyata tidak muat lagi
  // (halaman terakhir sudah mepet limit), taruh di halaman baru sendiri.
  const lastPage = pages[pages.length - 1];
  const lastPageLength = lastPage.join('\n').length;
  if (lastPageLength + 2 + totalLine.length <= SAFE_DESCRIPTION_LIMIT) {
    lastPage.push('', totalLine);
  } else {
    pages.push([totalLine]);
  }

  const totalPages = pages.length;
  return pages.map((pageLines, index) => {
    const title = totalPages > 1 ? `📋 Daftar Pesanan Diproses (Bagian ${index + 1}/${totalPages})` : '📋 Daftar Pesanan Diproses';
    return new EmbedBuilder()
      .setColor(COLOR_BRAND)
      .setTitle(title)
      .setDescription(pageLines.join('\n'))
      .setFooter({ text: 'KokoKrunch Studios · Update otomatis' })
      .setTimestamp();
  });
}

/**
 * Update (atau pasang pertama kali) pesan channel log pesanan + lampirkan CSV
 * terbaru. Dipanggil setiap kali /dana-masuk dijalankan ATAU setiap kali
 * sebuah ticket ditutup. Aman di-skip diam-diam kalau PROCESSING_LOG_CHANNEL_ID
 * belum diisi di .env (fitur opsional).
 *
 * Daftar pesanan bisa kepecah jadi BEBERAPA pesan kalau sudah kepanjangan
 * (lihat buildLogEmbeds). File CSV tetap SATU file utuh, selalu dilampirkan
 * di pesan PERTAMA saja. Kalau jumlah pesan yang dibutuhkan berkurang dari
 * refresh sebelumnya (karena pesanan sudah diselesaikan/ditutup), pesan lama
 * yang jadi kelebihan otomatis dihapus supaya channel log tidak numpuk pesan
 * usang.
 */
async function refreshProcessingLog(guild) {
  if (!config.processingLogChannelId) return { refreshed: false, reason: 'not_configured' };

  const orders = db.getQueuedOrdersForLog();
  const csvContent = buildCsvContent(orders);
  const embeds = buildLogEmbeds(orders);

  try {
    const channel = await guild.channels.fetch(config.processingLogChannelId);
    const existingMessageIds = db.getProcessingLogMessageIds();
    const newMessageIds = [];

    for (let i = 0; i < embeds.length; i++) {
      const embed = embeds[i];
      const filesForThisMessage = i === 0 ? [new AttachmentBuilder(Buffer.from(csvContent, 'utf-8'), { name: 'pesanan-diproses.csv' })] : [];
      const existingId = existingMessageIds[i];
      let sentOrEditedId = null;

      if (existingId) {
        try {
          const message = await channel.messages.fetch(existingId);
          await message.edit({ embeds: [embed], files: filesForThisMessage, attachments: [] });
          sentOrEditedId = message.id;
        } catch (err) {
          console.warn(`[ProcessingLog] Pesan lama (bagian ${i + 1}) tidak ditemukan (mungkin terhapus manual), bikin pesan baru:`, err.message);
        }
      }

      if (!sentOrEditedId) {
        const newMessage = await channel.send({ embeds: [embed], files: filesForThisMessage });
        sentOrEditedId = newMessage.id;
      }

      newMessageIds.push(sentOrEditedId);
    }

    // Kalau sekarang butuh pesan lebih SEDIKIT dari sebelumnya (pesanan sudah
    // banyak yang selesai), hapus pesan-pesan lama yang jadi kelebihan.
    for (let i = embeds.length; i < existingMessageIds.length; i++) {
      try {
        const oldMessage = await channel.messages.fetch(existingMessageIds[i]);
        await oldMessage.delete();
      } catch (err) {
        // Sudah terhapus manual atau tidak ketemu -- aman diabaikan.
      }
    }

    db.setProcessingLogMessageIds(newMessageIds);
    return { refreshed: true };
  } catch (err) {
    console.error('[ProcessingLog] Gagal update channel log pesanan:', err.message);
    return { refreshed: false, reason: 'error' };
  }
}

module.exports = { refreshProcessingLog, buildCsvContent, buildLogEmbeds };
