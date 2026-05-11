"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAuctionScheduler = startAuctionScheduler;
exports.getActiveAuctionCount = getActiveAuctionCount;
exports.getActiveAuctionItems = getActiveAuctionItems;
exports.stopAuctionScheduler = stopAuctionScheduler;
const clients_1 = require("../grpc/clients");
const config = {
    intervalSeconds: 15, // Create new auction every 15 seconds
    auctionDurationSeconds: 180, // Each auction lasts 3 minutes
};
const activeAuctionItems = new Set(); // Track which items are in active auctions
const scheduledAuctions = new Map(); // Track scheduled close timers
// Default item catalog with images
const DEFAULT_ITEMS = [
    { id: 'item-001', name: 'Lukisan Raden Saleh', description: 'Karya asli abad ke-19', starting_price: 500000000, image_url: '/images/painting.jpg' },
    { id: 'item-002', name: 'Jam Tangan Vintage Rolex', description: 'Seri 1965, kondisi prima', starting_price: 150000000, image_url: '/images/watch.jpg' },
    { id: 'item-003', name: 'Koin Kuno Majapahit', description: 'Koleksi langka', starting_price: 75000000, image_url: '/images/coin.jpg' },
];
async function getAvailableItems() {
    return new Promise((resolve, reject) => {
        clients_1.catalogClient.GetItems({}, (err, response) => {
            if (err) {
                console.log('[Scheduler] Using default items due to error:', err.message);
                // Fallback to default items if gRPC fails
                const available = DEFAULT_ITEMS.filter(item => !activeAuctionItems.has(item.id));
                return resolve(available);
            }
            const items = response?.items || [];
            const available = items.filter((item) => !activeAuctionItems.has(item.id));
            resolve(available);
        });
    });
}
async function createRandomAuction(mqttClient) {
    try {
        // Get available items (not in active auctions)
        const availableItems = await getAvailableItems();
        if (availableItems.length === 0) {
            console.log('[Scheduler] No available items. Waiting for next cycle...');
            return;
        }
        // Pick random item
        const randomItem = availableItems[Math.floor(Math.random() * availableItems.length)];
        // Create auction
        const auctionId = `auction-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        // Track item as active
        activeAuctionItems.add(randomItem.id);
        // Publish auction created event with full item info
        const auctionEvent = {
            auction_id: auctionId,
            item_id: randomItem.id,
            item_name: randomItem.name,
            image_url: randomItem.image_url || '/images/painting.jpg',
            status: 'AUCTION_OPENED',
            duration_seconds: config.auctionDurationSeconds,
            remaining_seconds: config.auctionDurationSeconds,
            created_at: new Date().toISOString(),
            created_by: 'scheduler',
        };
        mqttClient.publish(`system/auction_scheduler`, JSON.stringify(auctionEvent), { qos: 1, retain: false });
        console.log(`[Scheduler] Created auction: ${auctionId} for item: ${randomItem.name}`);
        // Schedule auto-close after duration
        const closeTimer = setTimeout(() => {
            activeAuctionItems.delete(randomItem.id);
            scheduledAuctions.delete(auctionId);
            // Publish auction closed event
            mqttClient.publish(`system/auction_scheduler`, JSON.stringify({
                auction_id: auctionId,
                status: 'AUCTION_CLOSED',
                closed_at: new Date().toISOString(),
                closed_by: 'scheduler',
            }), { qos: 1, retain: false });
            console.log(`[Scheduler] Auto-closed auction: ${auctionId}`);
        }, config.auctionDurationSeconds * 1000);
        scheduledAuctions.set(auctionId, closeTimer);
    }
    catch (error) {
        console.error('[Scheduler] Error creating auction:', error.message);
    }
}
function startAuctionScheduler(mqttClient) {
    console.log(`[Scheduler] Starting auction scheduler (interval: ${config.intervalSeconds}s)`);
    // Create first auction immediately
    createRandomAuction(mqttClient);
    // Then create new auctions at intervals
    setInterval(() => {
        createRandomAuction(mqttClient);
    }, config.intervalSeconds * 1000);
}
function getActiveAuctionCount() {
    return activeAuctionItems.size;
}
function getActiveAuctionItems() {
    return new Set(activeAuctionItems);
}
function stopAuctionScheduler() {
    // Clear all timers
    for (const timer of scheduledAuctions.values()) {
        clearTimeout(timer);
    }
    scheduledAuctions.clear();
    activeAuctionItems.clear();
    console.log('[Scheduler] Auction scheduler stopped');
}
