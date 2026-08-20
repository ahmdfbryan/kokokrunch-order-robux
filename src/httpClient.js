const axios = require('axios');

/**
 * Kenapa perlu retry/backoff manual?
 * Roblox API kadang membalas 429 (rate limit), 5xx, atau connection timeout --
 * terutama kalau request datang dari IP datacenter/VPS. Ini BUKAN bug di kode --
 * solusinya retry otomatis dengan exponential backoff, bukan langsung menyerah.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 600;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err) {
  if (!err.response) return true; // network error / timeout / DNS
  const status = err.response.status;
  return status === 429 || status >= 500;
}

function getRetryDelayMs(err, attempt) {
  const retryAfterHeader = err.response?.headers?.['retry-after'];
  if (retryAfterHeader) {
    const parsed = Number(retryAfterHeader);
    if (!Number.isNaN(parsed)) return parsed * 1000;
  }
  return BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 250);
}

async function requestWithRetry(axiosConfig, options = {}) {
  const retries = options.retries ?? MAX_RETRIES;
  const context = options.context ?? axiosConfig.url;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios({ timeout: DEFAULT_TIMEOUT_MS, ...axiosConfig });
      return response;
    } catch (err) {
      lastError = err;
      const willRetry = attempt < retries && isRetryableError(err);
      const status = err.response?.status ?? 'NETWORK_ERROR';

      console.warn(
        `[HTTP] Gagal request ke ${context} (percobaan ${attempt + 1}/${retries + 1}), status: ${status}` +
        (willRetry ? ' -> mencoba ulang...' : ' -> menyerah, tidak akan dicoba lagi.')
      );

      if (!willRetry) break;
      await sleep(getRetryDelayMs(err, attempt));
    }
  }
  throw lastError;
}

module.exports = { requestWithRetry };
