const { REST, Routes } = require('discord.js');
const config = require('./src/config');
const setupOrderPanelCommand = require('./src/commands/setuporderpanel');
const danaMasukCommand = require('./src/commands/danamasuk');
const tokoCommand = require('./src/commands/toko');
const bersihkanOrderanCommand = require('./src/commands/bersihkanorderan');

const commands = [
  setupOrderPanelCommand.data.toJSON(),
  danaMasukCommand.data.toJSON(),
  tokoCommand.data.toJSON(),
  bersihkanOrderanCommand.data.toJSON(),
];
const rest = new REST().setToken(config.discordToken);

(async () => {
  try {
    console.log(`[Deploy] Mendaftarkan ${commands.length} slash command ke guild ${config.discordGuildId}...`);
    await rest.put(Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId), { body: commands });
    console.log('[Deploy] Sukses! Command langsung tersedia di guild tersebut.');
  } catch (err) {
    console.error('[Deploy] Gagal mendaftarkan command:', err);
    process.exit(1);
  }
})();
