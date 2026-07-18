# agent-gateway tests

All project-level gateway tests live under `agent-gateway/test` and are split by boundary:

| Directory | Coverage |
| --- | --- |
| `auth/` | HTTP bearer parsing and gRPC interceptor auth behavior |
| `http/` | Gateway HTTP route auth, `/api/status`, and SPA fallback |
| `upload/` | `/api/files/import` validation, multipart parsing, and agent forwarding |
| `websocket/` | WebSocket auth, request forwarding, chat streaming, and cancellation-facing events |
| `webui/` | Browser-side WebUI helpers, auth, upload normalization, history state, live stream state, and WebSocket client behavior |
| `../web/test/` | WebUI source-adjacent module tests for chat transcript, history scope, and live conversation commit helpers |
| `helpers/` | Shared Node test module loader for WebUI TypeScript modules |

Run Go-side tests from `agent-gateway`:

```sh
go test ./...
```

Run WebUI Node tests from `agent-gateway`:

```sh
node --test test/webui/*.test.mjs web/test/*.test.mjs
```

Run the WebUI type/build gate separately from `agent-gateway/web`:

```sh
pnpm build
```
