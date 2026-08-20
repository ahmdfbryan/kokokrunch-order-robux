const { Client, GatewayIntentBits, Collection, Events, MessageFlags } = require('discord.js');
const config = require('./src/config');
const db = require('./src/db');
const { reconcileOrphanedOrders } = require('./src/reconcile');

const setupOrderPanelCommand = require('./src/commands/setuporderpanel');
const danaMasukCommand = require('./src/commands/danamasuk');
const tokoCommand = require('./src/commands/toko');
const bersihkanOrderanCommand = require('./src/commands/bersihkanorderan');

const buyRobuxButton = require('./src/interactions/buyRobuxButton');
const usernameModal = require('./src/interactions/usernameModal');
const confirmRobloxYes = require('./src/interactions/confirmRobloxYes');
const confirmRobloxNo = require('./src/interactions/confirmRobloxNo');
const amountSelect = require('./src/interactions/amountSelect');
const confirmPaymentButton = require('./src/interactions/confirmPaymentButton');
const closeTicketButton = require('./src/interactions/closeTicketButton');
const closeStatusSelect = require('./src/interactions/closeStatusSelect');
const closeNoteModal = require('./src/interactions/closeNoteModal');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.commands = new Collection();
client.commands.set(setupOrderPanelCommand.data.name, setupOrderPanelCommand);
client.commands.set(danaMasukCommand.data.name, danaMasukCommand);
client.commands.set(tokoCommand.data.name, tokoCommand);
client.commands.set(bersihkanOrderanCommand.data.name, bersihkanOrderanCommand);

// Handler dengan exact customId (button tunggal)
const exactButtonHandlers = new Collection([[buyRobuxButton.customId, buyRobuxButton]]);

// Handler dengan customId berformat "prefix:data..." (dipisah ':')
const prefixedHandlers = new Collection([
  [confirmRobloxYes.customIdPrefix, confirmRobloxYes],
  [confirmRobloxNo.customIdPrefix, confirmRobloxNo],
  [amountSelect.customIdPrefix, amountSelect],
  [confirmPaymentButton.customIdPrefix, confirmPaymentButton],
  [closeTicketButton.customIdPrefix, closeTicketButton],
  [closeStatusSelect.customIdPrefix, closeStatusSelect],
  [closeNoteModal.customIdPrefix, closeNoteModal],
]);

// Modal handler dengan exact customId
const exactModalHandlers = new Collection([[usernameModal.customId, usernameModal]]);

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[Bot] Login berhasil sebagai ${readyClient.user.tag}`);
  console.log(`[Bot] Guild: ${config.discordGuildId}`);
  const guild = await readyClient.guilds.fetch(config.discordGuildId).catch(() => null);
  if (guild) await reconcileOrphanedOrders(guild);
});

// Kalau channel ticket dihapus manual (bukan lewat tombol "Tutup Ticket"),
// order-nya ikut ditutup otomatis di database supaya pembeli tidak selamanya
// dianggap "masih punya ticket terbuka" gara-gara datanya nyangkut.
client.on(Events.ChannelDelete, (channel) => {
  try {
    const order = db.getOrderByChannelId(channel.id);
    if (order && !order.closed_at) {
      db.closeOrderAsDeleted(order.ticket_id);
      console.log(`[Ticket] Channel ${channel.id} (order ${order.ticket_id}) dihapus manual -> order otomatis ditutup di database.`);
    }
  } catch (err) {
    console.error('[Ticket] Gagal auto-close order saat channelDelete:', err.message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }

    if (interaction.isButton()) {
      const exact = exactButtonHandlers.get(interaction.customId);
      if (exact) return void (await exact.handle(interaction));

      const prefix = interaction.customId.split(':')[0];
      const prefixed = prefixedHandlers.get(prefix);
      if (prefixed) return void (await prefixed.handle(interaction));
      return;
    }

    if (interaction.isStringSelectMenu()) {
      const prefix = interaction.customId.split(':')[0];
      const prefixed = prefixedHandlers.get(prefix);
      if (prefixed) return void (await prefixed.handle(interaction));
      return;
    }

    if (interaction.isModalSubmit()) {
      const exact = exactModalHandlers.get(interaction.customId);
      if (exact) return void (await exact.handle(interaction));

      const prefix = interaction.customId.split(':')[0];
      const prefixed = prefixedHandlers.get(prefix);
      if (prefixed) return void (await prefixed.handle(interaction));
      return;
    }
  } catch (err) {
    console.error(`[Bot] Error tak terduga menangani interaction "${interaction.customId ?? interaction.commandName}":`, err);
    const errorPayload = { content: '❌ Terjadi kesalahan tak terduga. Silakan coba lagi atau hubungi admin.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorPayload).catch(() => {});
    } else {
      await interaction.reply(errorPayload).catch(() => {});
    }
  }
});

// Supaya proses tidak langsung mati kalau ada error async yang tidak tertangkap --
// biarkan pm2/systemd yang tahu lewat log, tapi bot tetap coba jalan terus.
process.on('unhandledRejection', (reason) => {
  console.error('[Bot] Unhandled promise rejection:', reason);
});

client.login(config.discordToken);
