const { PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const config = require('./config');
const db = require('./db');
const { generateQrisImageBuffer } = require('./qris');
const { buildTicketOrderEmbed, buildDmTicketCreatedEmbed, buildPaymentDeadlineEmbed } = require('./embeds');
const { slugifyChannelName } = require('./util');
const ticketQueue = require('./ticketQueue');
const { withDiscordRetry } = require('./discordRetry');
const { getAvailableTicketCategory } = require('./categoryManager');
const { refreshStatusDashboard } = require('./statusDashboard');

async function createOrderTicket({ ticketId, uniqueCode, paymentAmount, guild, buyerUser, robloxUsername, robloxUserId, robuxAmount, priceRupiah, sessionTicketNumber }) {
  // Semua pembuatan channel diantre supaya tidak "nembak" Discord API secara
  // bersamaan kalau lagi diserbu banyak order sekaligus.
  return ticketQueue.enqueue(() =>
    createOrderTicketNow({ ticketId, uniqueCode, paymentAmount, guild, buyerUser, robloxUsername, robloxUserId, robuxAmount, priceRupiah, sessionTicketNumber })
  );
}

async function createOrderTicketNow({ ticketId, uniqueCode, paymentAmount, guild, buyerUser, robloxUsername, robloxUserId, robuxAmount, priceRupiah, sessionTicketNumber }) {
  const ticketCode = ticketId.split('-')[1]; // 5 karakter unik dari ticket ID, contoh: LW102

  const categoryId = await getAvailableTicketCategory(guild);

  const channel = await withDiscordRetry(
    () =>
      guild.channels.create({
        name: slugifyChannelName(`order-${ticketCode}-${robloxUsername}`),
        type: ChannelType.GuildText,
        parent: categoryId,
        topic: `Order Robux ${ticketId} · Pembeli: ${buyerUser.id} · Roblox: ${robloxUsername} (${robloxUserId}) · ${robuxAmount} Robux`,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: buyerUser.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory],
          },
          {
            id: config.staffRoleId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory],
          },
          {
            id: guild.members.me.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
          },
        ],
      }),
    { context: `bikin channel ticket untuk ${robloxUsername}` }
  );

  db.updateOrderChannel({ ticketId, channelId: channel.id });

  // QRIS dibuat pakai nominal AKHIR (harga + kode unik), bukan harga polos --
  // ini yang bikin nominal per ticket beda-beda walau jumlah Robux-nya sama.
  const { buffer } = await generateQrisImageBuffer(config.qrisStaticPayload, paymentAmount);
  const attachment = new AttachmentBuilder(buffer, { name: 'qris-payment.png' });

  const orderEmbed = buildTicketOrderEmbed({
    ticketId,
    sessionTicketNumber,
    buyerDiscordId: buyerUser.id,
    robloxUsername,
    robloxUserId,
    robuxAmount,
    priceRupiah,
    uniqueCode,
    paymentAmount,
    staffRoleId: config.staffRoleId,
  }).setImage('attachment://qris-payment.png');

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_payment:${ticketId}`).setLabel('Konfirmasi Pembayaran').setEmoji('🧾').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`close_ticket:${ticketId}`).setLabel('Tutup Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );

  await withDiscordRetry(
    () =>
      channel.send({
        content: `<@${buyerUser.id}> selamat datang di ticket order kamu! <@&${config.staffRoleId}>`,
        embeds: [orderEmbed],
        files: [attachment],
        components: [closeRow],
      }),
    { context: `kirim pesan awal ticket ${ticketId}` }
  );

  // Kirim info batas waktu pembayaran (30 menit) sebagai pesan TERPISAH,
  // tepat setelah "Detail Pesanan". Pakai timestamp Discord (<t:...:R>) yang
  // otomatis hitung mundur sendiri di sisi client -- tidak perlu bot edit
  // pesan ini lagi nantinya, dan TIDAK ada tindakan otomatis apapun kalau
  // waktunya lewat (murni informasi buat pembeli).
  const deadlineUnixSeconds = Math.floor((Date.now() + 30 * 60 * 1000) / 1000);
  await withDiscordRetry(
    () => channel.send({ embeds: [buildPaymentDeadlineEmbed({ deadlineUnixSeconds })] }),
    { context: `kirim info batas waktu pembayaran ticket ${ticketId}` }
  );

  // Kirim notifikasi DM ke pembeli kalau ticket-nya berhasil dibuat. Sengaja
  // TIDAK di-`await` (fire-and-forget) -- kalau DM lambat terkirim atau gagal
  // (misal pembeli menutup DM dari anggota server, atau belum pernah kirim
  // pesan ke bot), ini TIDAK BOLEH ikut menahan antrian pembuatan ticket lain
  // (lihat ticketQueue.js: tugas diproses satu-satu, jadi apapun yang di-await
  // di sini menunda ticket pembeli BERIKUTNYA). Sengaja juga TANPA fallback
  // apapun kalau gagal -- cuma dicatat di log untuk keperluan debug, sesuai
  // permintaan.
  buyerUser
    .send({ embeds: [buildDmTicketCreatedEmbed({ ticketId, sessionTicketNumber, channelUrl: channel.url })] })
    .catch((err) => console.warn(`[Ticket] Gagal kirim DM ticket dibuat ke ${buyerUser.tag} (kemungkinan DM ditutup):`, err.message));

  // Update dashboard status publik (kalau fiturnya diaktifkan lewat .env) --
  // ticket baru ini mengubah angka "antrian berjalan" & sisa stock.
  await refreshStatusDashboard(guild).catch((err) => console.error('[Ticket] Gagal update status dashboard:', err.message));

  return { ticketId, channel };
}

module.exports = {
  createOrderTicket,
  getQueueLength: ticketQueue.getQueueLength,
  cancelQueuedTickets: ticketQueue.cancelAllPending,
  QueueCancelledError: ticketQueue.QueueCancelledError,
};
