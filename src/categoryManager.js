const { ChannelType, PermissionFlagsBits } = require('discord.js');
const config = require('./config');
const db = require('./db');
const { withDiscordRetry } = require('./discordRetry');

const MAX_CHANNELS_PER_CATEGORY = 50; // hard limit dari Discord
const SAFETY_MARGIN = 3; // berhenti pakai kategori begitu isinya >= 47, biar tidak mepet banget

function countChannelsInCategory(guild, categoryId) {
  return guild.channels.cache.filter((c) => c.parentId === categoryId).size;
}

/**
 * Cari kategori ticket yang masih ada slot-nya. Urutan: kategori utama
 * (TICKET_CATEGORY_ID) dulu, lalu kategori overflow yang sudah pernah dibuat
 * (urut dari yang paling lama), baru kalau semuanya penuh -- bikin kategori
 * overflow baru otomatis.
 */
async function getAvailableTicketCategory(guild) {
  // Pastikan cache channel guild ter-update (penting kalau bot baru start / lama idle)
  await guild.channels.fetch().catch(() => {});

  const candidates = [{ id: config.ticketCategoryId, isPrimary: true }, ...db.getAllOverflowCategories().map((c) => ({ id: c.category_id }))];

  for (const candidate of candidates) {
    const category = guild.channels.cache.get(candidate.id);
    if (!category) continue; // kategori mungkin sudah dihapus manual, skip
    const count = countChannelsInCategory(guild, candidate.id);
    if (count < MAX_CHANNELS_PER_CATEGORY - SAFETY_MARGIN) {
      return candidate.id;
    }
  }

  // Semua kategori yang ada sudah penuh -> bikin kategori overflow baru otomatis
  const primaryCategory = guild.channels.cache.get(config.ticketCategoryId);
  const baseName = primaryCategory?.name ?? 'Order Tickets';
  const overflowCount = db.getAllOverflowCategories().length;
  const newName = `${baseName} ${overflowCount + 2}`; // +2 karena kategori utama dianggap "1"

  const newCategory = await withDiscordRetry(
    () =>
      guild.channels.create({
        name: newName,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
      }),
    { context: `bikin kategori overflow baru "${newName}"` }
  );

  db.addOverflowCategory({ categoryId: newCategory.id, name: newName });
  console.log(`[Category] Semua kategori ticket penuh -> kategori baru dibuat otomatis: "${newName}" (${newCategory.id})`);

  return newCategory.id;
}

module.exports = { getAvailableTicketCategory };
