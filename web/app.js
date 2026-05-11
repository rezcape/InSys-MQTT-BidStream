const WS_URL = 'ws://localhost:8080';
let ws;
const reconnectDelay = 3000;
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
    const DURATION = 180; // Must match duration in btnOpen click
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

function sendCommand(type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert("Cannot send command: WebSocket is disconnected.");
    return;
  }
  const message = JSON.stringify({
    type: type,
    requestId: `req-${Math.floor(Math.random() * 10000)}`,
    payload: payload
  });
  ws.send(message);
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

function connectWebSocket() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    dom.connStatus.textContent = 'Connected';
    dom.connStatus.className = 'status-conn connected';
    logActivity('System: WebSocket connected successfully to ' + WS_URL);
    
    // Automatically fetch catalog items
    sendCommand('catalog.get_items');
    
    // Automatically register and login a demo user so we get a valid JWT token
    demoUser = `user_${Math.floor(Math.random() * 9999)}`;
    sendCommand('auth.register', { username: demoUser, password: 'password123' });
    setTimeout(() => {
       sendCommand('auth.login', { username: demoUser, password: 'password123' });
    }, 500);
  };

  ws.onclose = () => {
    dom.connStatus.textContent = 'Disconnected, retrying...';
    dom.connStatus.className = 'status-conn disconnected';
    logActivity('System Error: Connection closed. Attempting reconnect in 3s...');
    setTimeout(connectWebSocket, reconnectDelay);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleIncomingEvent(data);
    } catch (e) {
      console.warn('Failed to parse incoming message:', event.data);
    }
  };
}

function handleIncomingEvent(data) {
  // 1. Raw Message without Type
  if (!data.type && data.message) {
    logActivity(`SERVER INIT: ${data.message}`);
    return;
  }
  
  // 2. Global Error Catching
  if (data.ok === false) {
    const errorMsg = data.message || (data.payload && data.payload.message) || "Unknown Error";
    showResponseStatus(`Error: ${errorMsg}`, true);
    logActivity(`ERROR: ${errorMsg}`);
    return;
  }
  
  if (data.type && data.type.includes('error')) {
    const errorMsg = (data.payload && data.payload.message) || data.message || "Error";
    showResponseStatus(errorMsg, true);
    logActivity(`ERROR: ${errorMsg}`);
    return;
  }

  const type = data.type;
  const payload = data.payload || {};

  switch(type) {
    case 'auth.login.result':
      const authData = payload.data || data.data;
      if (authData && authData.token) {
        token = authData.token;
        logActivity(`System: Got valid authentication token for ${demoUser}.`);
      }
      break;

    case 'catalog.event':
      const evType = String(payload.event_type || '').toUpperCase();
      if (evType.includes('OPENED')) {
         setAuctionState('OPEN');
         // Auto-sync the auction ID for other browser tabs!
         if (payload.auction_id) {
            activeAuctionId = payload.auction_id;
            dom.joinAuctionId.value = activeAuctionId;
         }
      }
      if (evType.includes('CLOSING')) setAuctionState('CLOSING');
      if (evType.includes('CLOSED')) setAuctionState('CLOSED');
      logActivity(`CATALOG EVENT: Auction ${payload.auction_id} is ${evType}`);
      break;

    case 'auction.update':
       if (payload.highest_amount !== undefined) {
          dom.highestAmount.textContent = formatRupiah(payload.highest_amount);
          dom.highestBidder.textContent = payload.highest_bidder || 'Anonymous';
       }
       if (payload.event_type) {
          const auctionEv = String(payload.event_type || '').toUpperCase();
          if (auctionEv.includes('CLOSING')) setAuctionState('CLOSING');
          else if (auctionEv.includes('CLOSED')) setAuctionState('CLOSED');
          else setAuctionState('OPEN');
       }
       break;

    case 'system.alert': 
    case 'system.connected':
      if (payload.message || data.message) {
        logActivity(`SYSTEM: ${payload.message || data.message}`);
      }
      break;

    case 'catalog.get_items.result':
      if (payload && payload.data && Array.isArray(payload.data.items) && payload.data.items.length > 0) {
        fetchedItemId = payload.data.items[0].id;
        logActivity(`System: Fetched Catalog Item ID ready for auction!`);
      } else if (payload && Array.isArray(payload.items) && payload.items.length > 0) {
        fetchedItemId = payload.items[0].id;
        logActivity(`System: Fetched Catalog Item ID ready for auction!`);
      } else if (data.data && Array.isArray(data.data.items) && data.data.items.length > 0) {
        fetchedItemId = data.data.items[0].id;
        logActivity(`System: Fetched Catalog Item ID ready for auction!`);
      }
      break;

    case 'catalog.open_auction.result':
      const resultData = payload.data || data.data; 
      if (resultData && resultData.auction_id) {
         activeAuctionId = resultData.auction_id;
         dom.joinAuctionId.value = activeAuctionId; 
         logActivity(`Action Success: Auction Opened -> ${activeAuctionId}`);
         localStorage.setItem('sync_auction_opened_at', Date.now().toString()); // Set absolute timer start!
         setAuctionState('OPEN');
         // Broadcast to other tabs!
         localStorage.setItem('sync_auction_id', activeAuctionId);
      }
      break;

    // Provide explicit feedback for Join and Bid actions so UI doesn't seem unresponsive
    case 'auction.joined':
    case 'auction.join.result':
      const joinData = payload.data || data.data || payload; 
      logActivity(`Action Success: Joined Auction ${joinData.auction_id || activeAuctionId}`);
      showResponseStatus("Joined Successfully!");
      break;

    case 'auction.place_bid.result':
      logActivity(`Action Success: Bid Placed of Rp${dom.bidAmount.value}`);
      showResponseStatus("Bid Placed!");
      break;

    default:
      if (type && !type.includes('.result') && !type.includes('.heartbeat')) {
         logActivity(`EVENT [${type}]: ${JSON.stringify(payload)}`);
      }
      break;
  }
}

// Interacting
dom.btnOpen.addEventListener('click', () => {
  if (!fetchedItemId) {
    alert("I haven't fetched any items from the catalog yet! Trying to fetch one first...");
    sendCommand('catalog.get_items');
    return;
  }
  sendCommand('catalog.open_auction', {
    item_id: fetchedItemId,
    duration_seconds: 180 // Increased to 3 minutes for a longer bidding fight demo
  });
  showResponseStatus("Sent: catalog.open_auction");
});

dom.btnJoin.addEventListener('click', () => {
  const auctionId = dom.joinAuctionId.value.trim();
  if (!auctionId) return alert("Provide an Auction ID");
  // The backend requires the token to verify who is joining
  sendCommand('auction.join', { 
    auction_id: auctionId,
    token: token 
  });
  showResponseStatus("Sent: auction.join");
});

dom.btnBid.addEventListener('click', () => {
  const amountStr = dom.bidAmount.value.trim();
  if (!amountStr) return alert("Enter bid amount");
  
  // The backend requires the token user to perfectly match the bidder_name in the bid
  sendCommand('auction.place_bid', {
    auction_id: dom.joinAuctionId.value.trim() || activeAuctionId,
    bidder_name: demoUser,
    amount: parseInt(amountStr, 10),
    token: token
  });
  showResponseStatus("Sent: auction.place_bid");
});

// Front-End Demo Hack: Sync Auction ID across browser tabs instantly!
window.addEventListener('storage', (e) => {
  if (e.key === 'sync_auction_id' && e.newValue) {
    activeAuctionId = e.newValue;
    dom.joinAuctionId.value = activeAuctionId;
    setAuctionState('OPEN');
    logActivity(`System Sync: Received new Auction ID from Admin window!`);
  }
});

// Init
window.addEventListener('DOMContentLoaded', () => {
  // If this tab was opened late, grab the already synced ID from storage!
  const latecomerId = localStorage.getItem('sync_auction_id');
  if (latecomerId) {
    activeAuctionId = latecomerId;
    dom.joinAuctionId.value = activeAuctionId;
  }
  
  connectWebSocket();
});
