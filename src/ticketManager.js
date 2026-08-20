const { PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const config = require('./config');
const db = require('./db');
const { generateQrisImageBuffer } = require('./qris');
const { buildTicketOrderEmbed } = require('./embeds');
const { slugifyChannelName } = require('./util');
const ticketQueue = require('./ticketQueue');
const { withDiscordRetry } = require('./discordRetry');
const { getAvailableTicketCategory } = require('./categoryManager');

async function createOrderTicket({ ticketId, uniqueCode, paymentAmount, guild, buyerUser, robloxUsername, robuxAmount, priceRupiah }) {
  // Semua pembuatan channel diantre supaya tidak "nembak" Discord API secara
  // bersamaan kalau lagi diserbu banyak order sekaligus.
  return ticketQueue.enqueue(() =>
    createOrderTicketNow({ ticketId, uniqueCode, paymentAmount, guild, buyerUser, robloxUsername, robuxAmount, priceRupiah })
  );
}

async function createOrderTicketNow({ ticketId, uniqueCode, paymentAmount, guild, buyerUser, robloxUsername, robuxAmount, priceRupiah }) {
  const ticketCode = ticketId.split('-')[1]; // 5 karakter unik dari ticket ID, contoh: LW102

  const categoryId = await getAvailableTicketCategory(guild);

  const channel = await withDiscordRetry(
    () =>
      guild.channels.create({
        name: slugifyChannelName(`order-${ticketCode}-${robloxUsername}`),
        type: ChannelType.GuildText,
        parent: categoryId,
        topic: `Order Robux ${ticketId} · Pembeli: ${buyerUser.id} · Roblox: ${robloxUsername} · ${robuxAmount} Robux`,
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
    buyerDiscordId: buyerUser.id,
    robloxUsername,
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

  return { ticketId, channel };
}

module.exports = {
  createOrderTicket,
  getQueueLength: ticketQueue.getQueueLength,
  cancelQueuedTickets: ticketQueue.cancelAllPending,
  QueueCancelledError: ticketQueue.QueueCancelledError,
};
