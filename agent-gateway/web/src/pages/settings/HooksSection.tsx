import { type ReactNode, useState } from "react";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  Globe,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  Wrench,
  Zap,
} from "../../components/icons";

import { Button } from "../../components/ui/button";
import { useLocale } from "../../i18n";
import {
  applyHookOps,
  HOOK_EVENT_DESCRIPTION_TRANSLATION_KEYS,
  HOOK_EVENT_TRANSLATION_KEYS,
  type HookDef,
  type HookEvent,
  useAutomation,
} from "../../lib/automation";
import { HookModal } from "./HookModal";
import { AgentActivationSwitch, ConfirmDeletePopover } from "./shared";
import type { SettingsSectionProps } from "./types";

type PhaseConfig = {
  key: string;
  label: string;
  icon: ReactNode;
  events: HookEvent[];
};

function getHookEventLabel(t: (key: string) => string, event: HookEvent) {
  return t(HOOK_EVENT_TRANSLATION_KEYS[event]);
}

export function HooksSection(_props: SettingsSectionProps) {
  const { t } = useLocale();
  const [activeEvent, setActiveEvent] = useState<HookEvent>("agent_start");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingHook, setEditingHook] = useState<HookDef | null>(null);
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const { hooks: hooksSnapshot } = useAutomation();
  const hooks = hooksSnapshot.hooks;
  const activeHooks = hooks.filter((hook) => hook.event === activeEvent);
  const enabledCount = hooks.filter((hook) => hook.enabled).length;

  const phases: PhaseConfig[] = [
    {
      key: "agent",
      label: t("settings.hooksPhaseAgent"),
      icon: <Bot className="h-4 w-4 text-muted-foreground" />,
      events: ["agent_start", "agent_end"],
    },
    {
      key: "turn",
      label: t("settings.hooksPhaseTurn"),
      icon: <RefreshCw className="h-4 w-4 text-muted-foreground" />,
      events: ["turn_start", "turn_end"],
    },
    {
      key: "message",
      label: t("settings.hooksPhaseMessage"),
      icon: <MessageSquare className="h-4 w-4 text-muted-foreground" />,
      events: ["message_start", "message_end"],
    },
    {
      key: "tool",
      label: t("settings.hooksPhaseTool"),
      icon: <Wrench className="h-4 w-4 text-muted-foreground" />,
      events: ["tool_execution_start", "tool_execution_end"],
    },
  ];

  function togglePhase(key: string) {
    setCollapsedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function closeModal() {
    setModalOpen(false);
    setEditingHook(null);
  }

  function openAdd() {
    setEditingHook(null);
    setModalOpen(true);
  }

  function openEdit(hook: HookDef) {
    setEditingHook(hook);
    setActiveEvent(hook.event);
    setModalOpen(true);
  }

  function runOps(run: () => Promise<unknown>) {
    setActionError(null);
    void run().catch((error) => {
      setActionError(error instanceof Error ? error.message : String(error));
    });
  }

  async function handleSave(data: Omit<HookDef, "id">) {
    setActionError(null);
    if (editingHook) {
      await applyHookOps([{ op: "update", id: editingHook.id, patch: { ...data } }]);
    } else {
      await applyHookOps([{ op: "create", item: { ...data } }]);
    }
  }

  function toggleHook(hook: HookDef) {
    runOps(() => applyHookOps([{ op: "update", id: hook.id, patch: { enabled: !hook.enabled } }]));
  }

  function deleteHook(hookId: string) {
    runOps(() => applyHookOps([{ op: "delete", id: hookId }]));
  }

  return (
    <div className="settings-hooks-section flex h-full flex-col gap-4">
      {/* Top Header Card */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-5 sm:flex-row sm:items-center sm:justify-between shadow-2xs">
        <div className="flex items-start gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/50 text-foreground">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-semibold text-foreground">{t("settings.hooksTitle")}</h2>
              <span className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {enabledCount} / {hooks.length} {t("settings.hooksActiveHooks")}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.hooksDesc")}</p>
          </div>
        </div>

        <Button size="sm" className="gap-1.5 self-start sm:self-auto" onClick={openAdd}>
          <Plus className="h-3.5 w-3.5" />
          {t("settings.hooksAdd")}
        </Button>
      </div>

      {actionError ? (
        <div className="flex shrink-0 items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{actionError}</span>
        </div>
      ) : null}

      {/* Main 2-Column Layout */}
      <div className="grid min-h-[500px] flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Left: Lifecycle Phases */}
        <aside className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xs">
          <div className="shrink-0 border-b border-border/40 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground uppercase tracking-wider">
              <Play className="h-3.5 w-3.5 text-muted-foreground" />
              {t("settings.hooksLifecycle")}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
            {phases.map((phase) => {
              const phaseHookCount = phase.events.reduce(
                (sum, event) => sum + hooks.filter((hook) => hook.event === event).length,
                0,
              );
              const isCollapsed = collapsedPhases.has(phase.key);

              return (
                <div key={phase.key} className="rounded-xl border border-border/40 bg-background/50 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => togglePhase(phase.key)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/40"
                  >
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/60">
                      {phase.icon}
                    </div>
                    <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-foreground">
                        {phase.label}
                      </span>
                      {phaseHookCount > 0 ? (
                        <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-medium text-muted-foreground">
                          {phaseHookCount}
                        </span>
                      ) : null}
                    </div>
                    <ChevronDown
                      className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                        isCollapsed ? "-rotate-90" : ""
                      }`}
                    />
                  </button>

                  {!isCollapsed ? (
                    <div className="border-t border-border/30 bg-muted/10 p-1 space-y-0.5">
                      {phase.events.map((event) => {
                        const eventHooks = hooks.filter((hook) => hook.event === event);
                        const selected = activeEvent === event;
                        const hasHooks = eventHooks.length > 0;

                        return (
                          <button
                            key={event}
                            type="button"
                            onClick={() => setActiveEvent(event)}
                            className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-xs transition-all ${
                              selected
                                ? "bg-primary/10 text-primary font-medium shadow-2xs"
                                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                            }`}
                          >
                            <span className="truncate">{getHookEventLabel(t, event)}</span>
                            {hasHooks ? (
                              <span
                                className={`rounded-full px-1.5 py-0.2 text-[10px] font-medium ${
                                  selected
                                    ? "bg-primary/20 text-primary"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {eventHooks.length}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Right: Active Event Hooks */}
        <main className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xs">
          <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-5 py-3.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {getHookEventLabel(t, activeEvent)}
                </span>
                <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {activeEvent}
                </code>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t(HOOK_EVENT_DESCRIPTION_TRANSLATION_KEYS[activeEvent])}
              </p>
            </div>

            <Button size="sm" variant="outline" className="gap-1.5" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" />
              {t("settings.hooksAdd")}
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {activeHooks.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center p-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/60 bg-muted/30 text-muted-foreground">
                  <Zap className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{t("settings.hooksNoHooksForEvent")}</p>
                  <p className="mt-1 text-xs text-muted-foreground max-w-sm">
                    {t("settings.hooksNoHooksForEventHint")}
                  </p>
                </div>
                <Button size="sm" variant="outline" className="gap-1.5 mt-2" onClick={openAdd}>
                  <Plus className="h-3.5 w-3.5" />
                  {t("settings.hooksAdd")}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {activeHooks.map((hook) => (
                  <HookCard
                    key={hook.id}
                    hook={hook}
                    onToggle={() => toggleHook(hook)}
                    onEdit={() => openEdit(hook)}
                    onDelete={() => deleteHook(hook.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {modalOpen ? (
        <HookModal
          event={activeEvent}
          initialData={editingHook ?? undefined}
          onSave={handleSave}
          onClose={closeModal}
        />
      ) : null}
    </div>
  );
}

function HookCard(props: {
  hook: HookDef;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { hook, onToggle, onEdit, onDelete } = props;
  const { t } = useLocale();
  const isCommand = hook.type === "command";

  return (
    <div className="group rounded-xl border border-border/60 bg-background/60 p-4 transition-all hover:border-border hover:shadow-2xs">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground mt-0.5">
            {isCommand ? <Terminal className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground truncate">{hook.name}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                {isCommand ? t("settings.hooksTypeCommand") : t("settings.hooksTypeHttp")}
              </span>
            </div>
            {hook.description ? (
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{hook.description}</p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <AgentActivationSwitch
            checked={hook.enabled}
            title={t("settings.hooksToggle")}
            onToggle={onToggle}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={onEdit}
            title={t("settings.edit")}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <ConfirmDeletePopover
            name={hook.name}
            onConfirm={onDelete}
          >
            {(open) => (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={open}
                title={t("settings.delete")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </ConfirmDeletePopover>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-border/40 bg-muted/30 p-2.5 font-mono text-xs text-muted-foreground break-all">
        {isCommand ? (
          <div>
            <span className="text-foreground/80 font-semibold">$ </span>
            {hook.script}
          </div>
        ) : (
          <div className="space-y-1">
            {hook.requests?.map((req, i) => (
              <div key={i}>
                <span className="text-foreground/80 font-semibold">{req.method ?? "POST"} </span>
                {req.url}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
