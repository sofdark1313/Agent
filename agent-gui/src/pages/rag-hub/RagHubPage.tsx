import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GlassPanel, HubBackdrop, HubHeader } from "../../components/hub/HubChrome";
import {
  AlertTriangle,
  BookOpen,
  Clock3,
  FileText,
  RefreshCw,
  Search,
  Trash2,
} from "../../components/icons";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { useLocale } from "../../i18n";
import { nextRagCapabilityExpiryDelay } from "../../lib/rag/capabilitySnapshot";
import { resolveRagIngestionSettings } from "./ingestionSettings";
import { RagDocumentPanel } from "./RagDocumentPanel";
import { buildRagRerankRequest } from "./rerankModel";
import {
  normalizeRagSearchSettings,
  resolveRagSearchLimits,
  toggleRagKnowledgeBase,
} from "./searchSettings";
import {
  canTestSavedRagService,
  chooseRagServiceId,
  DEFAULT_RAGENT_BASE_URL,
  filterRagKnowledgeBases,
  isValidRagServiceTimeout,
  MAX_RAG_SERVICE_TIMEOUT_MS,
  MIN_RAG_SERVICE_TIMEOUT_MS,
  resolveRagCapabilityHealth,
} from "./serviceState";

type RagCapabilities = {
  protocolVersion: string;
  capturedAtMs?: number | null;
  credentialAudience?: string | null;
  features: Record<string, boolean>;
  limits: Record<string, number>;
};

type RagService = {
  id: string;
  name: string;
  adapterType: string;
  baseUrl: string;
  enabled: boolean;
  default: boolean;
  agentEnabled: boolean;
  agentKnowledgeBaseIds: string[];
  timeoutMs: number;
  managementCredentialConfigured: boolean;
  agentCredentialConfigured: boolean;
  capabilitiesSnapshot: RagCapabilities | null;
};

type RagCredentialKind = "management" | "agent";

type RagKnowledgeBase = {
  id: string;
  name: string;
  embeddingModel: string | null;
  collectionName: string | null;
  documentCount: number | null;
};
type RagSearchHit = {
  knowledgeBaseId: string;
  documentId?: string | null;
  documentName?: string | null;
  chunkId: string;
  content: string;
  score: number;
  source: string;
  rankBefore?: number | null;
  rankAfter?: number | null;
  metadata?: Record<string, unknown>;
};

type RagSearchTimings = {
  retrievalMs: number;
  rerankMs: number;
  totalMs: number;
};

type RagSearchResponse = {
  requestId?: string | null;
  rawResults?: RagSearchHit[];
  results: RagSearchHit[];
  warnings?: string[];
  timings?: RagSearchTimings | null;
};

type Translate = (key: string) => string;

const EMPTY_SERVICE: RagService = {
  id: "local-rag",
  name: "Local RAG",
  adapterType: "ragent",
  baseUrl: DEFAULT_RAGENT_BASE_URL,
  enabled: true,
  default: true,
  agentEnabled: true,
  agentKnowledgeBaseIds: [],
  timeoutMs: 30_000,
  managementCredentialConfigured: false,
  agentCredentialConfigured: false,
  capabilitiesSnapshot: null,
};

const EMPTY_KNOWLEDGE_BASE = {
  name: "",
  embeddingModel: "",
  collectionName: "",
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function searchWarningText(t: Translate, code: string) {
  if (code === "RAG_RERANK_UNAVAILABLE") {
    return t("ragHub.search.warningRerankUnavailable");
  }
  return code;
}

function RagSearchResultColumn(props: {
  title: string;
  subtitle: string;
  hits: RagSearchHit[];
  mode: "raw" | "final";
  t: Translate;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border/45 bg-background/45 p-3.5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{props.title}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{props.subtitle}</p>
        </div>
        <span className="rounded-full border border-border/55 bg-muted/35 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          {props.t("ragHub.search.hitCount").replace("{count}", String(props.hits.length))}
        </span>
      </div>

      {props.hits.length > 0 ? (
        <div className="space-y-2.5">
          {props.hits.map((hit, index) => {
            const before = hit.rankBefore ?? index + 1;
            const after = props.mode === "final" ? hit.rankAfter : null;
            const rankChanged = after != null && before !== after;
            const rankImproved = after != null && after < before;
            const metadata = Object.entries(hit.metadata ?? {})
              .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
              .slice(0, 3);

            return (
              <article
                key={`${props.mode}:${hit.knowledgeBaseId}:${hit.chunkId}`}
                className="rounded-lg border border-border/45 bg-muted/20 p-3 transition-colors hover:bg-muted/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                      <FileText className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p
                        className="truncate text-xs font-medium"
                        title={hit.documentName ?? undefined}
                      >
                        {hit.documentName ||
                          hit.documentId ||
                          props.t("ragHub.search.sourceDocumentUnavailable")}
                      </p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {hit.knowledgeBaseId} / {hit.chunkId}
                      </p>
                    </div>
                  </div>
                  <span
                    className={
                      rankChanged
                        ? rankImproved
                          ? "shrink-0 rounded-md bg-cyan-500/12 px-2 py-1 font-mono text-[10px] font-semibold text-cyan-700 dark:text-cyan-300"
                          : "shrink-0 rounded-md bg-amber-500/12 px-2 py-1 font-mono text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                        : "shrink-0 rounded-md bg-muted/55 px-2 py-1 font-mono text-[10px] text-muted-foreground"
                    }
                    title={
                      rankChanged
                        ? props.t("ragHub.search.rankBeforeAfter")
                        : props.t("ragHub.search.currentRank")
                    }
                  >
                    {rankChanged ? `#${before} → #${after}` : `#${after ?? before}`}
                  </span>
                </div>

                <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{hit.content}</p>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
                  <span>score {hit.score.toFixed(3)}</span>
                  <span>{hit.source}</span>
                  {metadata.map(([key, value]) => (
                    <span key={key}>
                      {key} {String(value)}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/55 px-4 py-8 text-center text-xs text-muted-foreground">
          {props.t("ragHub.search.noHits")}
        </div>
      )}
    </section>
  );
}

export function RagHubPage(props: { sidebarOpen: boolean; onOpenSidebar: () => void }) {
  const { t } = useLocale();
  const [services, setServices] = useState<RagService[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<RagService>(EMPTY_SERVICE);
  const [knowledgeBases, setKnowledgeBases] = useState<RagKnowledgeBase[]>([]);
  const [knowledgeBaseId, setKnowledgeBaseId] = useState("");
  const [knowledgeBaseName, setKnowledgeBaseName] = useState("");
  const [knowledgeBaseQuery, setKnowledgeBaseQuery] = useState("");
  const [knowledgeBaseCreateOpen, setKnowledgeBaseCreateOpen] = useState(false);
  const [newKnowledgeBase, setNewKnowledgeBase] = useState(EMPTY_KNOWLEDGE_BASE);
  const [query, setQuery] = useState("");
  const [searchKnowledgeBaseIds, setSearchKnowledgeBaseIds] = useState<string[]>([]);
  const [searchTopK, setSearchTopK] = useState(10);
  const [searchRerank, setSearchRerank] = useState(true);
  const [searchTopN, setSearchTopN] = useState(5);
  const [searchResponse, setSearchResponse] = useState<RagSearchResponse | null>(null);
  const [rerankResponse, setRerankResponse] = useState<RagSearchResponse | null>(null);
  const [rerankCandidateSnapshot, setRerankCandidateSnapshot] = useState<RagSearchHit[]>([]);
  const [resultView, setResultView] = useState<"search" | "rerank">("search");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [capabilityNowMs, setCapabilityNowMs] = useState(() => Date.now());
  const rerankRequestTokenRef = useRef(0);

  const selected = useMemo(
    () => services.find((service) => service.id === selectedId) ?? null,
    [selectedId, services],
  );

  const selectedKnowledgeBase = useMemo(
    () => knowledgeBases.find((item) => item.id === knowledgeBaseId) ?? null,
    [knowledgeBaseId, knowledgeBases],
  );
  const filteredKnowledgeBases = useMemo(
    () => filterRagKnowledgeBases(knowledgeBases, knowledgeBaseQuery),
    [knowledgeBaseQuery, knowledgeBases],
  );

  const finalResults = searchResponse?.results ?? [];
  const returnedRawResults = searchResponse?.rawResults ?? [];
  const rawResults = returnedRawResults.length > 0 ? returnedRawResults : finalResults;
  const rerankCandidates = returnedRawResults.length > 0 ? returnedRawResults : finalResults;
  const rerankResults = rerankResponse?.results ?? [];
  const rerankWarnings = rerankResponse?.warnings ?? [];
  const warnings = searchResponse?.warnings ?? [];
  const searchLimits = useMemo(
    () => resolveRagSearchLimits(draft.capabilitiesSnapshot, capabilityNowMs),
    [capabilityNowMs, draft.capabilitiesSnapshot],
  );
  const ingestionSettings = useMemo(
    () => resolveRagIngestionSettings(draft.capabilitiesSnapshot, capabilityNowMs),
    [capabilityNowMs, draft.capabilitiesSnapshot],
  );
  const effectiveSearchSettings = normalizeRagSearchSettings(
    { topK: searchTopK, rerank: searchRerank, topN: searchTopN },
    searchLimits,
  );
  const canRerankCurrentCandidates =
    rerankCandidates.length > 0 && Boolean(query.trim()) && searchLimits.rerankSupported && !busy;
  const canTestService = canTestSavedRagService(selected, draft);
  const validServiceTimeout = isValidRagServiceTimeout(draft.timeoutMs);

  const handleDocumentNotice = useCallback((message: string) => {
    setError("");
    setNotice(message);
  }, []);

  const handleDocumentError = useCallback((message: string) => {
    setNotice("");
    setError(message);
  }, []);

  async function loadServices(preferredId?: string, currentId = selectedId) {
    const next = await invoke<RagService[]>("rag_list_services");
    setServices(next);
    setSelectedId(chooseRagServiceId(next, preferredId, currentId));
    return next;
  }

  useEffect(() => {
    void invoke<RagService[]>("rag_list_services")
      .then((next) => {
        setServices(next);
        setSelectedId(chooseRagServiceId(next));
      })
      .catch((reason) => setError(errorText(reason)));
  }, []);

  useEffect(() => {
    const now = Date.now();
    setCapabilityNowMs(now);
    const delay = nextRagCapabilityExpiryDelay(draft.capabilitiesSnapshot, now);
    if (delay === null) return;
    const capabilityExpiryTimer = window.setTimeout(() => setCapabilityNowMs(Date.now()), delay);
    return () => window.clearTimeout(capabilityExpiryTimer);
  }, [draft.capabilitiesSnapshot]);

  useEffect(() => {
    rerankRequestTokenRef.current += 1;
    setKnowledgeBases([]);
    setKnowledgeBaseId("");
    setKnowledgeBaseName("");
    setKnowledgeBaseQuery("");
    setKnowledgeBaseCreateOpen(false);
    setNewKnowledgeBase(EMPTY_KNOWLEDGE_BASE);
    setSearchKnowledgeBaseIds([]);
    setSearchResponse(null);
    setRerankResponse(null);
    setRerankCandidateSnapshot([]);
    setResultView("search");
    if (selected) setDraft(selected);
  }, [selected]);

  useEffect(() => {
    setKnowledgeBaseName(selectedKnowledgeBase?.name ?? "");
  }, [selectedKnowledgeBase]);

  useEffect(() => {
    const availableIds = new Set(knowledgeBases.map((item) => item.id));
    setSearchKnowledgeBaseIds((current) => {
      const retained = current.filter((id) => availableIds.has(id));
      if (retained.length > 0) return retained;
      if (knowledgeBaseId && availableIds.has(knowledgeBaseId)) return [knowledgeBaseId];
      return knowledgeBases.map((item) => item.id);
    });
  }, [knowledgeBaseId, knowledgeBases]);

  async function run(
    action: string,
    task: () => Promise<void>,
    describeError: (reason: unknown) => string = errorText,
  ) {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy("");
    }
  }

  function startNewService() {
    setSelectedId("");
    setDraft({ ...EMPTY_SERVICE, default: services.length === 0 });
    setKnowledgeBases([]);
    setKnowledgeBaseId("");
    setKnowledgeBaseName("");
    setKnowledgeBaseCreateOpen(false);
    setNewKnowledgeBase(EMPTY_KNOWLEDGE_BASE);
    setSearchKnowledgeBaseIds([]);
    setSearchResponse(null);
    setRerankResponse(null);
    setRerankCandidateSnapshot([]);
    setResultView("search");
  }

  async function saveService() {
    if (!validServiceTimeout) {
      setError(t("ragHub.service.timeoutInvalid"));
      return;
    }
    await run("save", async () => {
      const saved = await invoke<RagService>("rag_save_service", {
        request: {
          service: draft,
        },
      });
      await loadServices(saved.id);
      setNotice(t("ragHub.notice.serviceSaved"));
    });
  }

  function applyCredentialService(service: RagService) {
    setDraft(service);
    setServices((current) => current.map((item) => (item.id === service.id ? service : item)));
  }

  async function configureCredential(kind: RagCredentialKind) {
    if (!selectedId) {
      setError(t("ragHub.error.saveBeforeCredential"));
      return;
    }
    await run(`credential:${kind}`, async () => {
      const updated = await invoke<RagService | null>("rag_prompt_service_credential", {
        service_id: selectedId,
        credential_kind: kind,
      });
      if (!updated) {
        setNotice(t("ragHub.notice.credentialCancelled"));
        return;
      }
      applyCredentialService(updated);
      setNotice(t("ragHub.notice.credentialSaved"));
    });
  }

  async function clearCredential(kind: RagCredentialKind) {
    if (!selectedId) return;
    if (!window.confirm(t("ragHub.confirm.clearCredential"))) return;
    await run(`credential-clear:${kind}`, async () => {
      const updated = await invoke<RagService>("rag_clear_service_credential", {
        service_id: selectedId,
        credential_kind: kind,
      });
      applyCredentialService(updated);
      setNotice(t("ragHub.notice.credentialCleared"));
    });
  }

  async function deleteService() {
    if (!selectedId) return;
    await run("delete", async () => {
      await invoke("rag_delete_service", { service_id: selectedId });
      const remaining = await loadServices(undefined, "");
      if (remaining.length === 0) startNewService();
      setNotice(t("ragHub.notice.serviceDeleted"));
    });
  }

  async function testService() {
    if (!canTestService) {
      setError(t("ragHub.error.saveBeforeTest"));
      return;
    }
    await run("test", async () => {
      const capabilities = await invoke<RagCapabilities>("rag_test_service", {
        service_id: draft.id,
      });
      setDraft((current) => ({ ...current, capabilitiesSnapshot: capabilities }));
      setServices((current) =>
        current.map((service) =>
          service.id === draft.id ? { ...service, capabilitiesSnapshot: capabilities } : service,
        ),
      );
      setNotice(
        t("ragHub.notice.connectionSucceeded").replace("{version}", capabilities.protocolVersion),
      );
    });
  }

  async function loadKnowledgeBases() {
    await run("knowledge", async () => {
      await refreshKnowledgeBases();
    });
  }

  async function refreshKnowledgeBases(preferredId?: string) {
    const items = await invoke<RagKnowledgeBase[]>("rag_hub_list_knowledge_bases", {
      service_id: selectedId || undefined,
    });
    setKnowledgeBases(items);
    const nextId =
      (preferredId && items.some((item) => item.id === preferredId) ? preferredId : "") ||
      (items.some((item) => item.id === knowledgeBaseId) ? knowledgeBaseId : "") ||
      items[0]?.id ||
      "";
    setKnowledgeBaseId(nextId);
    return items;
  }

  async function createKnowledgeBase() {
    const payload = {
      name: newKnowledgeBase.name.trim(),
      embeddingModel: newKnowledgeBase.embeddingModel.trim(),
      collectionName: newKnowledgeBase.collectionName.trim(),
    };
    if (!payload.name || !payload.embeddingModel || !payload.collectionName) return;
    await run(
      "knowledge-create",
      async () => {
        const created = await invoke<RagKnowledgeBase>("rag_hub_create_knowledge_base", {
          service_id: selectedId || undefined,
          name: payload.name,
          embedding_model: payload.embeddingModel,
          collection_name: payload.collectionName,
        });
        await refreshKnowledgeBases(created.id);
        setKnowledgeBaseCreateOpen(false);
        setNewKnowledgeBase(EMPTY_KNOWLEDGE_BASE);
        setNotice(t("ragHub.notice.knowledgeBaseCreated").replace("{name}", created.name));
      },
      (reason) => {
        const message = errorText(reason);
        return message.includes("RAG_KB_FORBIDDEN")
          ? `${message} ${t("ragHub.error.knowledgeBaseAdminRequired")}`
          : message;
      },
    );
  }

  async function renameKnowledgeBase() {
    if (!selectedKnowledgeBase || !knowledgeBaseName.trim()) return;
    await run("knowledge-update", async () => {
      const updated = await invoke<RagKnowledgeBase>("rag_hub_update_knowledge_base", {
        service_id: selectedId || undefined,
        knowledge_base_id: selectedKnowledgeBase.id,
        name: knowledgeBaseName.trim(),
      });
      await refreshKnowledgeBases(updated.id);
      setNotice(t("ragHub.notice.knowledgeBaseRenamed").replace("{name}", updated.name));
    });
  }

  async function deleteKnowledgeBase() {
    if (!selectedKnowledgeBase) return;
    if (
      !window.confirm(
        t("ragHub.confirm.deleteKnowledgeBase").replace("{name}", selectedKnowledgeBase.name),
      )
    ) {
      return;
    }
    await run("knowledge-delete", async () => {
      await invoke("rag_hub_delete_knowledge_base", {
        service_id: selectedId || undefined,
        knowledge_base_id: selectedKnowledgeBase.id,
      });
      await refreshKnowledgeBases();
      setNotice(
        t("ragHub.notice.knowledgeBaseDeleted").replace("{name}", selectedKnowledgeBase.name),
      );
    });
  }

  function toggleAgentKnowledgeBase(knowledgeBaseId: string) {
    setDraft((current) => ({
      ...current,
      agentKnowledgeBaseIds: toggleRagKnowledgeBase(current.agentKnowledgeBaseIds, knowledgeBaseId),
    }));
    setError("");
    setNotice(t("ragHub.knowledgeBase.allowlistSaveRetest"));
  }

  async function searchKnowledge() {
    if (!query.trim() || searchKnowledgeBaseIds.length === 0) return;
    rerankRequestTokenRef.current += 1;
    const requestToken = rerankRequestTokenRef.current;
    setSearchResponse(null);
    setRerankResponse(null);
    setRerankCandidateSnapshot([]);
    setResultView("search");
    await run("search", async () => {
      try {
        const response = await invoke<RagSearchResponse>("rag_hub_search", {
          request: {
            serviceId: selectedId || undefined,
            query: query.trim(),
            knowledgeBaseIds: searchKnowledgeBaseIds,
            topK: effectiveSearchSettings.topK,
            rerank: effectiveSearchSettings.rerank,
            topN: effectiveSearchSettings.topN,
          },
        });
        if (requestToken !== rerankRequestTokenRef.current) return;
        setSearchResponse({
          requestId: response.requestId ?? null,
          rawResults: response.rawResults ?? [],
          results: response.results ?? [],
          warnings: response.warnings ?? [],
          timings: response.timings ?? null,
        });
      } catch (reason) {
        if (requestToken !== rerankRequestTokenRef.current) return;
        throw reason;
      }
    });
  }

  async function rerankCurrentCandidates() {
    if (!canRerankCurrentCandidates) return;
    const requestToken = ++rerankRequestTokenRef.current;
    await run("rerank", async () => {
      try {
        const response = await invoke<RagSearchResponse>("rag_hub_rerank", {
          request: buildRagRerankRequest({
            serviceId: selectedId || undefined,
            query,
            hits: rerankCandidates,
            topN: effectiveSearchSettings.topN,
            capabilities: draft.capabilitiesSnapshot,
          }),
        });
        if (requestToken !== rerankRequestTokenRef.current) return;
        setRerankCandidateSnapshot(rerankCandidates);
        setRerankResponse({
          requestId: response.requestId ?? null,
          rawResults: response.rawResults ?? [],
          results: response.results ?? [],
          warnings: response.warnings ?? [],
          timings: response.timings ?? null,
        });
        setResultView("rerank");
        setNotice(t("ragHub.notice.rerankComplete"));
      } catch (reason) {
        if (requestToken !== rerankRequestTokenRef.current) return;
        throw reason;
      }
    });
  }

  return (
    <div
      data-agent-rag-hub
      className="hub-page hub-page-enter relative flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <HubBackdrop tone="neutral" />
      <div className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden">
        <HubHeader
          icon={<BookOpen className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
          title="RAG"
          subtitle={t("ragHub.subtitle")}
          sidebarOpen={props.sidebarOpen}
          onOpenSidebar={props.onOpenSidebar}
          actions={<Button onClick={startNewService}>{t("ragHub.service.add")}</Button>}
        />
        <div className="hub-scroll min-h-0 flex-1 overflow-auto px-5 pb-8 pt-5 sm:px-6 lg:px-8 xl:px-10">
          <div className="mx-auto grid w-full max-w-[1320px] gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="space-y-3">
              <div className="flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <span>{t("ragHub.service.title")}</span>
                <span>{services.length}</span>
              </div>
              {services.map((service) => {
                const serviceCapabilityHealth = resolveRagCapabilityHealth(
                  service.capabilitiesSnapshot,
                  capabilityNowMs,
                );
                const healthClass =
                  serviceCapabilityHealth === "valid"
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : serviceCapabilityHealth === "expired"
                      ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      : serviceCapabilityHealth === "incompatible"
                        ? "border-destructive/25 bg-destructive/10 text-destructive"
                        : "border-border/55 bg-muted/40 text-muted-foreground";
                return (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => setSelectedId(service.id)}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition ${selectedId === service.id ? "border-cyan-500/40 bg-cyan-500/[0.07]" : "border-border/45 bg-background/55 hover:bg-muted/45"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium">{service.name}</span>
                      <span
                        className={`h-2 w-2 rounded-full ${service.enabled ? "bg-emerald-500" : "bg-muted-foreground/35"}`}
                      />
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {service.baseUrl}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                      {service.default ? (
                        <span className="rounded bg-muted px-1.5 py-0.5">
                          {t("ragHub.service.defaultBadge")}
                        </span>
                      ) : null}
                      {service.agentEnabled ? (
                        <span className="rounded bg-muted px-1.5 py-0.5">Agent</span>
                      ) : null}
                    </div>
                    <dl className="mt-2 grid gap-1 border-t border-border/35 pt-2 text-[10px] text-muted-foreground">
                      <div className="flex items-center justify-between gap-2">
                        <dt>{t("ragHub.service.managementCredential")}</dt>
                        <dd>
                          {service.managementCredentialConfigured
                            ? t("ragHub.credential.configuredShort")
                            : t("ragHub.credential.notConfigured")}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt>{t("ragHub.service.agentCredential")}</dt>
                        <dd>
                          {service.agentCredentialConfigured
                            ? t("ragHub.credential.configuredShort")
                            : t("ragHub.credential.notConfigured")}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt>{t("ragHub.service.protocolVersion")}</dt>
                        <dd className="font-mono">
                          {service.capabilitiesSnapshot?.protocolVersion || "—"}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt>{t("ragHub.service.capabilityHealth")}</dt>
                        <dd className={`rounded-full border px-1.5 py-0.5 ${healthClass}`}>
                          {t(`ragHub.service.capabilityStatus.${serviceCapabilityHealth}`)}
                        </dd>
                      </div>
                    </dl>
                  </button>
                );
              })}
              {services.length === 0 ? (
                <p className="px-1 text-sm text-muted-foreground">{t("ragHub.service.empty")}</p>
              ) : null}
            </aside>

            <main className="space-y-5">
              {error ? (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </div>
              ) : notice ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-lg border border-cyan-500/25 bg-cyan-500/[0.06] px-3 py-2 text-sm text-foreground"
                >
                  {notice}
                </div>
              ) : null}

              <GlassPanel className="p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{t("ragHub.service.connectionConfig")}</h2>
                    <p className="text-xs text-muted-foreground">{t("ragHub.credential.noEcho")}</p>
                  </div>
                  <div className="flex gap-2">
                    {selected ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={deleteService}
                        disabled={Boolean(busy)}
                        title={t("ragHub.service.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      onClick={testService}
                      disabled={Boolean(busy) || !canTestService}
                      title={
                        canTestService
                          ? t("ragHub.service.testSavedTitle")
                          : t("ragHub.service.saveFirstTitle")
                      }
                    >
                      {busy === "test" ? t("ragHub.service.testing") : t("ragHub.service.test")}
                    </Button>
                    <Button
                      onClick={saveService}
                      disabled={
                        Boolean(busy) || !draft.id || !draft.baseUrl || !validServiceTimeout
                      }
                    >
                      {busy === "save" ? t("ragHub.common.saving") : t("ragHub.service.save")}
                    </Button>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>{t("ragHub.service.id")}</Label>
                    <Input
                      value={draft.id}
                      disabled={Boolean(selected)}
                      onChange={(event) => setDraft({ ...draft, id: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("ragHub.common.displayName")}</Label>
                    <Input
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rag-service-adapter">{t("ragHub.service.adapter")}</Label>
                    <select
                      id="rag-service-adapter"
                      value={draft.adapterType}
                      disabled
                      className="h-10 w-full rounded-md border border-input bg-muted/25 px-3 text-sm text-muted-foreground disabled:cursor-not-allowed disabled:opacity-100"
                    >
                      <option value="ragent">ragent</option>
                    </select>
                    <p className="text-[10px] text-muted-foreground">
                      {t("ragHub.service.adapterHint")}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rag-service-timeout">{t("ragHub.service.timeout")}</Label>
                    <Input
                      id="rag-service-timeout"
                      type="number"
                      min={MIN_RAG_SERVICE_TIMEOUT_MS}
                      max={MAX_RAG_SERVICE_TIMEOUT_MS}
                      step={1_000}
                      value={draft.timeoutMs}
                      aria-invalid={!validServiceTimeout}
                      onChange={(event) =>
                        setDraft({ ...draft, timeoutMs: Number(event.target.value) })
                      }
                    />
                    <p
                      className={
                        validServiceTimeout
                          ? "text-[10px] text-muted-foreground"
                          : "text-[10px] text-destructive"
                      }
                    >
                      {validServiceTimeout
                        ? t("ragHub.service.timeoutHint")
                            .replace("{min}", String(MIN_RAG_SERVICE_TIMEOUT_MS))
                            .replace("{max}", String(MAX_RAG_SERVICE_TIMEOUT_MS))
                        : t("ragHub.service.timeoutInvalid")}
                    </p>
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>{t("ragHub.service.baseUrl")}</Label>
                    <Input
                      value={draft.baseUrl}
                      onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                      placeholder={DEFAULT_RAGENT_BASE_URL}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("ragHub.credential.management")}</Label>
                    <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-border/55 bg-muted/20 px-3">
                      <span className="text-xs text-muted-foreground">
                        {draft.managementCredentialConfigured
                          ? t("ragHub.credential.configured")
                          : t("ragHub.credential.notConfigured")}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!selectedId || Boolean(busy)}
                          onClick={() => configureCredential("management")}
                        >
                          {draft.managementCredentialConfigured
                            ? t("ragHub.credential.replace")
                            : t("ragHub.credential.nativeInput")}
                        </Button>
                        {draft.managementCredentialConfigured ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={Boolean(busy)}
                            className="text-destructive hover:text-destructive"
                            onClick={() => clearCredential("management")}
                          >
                            {t("ragHub.common.clear")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {t("ragHub.credential.managementHint")}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("ragHub.credential.agent")}</Label>
                    <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-border/55 bg-muted/20 px-3">
                      <span className="text-xs text-muted-foreground">
                        {draft.agentCredentialConfigured
                          ? t("ragHub.credential.configured")
                          : t("ragHub.credential.notConfigured")}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!selectedId || Boolean(busy)}
                          onClick={() => configureCredential("agent")}
                        >
                          {draft.agentCredentialConfigured
                            ? t("ragHub.credential.replace")
                            : t("ragHub.credential.nativeInput")}
                        </Button>
                        {draft.agentCredentialConfigured ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={Boolean(busy)}
                            className="text-destructive hover:text-destructive"
                            onClick={() => clearCredential("agent")}
                          >
                            {t("ragHub.common.clear")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {t("ragHub.credential.agentHint")}
                    </p>
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>{t("ragHub.credential.knowledgeBaseAllowlist")}</Label>
                    <Input
                      value={draft.agentKnowledgeBaseIds.join(", ")}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          agentKnowledgeBaseIds: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="hr, policy"
                    />
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-5 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                    />
                    {t("ragHub.service.enable")}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.default}
                      onChange={(event) => setDraft({ ...draft, default: event.target.checked })}
                    />
                    {t("ragHub.service.setDefault")}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.agentEnabled}
                      onChange={(event) =>
                        setDraft({ ...draft, agentEnabled: event.target.checked })
                      }
                    />
                    {t("ragHub.service.enableForAgent")}
                  </label>
                </div>
              </GlassPanel>

              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-5">
                  <GlassPanel className="p-5">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-semibold">{t("ragHub.knowledgeBase.title")}</h2>
                        <p className="text-xs text-muted-foreground">
                          {t("ragHub.knowledgeBase.subtitle")}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setKnowledgeBaseCreateOpen((current) => !current)}
                          disabled={!selectedId || Boolean(busy)}
                        >
                          {t("ragHub.common.create")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={loadKnowledgeBases}
                          disabled={!selectedId || Boolean(busy)}
                        >
                          <RefreshCw className="mr-2 h-3.5 w-3.5" />
                          {t("ragHub.common.refresh")}
                        </Button>
                      </div>
                    </div>

                    {knowledgeBaseCreateOpen ? (
                      <div className="mb-4 rounded-xl border border-cyan-500/25 bg-cyan-500/[0.04] p-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5 sm:col-span-2">
                            <Label>{t("ragHub.knowledgeBase.name")}</Label>
                            <Input
                              value={newKnowledgeBase.name}
                              onChange={(event) =>
                                setNewKnowledgeBase({
                                  ...newKnowledgeBase,
                                  name: event.target.value,
                                })
                              }
                              placeholder={t("ragHub.knowledgeBase.namePlaceholder")}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>{t("ragHub.knowledgeBase.embeddingModel")}</Label>
                            <Input
                              value={newKnowledgeBase.embeddingModel}
                              onChange={(event) =>
                                setNewKnowledgeBase({
                                  ...newKnowledgeBase,
                                  embeddingModel: event.target.value,
                                })
                              }
                              placeholder="text-embedding-v3"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>{t("ragHub.knowledgeBase.collectionName")}</Label>
                            <Input
                              value={newKnowledgeBase.collectionName}
                              onChange={(event) =>
                                setNewKnowledgeBase({
                                  ...newKnowledgeBase,
                                  collectionName: event.target.value,
                                })
                              }
                              placeholder="company-policy"
                            />
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                          <p className="text-[11px] text-muted-foreground">
                            {t("ragHub.knowledgeBase.createHint")}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setKnowledgeBaseCreateOpen(false);
                                setNewKnowledgeBase(EMPTY_KNOWLEDGE_BASE);
                              }}
                              disabled={Boolean(busy)}
                            >
                              {t("ragHub.common.cancel")}
                            </Button>
                            <Button
                              size="sm"
                              onClick={createKnowledgeBase}
                              disabled={
                                Boolean(busy) ||
                                !newKnowledgeBase.name.trim() ||
                                !newKnowledgeBase.embeddingModel.trim() ||
                                !newKnowledgeBase.collectionName.trim()
                              }
                            >
                              {busy === "knowledge-create"
                                ? t("ragHub.common.creating")
                                : t("ragHub.knowledgeBase.create")}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="mb-3 space-y-1.5">
                      <Label htmlFor="rag-knowledge-base-search" className="sr-only">
                        {t("ragHub.knowledgeBase.searchLabel")}
                      </Label>
                      <Input
                        id="rag-knowledge-base-search"
                        type="search"
                        value={knowledgeBaseQuery}
                        onChange={(event) => setKnowledgeBaseQuery(event.target.value)}
                        placeholder={t("ragHub.knowledgeBase.searchPlaceholder")}
                      />
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      {filteredKnowledgeBases.map((item) => {
                        const allowedForAgent = draft.agentKnowledgeBaseIds.includes(item.id);
                        return (
                          <div
                            key={item.id}
                            className={`overflow-hidden rounded-xl border text-sm transition ${knowledgeBaseId === item.id ? "border-cyan-500/40 bg-cyan-500/[0.07] shadow-sm" : "border-border/50 bg-background/35"}`}
                          >
                            <button
                              type="button"
                              onClick={() => setKnowledgeBaseId(item.id)}
                              className="w-full px-3 py-2.5 text-left hover:bg-muted/25"
                            >
                              <span className="flex items-center justify-between gap-2">
                                <span className="truncate font-medium">{item.name}</span>
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  {t("ragHub.knowledgeBase.documentCount").replace(
                                    "{count}",
                                    String(item.documentCount ?? 0),
                                  )}
                                </span>
                              </span>
                              <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                                {item.id}
                              </span>
                            </button>
                            <div className="flex items-center justify-between gap-2 border-t border-border/35 px-3 py-2">
                              <span className="text-[10px] text-muted-foreground">
                                {t("ragHub.knowledgeBase.agentAccess")}
                              </span>
                              <button
                                type="button"
                                aria-pressed={allowedForAgent}
                                onClick={() => toggleAgentKnowledgeBase(item.id)}
                                className={
                                  allowedForAgent
                                    ? "rounded-full border border-cyan-500/35 bg-cyan-500/12 px-2 py-1 text-[10px] font-medium text-cyan-800 dark:text-cyan-200"
                                    : "rounded-full border border-border/55 bg-background/55 px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/45"
                                }
                              >
                                {allowedForAgent
                                  ? t("ragHub.knowledgeBase.removeFromAgent")
                                  : t("ragHub.knowledgeBase.addToAgent")}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {!knowledgeBases.length ? (
                        <span className="text-sm text-muted-foreground sm:col-span-2">
                          {t("ragHub.knowledgeBase.empty")}
                        </span>
                      ) : null}
                      {knowledgeBases.length > 0 && !filteredKnowledgeBases.length ? (
                        <span className="text-sm text-muted-foreground sm:col-span-2">
                          {t("ragHub.knowledgeBase.noMatches")}
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-3 text-[10px] text-muted-foreground">
                      {t("ragHub.knowledgeBase.allowlistSaveRetest")}
                    </p>

                    {selectedKnowledgeBase ? (
                      <div className="mt-4 border-t border-border/45 pt-4">
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                          <div className="space-y-1.5">
                            <Label>{t("ragHub.common.displayName")}</Label>
                            <Input
                              value={knowledgeBaseName}
                              onChange={(event) => setKnowledgeBaseName(event.target.value)}
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={renameKnowledgeBase}
                              disabled={
                                Boolean(busy) ||
                                !knowledgeBaseName.trim() ||
                                knowledgeBaseName.trim() === selectedKnowledgeBase.name
                              }
                            >
                              {busy === "knowledge-update"
                                ? t("ragHub.common.saving")
                                : t("ragHub.knowledgeBase.saveName")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={deleteKnowledgeBase}
                              disabled={
                                Boolean(busy) || (selectedKnowledgeBase.documentCount ?? 0) > 0
                              }
                              title={
                                (selectedKnowledgeBase.documentCount ?? 0) > 0
                                  ? t("ragHub.knowledgeBase.deleteDocumentsFirst")
                                  : t("ragHub.knowledgeBase.deleteEmpty")
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                          <span className="truncate font-mono">
                            {t("ragHub.knowledgeBase.modelLabel")}
                            {selectedKnowledgeBase.embeddingModel || t("ragHub.common.notReturned")}
                          </span>
                          <span className="truncate font-mono">
                            {t("ragHub.knowledgeBase.collectionLabel")}
                            {selectedKnowledgeBase.collectionName || t("ragHub.common.notReturned")}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </GlassPanel>

                  <RagDocumentPanel
                    serviceId={selectedId}
                    knowledgeBaseId={knowledgeBaseId}
                    ingestionSettings={ingestionSettings}
                    onNotice={handleDocumentNotice}
                    onError={handleDocumentError}
                  />
                </div>

                <GlassPanel className="p-5">
                  <div className="mb-4">
                    <h2 className="font-semibold">{t("ragHub.search.title")}</h2>
                    <p className="text-xs text-muted-foreground">{t("ragHub.search.subtitle")}</p>
                  </div>
                  <div className="rounded-xl border border-border/45 bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium">{t("ragHub.search.scope")}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {t("ragHub.search.scopeHint")}
                        </p>
                      </div>
                      {knowledgeBases.length > 0 ? (
                        <div className="flex items-center gap-1 text-[11px]">
                          <button
                            type="button"
                            className="rounded px-2 py-1 text-cyan-700 hover:bg-cyan-500/10 dark:text-cyan-300"
                            onClick={() =>
                              setSearchKnowledgeBaseIds(knowledgeBases.map((item) => item.id))
                            }
                          >
                            {t("ragHub.common.selectAll")}
                          </button>
                          <button
                            type="button"
                            className="rounded px-2 py-1 text-muted-foreground hover:bg-muted/60"
                            onClick={() => setSearchKnowledgeBaseIds([])}
                          >
                            {t("ragHub.common.clear")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {knowledgeBases.length > 0 ? (
                      <div className="mt-3 flex max-h-28 flex-wrap gap-2 overflow-auto">
                        {knowledgeBases.map((item) => {
                          const active = searchKnowledgeBaseIds.includes(item.id);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              aria-pressed={active}
                              className={
                                active
                                  ? "rounded-full border border-cyan-500/35 bg-cyan-500/12 px-3 py-1.5 text-xs font-medium text-cyan-800 dark:text-cyan-200"
                                  : "rounded-full border border-border/55 bg-background/55 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/45"
                              }
                              onClick={() =>
                                setSearchKnowledgeBaseIds((current) =>
                                  toggleRagKnowledgeBase(current, item.id),
                                )
                              }
                            >
                              {item.name}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-muted-foreground">
                        {t("ragHub.search.loadKnowledgeBasesFirst")}
                      </p>
                    )}
                  </div>

                  <Label htmlFor="rag-search-query" className="sr-only">
                    {t("ragHub.search.queryLabel")}
                  </Label>
                  <div className="relative mt-3">
                    <Textarea
                      id="rag-search-query"
                      value={query}
                      onChange={(event) => {
                        rerankRequestTokenRef.current += 1;
                        setQuery(event.target.value);
                      }}
                      maxLength={searchLimits.maxQueryLength}
                      placeholder={t("ragHub.search.queryPlaceholder")}
                      className="min-h-24 pb-7"
                    />
                    <span className="pointer-events-none absolute bottom-2 right-3 font-mono text-[10px] text-muted-foreground">
                      {query.length}/{searchLimits.maxQueryLength}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-3 rounded-xl border border-border/45 bg-background/35 p-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="rag-search-top-k">{t("ragHub.search.topK")}</Label>
                      <Input
                        id="rag-search-top-k"
                        type="number"
                        min={1}
                        max={searchLimits.maxTopK}
                        value={effectiveSearchSettings.topK}
                        onChange={(event) => setSearchTopK(Number(event.target.value))}
                      />
                      <p className="text-[10px] text-muted-foreground">
                        {t("ragHub.search.serviceLimit").replace(
                          "{limit}",
                          String(searchLimits.maxTopK),
                        )}
                      </p>
                    </div>

                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/45 bg-muted/20 px-3 py-2.5 sm:self-start">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-cyan-600"
                        checked={effectiveSearchSettings.rerank}
                        disabled={!searchLimits.rerankSupported}
                        onChange={(event) => setSearchRerank(event.target.checked)}
                      />
                      <span>
                        <span className="block text-xs font-medium">
                          {t("ragHub.search.enableRerank")}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          {searchLimits.rerankSupported
                            ? t("ragHub.search.rerankHint")
                            : t("ragHub.search.rerankUnsupported")}
                        </span>
                      </span>
                    </label>

                    <div className="space-y-1.5">
                      <Label htmlFor="rag-search-top-n">{t("ragHub.search.topN")}</Label>
                      <Input
                        id="rag-search-top-n"
                        type="number"
                        min={1}
                        max={searchLimits.maxTopN}
                        value={effectiveSearchSettings.topN}
                        disabled={!effectiveSearchSettings.rerank}
                        onChange={(event) => {
                          rerankRequestTokenRef.current += 1;
                          setSearchTopN(Number(event.target.value));
                        }}
                      />
                      <p className="text-[10px] text-muted-foreground">
                        {t("ragHub.search.serviceLimit").replace(
                          "{limit}",
                          String(searchLimits.maxTopN),
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      onClick={searchKnowledge}
                      aria-busy={busy === "search"}
                      disabled={
                        !selectedId ||
                        !searchLimits.searchSupported ||
                        !query.trim() ||
                        searchKnowledgeBaseIds.length === 0 ||
                        Boolean(busy)
                      }
                    >
                      <Search className="mr-2 h-4 w-4" />
                      {busy === "search" ? t("ragHub.search.searching") : t("ragHub.search.start")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={rerankCurrentCandidates}
                      aria-busy={busy === "rerank"}
                      disabled={!canRerankCurrentCandidates}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      {busy === "rerank"
                        ? t("ragHub.search.rerankingCandidates")
                        : t("ragHub.search.rerankCandidates")}
                    </Button>
                    <span className="sr-only" role="status" aria-live="polite">
                      {busy === "search"
                        ? t("ragHub.search.searchingAnnouncement")
                        : busy === "rerank"
                          ? t("ragHub.search.rerankingAnnouncement")
                          : ""}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {t("ragHub.search.selectedKnowledgeBases").replace(
                        "{count}",
                        String(searchKnowledgeBaseIds.length),
                      )}
                      {draft.capabilitiesSnapshot
                        ? t("ragHub.search.capabilityLimits")
                        : t("ragHub.search.localLimits")}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {draft.capabilitiesSnapshot?.features?.rerank === true
                        ? t("ragHub.search.rerankCandidateCount").replace(
                            "{count}",
                            String(rerankCandidates.length),
                          )
                        : t("ragHub.search.rerankCapabilityRequired")}
                    </span>
                  </div>
                  {searchResponse ? (
                    <div className="mt-4 space-y-4">
                      {rerankResponse ? (
                        <fieldset className="inline-flex rounded-lg border border-border/55 bg-muted/25 p-1">
                          <legend className="sr-only">{t("ragHub.search.resultViewLegend")}</legend>
                          <button
                            type="button"
                            aria-pressed={resultView === "search"}
                            className={
                              resultView === "search"
                                ? "rounded-md bg-background px-3 py-1.5 text-xs font-medium text-cyan-800 shadow-sm dark:text-cyan-200"
                                : "rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                            }
                            onClick={() => setResultView("search")}
                          >
                            {t("ragHub.search.results")}
                          </button>
                          <button
                            type="button"
                            aria-pressed={resultView === "rerank"}
                            className={
                              resultView === "rerank"
                                ? "rounded-md bg-background px-3 py-1.5 text-xs font-medium text-cyan-800 shadow-sm dark:text-cyan-200"
                                : "rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                            }
                            onClick={() => setResultView("rerank")}
                          >
                            {t("ragHub.search.rerankedResults")}
                          </button>
                        </fieldset>
                      ) : null}

                      {resultView === "search" ? (
                        <>
                          {searchResponse.timings || searchResponse.requestId ? (
                            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/45 bg-muted/20 p-3">
                              <div className="mr-1 flex items-center gap-2 text-xs font-medium">
                                <Clock3 className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                                {t("ragHub.search.searchTiming")}
                              </div>
                              {searchResponse.timings ? (
                                <>
                                  <span className="rounded-md bg-background/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                                    {t("ragHub.search.retrievalTiming").replace(
                                      "{ms}",
                                      String(searchResponse.timings.retrievalMs),
                                    )}
                                  </span>
                                  <span className="rounded-md bg-background/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                                    {t("ragHub.search.rerankTiming").replace(
                                      "{ms}",
                                      String(searchResponse.timings.rerankMs),
                                    )}
                                  </span>
                                  <span className="rounded-md bg-cyan-500/10 px-2 py-1 font-mono text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">
                                    {t("ragHub.search.totalTiming").replace(
                                      "{ms}",
                                      String(searchResponse.timings.totalMs),
                                    )}
                                  </span>
                                </>
                              ) : null}
                              {searchResponse.requestId ? (
                                <span
                                  className="ml-auto max-w-full truncate font-mono text-[10px] text-muted-foreground"
                                  title={searchResponse.requestId}
                                >
                                  {t("ragHub.search.requestId").replace(
                                    "{id}",
                                    searchResponse.requestId,
                                  )}
                                </span>
                              ) : null}
                            </div>
                          ) : null}

                          {warnings.length > 0 ? (
                            <div className="space-y-2" role="status">
                              {warnings.map((warning) => (
                                <div
                                  key={warning}
                                  className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
                                >
                                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                  <span>{searchWarningText(t, warning)}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}

                          {returnedRawResults.length === 0 && finalResults.length > 0 ? (
                            <p className="text-[11px] text-muted-foreground">
                              {t("ragHub.search.rawResultsFallback")}
                            </p>
                          ) : null}

                          <div className="grid gap-4 lg:grid-cols-2">
                            <RagSearchResultColumn
                              title={t("ragHub.search.rawResults")}
                              subtitle={t("ragHub.search.rawResultsSubtitle")}
                              hits={rawResults}
                              mode="raw"
                              t={t}
                            />
                            <RagSearchResultColumn
                              title={t("ragHub.search.finalResults")}
                              subtitle={t("ragHub.search.finalResultsSubtitle")}
                              hits={finalResults}
                              mode="final"
                              t={t}
                            />
                          </div>
                        </>
                      ) : rerankResponse ? (
                        <>
                          {rerankResponse.timings || rerankResponse.requestId ? (
                            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                              <div className="mr-1 flex items-center gap-2 text-xs font-medium">
                                <Clock3 className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                                {t("ragHub.search.independentRerankTiming")}
                              </div>
                              {rerankResponse.timings ? (
                                <>
                                  <span className="rounded-md bg-background/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                                    {t("ragHub.search.candidateTiming").replace(
                                      "{ms}",
                                      String(rerankResponse.timings.retrievalMs),
                                    )}
                                  </span>
                                  <span className="rounded-md bg-background/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                                    {t("ragHub.search.rerankTiming").replace(
                                      "{ms}",
                                      String(rerankResponse.timings.rerankMs),
                                    )}
                                  </span>
                                  <span className="rounded-md bg-cyan-500/10 px-2 py-1 font-mono text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">
                                    {t("ragHub.search.totalTiming").replace(
                                      "{ms}",
                                      String(rerankResponse.timings.totalMs),
                                    )}
                                  </span>
                                </>
                              ) : null}
                              {rerankResponse.requestId ? (
                                <span
                                  className="ml-auto max-w-full truncate font-mono text-[10px] text-muted-foreground"
                                  title={rerankResponse.requestId}
                                >
                                  {t("ragHub.search.requestId").replace(
                                    "{id}",
                                    rerankResponse.requestId,
                                  )}
                                </span>
                              ) : null}
                            </div>
                          ) : null}

                          {rerankWarnings.length > 0 ? (
                            <div className="space-y-2" role="status">
                              {rerankWarnings.map((warning) => (
                                <div
                                  key={warning}
                                  className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
                                >
                                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                  <span>{searchWarningText(t, warning)}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}

                          <div className="grid gap-4 lg:grid-cols-2">
                            <RagSearchResultColumn
                              title={t("ragHub.search.candidateInput")}
                              subtitle={t("ragHub.search.candidateInputSubtitle")}
                              hits={rerankCandidateSnapshot}
                              mode="raw"
                              t={t}
                            />
                            <RagSearchResultColumn
                              title={t("ragHub.search.rerankedResults")}
                              subtitle={t("ragHub.search.independentRerankSubtitle")}
                              hits={rerankResults}
                              mode="final"
                              t={t}
                            />
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-dashed border-border/55 px-4 py-8 text-center text-xs text-muted-foreground">
                      {t("ragHub.search.empty")}
                    </div>
                  )}
                </GlassPanel>
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
