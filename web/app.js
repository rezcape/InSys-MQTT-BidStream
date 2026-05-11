const BROKER_URL = 'ws://broker.hivemq.com:8000/mqtt';
const reconnectDelay = 3000;
const commandPassword = 'password123';
const correlationEncoder = new TextEncoder();

const randomSuffix = Math.random().toString(16).slice(2, 8);
const demoUser = `user_${Date.now().toString().slice(-6)}_${randomSuffix}`;
const clientId = `person2_${demoUser}_${randomSuffix}`;

let mqttClient = null;
let activeAuctionId = localStorage.getItem('sync_auction_id') || '';
let fetchedItemId = '';
let token = '';
let countdownInterval = null;
let lastRemainingSeconds = null;
const pendingRequests = new Map();
const responseTopic = `client/${demoUser}/response`;

const dom = {
  connStatus: document.getElementById('conn-status'),
  auctionState: document.getElementById('auction-state'),
  auctionTimer: document.getElementById('auction-timer'),
  highestAmount: document.getElementById('highest-amount'),
  highestBidder: document.getElementById('highest-bidder'),
  eventLog: document.getElementById('event-log'),
  adminAnnounce: document.getElementById('admin-announce'),
  
  btnOpen: document.getElementById('btn-open'),
  joinAuctionId: document.getElementById('join-auction-id'),
  btnJoin: document.getElementById('btn-join'),
  bidAmount: document.getElementById('bid-amount'),
  btnBid: document.getElementById('btn-bid'),
  btnAdminAnnounce: document.getElementById('btn-admin-announce'),
  commandResponse: document.getElementById('command-response')
};

function startVisualCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);

  if (!Number.isFinite(lastRemainingSeconds) || lastRemainingSeconds < 0) {
    if (dom.auctionTimer) {
      dom.auctionTimer.textContent = '--:--';
    }
    return;
  }

  let remaining = Math.floor(lastRemainingSeconds);

  const renderRemaining = () => {
    const m = Math.floor(remaining / 60).toString().padStart(2, '0');
    const s = (remaining % 60).toString().padStart(2, '0');
    dom.auctionTimer.textContent = `${m}:${s}`;
  };

  renderRemaining();

  countdownInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      remaining = 0;
    }

    renderRemaining();
  }, 1000);
}

function stopVisualCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  if (dom.auctionTimer) dom.auctionTimer.textContent = '00:00';
  lastRemainingSeconds = null;
}

function formatRupiah(amount) {
  return `Rp${Number(amount || 0).toLocaleString('id-ID')}`;
}

function showResponseStatus(message, isError = false) {
  dom.commandResponse.style.color = isError ? '#ca0032' : '#00ca65';
  dom.commandResponse.textContent = message;
  setTimeout(() => { dom.commandResponse.textContent = ''; }, 4000);
}

function setConnectionStatus(message, isConnected) {
  if (!dom.connStatus) {
    return;
  }

  dom.connStatus.textContent = message;
  dom.connStatus.className = `status-conn ${isConnected ? 'connected' : 'disconnected'}`;
}

function ensureAuctionContext(auctionId) {
  if (!auctionId) {
    return;
  }

  activeAuctionId = auctionId;
  dom.joinAuctionId.value = auctionId;
  localStorage.setItem('sync_auction_id', auctionId);
}

function updateRemainingSeconds(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return;
  }

  lastRemainingSeconds = Math.max(0, Math.floor(numericValue));
  startVisualCountdown();
}

function summarizeAuctionEvent(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'Unknown auction event';
  }

  const parts = [];
  if (payload.event_type) {
    parts.push(String(payload.event_type));
  }
  if (payload.highest_bidder !== undefined) {
    parts.push(`bidder=${payload.highest_bidder || 'Anonymous'}`);
  }
  if (payload.highest_amount !== undefined) {
    parts.push(`amount=${formatRupiah(payload.highest_amount)}`);
  }
  if (payload.remaining_seconds !== undefined) {
    parts.push(`remaining=${payload.remaining_seconds}s`);
  }

  return parts.length > 0 ? parts.join(' | ') : JSON.stringify(payload);
}

function publishCommand(action, payload = {}, options = {}) {
  if (!mqttClient || !mqttClient.connected) {
    showResponseStatus('Broker MQTT belum terhubung.', true);
    return false;
  }

  const topic = `client/${demoUser}/command/${action}`;
  const message = JSON.stringify(payload);
  const correlationId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  pendingRequests.set(correlationId, {
    action,
    createdAt: Date.now(),
  });

  mqttClient.publish(topic, message, {
    qos: 1,
    retain: false,
    properties: {
      responseTopic,
      correlationData: correlationEncoder.encode(correlationId),
      userProperties: {
        role: 'browser',
        action,
        client_id: clientId,
      },
    },
  }, (err) => {
    if (err) {
      pendingRequests.delete(correlationId);
      showResponseStatus(`Publish gagal: ${err.message}`, true);
      logActivity(`ERROR: gagal publish ${action} -> ${err.message}`);
      return;
    }

    if (!options.silent) {
      showResponseStatus(`Sent: ${action}`);
    }
  });

  return true;
}

function logActivity(message) {
  const li = document.createElement('li');
  const timestamp = new Date().toLocaleTimeString();
  li.textContent = `[${timestamp}] ${message}`;
  
  dom.eventLog.appendChild(li);
  dom.eventLog.scrollTop = dom.eventLog.scrollHeight;
  while (dom.eventLog.children.length > 50) {
    dom.eventLog.removeChild(dom.eventLog.firstChild);
  }
}

function setAuctionState(state) {
  const stateStr = String(state).toUpperCase();
  dom.auctionState.textContent = stateStr;
  dom.auctionState.className = `state ${stateStr.toLowerCase()}`;

  if (stateStr === 'OPEN') {
    if (Number.isFinite(lastRemainingSeconds)) {
      startVisualCountdown();
    }
  } else if (stateStr === 'CLOSED' || stateStr === 'WAITING') {
    stopVisualCountdown();
  }
}

function subscribeToTopics() {
  if (!mqttClient) {
    return;
  }

  const topics = [
    'auction/item/+/status',
    'auction/item/+/bid/highest',
    '$share/monitoring/auction/item/+/events',
    'system/announcement',
    'system/status',
    responseTopic,
    `client/${demoUser}/error`
  ];

  mqttClient.subscribe(topics, { qos: 1 }, (err) => {
    if (err) {
      logActivity(`ERROR: subscribe gagal -> ${err.message}`);
      showResponseStatus(`Subscribe gagal: ${err.message}`, true);
      return;
    }

    logActivity('System: Subscribed to auction and command result topics.');
  });
}

function extractPayload(rawMessage) {
  const text = rawMessage.toString();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function handleCommandResponse(commandName, payload) {

  switch (commandName) {
    case 'register':
      if (payload && payload.success) {
        logActivity(`AUTH: register sukses untuk ${demoUser}`);
      }
      break;

    case 'login':
      if (payload && payload.token) {
        token = payload.token;
      } else if (payload && payload.data && payload.data.token) {
        token = payload.data.token;
      }

      if (token) {
        logActivity(`AUTH: login sukses, token aktif untuk ${demoUser}`);
      }
      break;

    case 'get_items': {
      const items = payload?.items || payload?.data?.items || [];
      if (Array.isArray(items) && items.length > 0) {
        fetchedItemId = items[0].id;
        logActivity(`CATALOG: item tersedia, default auction item = ${fetchedItemId}`);
      }
      break;
    }

    case 'open_auction': {
      const auctionId = payload?.auction_id || payload?.data?.auction_id;
      if (auctionId) {
        ensureAuctionContext(auctionId);
        setAuctionState('OPEN');
        logActivity(`AUCTION: opened -> ${auctionId}`);
      }
      break;
    }

    case 'join_auction': {
      const auctionId = payload?.auction_id || payload?.data?.auction_id || activeAuctionId;
      if (auctionId) {
        ensureAuctionContext(auctionId);
      }
      showResponseStatus(payload?.message || 'Joined Successfully!');
      logActivity(`AUCTION: join sukses -> ${auctionId || activeAuctionId}`);
      break;
    }

    case 'place_bid':
      showResponseStatus(payload?.message || 'Bid Placed!');
      if (payload?.current_highest !== undefined) {
        dom.highestAmount.textContent = formatRupiah(payload.current_highest);
      }
      logActivity(`BID: ${payload?.message || 'bid processed'}${payload?.current_highest ? ` | current_highest=${formatRupiah(payload.current_highest)}` : ''}`);
      break;

    default:
      logActivity(`RESULT [${commandName}]: ${JSON.stringify(payload)}`);
      break;
  }
}

function handleAuctionTopic(topic, payload) {
  const parts = topic.split('/');
  const auctionId = parts[2];
  const channel = parts[3];

  if (auctionId) {
    ensureAuctionContext(auctionId);
  }

  if (channel === 'status') {
    const statusValue = String(payload?.status || payload?.event_type || '').toUpperCase();
    if (statusValue.includes('OPEN')) {
      setAuctionState('OPEN');
    } else if (statusValue.includes('CLOSED')) {
      setAuctionState('CLOSED');
    } else if (statusValue.includes('CLOSING')) {
      setAuctionState('CLOSING');
    }

    logActivity(`STATUS: auction ${auctionId} -> ${statusValue || JSON.stringify(payload)}`);
    return;
  }

  if (topic.endsWith('/bid/highest')) {
    if (payload?.amount !== undefined) {
      dom.highestAmount.textContent = formatRupiah(payload.amount);
    }
    if (payload?.bidder !== undefined) {
      dom.highestBidder.textContent = payload.bidder || 'Anonymous';
    }
    if (payload?.remaining_seconds !== undefined) {
      updateRemainingSeconds(payload.remaining_seconds);
    }

    logActivity(`HIGHEST BID: ${auctionId} -> ${formatRupiah(payload?.amount)} / ${payload?.bidder || 'Anonymous'}`);
    return;
  }

  if (topic.endsWith('/events')) {
    if (payload?.highest_amount !== undefined) {
      dom.highestAmount.textContent = formatRupiah(payload.highest_amount);
    }
    if (payload?.highest_bidder !== undefined) {
      dom.highestBidder.textContent = payload.highest_bidder || 'Anonymous';
    }
    if (payload?.remaining_seconds !== undefined) {
      updateRemainingSeconds(payload.remaining_seconds);
    }

    if (payload?.event_type) {
      const eventType = String(payload.event_type).toUpperCase();
      if (eventType.includes('OPEN')) {
        setAuctionState('OPEN');
      } else if (eventType.includes('CLOSING')) {
        setAuctionState('CLOSING');
      } else if (eventType.includes('CLOSED')) {
        setAuctionState('CLOSED');
      }
    }

    logActivity(`EVENT: ${summarizeAuctionEvent(payload)}`);
    return;
  }
}

function handleResponseTopic(topic, payload, packet) {
  const correlationData = packet?.properties?.correlationData;
  const correlationKey = correlationData ? correlationData.toString() : '';
  const pending = correlationKey ? pendingRequests.get(correlationKey) : undefined;
  const commandName = pending?.action || payload?.command || 'unknown';

  if (correlationKey) {
    pendingRequests.delete(correlationKey);
  }

  logActivity(`RESPONSE: ${commandName}${correlationKey ? ` | correlation=${correlationKey}` : ''}`);
  handleCommandResponse(commandName, payload);
}

function handleIncomingMessage(topic, rawMessage, packet) {
  const payload = extractPayload(rawMessage);

  if (topic === `client/${demoUser}/error`) {
    const errorMessage = payload?.error || payload?.message || JSON.stringify(payload);
    showResponseStatus(`Error: ${errorMessage}`, true);
    logActivity(`ERROR: ${errorMessage}`);
    return;
  }

  if (topic === responseTopic) {
    handleResponseTopic(topic, payload, packet);
    return;
  }

  if (topic.startsWith('auction/item/')) {
    handleAuctionTopic(topic, payload);
    return;
  }

  if (topic === 'system/announcement') {
    const message = payload?.message || payload?.text || JSON.stringify(payload);
    logActivity(`ANNOUNCEMENT: ${message}${payload?.role ? ` | role=${payload.role}` : ''}`);
    return;
  }

  if (topic === 'system/status') {
    const message = payload?.message || payload?.status || JSON.stringify(payload);
    logActivity(`SYSTEM STATUS: ${message}`);
    return;
  }

  logActivity(`MQTT [${topic}]: ${JSON.stringify(payload)}`);
}

function connectMqtt() {
  if (typeof mqtt === 'undefined') {
    setConnectionStatus('MQTT.js belum termuat', false);
    showResponseStatus('MQTT.js CDN gagal dimuat.', true);
    return;
  }

  mqttClient = mqtt.connect(BROKER_URL, {
    clientId,
    protocolVersion: 5,
    clean: true,
    reconnectPeriod: reconnectDelay,
    connectTimeout: 10_000,
    properties: {
      sessionExpiryInterval: 30,
      receiveMaximum: 20,
    },
    will: {
      topic: 'system/status',
      payload: JSON.stringify({
        status: 'offline',
        role: 'browser',
        clientId,
        message: 'Browser client disconnected unexpectedly',
      }),
      qos: 1,
      retain: true,
      properties: {
        userProperties: {
          role: 'browser',
          state: 'offline',
        },
        messageExpiryInterval: 120,
      },
    }
  });

  mqttClient.on('connect', () => {
    setConnectionStatus('Connected', true);
    logActivity(`System: MQTT connected to ${BROKER_URL}`);
    subscribeToTopics();

    mqttClient.publish('system/status', JSON.stringify({
      status: 'online',
      role: 'browser',
      clientId,
      message: 'Browser client connected successfully',
    }), {
      qos: 1,
      retain: true,
      properties: {
        topicAlias: 1,
        userProperties: {
          role: 'browser',
          state: 'online',
        },
      }
    });

    publishCommand('get_items', {}, { silent: true });
    publishCommand('register', { username: demoUser, password: commandPassword }, { silent: true });
    setTimeout(() => {
      publishCommand('login', { username: demoUser, password: commandPassword }, { silent: true });
    }, 500);
  });

  mqttClient.on('reconnect', () => {
    setConnectionStatus('Reconnecting...', false);
  });

  mqttClient.on('close', () => {
    setConnectionStatus('Disconnected, retrying...', false);
    logActivity('System: MQTT connection closed. Reconnecting...');
  });

  mqttClient.on('offline', () => {
    setConnectionStatus('Offline', false);
  });

  mqttClient.on('error', (err) => {
    showResponseStatus(`MQTT error: ${err.message}`, true);
    logActivity(`ERROR: MQTT ${err.message}`);
  });

  mqttClient.on('message', (topic, message, packet) => {
    handleIncomingMessage(topic, message, packet);
  });
}

function requestCurrentAuction() {
  publishCommand('get_items', {});
}

function openAuction() {
  if (!fetchedItemId) {
    requestCurrentAuction();
    showResponseStatus('Ambil item catalog dulu, lalu coba open auction lagi.', true);
    return;
  }

  publishCommand('open_auction', {
    item_id: fetchedItemId,
    duration_seconds: 180
  });
}

function joinAuction() {
  const auctionId = dom.joinAuctionId.value.trim();
  if (!auctionId) {
    alert('Provide an Auction ID');
    return;
  }

  publishCommand('join_auction', {
    auction_id: auctionId,
    token
  });
}

function placeBid() {
  const amountStr = dom.bidAmount.value.trim();
  if (!amountStr) {
    alert('Enter bid amount');
    return;
  }

  const auctionId = dom.joinAuctionId.value.trim() || activeAuctionId;
  if (!auctionId) {
    alert('Join an auction first');
    return;
  }

  publishCommand('place_bid', {
    auction_id: auctionId,
    bidder_name: demoUser,
    amount: parseInt(amountStr, 10),
    token
  });
}

function publishAdminAnnouncement() {
  const message = dom.adminAnnounce.value.trim();
  if (!message) {
    alert('Isi announcement admin terlebih dahulu');
    return;
  }

  if (!mqttClient || !mqttClient.connected) {
    showResponseStatus('Broker MQTT belum terhubung.', true);
    return;
  }

  const payload = {
    role: 'admin',
    sent_by: 'admin-dashboard',
    message,
    source: 'person2-admin-publisher',
    timestamp: Date.now()
  };

  mqttClient.publish('system/announcement', JSON.stringify(payload), {
    qos: 1,
    retain: false,
    properties: {
      topicAlias: 2,
      messageExpiryInterval: 60,
      userProperties: {
        role: 'admin',
        source: 'person2-admin-publisher',
      },
    },
  }, (err) => {
    if (err) {
      showResponseStatus(`Publish announcement gagal: ${err.message}`, true);
      logActivity(`ERROR: announcement gagal -> ${err.message}`);
      return;
    }

    showResponseStatus('Admin announcement published.');
    dom.adminAnnounce.value = '';
    logActivity(`ADMIN PUBLISH: ${message}`);
  });
}

dom.btnOpen.addEventListener('click', openAuction);
dom.btnJoin.addEventListener('click', joinAuction);
dom.btnBid.addEventListener('click', placeBid);
dom.btnAdminAnnounce.addEventListener('click', publishAdminAnnouncement);

window.addEventListener('storage', (e) => {
  if (e.key === 'sync_auction_id' && e.newValue) {
    ensureAuctionContext(e.newValue);
    setAuctionState('OPEN');
    logActivity('System Sync: Received new Auction ID from another tab.');
  }
});

window.addEventListener('DOMContentLoaded', () => {
  setConnectionStatus('Disconnected', false);
  logActivity(`System: preparing MQTT client as ${demoUser}`);

  const latecomerId = localStorage.getItem('sync_auction_id');
  if (latecomerId) {
    ensureAuctionContext(latecomerId);
  }

  connectMqtt();
});
