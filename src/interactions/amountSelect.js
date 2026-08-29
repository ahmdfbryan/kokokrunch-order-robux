const { MessageFlags } = require('discord.js');
const db = require('../db');
const pendingOrders = require('../pendingOrders');
const { priceForAmount } = require('../constants');
const ticketManager = require('../ticketManager');
const { buildTicketCreatedEmbed, buildAlreadyHasTicketMessage } = require('../embeds');

const CUSTOM_ID_PREFIX = 'buy_robux_amount_select';

async function handle(interaction) {
  const [, token] = interaction.customId.split(':');
  const pending = pendingOrders.get(token);

  if (!pending) {
    await interaction.reply({
      content: '⚠️ Sesi order kamu sudah kadaluarsa. Silakan klik **Beli Robux** lagi dari awal.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const robuxAmount = Number(interaction.values[0]);
  const priceRupiah = priceForAmount(robuxAmount);

  // Reservasi ATOMIK: cek + kunci slot (per pembeli DAN per akun Roblox) dalam
  // satu langkah sinkron -- ini yang mencegah 2 klik hampir bersamaan sama-sama
  // lolos dan bikin 2 ticket sekaligus.
  let reservation;
  try {
    reservation = db.reserveOrder({
      buyerDiscordId: interaction.user.id,
      robloxUsername: pending.robloxUsername,
      robuxAmount,
      priceRupiah,
    });
  } catch (err) {
    console.error('[Order] Gagal reservasi order:', err);
    await interaction.update({
      content: '❌ Sistem sedang sangat padat, silakan coba lagi dalam beberapa saat.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (!reservation.ok) {
    await interaction.update({
      content: buildAlreadyHasTicketMessage({ reason: reservation.reason, existingOrder: reservation.existingOrder }),
      embeds: [],
      components: [],
    });
    pendingOrders.remove(token);
    return;
  }

  const { ticketId, uniqueCode, paymentAmount } = reservation;

  // Kalau lagi rame (banyak ticket lain sedang diproses), kasih tahu user
  // sistemnya lagi sibuk, supaya nggak kelihatan diam/nge-hang -- tanpa
  // menyebut "nomor antrian" biar nggak dikira slot yang pasti/dijamin.
  const positionAhead = ticketManager.getQueueLength();
  if (positionAhead > 0) {
    await interaction.update({
      content:
        '🔄 Sedang mengecek ketersediaan tiket...\n' +
        'Sistem sedang memproses permintaan kamu dan mengecek antrean secara otomatis.\n\n' +
        'Mohon tunggu sampai proses pengecekan selesai dan tidak melakukan klik ulang tombol selama proses berlangsung.',
      embeds: [],
      components: [],
    });
  } else {
    await interaction.deferUpdate();
  }

  try {
    const { channel } = await ticketManager.createOrderTicket({
      ticketId,
      uniqueCode,
      paymentAmount,
      guild: interaction.guild,
      buyerUser: interaction.user,
      robloxUsername: pending.robloxUsername,
      robuxAmount,
      priceRupiah,
    });

    pendingOrders.remove(token);

    await interaction.editReply({
      content: null,
      embeds: [buildTicketCreatedEmbed({ channelId: channel.id })],
      components: [],
    });
  } catch (err) {
    pendingOrders.remove(token);

    if (err instanceof ticketManager.QueueCancelledError) {
      // Toko ditutup sementara ticket ini masih antre -> reservasi dibatalkan,
      // beri tahu user dengan jelas (bukan error generik).
      db.closeOrder({ ticketId, status: 'Cancelled', progressNote: `Antrian dibatalkan: ${err.message}`, closedByDiscordId: null });
      await interaction.editReply({
        content:
          '🔒 Yah, toko baru saja ditutup!\n\n' +
          'Mohon maaf ketersedian tiket telah terpenuhi, permintaan anda telah dibatalkan secara otomatis oleh sistem.\n\n' +
          '🕐 Jangan khawatir, kamu bisa mencoba order kembali setelah toko dibuka.',
        embeds: [],
        components: [],
      });
      return;
    }

    console.error('[Order] Gagal membuat ticket:', err);
    db.closeOrder({ ticketId, status: 'Cancelled', progressNote: `Gagal dibuat karena error teknis: ${err.message}`, closedByDiscordId: null });

    const isRateLimited = err.status === 429 || err.code === 429;
    await interaction.editReply({
      content: isRateLimited
        ? '❌ Server Discord sedang sangat sibuk. Ticket kamu GAGAL dibuat -- silakan tunggu 1-2 menit lalu klik **Beli Robux** lagi.'
        : '❌ Terjadi kesalahan saat membuat ticket. Silakan hubungi admin atau coba lagi dalam beberapa saat.',
      embeds: [],
      components: [],
    });
  }
}

module.exports = { customIdPrefix: CUSTOM_ID_PREFIX, handle };
