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
let fetchedItems = []; // Store fetched items with images
let token = '';
let countdownInterval = null;
let lastRemainingSeconds = null;
const pendingRequests = new Map();
const responseTopic = `client/${demoUser}/response`;

// ============= DATA TRACKING =============
const auctionStats = new Map(); // { auctionId: { highest_bid, bidder_count, bid_history, status, remaining_time, item_name, image_url } }
const bidderStats = new Map(); // { bidder: { bid_count, total_bid_value, last_bid_time } }
const availableAuctions = new Map(); // { auctionId: { item_id, status, duration_seconds, remaining_seconds, created_at, countdown_timer } }
const trendingBids = []; // Track bids over time for charting

let biddingTrendChart = null;

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
  commandResponse: document.getElementById('command-response'),

  // New leaderboard & analytics DOM
  topItemsList: document.getElementById('top-items-list'),
  topBiddersList: document.getElementById('top-bidders-list'),
  metricTotalBids: document.getElementById('metric-total-bids'),
  metricAvgBid: document.getElementById('metric-avg-bid'),
  metricVelocity: document.getElementById('metric-velocity'),
  auctionStatusGrid: document.getElementById('auction-status-grid'),
  
  // Current auction item display
  currentItemImage: document.getElementById('current-item-image'),
  currentItemName: document.getElementById('current-item-name'),
};

// ============= HELPERS =============
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
  
  // Update current item display
  const auctionStats_entry = auctionStats.get(auctionId);
  if (auctionStats_entry) {
    dom.currentItemImage.src = auctionStats_entry.image_url;
    dom.currentItemName.textContent = auctionStats_entry.item_name;
  }
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

// ============= ANALYTICS TRACKING =============
function trackBid(auctionId, amount, bidder) {
  // Track auction stats
  if (!auctionStats.has(auctionId)) {
    // Try to find item info from fetched items
    let itemName = `Item ${auctionId.substring(0, 8)}`;
    let imageUrl = '/images/placeholder.jpg';
    
    const foundItem = fetchedItems.find(item => item.id === auctionId);
    if (foundItem) {
      itemName = foundItem.name;
      imageUrl = foundItem.image_url || '/images/placeholder.jpg';
    }

    auctionStats.set(auctionId, {
      highest_bid: 0,
      bidder_count: new Set(),
      bid_history: [],
      status: 'OPEN',
      remaining_time: 180,
      item_name: itemName,
      image_url: imageUrl,
    });
  }

  const auction = auctionStats.get(auctionId);
  auction.highest_bid = Math.max(auction.highest_bid, amount);
  auction.bidder_count.add(bidder);
  auction.bid_history.push({ amount, bidder, timestamp: Date.now() });

  // Track bidder stats
  if (!bidderStats.has(bidder)) {
    bidderStats.set(bidder, {
      bid_count: 0,
      total_bid_value: 0,
      last_bid_time: Date.now(),
    });
  }

  const bidderStat = bidderStats.get(bidder);
  bidderStat.bid_count += 1;
  bidderStat.total_bid_value += amount;
  bidderStat.last_bid_time = Date.now();

  // Track for trending
  trendingBids.push({ amount, timestamp: Date.now() });

  updateLeaderboards();
  updateMetrics();
  updateChart();
  updateAuctionStatusGrid();
}

function updateLeaderboards() {
  // Top 5 Items by highest bid
  const topItems = Array.from(auctionStats.entries())
    .sort((a, b) => b[1].highest_bid - a[1].highest_bid)
    .slice(0, 5);

  dom.topItemsList.innerHTML = topItems.map((entry, idx) => {
    const [auctionId, stats] = entry;
    return `
      <div class="leaderboard-item">
        <div style="display: flex; gap: 10px; align-items: center;">
          <img src="${stats.image_url}" alt="${stats.item_name}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover; background: #0a0f18;">
          <div style="flex: 1;">
            <span class="rank">#${idx + 1}</span>
            <div style="font-size: 0.85rem; color: #95a8c1;">${stats.item_name.substring(0, 15)}</div>
            <div style="font-size: 0.75rem; color: #666;">ID: ${auctionId.substring(0, 8)}...</div>
          </div>
          <span class="value">${formatRupiah(stats.highest_bid)}</span>
        </div>
      </div>
    `;
  }).join('');

  if (topItems.length === 0) {
    dom.topItemsList.innerHTML = '<div class="leaderboard-item"><span style="color: #666;">No auctions yet</span></div>';
  }

  // Top 5 Bidders by bid count
  const topBidders = Array.from(bidderStats.entries())
    .sort((a, b) => b[1].bid_count - a[1].bid_count)
    .slice(0, 5);

  dom.topBiddersList.innerHTML = topBidders.map((entry, idx) => {
    const [bidder, stats] = entry;
    return `
      <div class="leaderboard-item">
        <span class="rank">#${idx + 1}</span> 
        ${bidder.substring(0, 12)}... 
        <span class="value">${stats.bid_count} bids</span>
      </div>
    `;
  }).join('');

  if (topBidders.length === 0) {
    dom.topBiddersList.innerHTML = '<div class="leaderboard-item"><span style="color: #666;">No bidders yet</span></div>';
  }
}

function updateMetrics() {
  const totalBids = Array.from(auctionStats.values()).reduce((sum, auction) => sum + auction.bid_history.length, 0);
  
  let totalAmount = 0;
  let bidCount = 0;
  auctionStats.forEach(auction => {
    auction.bid_history.forEach(bid => {
      totalAmount += bid.amount;
      bidCount += 1;
    });
  });

  const avgBid = bidCount > 0 ? Math.floor(totalAmount / bidCount) : 0;

  // Velocity: bids per minute (last minute)
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  const recentBids = trendingBids.filter(b => b.timestamp > oneMinuteAgo).length;

  dom.metricTotalBids.textContent = totalBids.toString();
  dom.metricAvgBid.textContent = formatRupiah(avgBid);
  dom.metricVelocity.textContent = `${recentBids}/min`;
}

function updateChart() {
  // Aggregate bids by 30-second windows for smooth trending
  if (trendingBids.length === 0) return;

  const now = Date.now();
  const windowSize = 30000; // 30 seconds
  const timeWindows = new Map();

  trendingBids.forEach(bid => {
    const windowKey = Math.floor(bid.timestamp / windowSize) * windowSize;
    if (!timeWindows.has(windowKey)) {
      timeWindows.set(windowKey, []);
    }
    timeWindows.get(windowKey).push(bid.amount);
  });

  const sortedWindows = Array.from(timeWindows.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(-20); // Last 20 windows (~10 minutes)

  const labels = sortedWindows.map(([timestamp]) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  });

  const avgBids = sortedWindows.map(([, bids]) => {
    return Math.floor(bids.reduce((a, b) => a + b, 0) / bids.length);
  });

  if (!biddingTrendChart) {
    const ctx = document.getElementById('bidding-trend-chart')?.getContext('2d');
    if (!ctx) return;

    biddingTrendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Average Bid Amount',
          data: avgBids,
          borderColor: '#2aa8ff',
          backgroundColor: 'rgba(42, 168, 255, 0.1)',
          tension: 0.4,
          fill: true,
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: '#00ca65',
          pointBorderColor: '#2aa8ff',
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { color: '#95a8c1', callback: (v) => formatRupiah(v) },
            grid: { color: 'rgba(42, 168, 255, 0.1)' },
          },
          x: {
            ticks: { color: '#95a8c1' },
            grid: { color: 'rgba(42, 168, 255, 0.1)' },
          }
        }
      }
    });
  } else {
    biddingTrendChart.data.labels = labels;
    biddingTrendChart.data.datasets[0].data = avgBids;
    biddingTrendChart.update();
  }
}

function updateAuctionStatusGrid() {
  const auctions = Array.from(auctionStats.entries()).slice(0, 6); // Show top 6
  
  dom.auctionStatusGrid.innerHTML = auctions.map(([auctionId, stats]) => {
    const statusClass = stats.status.toLowerCase();
    return `
      <div class="auction-card">
        <img src="${stats.image_url}" alt="${stats.item_name}" style="width: 100%; height: 120px; object-fit: cover; border-radius: 4px 4px 0 0; background: #0a0f18;">
        <div style="padding: 10px;">
          <div class="state ${statusClass}" style="margin-bottom: 8px;">${stats.status}</div>
          <div class="auction-info" style="font-weight: bold; margin-bottom: 5px;">
            ${stats.item_name.substring(0, 25)}
          </div>
          <div class="auction-info auction-price" style="font-size: 1.1rem; margin: 8px 0;">
            ${formatRupiah(stats.highest_bid)}
          </div>
          <div class="auction-info auction-time" style="font-size: 0.85rem;">
            ⏱️ ${stats.remaining_time}s
          </div>
          <div class="auction-info" style="color: #95a8c1; font-size: 0.8rem; margin-top: 5px;">
            👥 ${stats.bidder_count.size} bidders
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (auctions.length === 0) {
    dom.auctionStatusGrid.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No active auctions</div>';
  }
}

function updateAvailableAuctionsPanel() {
  const panel = document.getElementById('available-auctions-panel');
  if (!panel) return;

  if (availableAuctions.size === 0) {
    panel.innerHTML = '<div style="padding: 20px; text-align: center; color: #95a8c1; font-style: italic;">Waiting for auctions to be scheduled...</div>';
    return;
  }

  const auctionsList = Array.from(availableAuctions.entries()).map(([auctionId, auctionData]) => {
    const itemId = auctionData.item_id;
    const remaining = Math.max(0, Math.ceil(auctionData.remaining_seconds));
    const durationDisplay = `${remaining}s / ${auctionData.duration_seconds}s`;
    
    return `
      <div class="available-auction-item" style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px;
        border: 1px solid #334155;
        border-radius: 6px;
        background: rgba(30, 41, 59, 0.5);
        margin-bottom: 10px;
      ">
        <div style="flex: 1;">
          <div style="font-weight: bold; margin-bottom: 4px;">${auctionId.substring(0, 12)}...</div>
          <div style="color: #95a8c1; font-size: 0.85rem;">Item: ${itemId}</div>
          <div style="color: #cbd5e1; font-size: 0.8rem; margin-top: 4px;">⏱️ ${durationDisplay}</div>
        </div>
        <button class="join-auction-btn" data-auction-id="${auctionId}" style="
          padding: 8px 16px;
          background: #2aa8ff;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: bold;
          white-space: nowrap;
          margin-left: 10px;
        ">Join Auction</button>
      </div>
    `;
  }).join('');

  panel.innerHTML = auctionsList;

  // Add click handlers to join buttons
  panel.querySelectorAll('.join-auction-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const auctionId = btn.getAttribute('data-auction-id');
      joinAuction(auctionId);
    });
  });
}

function joinAuction(auctionId) {
  const auctionData = availableAuctions.get(auctionId);
  if (!auctionData) {
    showResponseStatus('Auction not found', true);
    return;
  }

  // Publish join command via MQTT
  publishCommand('join_auction', {
    auction_id: auctionId,
    item_id: auctionData.item_id,
  });

  logActivity(`📝 Attempting to join auction: ${auctionId.substring(0, 8)}...`);
}

// ============= MQTT COMMANDS =============

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
        fetchedItems = items; // Store all items with their images
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
        const bidAmount = payload.current_highest;
        dom.highestAmount.textContent = formatRupiah(bidAmount);
        // Track the bid we just placed
        const auction = activeAuctionId || dom.joinAuctionId.value;
        if (auction) {
          trackBid(auction, bidAmount, demoUser);
        }
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

    // Update auction status in stats
    if (auctionStats.has(auctionId)) {
      auctionStats.get(auctionId).status = statusValue;
    }

    logActivity(`STATUS: auction ${auctionId.substring(0, 8)}... -> ${statusValue || JSON.stringify(payload)}`);
    updateAuctionStatusGrid();
    return;
  }

  if (topic.endsWith('/bid/highest')) {
    if (payload?.amount !== undefined) {
      dom.highestAmount.textContent = formatRupiah(payload.amount);
      // Track this bid
      trackBid(auctionId, payload.amount, payload?.bidder || 'Anonymous');
    }
    if (payload?.bidder !== undefined) {
      dom.highestBidder.textContent = payload.bidder || 'Anonymous';
    }
    if (payload?.remaining_seconds !== undefined) {
      updateRemainingSeconds(payload.remaining_seconds);
      if (auctionStats.has(auctionId)) {
        auctionStats.get(auctionId).remaining_time = payload.remaining_seconds;
      }
    }

    logActivity(`HIGHEST BID: ${auctionId.substring(0, 8)}... -> ${formatRupiah(payload?.amount)} / ${payload?.bidder || 'Anonymous'}`);
    return;
  }

  if (topic.endsWith('/events')) {
    if (payload?.highest_amount !== undefined) {
      dom.highestAmount.textContent = formatRupiah(payload.highest_amount);
      // Track this bid
      trackBid(auctionId, payload.highest_amount, payload?.highest_bidder || 'Anonymous');
    }
    if (payload?.highest_bidder !== undefined) {
      dom.highestBidder.textContent = payload.highest_bidder || 'Anonymous';
    }
    if (payload?.remaining_seconds !== undefined) {
      updateRemainingSeconds(payload.remaining_seconds);
      if (auctionStats.has(auctionId)) {
        auctionStats.get(auctionId).remaining_time = payload.remaining_seconds;
      }
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

      // Update status in stats
      if (auctionStats.has(auctionId)) {
        auctionStats.get(auctionId).status = eventType;
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

function handleSchedulerEvent(payload) {
  const auctionId = payload?.auction_id;
  const itemId = payload?.item_id;
  const status = payload?.status;

  if (!auctionId) return;

  if (status === 'AUCTION_OPENED') {
    // New auction created by scheduler
    availableAuctions.set(auctionId, {
      item_id: itemId,
      status: 'AVAILABLE',
      duration_seconds: payload?.duration_seconds || 180,
      remaining_seconds: payload?.duration_seconds || 180,
      created_at: payload?.created_at || new Date().toISOString(),
      countdown_timer: null,
    });

    logActivity(`📢 NEW AUCTION AVAILABLE: ${auctionId.substring(0, 8)}... | Item: ${itemId}`);
    updateAvailableAuctionsPanel();

    // Start countdown timer
    const auctionData = availableAuctions.get(auctionId);
    const startTime = new Date(auctionData.created_at).getTime();
    const durationMs = auctionData.duration_seconds * 1000;
    
    const timer = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const remaining = Math.max(0, auctionData.duration_seconds - elapsed);
      auctionData.remaining_seconds = remaining;
      updateAvailableAuctionsPanel();

      if (remaining <= 0) {
        clearInterval(timer);
      }
    }, 1000);

    auctionData.countdown_timer = timer;
  } else if (status === 'AUCTION_CLOSED') {
    // Auction closed by scheduler
    const auction = availableAuctions.get(auctionId);
    if (auction && auction.countdown_timer) {
      clearInterval(auction.countdown_timer);
    }
    availableAuctions.delete(auctionId);
    logActivity(`🔔 AUCTION CLOSED: ${auctionId.substring(0, 8)}...`);
    updateAvailableAuctionsPanel();
  }
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

  if (topic === 'system/auction_scheduler') {
    handleSchedulerEvent(payload);
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

    // Initialize leaderboards and chart
    updateLeaderboards();
    updateMetrics();
    updateChart();
    updateAuctionStatusGrid();

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
