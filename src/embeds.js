const { EmbedBuilder } = require('discord.js');
const config = require('./config');
const { formatRupiah, maskUsername } = require('./util');

const COLOR_BRAND = 0x5865f2;
const COLOR_RED = 0xed4245;
const COLOR_ORANGE = 0xffa500;
const COLOR_GREEN = 0x57f287;

function buildOrderPanelEmbed({ isOpen = true } = {}) {
  const statusLine = isOpen ? '🟢 **Status: BUKA** — silakan order!' : '🔴 **Status: TUTUP** — order sementara tidak bisa diproses';
  return new EmbedBuilder()
    .setColor(isOpen ? COLOR_BRAND : COLOR_RED)
    .setTitle('🛒 Top Up Robux — KokoKrunch Studios')
    .setDescription(
      [
        'Selamat datang di layanan top up Robux resmi **KokoKrunch Studios**!',
        '',
        statusLine,
        '',
        `💰 **Rate:** ${formatRupiah(config.rupiahPerRobux * 100)} / 100 Robux`,
        '⚡ **Proses:** Manual, dikonfirmasi admin setelah pembayaran QRIS',
        '✅ **Syarat:** Akun Roblox kamu harus sudah tergabung di komunitas KokoKrunch Studios minimal 14 hari',
        '',
        isOpen
          ? 'Klik tombol **Beli Robux** di bawah untuk mulai order, atau **Cara Beli** kalau butuh panduan lebih dulu.'
          : 'Order lagi ditutup sementara. Silakan cek lagi nanti, atau hubungi admin kalau ada pertanyaan.',
      ].join('\n')
    )
    .setFooter({ text: 'KokoKrunch Studios · Order Robux' })
    .setTimestamp();
}

function buildNotFoundEmbed(inputUsername) {
  return new EmbedBuilder()
    .setColor(COLOR_RED)
    .setTitle('🔴 Username Roblox Tidak Ditemukan')
    .setDescription(`Tidak ada akun Roblox dengan username \`${inputUsername}\`. Cek kembali ejaan username kamu lalu klik **Beli Robux** lagi.`);
}

function buildAlreadyHasTicketMessage({ reason, existingOrder }) {
  const ticketRef = `<#${existingOrder.channel_id}> (${existingOrder.ticket_id})`;
  if (reason === 'roblox') {
    return (
      `⚠️ Akun Roblox **${existingOrder.roblox_username}** sudah punya ticket order yang belum selesai: ${ticketRef}.\n` +
      'Selesaikan atau tunggu ticket itu ditutup dulu sebelum bikin order baru dengan akun Roblox yang sama.'
    );
  }
  return (
    `⚠️ Kamu masih punya ticket order yang belum selesai: ${ticketRef}.\n` +
    'Selesaikan atau tunggu ticket itu ditutup dulu sebelum bikin order baru.'
  );
}

function buildConfirmRobloxAccountEmbed({ username, displayName, avatarUrl }) {
  const embed = new EmbedBuilder()
    .setColor(COLOR_BRAND)
    .setTitle('🔍 Confirm Your Roblox Account')
    .addFields(
      { name: 'Username', value: username, inline: true },
      { name: 'Display Name', value: displayName || username, inline: true }
    )
    .setDescription('**Is this really your Roblox account?**')
    .setFooter({ text: 'KokoKrunch Studios' });
  if (avatarUrl) embed.setThumbnail(avatarUrl);
  return embed;
}

function buildNotMemberEmbed(username) {
  return new EmbedBuilder()
    .setColor(COLOR_RED)
    .setTitle('🔴 Belum Terdaftar di Komunitas')
    .setDescription(
      `**${username}** belum terdeteksi bergabung di komunitas Roblox KokoKrunch Studios.\n\n` +
      'Silakan join komunitas terlebih dahulu, lalu coba order lagi setelah 14 hari.'
    );
}

function buildNotEligibleEmbed({ username, daysSinceJoin }) {
  const remainingDays = Math.max(0, Math.ceil(config.eligibleDays - daysSinceJoin));
  return new EmbedBuilder()
    .setColor(COLOR_ORANGE)
    .setTitle('🟠 Belum Eligible')
    .setDescription(
      `**${username}** sudah join komunitas, tapi belum genap **${config.eligibleDays} hari**.\n\n` +
      `⏳ Sisa waktu: kurang lebih **${remainingDays} hari lagi**.\n\n` +
      'Order dibatalkan. Silakan coba lagi setelah eligible.'
    );
}

function buildRobloxErrorEmbed() {
  return new EmbedBuilder()
    .setColor(COLOR_RED)
    .setTitle('⚠️ Gagal Menghubungi Server Roblox')
    .setDescription('Terjadi gangguan sementara saat mengecek akun Roblox kamu. Silakan coba lagi dalam beberapa saat.');
}

function buildEligibleSelectAmountEmbed({ username }) {
  return new EmbedBuilder()
    .setColor(COLOR_GREEN)
    .setTitle('🟢 Akun Eligible!')
    .setDescription(
      `**${username}** sudah eligible untuk order Robux.\n\n` +
      'Silakan pilih jumlah Robux yang ingin dibeli pada menu di bawah ini.'
    );
}

function buildTicketCreatedEmbed({ channelId }) {
  return new EmbedBuilder()
    .setColor(COLOR_GREEN)
    .setTitle('🎫 Ticket Dibuat')
    .setDescription(`Ticket order kamu sudah dibuat: <#${channelId}>\n\nSilakan lanjutkan pembayaran di dalam ticket tersebut.`);
}

function buildTicketOrderEmbed({ ticketId, buyerDiscordId, robloxUsername, robuxAmount, priceRupiah, uniqueCode, paymentAmount, staffRoleId }) {
  return new EmbedBuilder()
    .setColor(COLOR_BRAND)
    .setTitle('📦 Detail Pesanan')
    .addFields(
      { name: '🆔 Ticket ID', value: ticketId, inline: true },
      { name: '🙋 Pembeli', value: `<@${buyerDiscordId}>`, inline: true },
      { name: '👤 Username Roblox', value: robloxUsername, inline: true },
      { name: 'Jumlah Robux', value: `${robuxAmount.toLocaleString('id-ID')} Robux`, inline: true },
      { name: '💰 Harga', value: formatRupiah(priceRupiah), inline: true },
      { name: '🔢 Kode Unik', value: String(uniqueCode).padStart(3, '0'), inline: true },
      { name: '💵 Total Bayar', value: `**${formatRupiah(paymentAmount)}**`, inline: true },
      { name: '📌 Status', value: 'Menunggu Pembayaran', inline: true },
      {
        name: '📋 Instruksi',
        value:
          `1️⃣ Scan QRIS dibawah ini pastikan sesuai nominal **${formatRupiah(paymentAmount)}** (termasuk 3 digit kode unik di belakang). Pastikan QRIS atas nama KokoKrunch Studios.\n` +
          `2️⃣ Setelah transfer berhasil, silakan klik tombol **Konfirmasi Pembayaran** di bawah.\n` +
          '3️⃣ Jangan melakukan spam konfirmasi, tunggu hingga Admin melakukan verifikasi dan proses Robux setelah pembayaran dikonfirmasi.\n\n' +
          '⚠️ **Untuk sementara, pembayaran via BCA sedang tidak tersedia.** Silakan gunakan bank/e-wallet lain untuk melakukan pembayaran.',
      }
    )
    .setFooter({ text: 'KokoKrunch Studios · Jangan share QR ini ke orang lain' })
    .setTimestamp();
}

function buildReviewEmbed({ ticketId, robloxUsername, robuxAmount, status, progressNote }) {
  const statusColor = status === 'Completed' ? COLOR_GREEN : status === 'Cancelled' ? COLOR_RED : COLOR_ORANGE;
  const title = status === 'Completed' ? '✅ Robux Terkirim' : '🚫 Transaksi Dibatalkan';
  return new EmbedBuilder()
    .setColor(statusColor)
    .setTitle(title)
    .setDescription('Ringkasan pesanan yang telah diproses.')
    .addFields(
      { name: '🆔 ID', value: ticketId, inline: true },
      { name: '👤 Username', value: maskUsername(robloxUsername), inline: true },
      { name: 'Robux', value: `${robuxAmount.toLocaleString('id-ID')} Robux`, inline: true },
      { name: '🔄 Status', value: status, inline: true },
      { name: '💳 Pembayaran', value: 'QRIS', inline: true },
      { name: '📋 Progress', value: progressNote || '-', inline: false }
    )
    .setFooter({ text: 'KokoKrunch Studios' })
    .setTimestamp();
}

function buildRequestPaymentProofEmbed({ ticketId, priceRupiah }) {
  return new EmbedBuilder()
    .setColor(COLOR_ORANGE)
    .setTitle('🧾 Konfirmasi Pembayaran')
    .setDescription(
      `Mohon kirim **bukti pembayaran** (screenshot/foto struk transfer) untuk pesanan **${ticketId}** ` +
      `senilai **${formatRupiah(priceRupiah)}** di channel ini.\n\n` +
      'Admin akan memverifikasi dan memproses pesanan setelah bukti pembayaran diterima.'
    )
    .setFooter({ text: 'KokoKrunch Studios' })
    .setTimestamp();
}

function buildPaymentConfirmedEmbed({ ticketId, buyerDiscordId, robloxUsername, robuxAmount, priceRupiah, confirmedByDiscordId }) {
  return new EmbedBuilder()
    .setColor(COLOR_GREEN)
    .setAuthor({ name: 'KokoKrunch Studios · Payment Update' })
    .setTitle('💸 Dana Masuk — Pesanan Masuk Antrian')
    .setDescription(`Pembayaran untuk pesanan **${ticketId}** telah dikonfirmasi oleh staff. Pesanan kamu sekarang masuk antrian proses. 🚀`)
    .addFields(
      { name: '🆔 Ticket', value: ticketId, inline: true },
      { name: '👤 Roblox', value: robloxUsername, inline: true },
      { name: 'Robux', value: `${robuxAmount.toLocaleString('id-ID')} Robux`, inline: true },
      { name: '💵 Nominal', value: formatRupiah(priceRupiah), inline: true },
      { name: '📦 Status', value: '🟡 Dalam Antrian', inline: true },
      { name: '✅ Dikonfirmasi oleh', value: `<@${confirmedByDiscordId}>`, inline: true }
    )
    .setFooter({ text: 'Mohon tunggu, admin akan proses secepatnya' })
    .setTimestamp();
}

module.exports = {
  buildOrderPanelEmbed,
  buildNotFoundEmbed,
  buildConfirmRobloxAccountEmbed,
  buildAlreadyHasTicketMessage,
  buildNotMemberEmbed,
  buildNotEligibleEmbed,
  buildRobloxErrorEmbed,
  buildEligibleSelectAmountEmbed,
  buildTicketCreatedEmbed,
  buildTicketOrderEmbed,
  buildReviewEmbed,
  buildRequestPaymentProofEmbed,
  buildPaymentConfirmedEmbed,
};
