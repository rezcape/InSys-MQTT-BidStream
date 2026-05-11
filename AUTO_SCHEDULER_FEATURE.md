# Auto-Auction Scheduler Feature

## Overview
The auto-auction scheduler automatically creates new auctions at regular intervals with random item selection, eliminating the need for manual auction creation and keeping the platform continuously active with bidding opportunities.

## Implementation Details

### Backend (TypeScript)
**File:** `src/scheduler/auctionScheduler.ts`

**Features:**
- Creates new auctions every 15 seconds (configurable via `config.intervalSeconds`)
- Each auction lasts 180 seconds by default (configurable via `config.auctionDurationSeconds`)
- Prevents concurrent duplicate items using `activeAuctionItems` Set
- Automatically closes auctions after duration expires
- Publishes `AUCTION_OPENED` and `AUCTION_CLOSED` events to `system/auction_scheduler` MQTT topic

**Configuration:**
```typescript
const config: SchedulerConfig = {
  intervalSeconds: 15,           // Create new auction every 15 seconds
  auctionDurationSeconds: 180,   // Each auction lasts 3 minutes
};
```

**Key Functions:**
- `getAvailableItems()`: Fetches items from catalog service, filters out items already in active auctions
- `createRandomAuction()`: Generates unique auction ID, tracks item, publishes MQTT event, schedules auto-close
- `startAuctionScheduler()`: Initializes scheduler, creates first auction immediately, then repeats at intervals
- `stopAuctionScheduler()`: Gracefully stops scheduler and clears all timers

### Frontend (HTML/JavaScript)

**UI Components:**
- **Available Auctions Panel** (`#available-auctions-panel`): Displays all scheduled auctions waiting for participants
  - Shows auction ID (truncated)
  - Shows item ID
  - Displays countdown timer (remaining / total seconds)
  - "Join Auction" button for each

**JavaScript Functions:**
- `handleSchedulerEvent(payload)`: Processes AUCTION_OPENED/CLOSED events from MQTT
- `updateAvailableAuctionsPanel()`: Renders all available auctions with countdown timers
- `joinAuction(auctionId)`: Publishes join_auction MQTT command for selected auction

**MQTT Integration:**
- Subscribes to `system/auction_scheduler` topic
- Maintains `availableAuctions` Map to track scheduled auctions
- Sets up countdown timers (1-second intervals) for each auction
- Automatically removes auctions from panel when closed

## User Flow

1. **Page Load**: User opens dashboard
2. **Auto-Auction Creation**: Backend scheduler creates first auction immediately, then every 15 seconds
3. **Real-Time Updates**: Frontend receives AUCTION_OPENED events via MQTT, displays new auctions in panel
4. **Countdown Display**: Each auction shows countdown timer counting down from 180s to 0s
5. **Join Auction**: User clicks "Join Auction" to participate
6. **Auto-Close**: Auction automatically closes after 180 seconds, removed from available panel

## Event Flow

### Backend → Frontend
```
Backend Scheduler (every 15s)
  ↓
  Create random auction with available item
  ↓
  Publish to system/auction_scheduler
  {
    auction_id: "auction-1778525548046-5005fd",
    item_id: "item-002",
    status: "AUCTION_OPENED",
    duration_seconds: 180,
    remaining_seconds: 180,
    created_at: "2026-05-11T18:52:28.046Z",
    created_by: "scheduler"
  }
  ↓
Frontend MQTT Listener
  ↓
  handleSchedulerEvent()
  ↓
  Add to availableAuctions Map
  ↓
  Start countdown timer
  ↓
  updateAvailableAuctionsPanel()
  ↓
Display in UI with "Join Auction" button
```

### User Interaction
```
User Clicks "Join Auction"
  ↓
  joinAuction(auctionId)
  ↓
  Publish to client/{userId}/command/join_auction
  {
    auction_id: "...",
    item_id: "..."
  }
  ↓
Gateway processes join command
  ↓
User joins active auction/bidding
```

## Files Modified

1. **src/scheduler/auctionScheduler.ts** (NEW)
   - Complete scheduler implementation

2. **src/index.ts**
   - Import and initialize scheduler in bootstrap()
   - Call startAuctionScheduler() after MQTT gateway starts
   - Call stopAuctionScheduler() on shutdown signals

3. **web/app.js**
   - Added `availableAuctions` Map to track scheduled auctions
   - Added `handleSchedulerEvent()` function
   - Added `updateAvailableAuctionsPanel()` function
   - Added `joinAuction()` function
   - Added `system/auction_scheduler` to MQTT subscription list

4. **web/index.html**
   - Added "📋 AVAILABLE AUCTIONS" section with `#available-auctions-panel`

## Configuration Options

To customize scheduler behavior, edit `src/scheduler/auctionScheduler.ts`:

```typescript
const config: SchedulerConfig = {
  intervalSeconds: 15,        // Change to 30 for less frequent auctions
  auctionDurationSeconds: 180, // Change to 300 for 5-minute auctions
};
```

## Testing

1. **Verify scheduler is running**: Check backend logs for "[Scheduler] Started auction scheduler"
2. **Monitor auction creation**: Watch for "[Scheduler] Created auction: ..." logs every 15 seconds
3. **Check frontend reception**: Observe "📢 NEW AUCTION AVAILABLE" messages in Live Activity Feed
4. **Test countdown**: Verify auction timers countdown in real-time
5. **Test join button**: Click "Join Auction" and confirm command is published

## Benefits

✅ **Continuous Activity**: Platform always has auctions available
✅ **No Manual Creation**: Fully automated auction lifecycle
✅ **Fair Distribution**: Random item selection prevents bias
✅ **Resource Efficient**: No duplicate items in concurrent auctions
✅ **User-Friendly**: Clear countdown timers help users decide
✅ **Real-Time**: MQTT ensures instant updates across all clients
