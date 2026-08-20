require('dotenv').config();

function required(name) {
  const val = process.env[name];
  if (!val || val.trim() === '') {
    throw new Error(
      `[CONFIG ERROR] Environment variable "${name}" wajib diisi di file .env. ` +
      `Cek kembali file .env kamu (lihat .env.example sebagai contoh).`
    );
  }
  return val.trim();
}

function optional(name, fallback = null) {
  const val = process.env[name];
  return val && val.trim() !== '' ? val.trim() : fallback;
}

/**
 * Bikin ROBUX_EMOJI di .env "anti salah format": terima input ID polos
 * (misal "1486698683461533787"), format lengkap yang benar
 * ("<:robux:1486698683461533787>"), atau bahkan yang kurang tanda "<" ">"
 * (misal ":robux:1486698683461533787:") -- semuanya dinormalisasi jadi tag
 * emoji custom yang valid. Kalau isinya emoji unicode biasa (🪙), dibiarkan apa adanya.
 */
function normalizeRobuxEmoji(raw) {
  const trimmed = raw.trim();

  // Sudah format lengkap & benar: <:nama:id> atau <a:nama:id>
  if (/^<a?:\w+:\d+>$/.test(trimmed)) return trimmed;

  // Cuma digit -> anggap ID emoji polos
  if (/^\d+$/.test(trimmed)) return `<:robux:${trimmed}>`;

  // Format custom emoji tapi kurang "<" / ">" (misal ":robux:123456789012345678:" atau "robux:123456789012345678")
  const match = trimmed.match(/(\w+)?:?(\d{15,25})/);
  if (match) {
    const id = match[2];
    const name = match[1] || 'robux';
    return `<:${name}:${id}>`;
  }

  return trimmed; // fallback: emoji unicode biasa, dipakai apa adanya
}

const config = {
  discordToken: required('DISCORD_TOKEN'),
  discordClientId: required('DISCORD_CLIENT_ID'),
  discordGuildId: required('DISCORD_GUILD_ID'),

  // Roblox (dipakai ulang untuk cek eligibility, sama seperti bot /eligible yang sudah jalan)
  robloxApiKey: required('ROBLOX_API_KEY'),
  robloxGroupId: required('ROBLOX_GROUP_ID'),
  eligibleDays: Number(optional('ELIGIBLE_DAYS', '14')),

  // Channel & role IDs
  orderChannelId: required('ORDER_CHANNEL_ID'), // #order-robux
  caraBeliChannelId: required('CARA_BELI_CHANNEL_ID'), // 1533433480489467996
  reviewChannelId: required('REVIEW_CHANNEL_ID'), // #review
  ticketCategoryId: required('TICKET_CATEGORY_ID'), // kategori untuk channel ticket baru
  staffRoleId: required('STAFF_ROLE_ID'), // role admin/staff yang bisa lihat & close ticket

  // QRIS statis (string hasil decode QR KokoKrunch Studios, format EMVCo)
  qrisStaticPayload: required('QRIS_STATIC_PAYLOAD'),

  // Harga: rupiah per 1 Robux (rate 100 Robux = Rp10.000 => 100 per robux)
  rupiahPerRobux: Number(optional('RUPIAH_PER_ROBUX', '100')),

  // Emoji Robux custom (opsional). Isi dengan format lengkap hasil upload custom
  // emoji di server, contoh: <:robux:1234567890123456789> -- tapi kalau salah
  // format (cuma ID, atau kurang tanda < >), otomatis dinormalisasi di bawah.
  // Kalau dikosongkan, bot pakai emoji unicode 🪙 sebagai fallback.
  robuxEmoji: normalizeRobuxEmoji(optional('ROBUX_EMOJI', '🪙')),
};

if (Number.isNaN(config.eligibleDays) || config.eligibleDays <= 0) {
  throw new Error('[CONFIG ERROR] ELIGIBLE_DAYS harus berupa angka positif.');
}
if (Number.isNaN(config.rupiahPerRobux) || config.rupiahPerRobux <= 0) {
  throw new Error('[CONFIG ERROR] RUPIAH_PER_ROBUX harus berupa angka positif.');
}

module.exports = config;
