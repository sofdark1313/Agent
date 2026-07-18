import type { GatewayWebSocketClientLike } from "@/lib/gatewaySocket";
import type { SftpClient } from "./types";

export function createGatewaySftpClient(api: GatewayWebSocketClientLike): SftpClient {
  return {
    list(params) {
      return api.sftpList(params);
    },
    stat(params) {
      return api.sftpStat(params);
    },
    mkdir(params) {
      return api.sftpMkdir(params);
    },
    rename(params) {
      return api.sftpRename(params);
    },
    delete(params) {
      return api.sftpDelete(params);
    },
    transfer(params) {
      return api.sftpTransfer(params);
    },
    cancelTransfer(params) {
      return api.sftpCancelTransfer(params);
    },
    subscribeTransfers(listener) {
      return api.subscribeSftpTransfers(listener);
    },
  };
}
