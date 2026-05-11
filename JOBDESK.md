# Pembagian Jobdesk Implementasi MQTT (2 Orang)

Dokumen ini adalah panduan kerja resmi untuk proyek lelang (Auction) berbasis MQTT. Proyek dikerjakan oleh 2 orang secara paralel dengan tanggung jawab yang terpisah jelas sehingga tidak saling menunggu (non-blocking).

## Arsitektur Singkat
- **Broker**: `broker.hivemq.com` (Public MQTT Broker)
- **Topik Dasar**: `auction/item/+/#` dan `client/+/command`

---

## 👨‍💻 Person 1: Backend & Integrasi MQTT (Sisi Server)

**Tugas Utama**: Menulis logika di sisi backend Node.js (`src/index.ts`) agar bertindak sebagai klien MQTT yang menjembatani layanan gRPC internal ke publik via MQTT.

### Scope Pekerjaan Person 1:
1. **Setup Koneksi MQTT**: Menghubungkan backend Node.js ke `mqtt://broker.hivemq.com:1883`.
2. **Translasi Event (gRPC -> MQTT)**:
   - Saat lelang dibuka/ditutup oleh sistem, *publish* status ke topik `auction/item/<id>/status` dengan flag `retain: true`.
   - Saat event lelang (countdown, user join) terjadi dari gRPC, *publish* ke topik `auction/item/<id>/events`.
3. **Translasi Command (MQTT -> gRPC)**:
   - *Subscribe* ke topik `client/+/command/#` (misalnya `client/user123/command/bid`).
   - Ketika ada pesan masuk ke topik tersebut, teruskan datanya ke gRPC `PlaceBid` atau `JoinAuction`.
   - Jika sukses/gagal, *publish* hasilnya ke topik spesifik klien atau update `highest_bid`.

### File yang Dikerjakan:
- `src/index.ts` (Gateway Backend)
- `package.json` (Setup dependensi MQTT backend)

### Milestone Person 1 Selesai Jika:
- Log terminal menunjukkan backend berhasil terkoneksi ke HiveMQ.
- Frontend bisa menerima *event* seperti status OPEN atau hitung mundur melalui topik MQTT.

---

## 👨‍💻 Person 2: Frontend Web & UI Event-Driven (Sisi Klien)

**Tugas Utama**: Mengubah *Dashboard Web* agar berlangganan (*subscribe*) dan mempublikasi (*publish*) pesan langsung ke MQTT Broker (HiveMQ) dari browser.

### Scope Pekerjaan Person 2:
1. **Setup Koneksi Frontend**:
   - Mengimpor pustaka MQTT.js via CDN di `index.html`.
   - Membuat koneksi WebSocket ke HiveMQ: `mqtt.connect('ws://broker.hivemq.com:8000/mqtt')`.
2. **Subscribe Event**:
   - *Subscribe* ke `auction/item/+/status` -> Untuk mengupdate tulisan status Lelang (OPEN/CLOSED).
   - *Subscribe* ke `auction/item/+/bid/highest` -> Untuk mengupdate panel "Highest Bidder" dan harga saat ini.
   - *Subscribe* ke `auction/item/+/events` -> Untuk menampilkan log aktivitas di layar kanan.
3. **Publish Command (Bidding)**:
   - Saat tombol "Buzz In!" atau "Bid" ditekan, *publish* data tawaran tersebut ke topik `client/<nama_user>/command/bid` agar diproses oleh Person 1.

### File yang Dikerjakan:
- `web/index.html` (Markup & CDN)
- `web/app.js` (Logika UI dan MQTT Client)

### Milestone Person 2 Selesai Jika:
- Klien browser berhasil *connect* ke `ws://broker.hivemq.com:8000/mqtt`.
- UI berubah secara otomatis saat ada pesan MQTT masuk.
- Form bidding bisa menembak pesan ke MQTT.

---

## Kolaborasi dan Testing Bersama

Setelah Person 1 dan Person 2 menyelesaikan milestonenya:
1. **Jalankan bersama-sama**: Person 1 menjalankan backend (`npm run dev:stack`), Person 2 membuka `index.html` di browser.
2. **Test Skenario**:
   - Person 2 menekan tombol join/bid. Person 1 memastikan backend mendeteksi topik MQTT dan meneruskannya ke gRPC.
   - Backend memvalidasi lalu merespon dengan topik *highest_bid*. Frontend Person 2 akan otomatis ter-update harganya.
3. **Pembuatan Laporan**: Ambil screenshot dari berbagai fitur ini untuk melengkapi `draft_laporan_mqtt.md`.