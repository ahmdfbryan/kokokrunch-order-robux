// Sama seperti httpClient.js (buat Roblox API), tapi khusus buat panggilan
// Discord API (discord.js). Kalau kena rate limit (429) atau error server
// (5xx) sementara, coba lagi otomatis dengan jeda -- bukan langsung nyerah.

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableDiscordError(err) {
  const status = err.status ?? err.httpStatus;
  return status === 429 || (status >= 500 && status < 600);
}

function getRetryDelayMs(err, attempt) {
  // discord.js biasanya sudah nyimpen retry_after (detik) dari header Discord kalau 429
  const retryAfterSec = err.retry_after ?? err.rawError?.retry_after;
  if (typeof retryAfterSec === 'number') return retryAfterSec * 1000 + 200;
  return BASE_DELAY_MS * 2 ** attempt;
}

/**
 * Jalankan fungsi async yang manggil Discord API, retry otomatis kalau kena
 * rate limit / error server sementara.
 * @param {() => Promise<any>} fn
 * @param {{ context?: string, retries?: number }} options
 */
async function withDiscordRetry(fn, options = {}) {
  const retries = options.retries ?? MAX_RETRIES;
  const context = options.context ?? 'Discord API call';

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const willRetry = attempt < retries && isRetryableDiscordError(err);
      console.warn(
        `[Discord Retry] Gagal ${context} (percobaan ${attempt + 1}/${retries + 1}), status: ${err.status ?? 'unknown'}` +
        (willRetry ? ' -> mencoba ulang...' : ' -> menyerah.')
      );
      if (!willRetry) break;
      await sleep(getRetryDelayMs(err, attempt));
    }
  }
  throw lastError;
}

module.exports = { withDiscordRetry };
