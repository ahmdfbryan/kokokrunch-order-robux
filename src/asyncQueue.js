/**
 * Bikin versi "diantre" dari sebuah fungsi async: SETIAP pemanggilan dijamin
 * jalan satu-per-satu berurutan (tidak pernah tumpang tindih/overlap), walau
 * pemanggilnya sendiri tidak nge-`await` hasilnya (fire-and-forget).
 *
 * Kenapa ini perlu: refreshProcessingLog() baca "daftar pesan log yang lagi
 * ada" di awal, lalu edit/bikin/hapus beberapa pesan Discord, baru simpan
 * lagi daftar pesan yang baru di akhir. Kalau ada 2+ panggilan yang jalan
 * BERBARENGAN (misal beberapa staff nutup ticket hampir bersamaan), keduanya
 * bisa baca "daftar lama" yang SAMA, lalu saling tabrakan pas edit/hapus
 * pesan -- hasilnya sebagian pesan yang seharusnya tetap ada malah kehapus,
 * atau isinya jadi campur aduk/tidak lengkap. Dengan diantre lewat fungsi
 * ini, hanya SATU refresh yang benar-benar menyentuh Discord/database di
 * satu waktu -- refresh berikutnya nunggu giliran, jadi tidak akan pernah
 * saling tabrakan.
 *
 * @param {(...args: any[]) => Promise<any>} fn
 * @returns {(...args: any[]) => Promise<any>}
 */
function serializeAsync(fn) {
  let chain = Promise.resolve();

  return function (...args) {
    const run = chain.then(() => fn(...args));
    // Jangan sampai 1 kegagalan bikin SEMUA antrean berikutnya ikut macet --
    // tiap pemanggil tetap dapat promise `run` miliknya sendiri (lengkap
    // dengan reject-nya kalau memang gagal), tapi rantai internal harus
    // selalu lanjut ke panggilan berikutnya apapun hasilnya.
    chain = run.catch(() => {});
    return run;
  };
}

module.exports = { serializeAsync };
