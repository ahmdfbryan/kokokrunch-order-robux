// Kalau banyak orang klik "Beli Robux" hampir bersamaan (misal pas toko baru
// dibuka), bikin channel ticket SEKALIGUS untuk semuanya bisa memicu rate
// limit Discord untuk pembuatan channel. Queue ini memaksa pembuatan channel
// diproses SATU PER SATU dengan jeda aman di antaranya, supaya tidak pernah
// "nembak" API secara bersamaan -- throughput jadi sedikit lebih lambat saat
// rame, tapi jauh lebih stabil dan tidak pernah gagal total.

const MIN_INTERVAL_MS = 1500; // jeda aman antar pembuatan channel

const queue = [];
let processing = false;
let lastRunAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const elapsed = Date.now() - lastRunAt;
    if (elapsed < MIN_INTERVAL_MS) {
      await sleep(MIN_INTERVAL_MS - elapsed);
    }

    const { taskFn, resolve, reject } = queue.shift();
    lastRunAt = Date.now();
    try {
      const result = await taskFn();
      resolve(result);
    } catch (err) {
      reject(err);
    }
  }

  processing = false;
}

/**
 * Masukkan tugas (biasanya pembuatan ticket) ke antrian. Tugas dijalankan
 * satu-satu dengan jeda aman, urut sesuai siapa yang antre duluan.
 * @returns {Promise} resolve/reject sesuai hasil taskFn()
 */
function enqueue(taskFn) {
  return new Promise((resolve, reject) => {
    queue.push({ taskFn, resolve, reject });
    processQueue();
  });
}

/** Posisi antrian saat ini (0 = langsung diproses, tidak nunggu). */
function getQueueLength() {
  return queue.length;
}

class QueueCancelledError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'QueueCancelledError';
  }
}

/**
 * Batalkan semua tugas yang MASIH ANTRE (belum mulai diproses). Tugas yang
 * lagi berjalan (sedang manggil Discord API) TIDAK diganggu -- dibiarkan
 * selesai dulu, karena tidak aman dibatalkan di tengah jalan.
 * @returns jumlah tugas yang dibatalkan
 */
function cancelAllPending(reason) {
  const cancelled = queue.splice(0, queue.length);
  for (const item of cancelled) {
    item.reject(new QueueCancelledError(reason));
  }
  return cancelled.length;
}

module.exports = { enqueue, getQueueLength, cancelAllPending, QueueCancelledError };
