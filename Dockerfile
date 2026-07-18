# syntax=docker/dockerfile:1.7

FROM node:22.17.1-bookworm-slim AS webui

WORKDIR /src/agent-gateway/web
RUN npm install -g pnpm@10.32.1

COPY agent-gateway/web/package.json agent-gateway/web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY agent-gateway/web ./
RUN pnpm build

FROM golang:1.25-bookworm AS gateway-builder

ARG TARGETOS=linux
ARG TARGETARCH=amd64

WORKDIR /src/agent-gateway

COPY agent-gateway/go.mod agent-gateway/go.sum ./
RUN go mod download

COPY agent-gateway ./
COPY --from=webui /src/agent-gateway/web/dist ./web/dist

RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/agent-gateway ./cmd/gateway

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 10001 --user-group --home-dir /nonexistent --shell /usr/sbin/nologin agent \
    && install -d -o agent -g agent -m 0700 /var/lib/agent

COPY --from=gateway-builder /out/agent-gateway /usr/local/bin/agent-gateway

USER agent

ENV PORT=8080
ENV AGENT_GATEWAY_GRPC_ADDR=:50051

EXPOSE 8080 50051

ENTRYPOINT ["/usr/local/bin/agent-gateway"]
