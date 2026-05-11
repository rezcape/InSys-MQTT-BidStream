export interface GatewayCommand {
  type: string;
  requestId?: string;
  payload?: Record<string, any>;
}

export const PROTOCOL_VERSION = 'v1';

export const AVAILABLE_COMMANDS = [
  'auth.register',
  'auth.login',
  'catalog.get_items',
  'catalog.open_auction',
  'stream.catalog.start',
  'stream.catalog.stop',
  'auction.join',
  'auction.leave',
  'auction.place_bid',
  'auction.get_result',
] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && typeof value === 'number' && value > 0;
}

export function validateCommand(input: unknown): { ok: true; command: GatewayCommand } | { ok: false; message: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, message: 'Command must be a JSON object' };
  }

  const command = input as GatewayCommand;

  if (!isNonEmptyString(command.type)) {
    return { ok: false, message: 'Command type is required' };
  }

  if (command.requestId !== undefined && typeof command.requestId !== 'string') {
    return { ok: false, message: 'requestId must be a string when provided' };
  }

  if (typeof command.requestId === 'string' && command.requestId.trim().length === 0) {
    return { ok: false, message: 'requestId must not be empty when provided' };
  }

  if (!AVAILABLE_COMMANDS.includes(command.type as any)) {
    return { ok: false, message: `Unknown command type: ${command.type}` };
  }

  const payload = command.payload ?? {};

  switch (command.type) {
    case 'auth.register':
    case 'auth.login': {
      if (!isNonEmptyString(payload.username) || !isNonEmptyString(payload.password)) {
        return { ok: false, message: 'username and password are required' };
      }
      break;
    }

    case 'catalog.open_auction': {
      if (!isNonEmptyString(payload.item_id)) {
        return { ok: false, message: 'item_id is required' };
      }
      if (payload.duration_seconds !== undefined && !isPositiveInteger(payload.duration_seconds)) {
        return { ok: false, message: 'duration_seconds must be a positive integer when provided' };
      }
      break;
    }

    case 'auction.join': {
      if (!isNonEmptyString(payload.auction_id) || !isNonEmptyString(payload.token)) {
        return { ok: false, message: 'auction_id and token are required' };
      }
      break;
    }

    case 'auction.place_bid': {
      if (
        !isNonEmptyString(payload.auction_id) ||
        !isNonEmptyString(payload.bidder_name) ||
        !isNonEmptyString(payload.token)
      ) {
        return { ok: false, message: 'auction_id, bidder_name, and token are required' };
      }
      if (!isPositiveNumber(payload.amount)) {
        return { ok: false, message: 'amount must be a positive number' };
      }
      break;
    }

    case 'auction.get_result': {
      if (!isNonEmptyString(payload.auction_id)) {
        return { ok: false, message: 'auction_id is required' };
      }
      break;
    }

    default:
      break;
  }

  return { ok: true, command: { ...command, payload } };
}
