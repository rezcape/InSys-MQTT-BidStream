"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.startMqttGateway = startMqttGateway;
const mqtt = __importStar(require("mqtt"));
const grpc = __importStar(require("@grpc/grpc-js"));
const clients_1 = require("../grpc/clients");
// Map of active auction streams
const activeAuctionStreams = new Map();
let catalogStream;
const TOPIC_ALIAS = {
    SYSTEM_STATUS: 1,
    CATALOG_EVENTS: 2,
    SYSTEM_ANNOUNCEMENT: 3,
};
function toBuffer(value) {
    if (Buffer.isBuffer(value)) {
        return value;
    }
    if (typeof value === 'string') {
        return Buffer.from(value);
    }
    if (value instanceof Uint8Array) {
        return Buffer.from(value);
    }
    return Buffer.from(String(value ?? ''));
}
function publishJson(client, topic, payload, options = {}) {
    client.publish(topic, JSON.stringify(payload), {
        qos: options.qos ?? 1,
        retain: options.retain ?? false,
        properties: options.properties,
    });
}
function publishReply(client, replyTopics, payload, packet) {
    const uniqueTopics = [...new Set(replyTopics.filter(Boolean))];
    const correlationData = packet?.properties?.correlationData;
    const responseProperties = {
        correlationData: correlationData ? toBuffer(correlationData) : undefined,
        userProperties: {
            response_from: 'mqtt-gateway',
        },
        messageExpiryInterval: 60,
    };
    for (const topic of uniqueTopics) {
        client.publish(topic, JSON.stringify(payload), {
            qos: 1,
            retain: false,
            properties: responseProperties,
        });
    }
}
function startMqttGateway() {
    const brokerUrl = 'mqtt://broker.hivemq.com:1883';
    console.log(`[MQTT Gateway] Connecting to ${brokerUrl}...`);
    const client = mqtt.connect(brokerUrl, {
        protocolVersion: 5,
        reconnectPeriod: 3000,
        clean: true,
        properties: {
            sessionExpiryInterval: 60,
            receiveMaximum: 20,
        },
        will: {
            topic: 'system/status',
            payload: JSON.stringify({
                status: 'offline',
                role: 'gateway',
                message: 'Gateway disconnected unexpectedly',
            }),
            qos: 1,
            retain: true,
            properties: {
                userProperties: {
                    role: 'gateway',
                    state: 'offline',
                },
                messageExpiryInterval: 120,
            },
        },
    });
    client.on('connect', () => {
        console.log('[MQTT Gateway] Connected to HiveMQ Broker.');
        publishJson(client, 'system/status', {
            status: 'online',
            role: 'gateway',
            message: 'Gateway connected successfully',
        }, {
            qos: 1,
            retain: true,
            properties: {
                topicAlias: TOPIC_ALIAS.SYSTEM_STATUS,
                userProperties: {
                    role: 'gateway',
                    state: 'online',
                },
            },
        });
        // Subscribe to all incoming commands from clients
        client.subscribe('client/+/command/+', { qos: 1 }, (err) => {
            if (err) {
                console.error('[MQTT Gateway] Failed to subscribe to commands:', err);
            }
            else {
                console.log('[MQTT Gateway] Subscribed to client/+/command/+');
            }
        });
        // Start catalog stream immediately upon connection to broadcast catalog events
        startCatalogStream(client);
    });
    client.on('message', async (topic, message, packet) => {
        // Topic format: client/{clientId}/command/{commandName}
        const topicParts = topic.split('/');
        if (topicParts.length !== 4 || topicParts[0] !== 'client' || topicParts[2] !== 'command') {
            return;
        }
        const clientId = topicParts[1];
        const commandName = topicParts[3];
        const replyTopic = `client/${clientId}/result/${commandName}`;
        let payload = {};
        try {
            payload = JSON.parse(message.toString());
        }
        catch (e) {
            publishReply(client, [
                packet?.properties?.responseTopic ? String(packet.properties.responseTopic) : '',
                `client/${clientId}/error`,
            ], { error: 'Invalid JSON payload', command: commandName }, packet);
            return;
        }
        try {
            const responseTopic = packet?.properties?.responseTopic ? String(packet.properties.responseTopic) : replyTopic;
            await handleCommand(client, clientId, commandName, payload, replyTopic, responseTopic, packet);
        }
        catch (err) {
            console.error(`[MQTT Gateway] Error handling ${commandName}:`, err.message);
            publishReply(client, [
                packet?.properties?.responseTopic ? String(packet.properties.responseTopic) : '',
                `client/${clientId}/error`,
            ], {
                command: commandName,
                error: err.message || 'Unknown error',
            }, packet);
        }
    });
    return client;
}
async function handleCommand(client, clientId, commandName, payload, replyTopic, responseTopic, packet) {
    switch (commandName) {
        case 'register': {
            const response = await (0, clients_1.unaryCall)(clients_1.authClient, 'Register', {
                username: payload.username,
                password: payload.password,
            });
            publishReply(client, [replyTopic, responseTopic], response, packet);
            break;
        }
        case 'login': {
            const response = await (0, clients_1.unaryCall)(clients_1.authClient, 'Login', {
                username: payload.username,
                password: payload.password,
            });
            publishReply(client, [replyTopic, responseTopic], response, packet);
            break;
        }
        case 'get_items': {
            const response = await (0, clients_1.unaryCall)(clients_1.catalogClient, 'GetItems', {});
            publishReply(client, [replyTopic, responseTopic], response, packet);
            break;
        }
        case 'add_item': {
            const response = await (0, clients_1.unaryCall)(clients_1.catalogClient, 'AddItem', {
                name: payload.name,
                description: payload.description,
                starting_price: Number(payload.starting_price),
                owner: payload.owner,
                image_url: payload.image_url,
            });
            publishReply(client, [replyTopic, responseTopic], response, packet);
            break;
        }
        case 'create_auction': {
            const itemResponse = await (0, clients_1.unaryCall)(clients_1.catalogClient, 'AddItem', {
                name: payload.name,
                description: payload.description,
                starting_price: Number(payload.starting_price),
                owner: payload.owner,
                image_url: payload.image_url,
            });
            const auctionResponse = await (0, clients_1.unaryCall)(clients_1.catalogClient, 'OpenAuction', {
                item_id: itemResponse.item_id,
                duration_seconds: payload.duration_seconds,
            });
            publishReply(client, [replyTopic, responseTopic], {
                success: true,
                item_id: itemResponse.item_id,
                auction_id: auctionResponse.auction_id,
                message: auctionResponse.message,
                item: {
                    id: itemResponse.item_id,
                    name: payload.name,
                    description: payload.description,
                    starting_price: Number(payload.starting_price),
                    owner: payload.owner,
                    image_url: payload.image_url,
                },
            }, packet);
            startAuctionStream(client, auctionResponse.auction_id || itemResponse.item_id, payload.token);
            break;
        }
        case 'open_auction': {
            const response = await (0, clients_1.unaryCall)(clients_1.catalogClient, 'OpenAuction', {
                item_id: payload.item_id,
                duration_seconds: payload.duration_seconds,
            });
            publishReply(client, [replyTopic, responseTopic], response, packet);
            // Start auction stream automatically when opened
            startAuctionStream(client, response.auction_id || payload.item_id, payload.token);
            break;
        }
        case 'join_auction': {
            const auctionId = payload.auction_id;
            if (!activeAuctionStreams.has(auctionId)) {
                startAuctionStream(client, auctionId, payload.token);
            }
            publishReply(client, [replyTopic, responseTopic], { success: true, auction_id: auctionId }, packet);
            break;
        }
        case 'place_bid': {
            const response = await (0, clients_1.unaryCall)(clients_1.biddingClient, 'PlaceBid', {
                auction_id: payload.auction_id,
                bidder_name: payload.bidder_name,
                amount: Number(payload.amount),
                token: payload.token,
            });
            publishReply(client, [replyTopic, responseTopic], response, packet);
            break;
        }
        default:
            console.log(`[MQTT Gateway] Unknown command: ${commandName}`);
    }
}
function startCatalogStream(client) {
    if (catalogStream)
        catalogStream.cancel();
    const stream = clients_1.catalogClient.MonitorAuctionFeed({});
    catalogStream = stream;
    stream.on('data', (event) => {
        // Publish catalog events
        publishJson(client, 'catalog/events', event, {
            qos: 1,
            retain: false,
            properties: {
                topicAlias: TOPIC_ALIAS.CATALOG_EVENTS,
                userProperties: {
                    source: 'catalog-service',
                },
            },
        });
        // Also publish status as a retained message if auction opened/closed
        if (event.event_type === 'AUCTION_OPENED' || event.event_type === 'AUCTION_CLOSED') {
            const statusTopic = `auction/item/${event.auction_id}/status`;
            publishJson(client, statusTopic, { status: event.event_type }, {
                qos: 1,
                retain: true,
                properties: {
                    userProperties: {
                        source: 'catalog-service',
                    },
                },
            });
        }
    });
    stream.on('error', (err) => {
        if (err?.code === grpc.status.CANCELLED)
            return;
        console.error('[MQTT Gateway] Catalog stream error:', err.message);
    });
}
function startAuctionStream(client, auctionId, token) {
    if (activeAuctionStreams.has(auctionId))
        return;
    const stream = clients_1.biddingClient.SendUpdate({
        auction_id: auctionId,
        token: token || '',
    });
    activeAuctionStreams.set(auctionId, stream);
    stream.on('data', (update) => {
        // Broadcast all updates to the events stream
        publishJson(client, `auction/item/${auctionId}/events`, update, {
            qos: 1,
            retain: false,
            properties: {
                userProperties: {
                    source: 'bidding-service',
                },
            },
        });
        // Broadcast the highest bid specifically with retain so new joiners see it instantly
        if (update.highest_amount !== undefined) {
            publishJson(client, `auction/item/${auctionId}/bid/highest`, {
                bidder: update.highest_bidder,
                amount: update.highest_amount,
                remaining_seconds: update.remaining_seconds
            }, {
                qos: 1,
                retain: true,
                properties: {
                    userProperties: {
                        source: 'bidding-service',
                    },
                },
            });
        }
        if (update.event_type === 'AUCTION_CLOSED') {
            publishJson(client, `auction/item/${auctionId}/status`, { status: 'CLOSED' }, {
                qos: 1,
                retain: true,
                properties: {
                    userProperties: {
                        source: 'bidding-service',
                    },
                },
            });
            activeAuctionStreams.delete(auctionId);
            stream.cancel();
        }
    });
    stream.on('error', (err) => {
        if (err?.code === grpc.status.CANCELLED)
            return;
        console.error(`[MQTT Gateway] Auction stream ${auctionId} error:`, err.message);
        activeAuctionStreams.delete(auctionId);
    });
}
