package server

import (
	"net"
	"net/http"
	"net/url"
	"strings"
)

func originAllowed(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return false
	}
	requestURL := requestURLForOriginCheck(r)
	if requestURL == nil {
		return false
	}
	if sameOrigin(parsed, requestURL) {
		return true
	}
	originHost := strings.TrimSpace(parsed.Hostname())
	requestHost := strings.TrimSpace(requestURL.Hostname())
	if originHost == "" || requestHost == "" {
		return false
	}
	return isLoopbackHost(originHost) && isLoopbackHost(requestHost)
}

func requestURLForOriginCheck(r *http.Request) *url.URL {
	if r == nil {
		return nil
	}
	scheme := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
	if scheme == "" {
		if r.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	scheme = strings.ToLower(strings.TrimSpace(strings.Split(scheme, ",")[0]))
	switch scheme {
	case "http", "https":
	default:
		return nil
	}
	host := strings.TrimSpace(r.Host)
	if host == "" {
		return nil
	}
	return &url.URL{Scheme: scheme, Host: host}
}

func sameOrigin(a *url.URL, b *url.URL) bool {
	if a == nil || b == nil {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(a.Scheme), strings.TrimSpace(b.Scheme)) {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(a.Hostname()), strings.TrimSpace(b.Hostname())) {
		return false
	}
	return originPort(a) == originPort(b)
}

func originPort(u *url.URL) string {
	if u == nil {
		return ""
	}
	if port := strings.TrimSpace(u.Port()); port != "" {
		return port
	}
	switch strings.ToLower(strings.TrimSpace(u.Scheme)) {
	case "http", "ws":
		return "80"
	case "https", "wss":
		return "443"
	default:
		return ""
	}
}

func isLoopbackHost(host string) bool {
	host = strings.Trim(strings.ToLower(strings.TrimSpace(host)), "[]")
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
