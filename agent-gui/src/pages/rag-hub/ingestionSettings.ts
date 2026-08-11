import {
  isFreshRagCapabilitySnapshot,
  positiveRagCapabilityLimit,
  type RagCapabilitySnapshot,
  type RagIngestionChunkConfigSchema,
  type RagIngestionFieldSchema,
} from "../../lib/rag/capabilitySnapshot";

const LOCAL_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type RagIngestionProcessMode = "chunk" | "pipeline";

export type RagControlledSchema = {
  type: "integer" | "string" | "boolean";
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: number | string | boolean;
  enum?: string[];
};

export type RagControlledObjectSchema = {
  properties: Record<string, RagControlledSchema>;
  required: string[];
};

export type RagIngestionPipeline = { id: string; name: string };

export type RagIngestionSettings = {
  fileUploadSupported: boolean;
  urlImportSupported: boolean;
  maxUploadBytes: number;
  allowedExtensions: string[];
  allowedMimeTypes: string[];
  processModes: RagIngestionProcessMode[];
  chunkStrategies: string[];
  chunkConfigSchema: Record<string, RagControlledObjectSchema>;
  pipelines: RagIngestionPipeline[];
  capabilityError: string | null;
};

export type RagIngestionSelection = {
  processMode: RagIngestionProcessMode;
  chunkStrategy: string | null;
  chunkConfig: Record<string, number | string | boolean> | null;
  pipelineId: string | null;
};

export type RagPickedDocumentFile = {
  path: string;
  name: string;
  size: number;
  extension: string;
  mimeType: string;
};

const EMPTY_SETTINGS = {
  fileUploadSupported: false,
  urlImportSupported: false,
  maxUploadBytes: 0,
  allowedExtensions: [],
  allowedMimeTypes: [],
  processModes: [],
  chunkStrategies: [],
  chunkConfigSchema: {},
  pipelines: [],
};

function invalidSettings(message: string): RagIngestionSettings {
  return { ...EMPTY_SETTINGS, capabilityError: message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedUniqueStrings(value: unknown, transform = (item: string) => item) {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return null;
    const normalized = transform(item.trim());
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeExtension(value: string) {
  const normalized = value.toLowerCase();
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

function safeNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function normalizeFieldSchema(value: unknown): RagControlledSchema | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  const raw = value as RagIngestionFieldSchema & Record<string, unknown>;
  const keys = Object.keys(raw);

  if (raw.type === "integer") {
    if (keys.some((key) => !["type", "minimum", "maximum", "default"].includes(key))) {
      return null;
    }
    if (raw.minimum !== undefined && !Number.isSafeInteger(raw.minimum)) return null;
    if (raw.maximum !== undefined && !Number.isSafeInteger(raw.maximum)) return null;
    const minimum = raw.minimum as number | undefined;
    const maximum = raw.maximum as number | undefined;
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) return null;
    if (raw.default !== undefined && !Number.isSafeInteger(raw.default)) return null;
    const defaultValue = raw.default as number | undefined;
    if (
      defaultValue !== undefined &&
      ((minimum !== undefined && defaultValue < minimum) ||
        (maximum !== undefined && defaultValue > maximum))
    ) {
      return null;
    }
    return { type: "integer", minimum, maximum, default: defaultValue };
  }

  if (raw.type === "string") {
    if (keys.some((key) => !["type", "minLength", "maxLength", "default", "enum"].includes(key))) {
      return null;
    }
    if (raw.minLength !== undefined && !safeNonNegativeInteger(raw.minLength)) return null;
    if (raw.maxLength !== undefined && !safeNonNegativeInteger(raw.maxLength)) return null;
    const minLength = raw.minLength as number | undefined;
    const maxLength = raw.maxLength as number | undefined;
    if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) return null;
    const normalizedEnumValues =
      raw.enum === undefined ? undefined : normalizedUniqueStrings(raw.enum, (item) => item);
    if (raw.enum !== undefined && (!normalizedEnumValues || normalizedEnumValues.length === 0)) {
      return null;
    }
    const enumValues = normalizedEnumValues ?? undefined;
    if (raw.default !== undefined && typeof raw.default !== "string") return null;
    const defaultValue = raw.default as string | undefined;
    if (
      defaultValue !== undefined &&
      ((minLength !== undefined && defaultValue.length < minLength) ||
        (maxLength !== undefined && defaultValue.length > maxLength) ||
        (enumValues !== undefined && !enumValues.includes(defaultValue)))
    ) {
      return null;
    }
    return {
      type: "string",
      minLength,
      maxLength,
      default: defaultValue,
      enum: enumValues,
    };
  }

  if (raw.type === "boolean") {
    if (keys.some((key) => !["type", "default"].includes(key))) return null;
    if (raw.default !== undefined && typeof raw.default !== "boolean") return null;
    return { type: "boolean", default: raw.default as boolean | undefined };
  }

  return null;
}

function normalizeObjectSchema(value: unknown): RagControlledObjectSchema | null {
  if (!isRecord(value)) return null;
  const raw = value as RagIngestionChunkConfigSchema & Record<string, unknown>;
  if (
    Object.keys(raw).some(
      (key) => !["type", "properties", "required", "additionalProperties"].includes(key),
    ) ||
    raw.type !== "object" ||
    raw.additionalProperties !== false ||
    !isRecord(raw.properties)
  ) {
    return null;
  }

  const properties: Record<string, RagControlledSchema> = {};
  for (const [name, schema] of Object.entries(raw.properties)) {
    if (!name.trim() || name !== name.trim()) return null;
    const normalized = normalizeFieldSchema(schema);
    if (!normalized) return null;
    properties[name] = normalized;
  }

  const required = raw.required === undefined ? [] : normalizedUniqueStrings(raw.required);
  if (!required || required.some((name) => !(name in properties))) return null;
  if (required.some((name) => properties[name]?.default === undefined)) return null;
  return { properties, required };
}

function normalizePipelines(value: unknown): RagIngestionPipeline[] | null {
  if (!Array.isArray(value)) return null;
  const pipelines: RagIngestionPipeline[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") {
      return null;
    }
    const id = item.id.trim();
    const name = item.name.trim();
    if (!id || !name || seen.has(id)) return null;
    if (Object.keys(item).some((key) => !["id", "name"].includes(key))) return null;
    seen.add(id);
    pipelines.push({ id, name });
  }
  return pipelines;
}

export function resolveRagIngestionSettings(
  capabilities: RagCapabilitySnapshot | null | undefined,
  nowMs = Date.now(),
): RagIngestionSettings {
  if (!capabilities || !isFreshRagCapabilitySnapshot(capabilities, nowMs)) {
    return invalidSettings("RAG capabilities 快照缺失、无效或已过期");
  }
  const maxUploadBytes = positiveRagCapabilityLimit(
    capabilities,
    "maxUploadBytes",
    LOCAL_MAX_UPLOAD_BYTES,
  );
  if (maxUploadBytes === null) {
    return invalidSettings("RAG capabilities 未声明有效的 maxUploadBytes");
  }

  const ingestion = capabilities.ingestion;
  if (!ingestion) return invalidSettings("RAG capabilities 未声明 ingestion 能力契约");
  const allowedExtensions = normalizedUniqueStrings(
    ingestion.allowedExtensions,
    normalizeExtension,
  );
  const allowedMimeTypes = normalizedUniqueStrings(ingestion.allowedMimeTypes, (item) =>
    item.toLowerCase(),
  );
  const rawProcessModes = normalizedUniqueStrings(ingestion.processModes);
  const processModes = rawProcessModes?.filter(
    (mode): mode is RagIngestionProcessMode => mode === "chunk" || mode === "pipeline",
  );
  const chunkStrategies = normalizedUniqueStrings(ingestion.chunkStrategies);
  const pipelines = normalizePipelines(ingestion.pipelines);
  if (
    !allowedExtensions?.length ||
    !allowedMimeTypes?.length ||
    !rawProcessModes?.length ||
    !processModes ||
    processModes.length !== rawProcessModes.length ||
    !chunkStrategies ||
    !pipelines
  ) {
    return invalidSettings("RAG ingestion capabilities schema 不兼容");
  }

  if (!isRecord(ingestion.chunkConfigSchema)) {
    return invalidSettings("RAG ingestion chunkConfig schema 不兼容");
  }
  const chunkConfigSchema: Record<string, RagControlledObjectSchema> = {};
  for (const strategy of chunkStrategies) {
    const schema = normalizeObjectSchema(ingestion.chunkConfigSchema[strategy]);
    if (!schema) return invalidSettings("RAG ingestion chunkConfig schema 不兼容");
    chunkConfigSchema[strategy] = schema;
  }
  if (
    (processModes.includes("chunk") && chunkStrategies.length === 0) ||
    (processModes.includes("pipeline") && pipelines.length === 0)
  ) {
    return invalidSettings("RAG ingestion capabilities 缺少所选处理模式的配置");
  }

  return {
    fileUploadSupported: capabilities.features?.fileUpload === true,
    urlImportSupported: capabilities.features?.urlImport === true,
    maxUploadBytes,
    allowedExtensions,
    allowedMimeTypes,
    processModes,
    chunkStrategies,
    chunkConfigSchema,
    pipelines,
    capabilityError: null,
  };
}

export function createDefaultRagIngestionSelection(
  settings: RagIngestionSettings,
): RagIngestionSelection {
  const processMode = settings.processModes[0] ?? "chunk";
  if (processMode === "pipeline") {
    return {
      processMode,
      chunkStrategy: null,
      chunkConfig: null,
      pipelineId: settings.pipelines[0]?.id ?? null,
    };
  }
  const chunkStrategy = settings.chunkStrategies[0] ?? null;
  const schema = chunkStrategy ? settings.chunkConfigSchema[chunkStrategy] : undefined;
  const chunkConfig = Object.fromEntries(
    Object.entries(schema?.properties ?? {})
      .filter(([, property]) => property.default !== undefined)
      .map(([name, property]) => [name, property.default]),
  ) as Record<string, number | string | boolean>;
  return { processMode, chunkStrategy, chunkConfig, pipelineId: null };
}

function validatePropertyValue(schema: RagControlledSchema, value: unknown) {
  if (schema.type === "integer") {
    return (
      Number.isSafeInteger(value) &&
      (schema.minimum === undefined || (value as number) >= schema.minimum) &&
      (schema.maximum === undefined || (value as number) <= schema.maximum)
    );
  }
  if (schema.type === "boolean") return typeof value === "boolean";
  return (
    typeof value === "string" &&
    (schema.minLength === undefined || value.length >= schema.minLength) &&
    (schema.maxLength === undefined || value.length <= schema.maxLength) &&
    (schema.enum === undefined || schema.enum.includes(value))
  );
}

export function validateRagIngestionSelection(
  settings: RagIngestionSettings,
  selection: RagIngestionSelection,
): { valid: boolean; error: string | null; request: RagIngestionSelection | null } {
  const invalid = (error: string) => ({ valid: false, error, request: null });
  if (settings.capabilityError) return invalid(settings.capabilityError);
  if (!settings.processModes.includes(selection.processMode)) {
    return invalid("服务 capabilities 不支持所选处理模式");
  }

  if (selection.processMode === "pipeline") {
    if (
      !selection.pipelineId ||
      !settings.pipelines.some((item) => item.id === selection.pipelineId)
    ) {
      return invalid("请选择 capabilities 声明的 Pipeline");
    }
    return {
      valid: true,
      error: null,
      request: {
        processMode: "pipeline",
        chunkStrategy: null,
        chunkConfig: null,
        pipelineId: selection.pipelineId,
      },
    };
  }

  const strategy = selection.chunkStrategy;
  if (!strategy || !settings.chunkStrategies.includes(strategy)) {
    return invalid("服务 capabilities 不支持所选分块策略");
  }
  const schema = settings.chunkConfigSchema[strategy];
  if (!schema || !isRecord(selection.chunkConfig)) {
    return invalid("分块配置缺失或不兼容");
  }
  const config = selection.chunkConfig;
  if (Object.keys(config).some((name) => !(name in schema.properties))) {
    return invalid("分块配置包含 capabilities 未声明的字段");
  }
  for (const required of schema.required) {
    if (!(required in config)) return invalid(`分块配置缺少 ${required}`);
  }
  for (const [name, value] of Object.entries(config)) {
    if (!validatePropertyValue(schema.properties[name], value)) {
      return invalid(`分块配置 ${name} 不符合 capabilities schema`);
    }
  }
  return {
    valid: true,
    error: null,
    request: {
      processMode: "chunk",
      chunkStrategy: strategy,
      chunkConfig: { ...config },
      pipelineId: null,
    },
  };
}

export function validateRagPickedDocument(
  settings: RagIngestionSettings,
  file: RagPickedDocumentFile,
) {
  if (!file.path.trim() || !file.name.trim()) return "文件路径或名称无效";
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > settings.maxUploadBytes) {
    return `文件大小超过允许上限 ${settings.maxUploadBytes} 字节`;
  }
  if (!settings.allowedExtensions.includes(normalizeExtension(file.extension.trim()))) {
    return "文件扩展名不在 capabilities 白名单中";
  }
  if (!settings.allowedMimeTypes.includes(file.mimeType.trim().toLowerCase())) {
    return "文件 MIME 类型不在 capabilities 白名单中";
  }
  return null;
}
