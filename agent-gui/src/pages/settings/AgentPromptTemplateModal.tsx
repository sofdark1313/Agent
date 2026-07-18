import { useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Check } from "../../components/icons";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { useLocale } from "../../i18n";
import type { AgentPromptTemplate } from "../../lib/settings";

type AgentPromptTemplateModalProps = {
  initialData?: AgentPromptTemplate;
  onSave: (data: Omit<AgentPromptTemplate, "id" | "enabled">) => void;
  onClose: () => void;
};

export function AgentPromptTemplateModal({
  initialData,
  onSave,
  onClose,
}: AgentPromptTemplateModalProps) {
  const { t } = useLocale();
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [prompt, setPrompt] = useState(initialData?.prompt ?? "");

  const isEditing = Boolean(initialData);

  function handleSave() {
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedName || !trimmedPrompt) return;

    onSave({
      name: trimmedName,
      description: description.trim(),
      prompt: trimmedPrompt,
    });
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label={t("settings.cancel")}
      />

      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">
            <BookOpen className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold">
              {isEditing ? t("settings.agentsEdit") : t("settings.agentsAdd")}
            </div>
            <div className="text-xs text-muted-foreground">{t("settings.agentsDesc")}</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-1.5">
            <Label
              htmlFor="agent-template-name"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("settings.agentsName")}
            </Label>
            <Input
              id="agent-template-name"
              value={name}
              placeholder={t("settings.agentsNamePlaceholder")}
              onChange={(e) => setName(e.currentTarget.value)}
            />
          </div>

          <div className="mt-4 space-y-1.5">
            <Label
              htmlFor="agent-template-description"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("settings.agentsDescription")}
            </Label>
            <Textarea
              id="agent-template-description"
              value={description}
              placeholder={t("settings.agentsDescriptionPlaceholder")}
              className="min-h-[80px] resize-y"
              onChange={(e) => setDescription(e.currentTarget.value)}
            />
          </div>

          <div className="mt-4 space-y-1.5">
            <Label
              htmlFor="agent-template-prompt"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("settings.agentsPrompt")}
            </Label>
            <Textarea
              id="agent-template-prompt"
              value={prompt}
              placeholder={t("settings.agentsPromptPlaceholder")}
              className="min-h-[220px] resize-y font-mono text-sm leading-relaxed"
              onChange={(e) => setPrompt(e.currentTarget.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between border-t px-6 py-4">
          <div className="text-xs text-muted-foreground">
            {name.trim() && prompt.trim() ? (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Check className="h-3 w-3" />
                {t("settings.agentsReady")}
              </span>
            ) : (
              <span>{t("settings.agentsRequired")}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("settings.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={!name.trim() || !prompt.trim()}>
              {t("settings.save")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
