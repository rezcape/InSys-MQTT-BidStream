const MQTT_BROKER = 'wss://broker.hivemq.com:8884/mqtt';
let mqttClient;
let activeAuctionId = '';
let fetchedItemId = ''; 
let token = ''; // Store backend JWT token
let demoUser = ''; // Store generated username

const dom = {
  connStatus: document.getElementById('conn-status'),
  auctionState: document.getElementById('auction-state'),
  auctionTimer: document.getElementById('auction-timer'),
  highestAmount: document.getElementById('highest-amount'),
  highestBidder: document.getElementById('highest-bidder'),
  eventLog: document.getElementById('event-log'),
  
  btnOpen: document.getElementById('btn-open'),
  joinAuctionId: document.getElementById('join-auction-id'),
  btnJoin: document.getElementById('btn-join'),
  bidAmount: document.getElementById('bid-amount'),
  btnBid: document.getElementById('btn-bid'),
  commandResponse: document.getElementById('command-response')
};

let countdownInterval = null;

function startVisualCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  
  let openedAt = localStorage.getItem('sync_auction_opened_at');
  if (!openedAt) {
     openedAt = Date.now().toString();
     localStorage.setItem('sync_auction_opened_at', openedAt);
  }

  countdownInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - parseInt(openedAt)) / 1000);
    const DURATION = 180; 
    let remaining = DURATION - elapsed;

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      remaining = 0;
    }
    
    if (dom.auctionTimer) {
      const m = Math.floor(remaining / 60).toString().padStart(2, '0');
      const s = (remaining % 60).toString().padStart(2, '0');
      dom.auctionTimer.textContent = `${m}:${s}`;
    }
  }, 1000);
}

function stopVisualCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  if (dom.auctionTimer) dom.auctionTimer.textContent = '00:00';
}

function formatRupiah(amount) {
  return `Rp${Number(amount || 0).toLocaleString('id-ID')}`;
}

function showResponseStatus(message, isError = false) {
  dom.commandResponse.style.color = isError ? '#ca0032' : '#00ca65';
  dom.commandResponse.textContent = message;
  setTimeout(() => { dom.commandResponse.textContent = ''; }, 4000);
}

function sendCommand(commandName, payload = {}) {
  if (!mqttClient || !mqttClient.connected) {
    alert("Cannot send command: MQTT is disconnected.");
    return;
  }
  const topic = `client/${demoUser}/command/${commandName}`;
  mqttClient.publish(topic, JSON.stringify(payload));
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
     startVisualCountdown();
  } else if (stateStr === 'CLOSED' || stateStr === 'WAITING') {
     stopVisualCountdown();
  }
}

function connectMQTT() {
  // Demo user random ID
  demoUser = `user_${Math.floor(Math.random() * 9999)}`;
  
  logActivity(`System: Connecting to MQTT Broker ${MQTT_BROKER}...`);
  mqttClient = mqtt.connect(MQTT_BROKER);

  mqttClient.on('connect', () => {
    dom.connStatus.textContent = 'Connected (MQTT)';
    dom.connStatus.className = 'status-conn connected';
    logActivity('System: MQTT connected successfully.');
    
    // Subscribe to results of our commands
    mqttClient.subscribe(`client/${demoUser}/result/#`);
    mqttClient.subscribe(`client/${demoUser}/error`);
    
    // Subscribe to general catalog events
    mqttClient.subscribe(`catalog/events`);

    // Automatically register and login
    sendCommand('register', { username: demoUser, password: 'password123' });
    setTimeout(() => {
       sendCommand('login', { username: demoUser, password: 'password123' });
       sendCommand('get_items');
    }, 500);
  });

  mqttClient.on('close', () => {
    dom.connStatus.textContent = 'Disconnected, retrying...';
    dom.connStatus.className = 'status-conn disconnected';
    logActivity('System Error: MQTT connection closed.');
  });

  mqttClient.on('message', (topic, message) => {
    try {
      const data = JSON.parse(message.toString());
      handleIncomingEvent(topic, data);
    } catch (e) {
      console.warn('Failed to parse incoming message:', message.toString());
    }
  });
}

function subscribeToAuction(auctionId) {
  if (!auctionId || !mqttClient) return;
  mqttClient.subscribe(`auction/item/${auctionId}/status`);
  mqttClient.subscribe(`auction/item/${auctionId}/bid/highest`);
  mqttClient.subscribe(`auction/item/${auctionId}/events`);
  logActivity(`System: Subscribed to topics for Auction ${auctionId}`);
}

function handleIncomingEvent(topic, payload) {
  // Check for command errors
  if (topic.endsWith('/error')) {
    const errorMsg = payload.error || "Unknown Error";
    showResponseStatus(`Error: ${errorMsg}`, true);
    logActivity(`ERROR: ${errorMsg}`);
    return;
  }

  // Handle Command Results
  if (topic.includes('/result/')) {
    const command = topic.split('/').pop();
    
    if (command === 'login') {
      if (payload.token) {
        token = payload.token;
        logActivity(`System: Got valid authentication token.`);
      }
    } 
    else if (command === 'get_items') {
      if (payload.items && payload.items.length > 0) {
        fetchedItemId = payload.items[0].id;
        logActivity(`System: Fetched Catalog Item ID ready for auction!`);
      }
    }
    else if (command === 'open_auction') {
      if (payload.auction_id) {
         activeAuctionId = payload.auction_id;
         dom.joinAuctionId.value = activeAuctionId; 
         logActivity(`Action Success: Auction Opened -> ${activeAuctionId}`);
         localStorage.setItem('sync_auction_opened_at', Date.now().toString()); 
         setAuctionState('OPEN');
         localStorage.setItem('sync_auction_id', activeAuctionId);
         subscribeToAuction(activeAuctionId);
      }
    }
    else if (command === 'join_auction') {
      logActivity(`Action Success: Joined Auction ${payload.auction_id || activeAuctionId}`);
      showResponseStatus("Joined Successfully!");
      subscribeToAuction(payload.auction_id || activeAuctionId);
    }
    else if (command === 'place_bid') {
      logActivity(`Action Success: Bid Placed of Rp${dom.bidAmount.value}`);
      showResponseStatus("Bid Placed!");
    }
    return;
  }

  // Handle Auction Events
  if (topic === 'catalog/events') {
    const evType = String(payload.event_type || '').toUpperCase();
    if (evType.includes('OPENED') && payload.auction_id) {
        activeAuctionId = payload.auction_id;
        dom.joinAuctionId.value = activeAuctionId;
        subscribeToAuction(activeAuctionId);
    }
    logActivity(`CATALOG EVENT: Auction ${payload.auction_id} is ${evType}`);
  }
  else if (topic.includes('/status')) {
    setAuctionState(payload.status);
  }
  else if (topic.includes('/bid/highest')) {
    dom.highestAmount.textContent = formatRupiah(payload.amount);
    dom.highestBidder.textContent = payload.bidder || 'Anonymous';
  }
  else if (topic.includes('/events')) {
    const auctionEv = String(payload.event_type || '').toUpperCase();
    logActivity(`AUCTION EVENT: ${auctionEv}`);
  }
}

// Interacting
dom.btnOpen.addEventListener('click', () => {
  if (!fetchedItemId) {
    alert("I haven't fetched any items from the catalog yet!");
    return;
  }
  sendCommand('open_auction', {
    item_id: fetchedItemId,
    duration_seconds: 180 
  });
  showResponseStatus("Sent: open_auction");
});

dom.btnJoin.addEventListener('click', () => {
  const auctionId = dom.joinAuctionId.value.trim();
  if (!auctionId) return alert("Provide an Auction ID");
  sendCommand('join_auction', { 
    auction_id: auctionId,
    token: token 
  });
  showResponseStatus("Sent: join_auction");
});

dom.btnBid.addEventListener('click', () => {
  const amountStr = dom.bidAmount.value.trim();
  if (!amountStr) return alert("Enter bid amount");
  
  sendCommand('place_bid', {
    auction_id: dom.joinAuctionId.value.trim() || activeAuctionId,
    bidder_name: demoUser,
    amount: parseInt(amountStr, 10),
    token: token
  });
  showResponseStatus("Sent: place_bid");
});

// Front-End Demo Hack: Sync Auction ID across browser tabs instantly!
window.addEventListener('storage', (e) => {
  if (e.key === 'sync_auction_id' && e.newValue) {
    activeAuctionId = e.newValue;
    dom.joinAuctionId.value = activeAuctionId;
    setAuctionState('OPEN');
    subscribeToAuction(activeAuctionId);
    logActivity(`System Sync: Received new Auction ID from Admin window!`);
  }
});

// Init
window.addEventListener('DOMContentLoaded', () => {
  const latecomerId = localStorage.getItem('sync_auction_id');
  if (latecomerId) {
    activeAuctionId = latecomerId;
    dom.joinAuctionId.value = activeAuctionId;
  }
  connectMQTT();
});
