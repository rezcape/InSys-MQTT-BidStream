# InSys-Websocket-BidStream

WebSocket gateway untuk menjembatani browser (frontend) dengan layanan gRPC BidStream.

Repo ini sekarang sudah standalone (tidak bergantung ke repo lain), karena source backend gRPC sudah disertakan di folder `grpc-backend`.

## Step 1 Status

- Selesai: fondasi backend gateway.
- Selesai: WebSocket server hidup di port `8080` (default).
- Selesai: startup check koneksi ke 3 service gRPC (`Auth`, `Catalog`, `Bidding`).

## Struktur Utama

- `grpc-backend/`: backend gRPC (Auth, Catalog, Bidding)
- `src/`: WebSocket Gateway

## Prasyarat

1. Gunakan Node.js 18+.

## Menjalankan Gateway

1. Setup semua dependency (root + grpc-backend):

```bash
npm run setup
```

2. Salin environment file:

```bash
cp .env.example .env
```

3. Jalankan seluruh stack (3 service gRPC + gateway) dari repo ini:

```bash
npm run dev:stack
```

Atau jalankan gateway saja:

```bash
npm run dev
```

Jika sukses, log akan menampilkan:

- `gRPC connectivity check passed (Auth/Catalog/Bidding)`
- `WebSocket gateway listening on ws://localhost:8080`

## Step 2 Status

- Selesai: command bridge WebSocket -> gRPC (unary)
- Selesai: stream bridge gRPC -> WebSocket (auction + catalog)
- Selesai: server-initiated heartbeat event

## Step 3 Status

- Selesai: kontrak command v1 dibekukan dengan validasi payload ketat
- Selesai: smoke test otomatis untuk skenario sukses + error

## Step 4 Status

- Selesai: semua outbound event memakai envelope versi protokol `v1`
- Selesai: smoke test diperluas untuk skenario `bid-too-low` dan `auction closed`

## Step 5 Status

- Selesai: frontend handover template (3 komponen dinamis + command panel)
- Selesai: tabel mapping field event v1 untuk implementasi UI lanjutan

## Menjalankan Smoke Test WebSocket

1. Jalankan stack:

```bash
npm run dev:stack
```

2. Pada terminal lain jalankan smoke test:

```bash
npm run smoke:ws
```

Smoke test memverifikasi:

- alur sukses: register, login, get items, open auction, join auction
- event stream masuk: `auction.update`
- alur error: validasi amount tidak valid, token invalid
- alur error bisnis: bid di bawah minimum increment
- alur error state: bid setelah auction ditutup

## Menjalankan Frontend Handover Template

1. Jalankan stack backend + gateway:

```bash
npm run dev:stack
```

2. Pada terminal lain jalankan static web server:

```bash
npm run dev:web
```

3. Buka browser ke:

- `http://localhost:5173`

Template ini menampilkan 3 komponen dinamis wajib:

- `Auction Status` (state + countdown)
- `Live Bid Panel` (highest bidder + highest amount + mini chart)
- `Activity Log` (event stream realtime)

## Kontrak Pesan WebSocket (Draft v1)

Semua command dari browser dikirim dalam bentuk JSON:

```json
{
	"type": "auction.place_bid",
	"requestId": "req-123",
	"payload": {
		"auction_id": "...",
		"bidder_name": "Alice",
		"amount": 600000000,
		"token": "..."
	}
}
```

### Command yang tersedia

- `auth.register`
- `auth.login`
- `catalog.get_items`
- `catalog.open_auction`
- `stream.catalog.start`
- `stream.catalog.stop`
- `auction.join`
- `auction.leave`
- `auction.place_bid`
- `auction.get_result`

### Event dari server

- `system.connected`
- `system.heartbeat`
- `catalog.event`
- `auction.update`
- `catalog.stream.ended`
- `auction.stream.ended`
- `command.error`

Semua event/response gateway memiliki envelope:

```json
{
	"version": "v1",
	"type": "...",
	"payload": {},
	"timestamp": 1710000000000
}
```

### Response sukses command

Server mengirim event result dengan pola `*.result`, misalnya:

- `auth.login.result`
- `catalog.get_items.result`
- `auction.place_bid.result`

## Mapping Field Event v1 (Freeze)

### `auction.update`

- `payload.auction_id`: string
- `payload.highest_bidder`: string
- `payload.highest_amount`: number
- `payload.remaining_seconds`: number
- `payload.event_type`: string (`SNAPSHOT`, `BID_UPDATE`, `AUCTION_CLOSING`, `AUCTION_CLOSED`, `TIMER_TICK`)

### `catalog.event`

- `payload.auction_id`: string
- `payload.item_id`: string
- `payload.item_name`: string
- `payload.starting_price`: number
- `payload.duration_seconds`: number
- `payload.event_type`: string (`AUCTION_OPENED`, `AUCTION_CLOSING`, `AUCTION_CLOSED`)

### `command.error`

- `payload.requestId`: string | null
- `payload.ok`: boolean (`false`)
- `payload.message`: string
- `payload.details`: object | null

### `*.result`

- `payload.requestId`: string | null
- `payload.ok`: boolean
- `payload.data`: object