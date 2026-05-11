import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const defaultProtoDir = path.resolve(process.cwd(), './grpc-backend/proto');

export const env = {
  wsPort: Number(process.env.WS_PORT || 8080),
  grpcAuthHost: process.env.GRPC_AUTH_HOST || 'localhost:50051',
  grpcCatalogHost: process.env.GRPC_CATALOG_HOST || 'localhost:50052',
  grpcBiddingHost: process.env.GRPC_BIDDING_HOST || 'localhost:50053',
  grpcProtoDir: path.resolve(process.cwd(), process.env.GRPC_PROTO_DIR || defaultProtoDir),
};

if (!Number.isFinite(env.wsPort) || env.wsPort <= 0) {
  throw new Error('WS_PORT must be a positive number');
}
