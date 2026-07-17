package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

const maxProviderModelsResponseBytes = 2 << 20

const anthropicAPIVersion = "2023-06-01"

type HTTPStatusError struct {
	Status  int
	Message string
}

func (e *HTTPStatusError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

type ProviderModelsResult struct {
	ContentType string
	Body        []byte
}

var codexModelsSuffixes = []string{
	"/chat/completions",
	"/responses",
	"/response",
}

type providerModelsAttempt struct {
	url     string
	headers map[string]string
}

type providerModelsAttemptFailure struct {
	upstreamStatus int
	err            error
}

func FetchProviderModels(
	ctx context.Context,
	req ProviderModelsRequestBody,
) (*ProviderModelsResult, error) {
	return fetchProviderModelsWithClient(ctx, req, newSafeOutboundHTTPClient(0))
}

func fetchProviderModelsWithClient(
	ctx context.Context,
	req ProviderModelsRequestBody,
	client outboundHTTPClient,
) (*ProviderModelsResult, error) {
	providerType := strings.TrimSpace(req.Type)
	baseURL := strings.TrimSpace(req.BaseURL)
	apiKey := strings.TrimSpace(req.APIKey)
	if baseURL == "" || apiKey == "" {
		return nil, &HTTPStatusError{
			Status:  http.StatusBadRequest,
			Message: "base_url and api_key are required",
		}
	}

	attempts, err := buildProviderModelsAttempts(providerType, baseURL, apiKey)
	if err != nil {
		return nil, &HTTPStatusError{
			Status:  http.StatusBadRequest,
			Message: err.Error(),
		}
	}

	var failures []providerModelsAttemptFailure
	var emptyResult *ProviderModelsResult

	for _, attempt := range attempts {
		result, failure, err := runProviderModelsAttempt(ctx, client, attempt)
		if err != nil {
			return nil, err
		}
		if failure != nil {
			failures = append(failures, *failure)
			continue
		}
		if providerModelsBodyHasEntries(result.Body) {
			return result, nil
		}
		emptyResult = result
	}

	if emptyResult != nil {
		return emptyResult, nil
	}

	return nil, pickProviderModelsFailure(failures)
}

// runProviderModelsAttempt performs a single upstream request. A non-nil
// error aborts the whole fetch (policy block); a non-nil failure lets the
// caller fall back to the next attempt.
func runProviderModelsAttempt(
	ctx context.Context,
	client outboundHTTPClient,
	attempt providerModelsAttempt,
) (*ProviderModelsResult, *providerModelsAttemptFailure, error) {
	upstreamReq, err := http.NewRequestWithContext(ctx, http.MethodGet, attempt.url, nil)
	if err != nil {
		return nil, nil, &HTTPStatusError{
			Status:  http.StatusBadRequest,
			Message: "invalid provider models URL",
		}
	}
	for key, value := range attempt.headers {
		upstreamReq.Header.Set(key, value)
	}

	resp, err := client.Do(upstreamReq)
	if err != nil {
		if isSafeOutboundBlockedError(err) {
			return nil, nil, &HTTPStatusError{
				Status:  http.StatusBadRequest,
				Message: "provider models URL is not allowed",
			}
		}
		return nil, &providerModelsAttemptFailure{err: err}, nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxProviderModelsResponseBytes))
	if err != nil {
		return nil, &providerModelsAttemptFailure{
			err: &HTTPStatusError{
				Status:  http.StatusBadGateway,
				Message: "failed to read provider model response",
			},
		}, nil
	}

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, &providerModelsAttemptFailure{
			upstreamStatus: resp.StatusCode,
			err: &HTTPStatusError{
				Status:  mapUpstreamProviderStatus(resp.StatusCode),
				Message: extractUpstreamErrorMessage(body, resp.Status),
			},
		}, nil
	}

	if !json.Valid(body) {
		return nil, &providerModelsAttemptFailure{
			err: &HTTPStatusError{
				Status:  http.StatusBadGateway,
				Message: "provider model response is not valid JSON",
			},
		}, nil
	}

	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if contentType == "" {
		contentType = "application/json"
	}

	return &ProviderModelsResult{
		ContentType: contentType,
		Body:        body,
	}, nil, nil
}

func buildProviderModelsAttempts(
	providerType string,
	baseURL string,
	apiKey string,
) ([]providerModelsAttempt, error) {
	defaultURL, err := buildProviderModelsURL(providerType, baseURL, false)
	if err != nil {
		return nil, err
	}
	officialURL, err := buildProviderModelsURL(providerType, baseURL, true)
	if err != nil {
		return nil, err
	}

	candidates := []providerModelsAttempt{
		{url: defaultURL, headers: buildProviderModelsHeaders(providerType, apiKey, false)},
		{url: officialURL, headers: buildProviderModelsHeaders(providerType, apiKey, true)},
	}

	attempts := make([]providerModelsAttempt, 0, len(candidates))
	seen := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		signature := providerModelsAttemptSignature(candidate)
		if _, ok := seen[signature]; ok {
			continue
		}
		seen[signature] = struct{}{}
		attempts = append(attempts, candidate)
	}
	return attempts, nil
}

func providerModelsAttemptSignature(attempt providerModelsAttempt) string {
	keys := make([]string, 0, len(attempt.headers))
	for key := range attempt.headers {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	var builder strings.Builder
	builder.WriteString(attempt.url)
	for _, key := range keys {
		builder.WriteString("||")
		builder.WriteString(key)
		builder.WriteString("=")
		builder.WriteString(attempt.headers[key])
	}
	return builder.String()
}

func buildProviderModelsHeaders(
	providerType string,
	apiKey string,
	official bool,
) map[string]string {
	headers := map[string]string{"Content-Type": "application/json"}
	switch providerType {
	case "gemini":
		headers["x-goog-api-key"] = apiKey
		if !official {
			headers["Authorization"] = "Bearer " + apiKey
		}
	case "claude_code":
		headers["x-api-key"] = apiKey
		headers["anthropic-version"] = anthropicAPIVersion
		if !official {
			headers["Authorization"] = "Bearer " + apiKey
		}
	default:
		headers["Authorization"] = "Bearer " + apiKey
		if !official {
			headers["x-api-key"] = apiKey
		}
	}
	return headers
}

func providerModelsBodyHasEntries(body []byte) bool {
	var payload any
	if err := json.Unmarshal(body, &payload); err != nil {
		return false
	}

	switch typed := payload.(type) {
	case []any:
		return len(typed) > 0
	case map[string]any:
		if items, ok := typed["data"].([]any); ok && len(items) > 0 {
			return true
		}
		if items, ok := typed["models"].([]any); ok && len(items) > 0 {
			return true
		}
	}
	return false
}

func isMissingEndpointStatus(status int) bool {
	return status == http.StatusNotFound || status == http.StatusMethodNotAllowed
}

// pickProviderModelsFailure prefers the most informative failure: the last
// one that is not a bare "endpoint missing" upstream status, falling back to
// the last failure overall.
func pickProviderModelsFailure(failures []providerModelsAttemptFailure) error {
	for index := len(failures) - 1; index >= 0; index-- {
		if !isMissingEndpointStatus(failures[index].upstreamStatus) {
			return failures[index].err
		}
	}
	if len(failures) > 0 {
		return failures[len(failures)-1].err
	}
	return &HTTPStatusError{
		Status:  http.StatusBadGateway,
		Message: "failed to fetch provider models",
	}
}

func buildProviderModelsURL(providerType string, baseURL string, official bool) (string, error) {
	normalizedBaseURL := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if normalizedBaseURL == "" {
		return "", errors.New("base_url is required")
	}

	switch providerType {
	case "claude_code", "codex", "gemini":
	default:
		return "", errors.New("unsupported provider type")
	}

	if providerType == "codex" {
		lower := strings.ToLower(normalizedBaseURL)
		for _, suffix := range codexModelsSuffixes {
			if strings.HasSuffix(lower, suffix) {
				normalizedBaseURL = normalizedBaseURL[:len(normalizedBaseURL)-len(suffix)]
				break
			}
		}
	}
	if providerType == "gemini" {
		lower := strings.ToLower(normalizedBaseURL)
		for _, suffix := range []string{":streamgeneratecontent", ":generatecontent"} {
			if strings.HasSuffix(lower, suffix) {
				normalizedBaseURL = normalizedBaseURL[:len(normalizedBaseURL)-len(suffix)]
				break
			}
		}
		if modelsIndex := strings.LastIndex(strings.ToLower(normalizedBaseURL), "/models"); modelsIndex >= 0 {
			afterModels := normalizedBaseURL[modelsIndex+len("/models"):]
			if afterModels == "" || strings.HasPrefix(afterModels, "/") {
				normalizedBaseURL = normalizedBaseURL[:modelsIndex]
			}
		}
	}

	parsed, err := url.Parse(normalizedBaseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("base_url must be an absolute URL")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("base_url cannot contain query parameters or fragments")
	}
	if err := validateParsedOutboundHTTPURL(parsed); err != nil {
		return "", errors.New("base_url is not allowed")
	}

	if providerType == "gemini" {
		versionPath := "/v1"
		if official {
			versionPath = "/v1beta"
		}
		normalizedPath := strings.TrimRight(parsed.Path, "/")
		if strings.HasSuffix(strings.ToLower(normalizedPath), "/models") {
			parsed.Path = normalizedPath
		} else if isGeminiVersionPath(normalizedPath) {
			parsed.Path = normalizedPath + "/models"
		} else {
			parsed.Path = normalizedPath + versionPath + "/models"
		}
		return parsed.String(), nil
	}

	if strings.HasSuffix(strings.TrimRight(parsed.Path, "/"), "/v1") {
		parsed.Path = strings.TrimRight(parsed.Path, "/") + "/models"
	} else {
		parsed.Path = strings.TrimRight(parsed.Path, "/") + "/v1/models"
	}

	return parsed.String(), nil
}

func isGeminiVersionPath(path string) bool {
	path = strings.TrimRight(strings.ToLower(path), "/")
	return path == "/v1" || path == "/v1beta" ||
		strings.HasSuffix(path, "/v1") || strings.HasSuffix(path, "/v1beta")
}

func mapUpstreamProviderStatus(status int) int {
	switch status {
	case http.StatusUnauthorized,
		http.StatusForbidden,
		http.StatusNotFound,
		http.StatusConflict,
		http.StatusTooManyRequests:
		return status
	default:
		return http.StatusBadGateway
	}
}

func extractUpstreamErrorMessage(body []byte, fallback string) string {
	text := strings.TrimSpace(string(body))
	if text == "" {
		return fallback
	}

	var payload any
	if err := json.Unmarshal(body, &payload); err == nil {
		if message := findStructuredErrorMessage(payload, 0); message != "" {
			return message
		}
	}

	return text
}

func findStructuredErrorMessage(value any, depth int) string {
	if depth > 4 || value == nil {
		return ""
	}

	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case []any:
		for _, item := range typed {
			if nested := findStructuredErrorMessage(item, depth+1); nested != "" {
				return nested
			}
		}
	case map[string]any:
		for _, key := range []string{"error", "message", "detail", "details", "errorMessage", "msg", "title"} {
			if nested := findStructuredErrorMessage(typed[key], depth+1); nested != "" {
				return nested
			}
		}
	}

	return ""
}
