import { invoke } from "@tauri-apps/api/core";

import type { ProviderId } from "../settings";

export const LIVEAGENT_PROXY_TOKEN_HEADER = "x-liveagent-proxy-token";
export const LIVEAGENT_UPSTREAM_ORIGIN_HEADER = "x-liveagent-upstream-origin";

type ProxyServerInfo = {
  baseUrl: string;
  token: string;
};

export type PreparedProxyRequest = {
  baseUrl: string;
  headers: Record<string, string>;
};

let proxyServerInfoPromise: Promise<ProxyServerInfo> | null = null;

function normalizeProxyServerInfo(info: ProxyServerInfo): ProxyServerInfo {
  const baseUrl = String(info.baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  const token = String(info.token ?? "").trim();

  if (!baseUrl) {
    throw new Error("Local proxy base URL is empty");
  }
  if (!token) {
    throw new Error("Local proxy token is empty");
  }

  return {
    baseUrl,
    token,
  };
}

async function getProxyServerInfo(): Promise<ProxyServerInfo> {
  if (!proxyServerInfoPromise) {
    proxyServerInfoPromise = invoke<ProxyServerInfo>("proxy_get_server_info")
      .then(normalizeProxyServerInfo)
      .catch((error) => {
        proxyServerInfoPromise = null;
        throw new Error(
          `Failed to get local proxy info: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  return proxyServerInfoPromise;
}

export function buildProxyBaseUrl(
  providerId: ProviderId,
  upstreamBaseUrl: string,
  proxyServerBaseUrl: string,
): { baseUrl: string; upstreamOrigin: string } {
  const normalizedUpstream = upstreamBaseUrl.trim();
  if (!normalizedUpstream) {
    throw new Error("Base URL cannot be empty");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedUpstream);
  } catch (error) {
    throw new Error(
      `Base URL must be an absolute URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error("Base URL cannot include embedded username or password");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Base URL cannot include query parameters or fragments");
  }

  const normalizedProxyServerBaseUrl = proxyServerBaseUrl.trim().replace(/\/+$/, "");
  const pathname = parsed.pathname.replace(/\/+$/, "");

  return {
    baseUrl: `${normalizedProxyServerBaseUrl}/proxy/${providerId}${pathname}`,
    upstreamOrigin: parsed.origin,
  };
}

export function buildImageProxyUrl(imageUrl: string, proxyServerBaseUrl: string): string {
  const normalizedImageUrl = imageUrl.trim();
  if (!normalizedImageUrl) {
    throw new Error("Image URL cannot be empty");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedImageUrl);
  } catch (error) {
    throw new Error(
      `Image URL must be an absolute URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Image URL must start with http:// or https://");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Image URL cannot include embedded username or password");
  }

  const normalizedProxyServerBaseUrl = proxyServerBaseUrl.trim().replace(/\/+$/, "");
  if (!normalizedProxyServerBaseUrl) {
    throw new Error("Local proxy base URL is empty");
  }
  return `${normalizedProxyServerBaseUrl}/image-proxy?url=${encodeURIComponent(parsed.toString())}`;
}

export async function prepareImageProxyUrl(imageUrl: string): Promise<string> {
  const proxyServerInfo = await getProxyServerInfo();
  return buildImageProxyUrl(imageUrl, proxyServerInfo.baseUrl);
}

export async function prepareProxyRequest(
  providerId: ProviderId,
  upstreamBaseUrl: string,
  headers: Record<string, string>,
): Promise<PreparedProxyRequest> {
  const proxyServerInfo = await getProxyServerInfo();
  const { baseUrl, upstreamOrigin } = buildProxyBaseUrl(
    providerId,
    upstreamBaseUrl,
    proxyServerInfo.baseUrl,
  );

  return {
    baseUrl,
    headers: {
      ...headers,
      [LIVEAGENT_UPSTREAM_ORIGIN_HEADER]: upstreamOrigin,
      [LIVEAGENT_PROXY_TOKEN_HEADER]: proxyServerInfo.token,
    },
  };
}
