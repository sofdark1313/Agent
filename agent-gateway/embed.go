package gateway

import "embed"

// WebUIAssets contains the embedded WebUI build output served by the HTTP server.
//
// The all: prefix is required because Vite may emit chunks whose names begin
// with "_" (for example, lodash's _baseFor chunk). Plain directory embeds
// silently exclude files and directories beginning with "." or "_".
//
//go:embed all:web/dist
var WebUIAssets embed.FS
