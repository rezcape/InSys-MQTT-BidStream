const WebSocket = require('ws');

const URL = process.env.WS_URL || 'ws://localhost:8080';

function randomUser(prefix = 'ws_smoke') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function openSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitFor(ws, predicate, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout waiting expected websocket event'));
    }, timeoutMs);

    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (predicate(msg)) {
        cleanup();
        resolve(msg);
      }
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };

    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

function send(ws, message) {
  ws.send(JSON.stringify(message));
}

function hasV1Envelope(msg) {
  return msg && msg.version === 'v1' && typeof msg.type === 'string';
}

async function main() {
  const ws = await openSocket();
  const username = randomUser();
  const password = 'pass123';

  console.log('[smoke] Connected:', URL);

  const connected = await waitFor(ws, (m) => m.type === 'system.connected');
  assert(hasV1Envelope(connected), 'system.connected missing v1 envelope');
  assert(Array.isArray(connected.payload?.availableCommands), 'system.connected missing availableCommands');

  send(ws, { type: 'auth.register', requestId: 'r1', payload: { username, password } });
  const registerRes = await waitFor(ws, (m) => m.type === 'auth.register.result' && m.payload?.requestId === 'r1');
  assert(registerRes.payload?.ok === true, 'auth.register did not return ok=true');

  send(ws, { type: 'auth.login', requestId: 'r2', payload: { username, password } });
  const loginRes = await waitFor(ws, (m) => m.type === 'auth.login.result' && m.payload?.requestId === 'r2');
  assert(hasV1Envelope(loginRes), 'auth.login.result missing v1 envelope');
  const token = loginRes.payload?.data?.token;
  assert(typeof token === 'string' && token.length > 10, 'auth.login token missing');

  send(ws, { type: 'catalog.get_items', requestId: 'r3', payload: {} });
  const itemsRes = await waitFor(ws, (m) => m.type === 'catalog.get_items.result' && m.payload?.requestId === 'r3');
  const items = itemsRes.payload?.data?.items || [];
  assert(items.length > 0, 'catalog.get_items returned no items');

  const itemId = items[0].id;
  send(ws, {
    type: 'catalog.open_auction',
    requestId: 'r4',
    payload: { item_id: itemId, duration_seconds: 8 },
  });
  const openRes = await waitFor(ws, (m) => m.type === 'catalog.open_auction.result' && m.payload?.requestId === 'r4');
  const auctionId = openRes.payload?.data?.auction_id;
  assert(typeof auctionId === 'string' && auctionId.length > 10, 'catalog.open_auction auction_id missing');

  send(ws, { type: 'auction.join', requestId: 'r5', payload: { auction_id: auctionId, token } });
  const joinRes = await waitFor(ws, (m) => m.type === 'auction.joined' && m.payload?.requestId === 'r5');
  assert(joinRes.payload?.ok === true, 'auction.join did not return ok=true');

  const snapshot = await waitFor(ws, (m) => m.type === 'auction.update');
  assert(hasV1Envelope(snapshot), 'auction.update missing v1 envelope');
  assert(snapshot.payload?.event_type, 'auction.update missing event_type');
  const currentHighest = Number(snapshot.payload?.highest_amount || 0);
  const lowBidAmount = currentHighest + 1;

  // Error scenario: bid too low from gRPC business rule
  send(ws, {
    type: 'auction.place_bid',
    requestId: 'e0',
    payload: { auction_id: auctionId, bidder_name: username, amount: lowBidAmount, token },
  });
  const lowBidErr = await waitFor(ws, (m) => m.type === 'command.error' && m.payload?.requestId === 'e0');
  assert(
    String(lowBidErr.payload?.message || '').toLowerCase().includes('minimum next bid'),
    'Expected low bid business-rule error'
  );

  // Error scenario: invalid bid amount caught by gateway validation
  send(ws, {
    type: 'auction.place_bid',
    requestId: 'e1',
    payload: { auction_id: auctionId, bidder_name: username, amount: 0, token },
  });
  const invalidAmountErr = await waitFor(
    ws,
    (m) => m.type === 'command.error' && m.payload?.requestId === 'e1'
  );
  assert(
    String(invalidAmountErr.payload?.message || '').includes('amount must be a positive number'),
    'Expected positive amount validation error'
  );

  // Error scenario: invalid token from gRPC layer (isolated socket so main stream remains active)
  const wsInvalid = await openSocket();
  await waitFor(wsInvalid, (m) => m.type === 'system.connected');
  send(wsInvalid, {
    type: 'auction.join',
    requestId: 'e2',
    payload: { auction_id: auctionId, token: 'invalid-token' },
  });
  await waitFor(
    wsInvalid,
    (m) => m.type === 'command.error' && m.payload?.requestId === 'e2'
  );
  wsInvalid.close();

  // Wait until auction is closed, then verify further bid is rejected.
  await waitFor(
    ws,
    (m) => m.type === 'auction.update' && m.payload?.event_type === 'AUCTION_CLOSED',
    15000
  );

  send(ws, {
    type: 'auction.place_bid',
    requestId: 'e3',
    payload: { auction_id: auctionId, bidder_name: username, amount: 700000000, token },
  });
  const closedErr = await waitFor(ws, (m) => m.type === 'command.error' && m.payload?.requestId === 'e3');
  assert(
    String(closedErr.payload?.message || '').toLowerCase().includes('closed'),
    'Expected closed auction error after AUCTION_CLOSED event'
  );

  ws.close();
  console.log('[smoke] PASS');
}

main().catch((err) => {
  console.error('[smoke] FAIL:', err.message);
  process.exit(1);
});
