package handler

import (
	"net/http"

	"github.com/liveagent/agent-gateway/internal/session"
)

func Status(sm *session.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, sm.Status())
	}
}
