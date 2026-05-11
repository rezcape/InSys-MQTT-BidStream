"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const clients_1 = require("./grpc/clients");
const gateway_1 = require("./mqtt/gateway");
const auctionScheduler_1 = require("./scheduler/auctionScheduler");
async function bootstrap() {
    await (0, clients_1.checkGrpcConnectivity)();
    console.log('[bootstrap] gRPC connectivity check passed (Auth/Catalog/Bidding)');
    const mqttClient = (0, gateway_1.startMqttGateway)();
    console.log(`[bootstrap] MQTT Gateway initialized`);
    // Start auction scheduler
    (0, auctionScheduler_1.startAuctionScheduler)(mqttClient);
    console.log(`[bootstrap] Auction Scheduler started`);
    process.on('SIGINT', () => {
        console.log('\n[shutdown] Received SIGINT, closing services...');
        (0, auctionScheduler_1.stopAuctionScheduler)();
        mqttClient.end();
        (0, clients_1.closeGrpcClients)();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        console.log('\n[shutdown] Received SIGTERM, closing services...');
        (0, auctionScheduler_1.stopAuctionScheduler)();
        mqttClient.end();
        (0, clients_1.closeGrpcClients)();
        process.exit(0);
    });
}
bootstrap().catch((err) => {
    console.error('[bootstrap] Failed to start gateway:', err.message);
    (0, clients_1.closeGrpcClients)();
    process.exit(1);
});
