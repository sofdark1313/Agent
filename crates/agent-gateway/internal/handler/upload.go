package handler

import (
	"context"
	"io"
	"net/http"
	"strings"
	"time"

	gatewayv1 "github.com/liveagent/agent-gateway/internal/proto/v1"
	"github.com/liveagent/agent-gateway/internal/session"
)

const maxReadableUploadBytes int64 = 100 << 20 // 100 MiB

func ImportReadableFiles(
	sm *session.Manager,
	requestTimeout time.Duration,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sm.IsOnline() {
			writeError(w, http.StatusServiceUnavailable, "agent offline")
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxReadableUploadBytes)
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			status := http.StatusBadRequest
			message := "invalid multipart form"
			if strings.Contains(err.Error(), "http: request body too large") {
				status = http.StatusRequestEntityTooLarge
				message = "uploaded files are too large"
			}
			writeError(w, status, message)
			return
		}
		if r.MultipartForm != nil {
			defer r.MultipartForm.RemoveAll()
		}

		workdir := strings.TrimSpace(r.FormValue("workdir"))
		if workdir == "" {
			writeError(w, http.StatusBadRequest, "workdir is required")
			return
		}

		fileHeaders := r.MultipartForm.File["files"]
		if len(fileHeaders) == 0 {
			writeError(w, http.StatusBadRequest, "files is required")
			return
		}

		uploads := make([]*gatewayv1.UploadReadableFile, 0, len(fileHeaders))
		for _, header := range fileHeaders {
			file, err := header.Open()
			if err != nil {
				writeError(w, http.StatusBadRequest, "failed to read uploaded files")
				return
			}

			content, readErr := io.ReadAll(file)
			closeErr := file.Close()
			if readErr != nil {
				writeError(w, http.StatusBadRequest, "failed to read uploaded files")
				return
			}
			if closeErr != nil {
				writeError(w, http.StatusBadRequest, "failed to finalize uploaded files")
				return
			}

			uploads = append(uploads, &gatewayv1.UploadReadableFile{
				FileName: header.Filename,
				MimeType: strings.TrimSpace(header.Header.Get("Content-Type")),
				Content:  content,
			})
		}

		ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
		defer cancel()

		requestID := newRequestID()
		ch, done, cleanup, err := sm.RegisterStreamAndSendContext(ctx, requestID, &gatewayv1.GatewayEnvelope{
			RequestId: requestID,
			Timestamp: time.Now().Unix(),
			Payload: &gatewayv1.GatewayEnvelope_UploadReadableFiles{
				UploadReadableFiles: &gatewayv1.UploadReadableFilesRequest{
					Workdir: workdir,
					Files:   uploads,
				},
			},
		})
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "agent offline")
			return
		}
		defer cleanup()

		env, err := waitForEnvelope(ctx, ch, done)
		if err != nil {
			writeError(w, http.StatusGatewayTimeout, errorMessage(err, "request failed"))
			return
		}
		if errResp := env.GetError(); errResp != nil {
			writeError(w, GatewayErrorStatus(errResp), errResp.GetMessage())
			return
		}

		resp := env.GetUploadReadableFilesResp()
		if resp == nil {
			writeError(w, http.StatusBadGateway, "unexpected agent response")
			return
		}

		files := make([]map[string]any, 0, len(resp.GetFiles()))
		for _, file := range resp.GetFiles() {
			files = append(files, map[string]any{
				"relativePath": file.GetRelativePath(),
				"absolutePath": file.GetAbsolutePath(),
				"fileName":     file.GetFileName(),
				"kind":         file.GetKind(),
				"sizeBytes":    file.GetSizeBytes(),
			})
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"files":   files,
			"skipped": resp.GetSkipped(),
		})
	}
}
