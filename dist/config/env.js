"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const defaultProtoDir = path_1.default.resolve(process.cwd(), './grpc-backend/proto');
exports.env = {
    wsPort: Number(process.env.WS_PORT || 8080),
    grpcAuthHost: process.env.GRPC_AUTH_HOST || 'localhost:50051',
    grpcCatalogHost: process.env.GRPC_CATALOG_HOST || 'localhost:50052',
    grpcBiddingHost: process.env.GRPC_BIDDING_HOST || 'localhost:50053',
    grpcProtoDir: path_1.default.resolve(process.cwd(), process.env.GRPC_PROTO_DIR || defaultProtoDir),
};
if (!Number.isFinite(exports.env.wsPort) || exports.env.wsPort <= 0) {
    throw new Error('WS_PORT must be a positive number');
}
