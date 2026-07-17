import { useCallback, useEffect, useRef, useState } from "react";

import { normalizeGatewayAccessToken, verifyGatewayAccessToken } from "@/lib/gatewayAuth";
import { resetGatewayWebSocketClient } from "@/lib/gatewaySocket";
import { clearToken, loadToken, saveToken } from "@/lib/storage";

import { asErrorMessage } from "../chatEventUtils";

export function useGatewaySession(historyShareToken: string | null) {
  const initialStoredTokenRef = useRef(historyShareToken ? "" : loadToken());
  const [token, setToken] = useState("");
  const [loginToken, setLoginToken] = useState(initialStoredTokenRef.current);
  const [authSubmitting, setAuthSubmitting] = useState(
    () => normalizeGatewayAccessToken(initialStoredTokenRef.current) !== "",
  );
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = normalizeGatewayAccessToken(initialStoredTokenRef.current);
    if (!storedToken) {
      return;
    }

    let cancelled = false;
    setAuthError(null);
    resetGatewayWebSocketClient();

    void verifyGatewayAccessToken(storedToken)
      .then((verifiedToken) => {
        if (cancelled) {
          return;
        }
        initialStoredTokenRef.current = verifiedToken;
        saveToken(verifiedToken);
        setLoginToken(verifiedToken);
        setToken(verifiedToken);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        initialStoredTokenRef.current = "";
        clearToken();
        resetGatewayWebSocketClient();
        setToken("");
        setAuthError(asErrorMessage(error, "Access Token 验证失败。"));
        setLoginToken(storedToken);
      })
      .finally(() => {
        if (!cancelled) {
          setAuthSubmitting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async () => {
    const draftToken = loginToken;
    const normalizedToken = normalizeGatewayAccessToken(draftToken);
    if (!normalizedToken) {
      setAuthError("请输入 Access Token。");
      return;
    }

    setAuthSubmitting(true);
    setAuthError(null);
    resetGatewayWebSocketClient();

    try {
      const verifiedToken = await verifyGatewayAccessToken(draftToken);
      initialStoredTokenRef.current = verifiedToken;
      saveToken(verifiedToken);
      setLoginToken(verifiedToken);
      setToken(verifiedToken);
    } catch (error) {
      initialStoredTokenRef.current = "";
      clearToken();
      resetGatewayWebSocketClient();
      setToken("");
      setAuthError(asErrorMessage(error, "Access Token 验证失败。"));
    } finally {
      setAuthSubmitting(false);
    }
  }, [loginToken]);

  const clearSession = useCallback(() => {
    clearToken();
    resetGatewayWebSocketClient();
    initialStoredTokenRef.current = "";
    setAuthSubmitting(false);
    setAuthError(null);
    setLoginToken("");
    setToken("");
  }, []);

  return {
    token,
    loginToken,
    authSubmitting,
    authError,
    setToken,
    setLoginToken,
    setAuthError,
    login,
    clearSession,
  };
}
