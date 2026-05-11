"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.biddingClient = exports.catalogClient = exports.authClient = void 0;
exports.unaryCall = unaryCall;
exports.checkGrpcConnectivity = checkGrpcConnectivity;
exports.closeGrpcClients = closeGrpcClients;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const grpc = __importStar(require("@grpc/grpc-js"));
const protoLoader = __importStar(require("@grpc/proto-loader"));
const env_1 = require("../config/env");
function loadProto(fileName) {
    const protoPath = path_1.default.join(env_1.env.grpcProtoDir, fileName);
    if (!fs_1.default.existsSync(protoPath)) {
        throw new Error(`Proto file not found: ${protoPath}`);
    }
    const packageDef = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
    });
    return grpc.loadPackageDefinition(packageDef);
}
const authProto = loadProto('auth.proto');
const catalogProto = loadProto('catalog.proto');
const biddingProto = loadProto('bidding.proto');
exports.authClient = new authProto.auth.AuthService(env_1.env.grpcAuthHost, grpc.credentials.createInsecure());
exports.catalogClient = new catalogProto.catalog.CatalogService(env_1.env.grpcCatalogHost, grpc.credentials.createInsecure());
exports.biddingClient = new biddingProto.bidding.BiddingService(env_1.env.grpcBiddingHost, grpc.credentials.createInsecure());
function unaryCall(client, methodName, request) {
    return new Promise((resolve, reject) => {
        const method = client?.[methodName];
        if (typeof method !== 'function') {
            reject(new Error(`Unknown gRPC method: ${methodName}`));
            return;
        }
        method.call(client, request, (err, response) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(response);
        });
    });
}
function waitReady(client, label) {
    const deadline = Date.now() + 3000;
    return new Promise((resolve, reject) => {
        client.waitForReady(deadline, (err) => {
            if (err) {
                reject(new Error(`${label} is not ready: ${err.message}`));
                return;
            }
            resolve();
        });
    });
}
async function checkGrpcConnectivity() {
    await waitReady(exports.authClient, 'AuthService');
    await waitReady(exports.catalogClient, 'CatalogService');
    await waitReady(exports.biddingClient, 'BiddingService');
}
function closeGrpcClients() {
    exports.authClient.close();
    exports.catalogClient.close();
    exports.biddingClient.close();
}
