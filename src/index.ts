import { checkGrpcConnectivity, closeGrpcClients } from './grpc/clients';
import { startMqttGateway } from './mqtt/gateway';
import { startAuctionScheduler, stopAuctionScheduler } from './scheduler/auctionScheduler';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  await checkGrpcConnectivity();
  console.log('[bootstrap] gRPC connectivity check passed (Auth/Catalog/Bidding)');

  const mqttClient = startMqttGateway();
  console.log(`[bootstrap] MQTT Gateway initialized`);

  // Start auction scheduler
  startAuctionScheduler(mqttClient);
  console.log(`[bootstrap] Auction Scheduler started`);

  process.on('SIGINT', () => {
    console.log('\n[shutdown] Received SIGINT, closing services...');
    stopAuctionScheduler();
    mqttClient.end();
    closeGrpcClients();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[shutdown] Received SIGTERM, closing services...');
    stopAuctionScheduler();
    mqttClient.end();
    closeGrpcClients();
    process.exit(0);
  });
}

bootstrap().catch((err: Error) => {
  console.error('[bootstrap] Failed to start gateway:', err.message);
  closeGrpcClients();
  process.exit(1);
});
