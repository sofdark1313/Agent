import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { RagDocumentPanel } from "./RagDocumentPanel";
import {
  normalizeRagSearchSettings,
  resolveRagSearchLimits,
  toggleRagKnowledgeBase,
} from "./searchSettings";
import { canTestSavedRagService, chooseRagServiceId } from "./serviceState";

type RagCapabilities = {
  protocolVersion: string;
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

const EMPTY_SERVICE: RagService = {
  id: "local-rag",
  name: "Local RAG",
  adapterType: "ragent",
  baseUrl: "http://localhost:8080",
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

function searchWarningText(code: string) {
  if (code === "RAG_RERANK_UNAVAILABLE") {
    return "重排服务暂不可用，已回退为原始召回顺序。";
  }
  return code;
}

function RagSearchResultColumn(props: {
  title: string;
  subtitle: string;
  hits: RagSearchHit[];
  mode: "raw" | "final";
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border/45 bg-background/45 p-3.5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{props.title}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{props.subtitle}</p>
        </div>
        <span className="rounded-full border border-border/55 bg-muted/35 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          {props.hits.length} 条
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
                        {hit.documentName || hit.documentId || "来源文档未返回"}
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
                    title={rankChanged ? "重排前 → 重排后" : "当前排名"}
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
          没有命中结果
        </div>
      )}
    </section>
  );
}

export function RagHubPage(props: { sidebarOpen: boolean; onOpenSidebar: () => void }) {
  const [services, setServices] = useState<RagService[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<RagService>(EMPTY_SERVICE);
  const [managementApiKey, setManagementApiKey] = useState("");
  const [agentApiKey, setAgentApiKey] = useState("");
  const [knowledgeBases, setKnowledgeBases] = useState<RagKnowledgeBase[]>([]);
  const [knowledgeBaseId, setKnowledgeBaseId] = useState("");
  const [knowledgeBaseName, setKnowledgeBaseName] = useState("");
  const [knowledgeBaseCreateOpen, setKnowledgeBaseCreateOpen] = useState(false);
  const [newKnowledgeBase, setNewKnowledgeBase] = useState(EMPTY_KNOWLEDGE_BASE);
  const [query, setQuery] = useState("");
  const [searchKnowledgeBaseIds, setSearchKnowledgeBaseIds] = useState<string[]>([]);
  const [searchTopK, setSearchTopK] = useState(10);
  const [searchRerank, setSearchRerank] = useState(true);
  const [searchTopN, setSearchTopN] = useState(5);
  const [searchResponse, setSearchResponse] = useState<RagSearchResponse | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(
    () => services.find((service) => service.id === selectedId) ?? null,
    [selectedId, services],
  );

  const selectedKnowledgeBase = useMemo(
    () => knowledgeBases.find((item) => item.id === knowledgeBaseId) ?? null,
    [knowledgeBaseId, knowledgeBases],
  );

  const finalResults = searchResponse?.results ?? [];
  const returnedRawResults = searchResponse?.rawResults ?? [];
  const rawResults = returnedRawResults.length > 0 ? returnedRawResults : finalResults;
  const warnings = searchResponse?.warnings ?? [];
  const searchLimits = resolveRagSearchLimits(draft.capabilitiesSnapshot);
  const effectiveSearchSettings = normalizeRagSearchSettings(
    { topK: searchTopK, rerank: searchRerank, topN: searchTopN },
    searchLimits,
  );
  const canTestService = canTestSavedRagService(selected, draft, managementApiKey, agentApiKey);

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
    setManagementApiKey("");
    setAgentApiKey("");
    setKnowledgeBases([]);
    setKnowledgeBaseId("");
    setKnowledgeBaseName("");
    setKnowledgeBaseCreateOpen(false);
    setNewKnowledgeBase(EMPTY_KNOWLEDGE_BASE);
    setSearchKnowledgeBaseIds([]);
    setSearchResponse(null);
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
    setManagementApiKey("");
    setAgentApiKey("");
    setKnowledgeBases([]);
    setKnowledgeBaseId("");
    setKnowledgeBaseName("");
    setKnowledgeBaseCreateOpen(false);
    setNewKnowledgeBase(EMPTY_KNOWLEDGE_BASE);
    setSearchKnowledgeBaseIds([]);
    setSearchResponse(null);
  }

  async function saveService() {
    await run("save", async () => {
      const saved = await invoke<RagService>("rag_save_service", {
        request: {
          service: draft,
          managementApiKey: managementApiKey || undefined,
          agentApiKey: agentApiKey || undefined,
        },
      });
      await loadServices(saved.id);
      setNotice("服务配置已保存，API Key 只保存在系统凭证库中。");
    });
  }

  async function deleteService() {
    if (!selectedId) return;
    await run("delete", async () => {
      await invoke("rag_delete_service", { service_id: selectedId });
      const remaining = await loadServices(undefined, "");
      if (remaining.length === 0) startNewService();
      setNotice("服务配置和对应凭证已删除。");
    });
  }

  async function testService() {
    if (!canTestService) {
      setError("请先保存当前服务配置和 API Key，再测试连接。");
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
      setNotice(`连接成功，协议版本 ${capabilities.protocolVersion}。`);
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
        setNotice(`知识库“${created.name}”已创建。`);
      },
      (reason) => {
        const message = errorText(reason);
        return message.includes("RAG_KB_FORBIDDEN")
          ? `${message} 创建知识库需要管理 Key 配置 knowledgeBaseIds=["*"]。`
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
      setNotice(`知识库已重命名为“${updated.name}”。`);
    });
  }

  async function deleteKnowledgeBase() {
    if (!selectedKnowledgeBase) return;
    if (!window.confirm(`确定删除空知识库“${selectedKnowledgeBase.name}”吗？该操作无法撤销。`)) {
      return;
    }
    await run("knowledge-delete", async () => {
      await invoke("rag_hub_delete_knowledge_base", {
        service_id: selectedId || undefined,
        knowledge_base_id: selectedKnowledgeBase.id,
      });
      await refreshKnowledgeBases();
      setNotice(`知识库“${selectedKnowledgeBase.name}”已删除。`);
    });
  }

  async function searchKnowledge() {
    if (!query.trim() || searchKnowledgeBaseIds.length === 0) return;
    setSearchResponse(null);
    await run("search", async () => {
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
      setSearchResponse({
        requestId: response.requestId ?? null,
        rawResults: response.rawResults ?? [],
        results: response.results ?? [],
        warnings: response.warnings ?? [],
        timings: response.timings ?? null,
      });
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
          subtitle="配置外部知识服务、上传文档，并让 Agent 通过内置只读工具检索"
          sidebarOpen={props.sidebarOpen}
          onOpenSidebar={props.onOpenSidebar}
          actions={<Button onClick={startNewService}>新增服务</Button>}
        />
        <div className="hub-scroll min-h-0 flex-1 overflow-auto px-5 pb-8 pt-5 sm:px-6 lg:px-8 xl:px-10">
          <div className="mx-auto grid w-full max-w-[1320px] gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="space-y-3">
              <div className="flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <span>服务</span>
                <span>{services.length}</span>
              </div>
              {services.map((service) => (
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
                  <div className="mt-2 flex gap-1.5 text-[10px] text-muted-foreground">
                    {service.default ? (
                      <span className="rounded bg-muted px-1.5 py-0.5">默认</span>
                    ) : null}
                    {service.agentEnabled ? (
                      <span className="rounded bg-muted px-1.5 py-0.5">Agent</span>
                    ) : null}
                  </div>
                </button>
              ))}
              {services.length === 0 ? (
                <p className="px-1 text-sm text-muted-foreground">
                  先保存一个已经运行的 RAG 服务。
                </p>
              ) : null}
            </aside>

            <main className="space-y-5">
              {error || notice ? (
                <div
                  className={`rounded-lg border px-3 py-2 text-sm ${error ? "border-destructive/35 bg-destructive/5 text-destructive" : "border-cyan-500/25 bg-cyan-500/[0.06] text-foreground"}`}
                >
                  {error || notice}
                </div>
              ) : null}

              <GlassPanel className="p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">连接配置</h2>
                    <p className="text-xs text-muted-foreground">密钥保存后不会回显到页面。</p>
                  </div>
                  <div className="flex gap-2">
                    {selected ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={deleteService}
                        disabled={Boolean(busy)}
                        title="删除服务"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      onClick={testService}
                      disabled={Boolean(busy) || !canTestService}
                      title={canTestService ? "测试已保存的服务配置" : "请先保存当前修改"}
                    >
                      {busy === "test" ? "测试中" : "测试连接"}
                    </Button>
                    <Button
                      onClick={saveService}
                      disabled={Boolean(busy) || !draft.id || !draft.baseUrl}
                    >
                      {busy === "save" ? "保存中" : "保存配置"}
                    </Button>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>服务 ID</Label>
                    <Input
                      value={draft.id}
                      disabled={Boolean(selected)}
                      onChange={(event) => setDraft({ ...draft, id: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>显示名称</Label>
                    <Input
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Base URL</Label>
                    <Input
                      value={draft.baseUrl}
                      onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                      placeholder="http://localhost:8080"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>管理 API Key</Label>
                    <Input
                      type="password"
                      value={managementApiKey}
                      onChange={(event) => setManagementApiKey(event.target.value)}
                      placeholder={
                        draft.managementCredentialConfigured
                          ? "已配置；留空保持不变"
                          : "用于文档和管理操作"
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Agent API Key</Label>
                    <Input
                      type="password"
                      value={agentApiKey}
                      onChange={(event) => setAgentApiKey(event.target.value)}
                      placeholder={
                        draft.agentCredentialConfigured ? "已配置；留空保持不变" : "只读检索凭证"
                      }
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Agent 知识库白名单</Label>
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
                    启用服务
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.default}
                      onChange={(event) => setDraft({ ...draft, default: event.target.checked })}
                    />
                    设为默认
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.agentEnabled}
                      onChange={(event) =>
                        setDraft({ ...draft, agentEnabled: event.target.checked })
                      }
                    />
                    开放给 Agent
                  </label>
                </div>
              </GlassPanel>

              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-5">
                  <GlassPanel className="p-5">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-semibold">知识库</h2>
                        <p className="text-xs text-muted-foreground">
                          选择文档要进入的知识库，管理操作使用管理凭证。
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setKnowledgeBaseCreateOpen((current) => !current)}
                          disabled={!selectedId || Boolean(busy)}
                        >
                          新建
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={loadKnowledgeBases}
                          disabled={!selectedId || Boolean(busy)}
                        >
                          <RefreshCw className="mr-2 h-3.5 w-3.5" />
                          刷新
                        </Button>
                      </div>
                    </div>

                    {knowledgeBaseCreateOpen ? (
                      <div className="mb-4 rounded-xl border border-cyan-500/25 bg-cyan-500/[0.04] p-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5 sm:col-span-2">
                            <Label>知识库名称</Label>
                            <Input
                              value={newKnowledgeBase.name}
                              onChange={(event) =>
                                setNewKnowledgeBase({
                                  ...newKnowledgeBase,
                                  name: event.target.value,
                                })
                              }
                              placeholder="公司制度"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>嵌入模型</Label>
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
                            <Label>集合名称</Label>
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
                            创建需要管理 Key 配置 knowledgeBaseIds=["*"]。
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
                              取消
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
                              {busy === "knowledge-create" ? "创建中" : "创建知识库"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="grid gap-2 sm:grid-cols-2">
                      {knowledgeBases.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setKnowledgeBaseId(item.id)}
                          className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${knowledgeBaseId === item.id ? "border-cyan-500/40 bg-cyan-500/[0.07] shadow-sm" : "border-border/50 bg-background/35 hover:bg-muted/35"}`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium">{item.name}</span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {item.documentCount ?? 0} 文档
                            </span>
                          </span>
                          <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                            {item.id}
                          </span>
                        </button>
                      ))}
                      {!knowledgeBases.length ? (
                        <span className="text-sm text-muted-foreground sm:col-span-2">
                          点击刷新读取知识库，或直接新建一个空知识库。
                        </span>
                      ) : null}
                    </div>

                    {selectedKnowledgeBase ? (
                      <div className="mt-4 border-t border-border/45 pt-4">
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                          <div className="space-y-1.5">
                            <Label>显示名称</Label>
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
                              {busy === "knowledge-update" ? "保存中" : "保存名称"}
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
                                  ? "请先删除知识库中的文档"
                                  : "删除空知识库"
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                          <span className="truncate font-mono">
                            模型：{selectedKnowledgeBase.embeddingModel || "未返回"}
                          </span>
                          <span className="truncate font-mono">
                            集合：{selectedKnowledgeBase.collectionName || "未返回"}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </GlassPanel>

                  <RagDocumentPanel
                    serviceId={selectedId}
                    knowledgeBaseId={knowledgeBaseId}
                    onNotice={handleDocumentNotice}
                    onError={handleDocumentError}
                  />
                </div>

                <GlassPanel className="p-5">
                  <div className="mb-4">
                    <h2 className="font-semibold">检索实验</h2>
                    <p className="text-xs text-muted-foreground">一次完成召回与可选重排。</p>
                  </div>
                  <div className="rounded-xl border border-border/45 bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium">检索范围</p>
                        <p className="text-[11px] text-muted-foreground">可同时选择多个知识库</p>
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
                            全选
                          </button>
                          <button
                            type="button"
                            className="rounded px-2 py-1 text-muted-foreground hover:bg-muted/60"
                            onClick={() => setSearchKnowledgeBaseIds([])}
                          >
                            清空
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
                        先加载知识库，再选择检索范围。
                      </p>
                    )}
                  </div>

                  <div className="relative mt-3">
                    <Textarea
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      maxLength={searchLimits.maxQueryLength}
                      placeholder="输入要检索的问题"
                      className="min-h-24 pb-7"
                    />
                    <span className="pointer-events-none absolute bottom-2 right-3 font-mono text-[10px] text-muted-foreground">
                      {query.length}/{searchLimits.maxQueryLength}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-3 rounded-xl border border-border/45 bg-background/35 p-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="rag-search-top-k">召回数量 Top K</Label>
                      <Input
                        id="rag-search-top-k"
                        type="number"
                        min={1}
                        max={searchLimits.maxTopK}
                        value={effectiveSearchSettings.topK}
                        onChange={(event) => setSearchTopK(Number(event.target.value))}
                      />
                      <p className="text-[10px] text-muted-foreground">
                        服务上限 {searchLimits.maxTopK}
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
                        <span className="block text-xs font-medium">启用重排</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {searchLimits.rerankSupported ? "优化最终排序" : "服务未声明此能力"}
                        </span>
                      </span>
                    </label>

                    <div className="space-y-1.5">
                      <Label htmlFor="rag-search-top-n">最终数量 Top N</Label>
                      <Input
                        id="rag-search-top-n"
                        type="number"
                        min={1}
                        max={searchLimits.maxTopN}
                        value={effectiveSearchSettings.topN}
                        disabled={!effectiveSearchSettings.rerank}
                        onChange={(event) => setSearchTopN(Number(event.target.value))}
                      />
                      <p className="text-[10px] text-muted-foreground">
                        服务上限 {searchLimits.maxTopN}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      onClick={searchKnowledge}
                      disabled={
                        !selectedId ||
                        !query.trim() ||
                        searchKnowledgeBaseIds.length === 0 ||
                        Boolean(busy)
                      }
                    >
                      <Search className="mr-2 h-4 w-4" />
                      {busy === "search" ? "检索中" : "开始检索"}
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      已选 {searchKnowledgeBaseIds.length} 个知识库
                      {draft.capabilitiesSnapshot
                        ? " · 已按服务能力限制参数"
                        : " · 使用本地安全上限"}
                    </span>
                  </div>
                  {searchResponse ? (
                    <div className="mt-4 space-y-4">
                      {searchResponse.timings || searchResponse.requestId ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/45 bg-muted/20 p-3">
                          <div className="mr-1 flex items-center gap-2 text-xs font-medium">
                            <Clock3 className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                            检索耗时
                          </div>
                          {searchResponse.timings ? (
                            <>
                              <span className="rounded-md bg-background/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                                召回 {searchResponse.timings.retrievalMs} ms
                              </span>
                              <span className="rounded-md bg-background/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                                重排 {searchResponse.timings.rerankMs} ms
                              </span>
                              <span className="rounded-md bg-cyan-500/10 px-2 py-1 font-mono text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">
                                总计 {searchResponse.timings.totalMs} ms
                              </span>
                            </>
                          ) : null}
                          {searchResponse.requestId ? (
                            <span
                              className="ml-auto max-w-full truncate font-mono text-[10px] text-muted-foreground"
                              title={searchResponse.requestId}
                            >
                              请求 {searchResponse.requestId}
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
                              <span>{searchWarningText(warning)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {returnedRawResults.length === 0 && finalResults.length > 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          当前服务未返回原始召回列表，左侧暂用最终结果兼容展示。
                        </p>
                      ) : null}

                      <div className="grid gap-4 lg:grid-cols-2">
                        <RagSearchResultColumn
                          title="原始召回"
                          subtitle="向量检索返回的候选顺序"
                          hits={rawResults}
                          mode="raw"
                        />
                        <RagSearchResultColumn
                          title="最终结果"
                          subtitle="重排后交给 Agent 的结果"
                          hits={finalResults}
                          mode="final"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-dashed border-border/55 px-4 py-8 text-center text-xs text-muted-foreground">
                      输入问题后，可对比原始召回与最终重排结果。
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
