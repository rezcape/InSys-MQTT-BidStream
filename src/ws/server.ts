import * as grpc from '@grpc/grpc-js';
import { WebSocketServer, WebSocket } from 'ws';
import { env } from '../config/env';
import { authClient, biddingClient, catalogClient, unaryCall } from '../grpc/clients';
import { AVAILABLE_COMMANDS, GatewayCommand, PROTOCOL_VERSION, validateCommand } from './protocol';

export interface GatewayEvent {
  version: string;
  type: string;
  payload: unknown;
  timestamp: number;
}

interface ClientSession {
  auctionId?: string;
  auctionStream?: grpc.ClientReadableStream<any>;
  catalogStream?: grpc.ClientReadableStream<any>;
}

function safeSend(client: WebSocket, event: Omit<GatewayEvent, 'version'> | GatewayEvent): void {
  if (client.readyState !== WebSocket.OPEN) return;
  const withVersion: GatewayEvent = {
    version: (event as GatewayEvent).version || PROTOCOL_VERSION,
    type: event.type,
    payload: event.payload,
    timestamp: event.timestamp,
  };
  client.send(JSON.stringify(withVersion));
}

function sendResult(client: WebSocket, requestId: string | undefined, type: string, payload: unknown): void {
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

function sendError(client: WebSocket, requestId: string | undefined, message: string, details?: unknown): void {
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

function closeSessionStreams(session: ClientSession): void {
  session.auctionStream?.cancel();
  session.catalogStream?.cancel();
  session.auctionStream = undefined;
  session.catalogStream = undefined;
}

function toMessage(err: any): string {
  if (!err) return 'Unknown error';
  if (typeof err.message === 'string') return err.message;
  return String(err);
}

async function handleCommand(
  client: WebSocket,
  session: ClientSession,
  command: GatewayCommand
): Promise<void> {
  const { type, requestId, payload = {} } = command;

  switch (type) {
    case 'auth.register': {
      const response = await unaryCall(authClient, 'Register', {
        username: payload.username,
        password: payload.password,
      });
      sendResult(client, requestId, 'auth.register.result', response);
      return;
    }

    case 'auth.login': {
      const response = await unaryCall(authClient, 'Login', {
        username: payload.username,
        password: payload.password,
      });
      sendResult(client, requestId, 'auth.login.result', response);
      return;
    }

    case 'catalog.get_items': {
      const response = await unaryCall(catalogClient, 'GetItems', {});
      sendResult(client, requestId, 'catalog.get_items.result', response);
      return;
    }

    case 'catalog.open_auction': {
      const response = await unaryCall(catalogClient, 'OpenAuction', {
        item_id: payload.item_id,
        duration_seconds: payload.duration_seconds,
      });
      sendResult(client, requestId, 'catalog.open_auction.result', response);
      return;
    }

    case 'stream.catalog.start': {
      session.catalogStream?.cancel();

      const stream = catalogClient.MonitorAuctionFeed({});
      session.catalogStream = stream;

      stream.on('data', (event: any) => {
        safeSend(client, {
          type: 'catalog.event',
          payload: event,
          timestamp: Date.now(),
        });
      });

      stream.on('error', (err: any) => {
        if (err?.code === grpc.status.CANCELLED) return;
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

      const stream = biddingClient.SendUpdate({
        auction_id: auctionId,
        token,
      });
      session.auctionStream = stream;

      stream.on('data', (update: any) => {
        safeSend(client, {
          type: 'auction.update',
          payload: update,
          timestamp: Date.now(),
        });
      });

      stream.on('error', (err: any) => {
        if (err?.code === grpc.status.CANCELLED) return;
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
      const response = await unaryCall(biddingClient, 'PlaceBid', {
        auction_id: payload.auction_id,
        bidder_name: payload.bidder_name,
        amount: Number(payload.amount),
        token: payload.token,
      });
      sendResult(client, requestId, 'auction.place_bid.result', response);
      return;
    }

    case 'auction.get_result': {
      const response = await unaryCall(biddingClient, 'GetAuctionResult', {
        auction_id: payload.auction_id,
      });
      sendResult(client, requestId, 'auction.get_result.result', response);
      return;
    }

    default:
      throw new Error(`Unknown command type: ${type}`);
  }
}

export function startWebSocketServer(): WebSocketServer {
  const wss = new WebSocketServer({ port: env.wsPort });

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
    const session: ClientSession = {};

    const welcomeEvent = {
      type: 'system.connected',
      payload: {
        message: 'Connected to BidStream WebSocket Gateway',
        availableCommands: AVAILABLE_COMMANDS,
      },
      timestamp: Date.now(),
    };

    safeSend(client, welcomeEvent);

    client.on('message', async (raw) => {
      let parsed: GatewayCommand;
      try {
        parsed = JSON.parse(raw.toString()) as GatewayCommand;
      } catch {
        sendError(client, undefined, 'Invalid JSON payload');
        return;
      }

      const validated = validateCommand(parsed);
      if (!validated.ok) {
        sendError(client, parsed?.requestId, validated.message);
        return;
      }

      try {
        await handleCommand(client, session, validated.command);
      } catch (err: any) {
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
