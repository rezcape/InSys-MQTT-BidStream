import * as mqtt from 'mqtt';
import * as grpc from '@grpc/grpc-js';
import { authClient, biddingClient, catalogClient, unaryCall } from '../grpc/clients';

// Map of active auction streams
const activeAuctionStreams = new Map<string, grpc.ClientReadableStream<any>>();
let catalogStream: grpc.ClientReadableStream<any> | undefined;

export function startMqttGateway() {
  const brokerUrl = 'mqtt://broker.hivemq.com:1883';
  console.log(`[MQTT Gateway] Connecting to ${brokerUrl}...`);
  const client = mqtt.connect(brokerUrl);

  client.on('connect', () => {
    console.log('[MQTT Gateway] Connected to HiveMQ Broker.');
    // Subscribe to all incoming commands from clients
    client.subscribe('client/+/command/+', (err) => {
      if (err) {
        console.error('[MQTT Gateway] Failed to subscribe to commands:', err);
      } else {
        console.log('[MQTT Gateway] Subscribed to client/+/command/+');
      }
    });

    // Start catalog stream immediately upon connection to broadcast catalog events
    startCatalogStream(client);
  });

  client.on('message', async (topic, message) => {
    // Topic format: client/{clientId}/command/{commandName}
    const topicParts = topic.split('/');
    if (topicParts.length !== 4 || topicParts[0] !== 'client' || topicParts[2] !== 'command') {
      return;
    }

    const clientId = topicParts[1];
    const commandName = topicParts[3];
    const replyTopic = `client/${clientId}/result/${commandName}`;

    let payload: any = {};
    try {
      payload = JSON.parse(message.toString());
    } catch (e) {
      client.publish(`client/${clientId}/error`, JSON.stringify({ error: 'Invalid JSON payload' }));
      return;
    }

    try {
      await handleCommand(client, clientId, commandName, payload, replyTopic);
    } catch (err: any) {
      console.error(`[MQTT Gateway] Error handling ${commandName}:`, err.message);
      client.publish(`client/${clientId}/error`, JSON.stringify({ 
        command: commandName, 
        error: err.message || 'Unknown error' 
      }));
    }
  });

  return client;
}

async function handleCommand(
  client: mqtt.MqttClient, 
  clientId: string, 
  commandName: string, 
  payload: any, 
  replyTopic: string
) {
  switch (commandName) {
    case 'register': {
      const response = await unaryCall(authClient, 'Register', {
        username: payload.username,
        password: payload.password,
      });
      client.publish(replyTopic, JSON.stringify(response));
      break;
    }
    case 'login': {
      const response = await unaryCall(authClient, 'Login', {
        username: payload.username,
        password: payload.password,
      });
      client.publish(replyTopic, JSON.stringify(response));
      break;
    }
    case 'get_items': {
      const response = await unaryCall(catalogClient, 'GetItems', {});
      client.publish(replyTopic, JSON.stringify(response));
      break;
    }
    case 'open_auction': {
      const response = await unaryCall(catalogClient, 'OpenAuction', {
        item_id: payload.item_id,
        duration_seconds: payload.duration_seconds,
      });
      client.publish(replyTopic, JSON.stringify(response));
      // Start auction stream automatically when opened
      startAuctionStream(client, payload.item_id, payload.token);
      break;
    }
    case 'join_auction': {
      const auctionId = payload.auction_id;
      if (!activeAuctionStreams.has(auctionId)) {
        startAuctionStream(client, auctionId, payload.token);
      }
      client.publish(replyTopic, JSON.stringify({ success: true, auction_id: auctionId }));
      break;
    }
    case 'place_bid': {
      const response = await unaryCall(biddingClient, 'PlaceBid', {
        auction_id: payload.auction_id,
        bidder_name: payload.bidder_name,
        amount: Number(payload.amount),
        token: payload.token,
      });
      client.publish(replyTopic, JSON.stringify(response));
      break;
    }
    default:
      console.log(`[MQTT Gateway] Unknown command: ${commandName}`);
  }
}

function startCatalogStream(client: mqtt.MqttClient) {
  if (catalogStream) catalogStream.cancel();

  const stream = catalogClient.MonitorAuctionFeed({});
  catalogStream = stream;
  
  stream.on('data', (event: any) => {
    // Publish catalog events
    client.publish('catalog/events', JSON.stringify(event));
    
    // Also publish status as a retained message if auction opened/closed
    if (event.event_type === 'AUCTION_OPENED' || event.event_type === 'AUCTION_CLOSED') {
      const statusTopic = `auction/item/${event.auction_id}/status`;
      client.publish(statusTopic, JSON.stringify({ status: event.event_type }), { retain: true });
    }
  });

  stream.on('error', (err: any) => {
    if (err?.code === grpc.status.CANCELLED) return;
    console.error('[MQTT Gateway] Catalog stream error:', err.message);
  });
}

function startAuctionStream(client: mqtt.MqttClient, auctionId: string, token: string) {
  if (activeAuctionStreams.has(auctionId)) return;

  const stream = biddingClient.SendUpdate({
    auction_id: auctionId,
    token: token || '',
  });

  activeAuctionStreams.set(auctionId, stream);

  stream.on('data', (update: any) => {
    // Broadcast all updates to the events stream
    client.publish(`auction/item/${auctionId}/events`, JSON.stringify(update));
    
    // Broadcast the highest bid specifically with retain so new joiners see it instantly
    if (update.highest_amount !== undefined) {
      client.publish(`auction/item/${auctionId}/bid/highest`, JSON.stringify({
        bidder: update.highest_bidder,
        amount: update.highest_amount,
        remaining_seconds: update.remaining_seconds
      }), { retain: true });
    }

    if (update.event_type === 'AUCTION_CLOSED') {
      client.publish(`auction/item/${auctionId}/status`, JSON.stringify({ status: 'CLOSED' }), { retain: true });
      activeAuctionStreams.delete(auctionId);
      stream.cancel();
    }
  });

  stream.on('error', (err: any) => {
    if (err?.code === grpc.status.CANCELLED) return;
    console.error(`[MQTT Gateway] Auction stream ${auctionId} error:`, err.message);
    activeAuctionStreams.delete(auctionId);
  });
}
