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
exports.startWebSocketServer = startWebSocketServer;
const grpc = __importStar(require("@grpc/grpc-js"));
const ws_1 = require("ws");
const env_1 = require("../config/env");
const clients_1 = require("../grpc/clients");
const protocol_1 = require("./protocol");
function safeSend(client, event) {
    if (client.readyState !== ws_1.WebSocket.OPEN)
        return;
    const withVersion = {
        version: event.version || protocol_1.PROTOCOL_VERSION,
        type: event.type,
        payload: event.payload,
        timestamp: event.timestamp,
    };
    client.send(JSON.stringify(withVersion));
}
function sendResult(client, requestId, type, payload) {
    safeSend(client, {
        type,
        payload: {
            requestId: requestId ?? null,
            ok: true,
            data: payload,
        },
        timestamp: Date.now(),
    });
}
function sendError(client, requestId, message, details) {
    safeSend(client, {
        type: 'command.error',
        payload: {
            requestId: requestId ?? null,
            ok: false,
            message,
            details: details ?? null,
        },
        timestamp: Date.now(),
    });
}
function closeSessionStreams(session) {
    session.auctionStream?.cancel();
    session.catalogStream?.cancel();
    session.auctionStream = undefined;
    session.catalogStream = undefined;
}
function toMessage(err) {
    if (!err)
        return 'Unknown error';
    if (typeof err.message === 'string')
        return err.message;
    return String(err);
}
async function handleCommand(client, session, command) {
    const { type, requestId, payload = {} } = command;
    switch (type) {
        case 'auth.register': {
            const response = await (0, clients_1.unaryCall)(clients_1.authClient, 'Register', {
                username: payload.username,
                password: payload.password,
            });
            sendResult(client, requestId, 'auth.register.result', response);
            return;
        }
        case 'auth.login': {
            const response = await (0, clients_1.unaryCall)(clients_1.authClient, 'Login', {
                username: payload.username,
                password: payload.password,
            });
            sendResult(client, requestId, 'auth.login.result', response);
            return;
        }
        case 'catalog.get_items': {
            const response = await (0, clients_1.unaryCall)(clients_1.catalogClient, 'GetItems', {});
            sendResult(client, requestId, 'catalog.get_items.result', response);
            return;
        }
        case 'catalog.open_auction': {
            const response = await (0, clients_1.unaryCall)(clients_1.catalogClient, 'OpenAuction', {
                item_id: payload.item_id,
                duration_seconds: payload.duration_seconds,
            });
            sendResult(client, requestId, 'catalog.open_auction.result', response);
            return;
        }
        case 'stream.catalog.start': {
            session.catalogStream?.cancel();
            const stream = clients_1.catalogClient.MonitorAuctionFeed({});
            session.catalogStream = stream;
            stream.on('data', (event) => {
                safeSend(client, {
                    type: 'catalog.event',
                    payload: event,
                    timestamp: Date.now(),
                });
            });
            stream.on('error', (err) => {
                if (err?.code === grpc.status.CANCELLED)
                    return;
                sendError(client, requestId, 'Catalog stream error', { message: toMessage(err) });
            });
            stream.on('end', () => {
                safeSend(client, {
                    type: 'catalog.stream.ended',
                    payload: { message: 'Catalog stream ended' },
                    timestamp: Date.now(),
                });
            });
            sendResult(client, requestId, 'stream.catalog.started', { subscribed: true });
            return;
        }
        case 'stream.catalog.stop': {
            session.catalogStream?.cancel();
            session.catalogStream = undefined;
            sendResult(client, requestId, 'stream.catalog.stopped', { subscribed: false });
            return;
        }
        case 'auction.join': {
            const auctionId = String(payload.auction_id || '');
            const token = String(payload.token || '');
            if (!auctionId || !token) {
                throw new Error('auction_id and token are required');
            }
            session.auctionStream?.cancel();
            session.auctionId = auctionId;
            const stream = clients_1.biddingClient.SendUpdate({
                auction_id: auctionId,
                token,
            });
            session.auctionStream = stream;
            stream.on('data', (update) => {
                safeSend(client, {
                    type: 'auction.update',
                    payload: update,
                    timestamp: Date.now(),
                });
            });
            stream.on('error', (err) => {
                if (err?.code === grpc.status.CANCELLED)
                    return;
                sendError(client, requestId, 'Auction stream error', { message: toMessage(err), auction_id: auctionId });
            });
            stream.on('end', () => {
                safeSend(client, {
                    type: 'auction.stream.ended',
                    payload: { auction_id: auctionId },
                    timestamp: Date.now(),
                });
            });
            sendResult(client, requestId, 'auction.joined', { auction_id: auctionId });
            return;
        }
        case 'auction.leave': {
            const prevAuctionId = session.auctionId;
            session.auctionStream?.cancel();
            session.auctionStream = undefined;
            session.auctionId = undefined;
            sendResult(client, requestId, 'auction.left', { auction_id: prevAuctionId ?? null });
            return;
        }
        case 'auction.place_bid': {
            const response = await (0, clients_1.unaryCall)(clients_1.biddingClient, 'PlaceBid', {
                auction_id: payload.auction_id,
                bidder_name: payload.bidder_name,
                amount: Number(payload.amount),
                token: payload.token,
            });
            sendResult(client, requestId, 'auction.place_bid.result', response);
            return;
        }
        case 'auction.get_result': {
            const response = await (0, clients_1.unaryCall)(clients_1.biddingClient, 'GetAuctionResult', {
                auction_id: payload.auction_id,
            });
            sendResult(client, requestId, 'auction.get_result.result', response);
            return;
        }
        default:
            throw new Error(`Unknown command type: ${type}`);
    }
}
function startWebSocketServer() {
    const wss = new ws_1.WebSocketServer({ port: env_1.env.wsPort });
    const heartbeat = setInterval(() => {
        wss.clients.forEach((client) => {
            safeSend(client, {
                type: 'system.heartbeat',
                payload: { status: 'alive' },
                timestamp: Date.now(),
            });
        });
    }, 20000);
    wss.on('close', () => {
        clearInterval(heartbeat);
    });
    wss.on('connection', (client) => {
        const session = {};
        const welcomeEvent = {
            type: 'system.connected',
            payload: {
                message: 'Connected to BidStream WebSocket Gateway',
                availableCommands: protocol_1.AVAILABLE_COMMANDS,
            },
            timestamp: Date.now(),
        };
        safeSend(client, welcomeEvent);
        client.on('message', async (raw) => {
            let parsed;
            try {
                parsed = JSON.parse(raw.toString());
            }
            catch {
                sendError(client, undefined, 'Invalid JSON payload');
                return;
            }
            const validated = (0, protocol_1.validateCommand)(parsed);
            if (!validated.ok) {
                sendError(client, parsed?.requestId, validated.message);
                return;
            }
            try {
                await handleCommand(client, session, validated.command);
            }
            catch (err) {
                sendError(client, validated.command.requestId, toMessage(err), {
                    grpcCode: err?.code ?? null,
                });
            }
        });
        client.on('close', () => {
            closeSessionStreams(session);
        });
        client.on('error', () => {
            closeSessionStreams(session);
        });
    });
    return wss;
}
