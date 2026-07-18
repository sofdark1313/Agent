import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { GlassPanel, HubBackdrop, HubHeader } from "../../components/hub/HubChrome";
import { BookOpen, RefreshCw, Search, Trash2, Upload } from "../../components/icons";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";

type RagCapabilities = {
  protocolVersion: string;
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

type RagKnowledgeBase = { id: string; name: string };
type RagSearchHit = {
  knowledgeBaseId: string;
  chunkId: string;
  content: string;
  score: number;
  source: string;
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

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function RagHubPage(props: { sidebarOpen: boolean; onOpenSidebar: () => void }) {
  const [services, setServices] = useState<RagService[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<RagService>(EMPTY_SERVICE);
  const [managementApiKey, setManagementApiKey] = useState("");
  const [agentApiKey, setAgentApiKey] = useState("");
  const [knowledgeBases, setKnowledgeBases] = useState<RagKnowledgeBase[]>([]);
  const [knowledgeBaseId, setKnowledgeBaseId] = useState("");
  const [documents, setDocuments] = useState<unknown>(null);
  const [filePath, setFilePath] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RagSearchHit[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(
    () => services.find((service) => service.id === selectedId) ?? null,
    [selectedId, services],
  );

  async function loadServices(preferredId?: string) {
    const next = await invoke<RagService[]>("rag_list_services");
    setServices(next);
    const nextId =
      preferredId || selectedId || next.find((item) => item.default)?.id || next[0]?.id;
    if (nextId) setSelectedId(nextId);
  }

  useEffect(() => {
    void invoke<RagService[]>("rag_list_services")
      .then((next) => {
        setServices(next);
        const nextId = next.find((item) => item.default)?.id || next[0]?.id;
        if (nextId) setSelectedId(nextId);
      })
      .catch((reason) => setError(errorText(reason)));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setDraft(selected);
    setManagementApiKey("");
    setAgentApiKey("");
    setKnowledgeBases([]);
    setKnowledgeBaseId("");
    setDocuments(null);
    setResults([]);
  }, [selected]);

  async function run(action: string, task: () => Promise<void>) {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  }

  function startNewService() {
    setSelectedId("");
    setDraft({ ...EMPTY_SERVICE, default: services.length === 0 });
    setManagementApiKey("");
    setAgentApiKey("");
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
      setSelectedId("");
      await loadServices();
      startNewService();
      setNotice("服务配置和对应凭证已删除。");
    });
  }

  async function testService() {
    await run("test", async () => {
      const capabilities = await invoke<RagCapabilities>("rag_test_service", {
        service_id: draft.id,
      });
      setDraft((current) => ({ ...current, capabilitiesSnapshot: capabilities }));
      setNotice(`连接成功，协议版本 ${capabilities.protocolVersion}。`);
    });
  }

  async function loadKnowledgeBases() {
    await run("knowledge", async () => {
      const items = await invoke<RagKnowledgeBase[]>("rag_hub_list_knowledge_bases", {
        service_id: selectedId || undefined,
      });
      setKnowledgeBases(items);
      if (!knowledgeBaseId && items[0]) setKnowledgeBaseId(items[0].id);
    });
  }

  async function loadDocuments() {
    if (!knowledgeBaseId) return;
    await run("documents", async () => {
      const page = await invoke("rag_hub_list_documents", {
        service_id: selectedId || undefined,
        knowledge_base_id: knowledgeBaseId,
        current: 1,
        size: 50,
      });
      setDocuments(page);
    });
  }

  async function uploadDocument() {
    if (!knowledgeBaseId || !filePath.trim()) return;
    await run("upload", async () => {
      const response = await invoke("rag_hub_upload_document", {
        service_id: selectedId || undefined,
        knowledge_base_id: knowledgeBaseId,
        file_path: filePath.trim(),
      });
      setNotice(`文档已提交入库：${JSON.stringify(response)}`);
      setFilePath("");
      await loadDocuments();
    });
  }

  async function searchKnowledge() {
    if (!query.trim()) return;
    await run("search", async () => {
      const response = await invoke<{ results: RagSearchHit[] }>("rag_hub_search", {
        request: {
          serviceId: selectedId || undefined,
          query: query.trim(),
          knowledgeBaseIds: knowledgeBaseId
            ? [knowledgeBaseId]
            : knowledgeBases.map((item) => item.id),
          topK: 10,
          rerank: true,
          topN: 5,
        },
      });
      setResults(response.results);
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
                      disabled={Boolean(busy) || !draft.id}
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
                <GlassPanel className="p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="font-semibold">知识库与文档</h2>
                      <p className="text-xs text-muted-foreground">管理操作使用管理凭证。</p>
                    </div>
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
                  <div className="flex flex-wrap gap-2">
                    {knowledgeBases.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setKnowledgeBaseId(item.id)}
                        className={`rounded-lg border px-3 py-2 text-sm ${knowledgeBaseId === item.id ? "border-cyan-500/40 bg-cyan-500/[0.07]" : "border-border/50"}`}
                      >
                        {item.name}
                        <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                          {item.id}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button
                      variant="outline"
                      onClick={loadDocuments}
                      disabled={!knowledgeBaseId || Boolean(busy)}
                    >
                      查看文档
                    </Button>
                    <Input
                      value={filePath}
                      onChange={(event) => setFilePath(event.target.value)}
                      placeholder="要上传的本地文件绝对路径"
                    />
                    <Button
                      onClick={uploadDocument}
                      disabled={!knowledgeBaseId || !filePath.trim() || Boolean(busy)}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      上传
                    </Button>
                  </div>
                  {documents ? (
                    <pre className="mt-4 max-h-56 overflow-auto rounded-lg bg-muted/45 p-3 text-[11px] leading-5">
                      {JSON.stringify(documents, null, 2)}
                    </pre>
                  ) : null}
                </GlassPanel>

                <GlassPanel className="p-5">
                  <div className="mb-4">
                    <h2 className="font-semibold">检索实验</h2>
                    <p className="text-xs text-muted-foreground">一次完成召回与可选重排。</p>
                  </div>
                  <Textarea
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="输入要检索的问题"
                    className="min-h-24"
                  />
                  <Button
                    className="mt-3"
                    onClick={searchKnowledge}
                    disabled={!query.trim() || Boolean(busy)}
                  >
                    <Search className="mr-2 h-4 w-4" />
                    {busy === "search" ? "检索中" : "开始检索"}
                  </Button>
                  <div className="mt-4 space-y-3">
                    {results.map((hit, index) => (
                      <div
                        key={`${hit.knowledgeBaseId}:${hit.chunkId}`}
                        className="rounded-lg border border-border/45 bg-muted/25 p-3"
                      >
                        <div className="mb-2 flex flex-wrap gap-2 font-mono text-[10px] text-muted-foreground">
                          <span>[{index + 1}]</span>
                          <span>{hit.knowledgeBaseId}</span>
                          <span>{hit.chunkId}</span>
                          <span>{hit.score.toFixed(3)}</span>
                        </div>
                        <p className="whitespace-pre-wrap text-sm leading-6">{hit.content}</p>
                      </div>
                    ))}
                  </div>
                </GlassPanel>
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
