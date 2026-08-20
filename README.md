# KokoKrunch Order Robux Bot

Bot Discord untuk sistem **top up Robux berbasis ticket** di server KokoKrunch Studios,
lengkap dengan cek eligibility otomatis, QRIS dinamis sesuai nominal, dan laporan
otomatis ke channel `#review` saat ticket ditutup.

> ⚠️ **Catatan arsitektur penting**: Bot ini TIDAK menggunakan Tickety.top. API
> Tickety.top hanya webhook satu arah (memberi tahu server kamu saat ticket
> dibuat/ditutup), bukan API untuk *membuat* ticket secara terprogram — jadi tidak
> bisa dipakai untuk alur "cek eligibility dulu, baru buat ticket kalau lolos".
> Bot ini membuat & mengelola ticket-nya sendiri (channel + permission), sehingga
> alur pembatalan sebelum ticket dibuat bisa dijamin 100% bekerja.

---

## 1. Alur Lengkap

```
#order-robux
  └─ Embed panel + tombol [Beli Robux] [Cara Beli]
        │
        ├─ Cara Beli (Link Button) -> langsung buka channel panduan
        │
        └─ Beli Robux (klik)
              -> Cek: toko lagi buka? pembeli ini sudah punya ticket terbuka? (kalau ya, DIBATALKAN)
              -> Modal: input username Roblox
              -> Bot resolve username -> tampil "Confirm Your Roblox Account"
                 (Username, Display Name, avatar, tombol Yes/No)
                    ├─ No -> dibatalkan, user diminta klik "Beli Robux" lagi
                    └─ Yes -> cek akun Roblox ini sudah punya ticket terbuka? (kalau ya, DIBATALKAN)
                          -> Bot cek eligibility (Open Cloud Memberships API, sama seperti bot /eligible)
                                ├─ Belum join / belum 14 hari -> DIBATALKAN
                                └─ Eligible -> tampil Select Menu nominal Robux (100..5000)
                                      -> User pilih nominal
                                      -> RESERVASI ATOMIK (cek + kunci slot pembeli & akun Roblox sekaligus,
                                         anti race condition walau ada banyak klik hampir bersamaan)
                                      -> Antre di ticket queue (kasih tahu posisi antrian kalau lagi rame)
                                      -> Bot buat CHANNEL TICKET privat (hanya pembeli + staff + bot yang bisa lihat)
                                            -> Kirim embed detail pesanan + QR QRIS DINAMIS sesuai nominal
                                            -> Instruksi: bayar sesuai QR, lalu klik tombol Konfirmasi Pembayaran
                                      -> Balasan: "Ticket dibuat: #channel"

Di dalam ticket:
  -> Pembeli ATAU staff klik [Konfirmasi Pembayaran] -> bot minta bukti transfer
  -> Staff jalankan /dana-masuk (setelah verifikasi bukti transfer) -> bot kirim embed
        "💸 Dana Masuk — Pesanan Masuk Antrian" + tag pembeli otomatis, tanpa perlu ketik manual
  -> Staff klik [Tutup Ticket] (staff-only) -> pilih status (Completed/Cancelled/Refunded) -> isi catatan progress
        -> Bot kirim ringkasan ke #review (ID ticket, tag pembeli, username di-blur, jumlah Robux, status, progress)
        -> Channel ticket dihapus otomatis 10 detik kemudian
        -> Pembeli & akun Roblox itu langsung bisa buka ticket baru lagi

Kalau staff jalankan /toko status:Tutup saat ada ticket masih ANTRE (belum sempat dibuat):
  -> Ticket yang masih antre otomatis dibatalkan, user dikasih tahu
  -> Ticket yang SUDAH terlanjur jadi channel tetap dibiarkan (tidak dihapus)
```

**Satu pembeli (Discord) DAN satu akun Roblox masing-masing cuma boleh punya 1 ticket aktif** di waktu yang sama -- kedua-duanya dicek, jadi orang tidak bisa akali batasan ini pakai akun Discord alternatif kalau akun Robloxnya sama, atau sebaliknya.

## 2. Persiapan Sebelum Deploy

### 2.1 Bot Discord baru
Buat aplikasi bot BARU di https://discord.com/developers/applications (terpisah dari
bot `/eligible` yang sudah ada — sesuai keputusan awal, bot ini berdiri sendiri).

1. **New Application** -> beri nama, misal `KokoKrunch Order Bot`.
2. Tab **Bot** -> **Reset Token** -> catat token-nya (`DISCORD_TOKEN`).
3. Di tab **Bot**, aktifkan tidak perlu privileged intent apa pun (bot ini cuma
   pakai slash command & component interaction, tidak baca isi pesan).
4. Tab **General Information** -> catat **Application ID** (`DISCORD_CLIENT_ID`).
5. Tab **OAuth2 -> URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions minimal yang dibutuhkan:
     - `Manage Channels` (bikin & hapus channel ticket)
     - `View Channels`, `Send Messages`, `Embed Links`, `Attach Files`
     - `Read Message History`
   - Copy URL yang dihasilkan, buka di browser, invite ke server KokoKrunch Studios.

### 2.2 Kumpulkan ID yang dibutuhkan
Aktifkan dulu **Developer Mode** di Discord (Settings -> Advanced -> Developer Mode),
lalu klik kanan tiap elemen ini -> **Copy ID**:

| Variabel | Cara ambil |
|---|---|
| `DISCORD_GUILD_ID` | Klik kanan nama server |
| `ORDER_CHANNEL_ID` | Klik kanan channel `#order-robux` |
| `CARA_BELI_CHANNEL_ID` | Sudah diketahui: `1533433480489467996` |
| `REVIEW_CHANNEL_ID` | Klik kanan channel `#review` |
| `TICKET_CATEGORY_ID` | Buat category baru misal **"Order Tickets"**, klik kanan -> Copy ID |
| `STAFF_ROLE_ID` | Klik kanan role admin/staff yang boleh proses & tutup ticket |

### 2.3 Roblox Open Cloud API Key
Sama seperti bot `/eligible` yang sudah kamu punya — kamu **boleh pakai API Key yang
sama** (scope `group:read`, restricted ke Group ID 625247444), tidak perlu bikin baru.
Kalau mau terpisah demi keamanan, ikuti langkah yang sama seperti waktu bikin bot
eligible pertama kali (create.roblox.com/credentials -> scope `group:read` ->
restrict ke Group ID & IP VPS).

### 2.4 Ambil `QRIS_STATIC_PAYLOAD`
Ini **string hasil decode QR**, BUKAN file gambar. `.env.example` di project ini
sudah diisi otomatis dengan hasil decode dari gambar QRIS KokoKrunch Studios yang
kamu berikan — jadi biasanya kamu tidak perlu ambil ulang, cukup copy dari
`.env.example` ke `.env`.

Kalau suatu saat merchant ganti QRIS (NMID baru), ambil ulang payload-nya:
1. Scan QR statis yang baru pakai aplikasi scanner QR biasa (bukan aplikasi e-wallet,
   karena e-wallet langsung memproses, bukan menampilkan teks mentahnya) — atau pakai
   situs decoder QR online.
2. Copy teks hasil scan (diawali `00020101...` dan diakhiri 4 karakter hex + digit,
   contoh `...630445B3`).
3. Tempel ke `QRIS_STATIC_PAYLOAD` di `.env`.

> Bot akan **otomatis** mengubah field nominal & menghitung ulang checksum (CRC)
> setiap kali ada order baru — kamu tidak perlu generate QR manual per transaksi.

---

## 3. Setup VPS Ubuntu 24 (dari nol)

### 3.1 Login & update sistem
```bash
ssh root@ALAMAT_IP_VPS_ANDA
apt update && apt upgrade -y
```

### 3.2 Install Node.js 20 LTS
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs build-essential python3
node -v   # pastikan v20.x.x
```
`build-essential` & `python3` dibutuhkan karena `better-sqlite3` adalah native addon
yang perlu di-compile saat `npm install`.

### 3.3 Buat user khusus (jangan jalankan bot sebagai root)
```bash
adduser botuser
usermod -aG sudo botuser
su - botuser
```

### 3.4 Upload project
Dari komputer lokal kamu:
```bash
scp -r kokokrunch-order-robux-bot botuser@ALAMAT_IP_VPS_ANDA:/home/botuser/
```
Atau lewat GitHub kalau project sudah kamu push:
```bash
git clone <url-repo-anda> kokokrunch-order-robux-bot
```

### 3.5 Install dependencies
```bash
cd ~/kokokrunch-order-robux-bot
npm install
```

### 3.6 Konfigurasi environment
```bash
cp .env.example .env
nano .env
```
Isi semua variabel sesuai data yang sudah kamu kumpulkan di Bab 2. Simpan dengan
`Ctrl+O`, `Enter`, keluar dengan `Ctrl+X`.

> ⚠️ **Jangan pernah** commit `.env` ke Git atau share ke publik.

### 3.7 Daftarkan slash command
```bash
node deploy-commands.js
```
Command `/setup-order-panel` akan langsung muncul di server (karena didaftarkan
per-guild, bukan global, jadi instan).

### 3.8 Pasang panel order
Jalankan bot manual dulu untuk uji coba:
```bash
node index.js
```
Harus muncul log:
```
[Bot] Login berhasil sebagai NamaBot#1234
[Bot] Guild: 123456789012345678
```
Lalu di Discord, jalankan `/setup-order-panel` di server kamu (butuh permission
**Manage Server**). Panel dengan tombol **Beli Robux** & **Cara Beli** akan muncul
di `#order-robux`.

Coba klik **Beli Robux**, isi username Roblox yang kamu tahu eligible, pastikan
select nominal muncul, pilih satu nominal, dan pastikan channel ticket baru
terbuat lengkap dengan QR yang bisa di-scan. Setelah yakin semua jalan, tekan
`Ctrl+C` lalu lanjut ke PM2 supaya bot jalan 24 jam.

---

## 4. Menjalankan Bot 24 Jam dengan PM2

### 4.1 Install PM2
```bash
sudo npm install -g pm2
```

### 4.2 Jalankan bot
```bash
cd ~/kokokrunch-order-robux-bot
pm2 start ecosystem.config.js
```

### 4.3 Perintah PM2 yang berguna
```bash
pm2 status
pm2 logs kokokrunch-order-robux-bot
pm2 restart kokokrunch-order-robux-bot
pm2 stop kokokrunch-order-robux-bot
```

### 4.4 Auto-start setelah VPS reboot
```bash
pm2 startup
# copy-paste & jalankan command sudo yang ditampilkan
pm2 save
```

---

## 5. Ketahanan Saat Diserbu Banyak Order Sekaligus

Bot ini punya beberapa lapis perlindungan otomatis supaya tidak down kalau tiba-tiba banyak orang order bersamaan (misal pas promo/buka toko):

1. **Antrian pembuatan ticket** (`src/ticketQueue.js`) — semua pembuatan channel diproses satu-satu dengan jeda ~1.5 detik, bukan sekaligus bersamaan. User yang order pas lagi rame akan lihat pesan "Ticket kamu masuk antrian (N order di depan kamu)".
2. **Auto-retry Discord API** (`src/discordRetry.js`) — kalau kena rate limit (429) atau error server sementara, otomatis dicoba lagi, bukan langsung gagal.
3. **Kategori ticket otomatis meluas** (`src/categoryManager.js`) — Discord membatasi keras maksimal 50 channel per kategori. Begitu kategori `TICKET_CATEGORY_ID` mendekati penuh, bot **otomatis bikin kategori baru** ("Order Tickets 2", dst) dan memakainya, jadi tidak akan pernah mentok di limit itu.
4. **Reservasi atomik** (`src/db.js` fungsi `reserveOrder`) — cek + kunci slot pembeli & akun Roblox dalam satu langkah, anti race condition walau ada banyak klik hampir bersamaan.

Kalau tetap ada ticket yang gagal dibuat (misal Discord API benar-benar down), user akan dapat pesan error yang jelas dan diminta coba lagi beberapa saat kemudian -- bukan diam tanpa respons.

### 5.1 Cakupan pengujian yang sudah dilakukan (jujur, biar jelas batasnya)

Yang **sudah** diuji lewat simulasi/unit test:
- Antrian memproses tugas berurutan dengan jeda pasti (~1.5 detik), tidak pernah dobel jalan bersamaan
- Kategori otomatis beralih begitu kategori utama disimulasikan hampir penuh (48/50), dan tidak bikin kategori baru berulang-ulang
- Reservasi atomik menolak dengan benar untuk kasus: pembeli sama, akun Roblox sama (walau pembeli beda), dan mengizinkan lagi setelah ticket lama ditutup
- Pembatalan massal antrian: tugas yang sudah "dipegang" tetap selesai, sisanya di antrian batal bersih dengan pesan yang jelas
- Semua modul berhasil dimuat tanpa error syntax/require

Yang **BELUM** bisa aku uji dari sini (keterbatasan environment, bukan malas 😅): aku tidak punya akses ke Discord API sungguhan (tidak ada token/koneksi live), jadi semua ini diuji pakai simulasi/mock objek Discord, BUKAN lewat server Discord asli dengan banyak user asli mengklik bersamaan secara nyata. Artinya:
- Belum ada uji beban nyata (misal 40 klik sungguhan dalam hitungan detik di server production)
- Belum terverifikasi bagaimana perilaku Discord API sungguhan merespons pola trafik ini di dunia nyata (rate limit real bisa beda-beda tergantung load Discord saat itu)
- Belum ada automated test suite yang bisa dijalankan ulang otomatis tiap kali ada perubahan kode ke depannya

**Rekomendasi**: sebelum event/promo besar berikutnya, coba dulu simulasikan rame-rame kecil dulu (misal minta 5-10 orang staff/teman order bersamaan di jam biasa, bukan langsung di momen promo sungguhan) supaya ketahuan kalau ada masalah sebelum benar-benar dibutuhkan saat rame.

## 6. Data Transaksi (SQLite)

Setiap order otomatis tersimpan di file `orders.sqlite3` (dibuat otomatis di folder
project, jangan dihapus manual). Data yang disimpan: ticket ID, channel ID, Discord
ID pembeli, username Roblox, jumlah Robux, harga, status, catatan progress, dan
waktu dibuat/ditutup — berguna untuk audit kalau ada sengketa transaksi.

**Backup rutin disarankan**, misalnya cron harian:
```bash
crontab -e
# tambahkan baris ini (backup jam 3 pagi tiap hari):
0 3 * * * cp /home/botuser/kokokrunch-order-robux-bot/orders.sqlite3 /home/botuser/backup-orders-$(date +\%F).sqlite3
```

---

## 7. Troubleshooting

| Gejala | Kemungkinan Penyebab | Solusi |
|---|---|---|
| `/setup-order-panel` tidak muncul di Discord | Command belum di-deploy | Jalankan ulang `node deploy-commands.js` |
| Klik "Beli Robux" tidak ada respons | Bot tidak online, atau intents/permission kurang | Cek `pm2 logs`, pastikan bot punya izin **View Channel** & **Send Messages** di `#order-robux` |
| Channel ticket gagal dibuat | Bot tidak punya **Manage Channels**, atau `TICKET_CATEGORY_ID` salah | Cek permission bot di server & ulang cek ID kategori |
| QR di ticket tidak bisa di-scan / ditolak aplikasi bank | `QRIS_STATIC_PAYLOAD` di `.env` tidak lengkap/terpotong | Ambil ulang payload sesuai langkah 2.4, pastikan disalin utuh tanpa spasi tambahan |
| Eligibility selalu gagal padahal user sudah join | Masalah sama seperti bot `/eligible` — lihat tabel troubleshooting di README bot tersebut (masalah biasanya di scope API Key atau IP restriction) |
| Ticket tidak terhapus setelah close | Bot kehilangan permission **Manage Channels** di kategori ticket | Cek ulang permission overwrite kategori `TICKET_CATEGORY_ID` |
| `npm install` gagal di step `better-sqlite3` | Belum install `build-essential`/`python3` | `apt install -y build-essential python3`, lalu `npm install` ulang |

---

## 8. Rekomendasi Lanjutan

Beberapa hal yang worth dipertimbangkan ke depannya, di luar yang sudah dikerjakan:

1. **Cooldown ringan di tombol "Beli Robux"** — reservasi atomik sudah mencegah dobel ticket, tapi kalau mau UX lebih rapi (misal user spam klik saking penasaran), bisa ditambah jeda beberapa detik antar klik per user.
2. **Command `/queue-status` untuk staff** — biar staff bisa lihat langsung berapa ticket yang lagi antre tanpa perlu tanya-tanya pembeli, terutama pas lagi rame.
3. **Log rotation untuk PM2** — install `pm2-logrotate` (`pm2 install pm2-logrotate`) supaya file log tidak membengkak tanpa batas di VPS seiring waktu.
4. **Server Discord testing terpisah** — beberapa bug yang ditemukan kemarin (race condition, limit kategori) ketahuan pas sudah dipakai pembeli asli. Kalau ke depannya mau nambah fitur besar lagi, coba dulu di server testing sebelum diterapkan ke server utama.
5. **Backup database rutin** — sudah dijelaskan di bagian 6, tapi ini layak ditekankan lagi karena `orders.sqlite3` adalah satu-satunya catatan riwayat transaksi kamu.

---

## 9. Update Bot di Kemudian Hari

```bash
cd ~/kokokrunch-order-robux-bot
git pull                 # atau upload ulang file yang berubah via scp
npm install               # kalau ada dependency baru
node deploy-commands.js   # HANYA kalau ada perubahan definisi slash command
pm2 restart kokokrunch-order-robux-bot
```

---

## 10. Struktur File

```
kokokrunch-order-robux-bot/
├── index.js                     # entry point, router semua interaction
├── deploy-commands.js           # daftar slash command /setup-order-panel
├── ecosystem.config.js          # config PM2
├── .env.example
├── package.json
├── orders.sqlite3               # (dibuat otomatis) database transaksi
└── src/
    ├── config.js                 # load & validasi .env
    ├── constants.js               # daftar nominal Robux & rate harga
    ├── db.js                      # akses SQLite (better-sqlite3) + reservasi atomik
    ├── embeds.js                  # semua tampilan embed
    ├── httpClient.js              # axios + retry/backoff otomatis (Roblox API)
    ├── discordRetry.js            # retry/backoff khusus panggilan Discord API
    ├── categoryManager.js         # kategori ticket otomatis meluas (anti limit 50 channel/kategori)
    ├── ticketQueue.js             # antrian pembuatan ticket + dukungan pembatalan massal
    ├── pendingOrders.js           # state sementara antara modal -> konfirmasi -> select nominal
    ├── qris.js                    # parser TLV EMVCo + generator QRIS dinamis
    ├── reconcile.js               # bersihkan order "nyangkut" (channel sudah hilang) -- dipakai startup sweep & command manual
    ├── roblox.js                  # resolve username & cek eligibility (sama seperti bot /eligible)
    ├── ticketManager.js           # pembuatan channel ticket (lewat antrian) + kirim embed order
    ├── util.js                    # format rupiah, mask username, slugify
    ├── commands/
    │   ├── setuporderpanel.js     # slash command pasang panel di #order-robux
    │   ├── danamasuk.js           # slash command /dana-masuk (staff, dipakai di dalam ticket)
    │   ├── toko.js                # slash command /toko status:[Buka/Tutup] (staff)
    │   └── bersihkanorderan.js    # slash command /bersihkan-orderan (staff) -- bersihkan order nyangkut tanpa restart bot
    ├── panel.js                   # helper bangun & refresh pesan panel order (tombol disabled saat tutup)
    └── interactions/
        ├── buyRobuxButton.js      # tombol "Beli Robux" -> munculkan modal
        ├── usernameModal.js       # submit username -> resolve akun -> tampil konfirmasi
        ├── confirmRobloxYes.js    # konfirmasi "Yes" -> cek eligibility -> select nominal
        ├── confirmRobloxNo.js     # konfirmasi "No" -> batalkan, minta ulang
        ├── amountSelect.js        # pilih nominal -> reservasi atomik -> buat ticket
        ├── closeTicketButton.js   # tombol "Tutup Ticket" -> pilih status
        ├── closeStatusSelect.js   # pilih status -> modal catatan progress
        └── closeNoteModal.js      # submit catatan -> kirim ke #review & hapus channel
```

