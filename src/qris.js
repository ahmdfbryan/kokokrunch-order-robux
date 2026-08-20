const QRCode = require('qrcode');

/**
 * QRIS mengikuti format EMVCo QR Code for Payment Systems: rangkaian TLV
 * (Tag-Length-Value), tag & length masing-masing 2 digit.
 *
 * Untuk mengubah QRIS STATIS -> DINAMIS dengan nominal tetap, ada 3 langkah:
 *  1. Ubah tag "01" (Point of Initiation Method) dari "11" (statis) -> "12" (dinamis)
 *  2. Sisipkan/replace tag "54" (Transaction Amount) dengan nominal yang diinginkan
 *  3. Hitung ulang CRC16 (tag "63") karena isi payload berubah
 *
 * Referensi: spesifikasi EMVCo QR Code Specification for Payment Systems,
 * dan Buku Kodifikasi QRIS Bank Indonesia (format tag sama, dipakai semua
 * penyedia QRIS termasuk InterActive/SpeedCash yang dipakai KokoKrunch Studios).
 */

// ---------------------------------------------------------------------------
// TLV parsing
// ---------------------------------------------------------------------------

/** Pecah payload EMVCo jadi array {tag, length, value}, urut sesuai payload asli. */
function parseTLV(payload) {
  const entries = [];
  let i = 0;
  while (i < payload.length) {
    const tag = payload.slice(i, i + 2);
    const lengthStr = payload.slice(i + 2, i + 4);
    const length = parseInt(lengthStr, 10);

    if (tag.length < 2 || lengthStr.length < 2 || Number.isNaN(length)) {
      throw new Error(
        `[QRIS] Payload tidak valid / rusak saat parsing di posisi ${i}. ` +
        `Pastikan QRIS_STATIC_PAYLOAD di .env adalah hasil scan QR asli tanpa terpotong.`
      );
    }

    const value = payload.slice(i + 4, i + 4 + length);
    if (value.length !== length) {
      throw new Error(`[QRIS] Payload terpotong: tag ${tag} mengklaim panjang ${length} tapi sisa data tidak cukup.`);
    }

    entries.push({ tag, length, value });
    i += 4 + length;
  }
  return entries;
}

/** Gabungkan kembali array TLV jadi string payload (tanpa CRC di akhir). */
function serializeTLV(entries) {
  return entries
    .map(({ tag, value }) => `${tag}${String(value.length).padStart(2, '0')}${value}`)
    .join('');
}

// ---------------------------------------------------------------------------
// CRC16/CCITT-FALSE -- algoritma wajib dipakai EMVCo QR (poly 0x1021, init 0xFFFF)
// ---------------------------------------------------------------------------
function crc16ccitt(str) {
  let crc = 0xffff;
  for (let c = 0; c < str.length; c++) {
    crc ^= str.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// ---------------------------------------------------------------------------
// Builder utama
// ---------------------------------------------------------------------------

const TAG_POINT_OF_INIT = '01';
const TAG_TX_AMOUNT = '54';
const TAG_COUNTRY_CODE = '58'; // tag 54 harus disisipkan SEBELUM tag ini per spesifikasi EMVCo
const TAG_CRC = '63';

/**
 * @param {string} staticPayload payload QRIS statis hasil decode QR asli
 * @param {number} amount nominal transaksi dalam Rupiah (integer, tanpa desimal)
 * @returns {string} payload QRIS dinamis siap di-encode jadi QR image
 */
function buildDynamicPayload(staticPayload, amount) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('[QRIS] Nominal harus berupa bilangan bulat positif.');
  }

  const cleaned = staticPayload.trim();
  let entries = parseTLV(cleaned);

  // 1) Tag 01: paksa jadi dinamis ("12")
  const poiIndex = entries.findIndex((e) => e.tag === TAG_POINT_OF_INIT);
  if (poiIndex === -1) {
    throw new Error('[QRIS] Tag 01 (Point of Initiation Method) tidak ditemukan di payload statis.');
  }
  entries[poiIndex] = { ...entries[poiIndex], value: '12', length: 2 };

  // 2) Tag 54: replace kalau sudah ada, atau sisipkan sebelum tag 58 (country code)
  const amountValue = String(amount); // QRIS Indonesia lazim pakai integer tanpa desimal
  const amountEntry = { tag: TAG_TX_AMOUNT, length: amountValue.length, value: amountValue };

  const existingAmountIndex = entries.findIndex((e) => e.tag === TAG_TX_AMOUNT);
  if (existingAmountIndex !== -1) {
    entries[existingAmountIndex] = amountEntry;
  } else {
    const countryIndex = entries.findIndex((e) => e.tag === TAG_COUNTRY_CODE);
    const insertAt = countryIndex === -1 ? entries.length : countryIndex;
    entries.splice(insertAt, 0, amountEntry);
  }

  // 3) Buang tag CRC lama (kalau ada) -- akan dihitung ulang di akhir
  entries = entries.filter((e) => e.tag !== TAG_CRC);

  // Susun ulang payload tanpa CRC, lalu tempel tag+length CRC (nilai belum diisi)
  // sebelum dihitung, sesuai aturan EMVCo: CRC dihitung atas seluruh data
  // TERMASUK "6304" di akhir, TAPI TIDAK termasuk 4 digit nilai CRC itu sendiri.
  const payloadWithoutCRC = serializeTLV(entries) + `${TAG_CRC}04`;
  const crc = crc16ccitt(payloadWithoutCRC);

  return payloadWithoutCRC + crc;
}

/** Generate PNG buffer dari payload QRIS dinamis, siap dikirim sebagai attachment Discord. */
async function generateQrisImageBuffer(staticPayload, amount) {
  const dynamicPayload = buildDynamicPayload(staticPayload, amount);
  const buffer = await QRCode.toBuffer(dynamicPayload, {
    type: 'png',
    width: 512,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
  return { buffer, dynamicPayload };
}

module.exports = { buildDynamicPayload, generateQrisImageBuffer, crc16ccitt, parseTLV };
