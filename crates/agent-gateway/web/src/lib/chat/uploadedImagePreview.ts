import type { PendingUploadedFile } from "./uploadedFiles";

export type UploadedImagePreviewResult = {
  mimeType: string;
  data: string;
};

export type UploadedImagePreviewLoader = (
  workspaceRoot: string,
  absolutePath: string,
) => Promise<UploadedImagePreviewResult | null>;

type UploadedImagePreviewCacheEntry = {
  src: string;
  revoke?: () => void;
};

const UPLOADED_IMAGE_PREVIEW_CACHE_LIMIT = 64;
const uploadedImagePreviewCache = new Map<string, UploadedImagePreviewCacheEntry>();
const uploadedImagePreviewRequests = new Map<string, Promise<string | null>>();

function normalizeCachePart(value: string | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

export function getUploadedImagePreviewCacheKey(
  workspaceRoot: string | undefined,
  file: Pick<PendingUploadedFile, "absolutePath" | "relativePath">,
) {
  const root = normalizeCachePart(workspaceRoot);
  const path = normalizeCachePart(file.absolutePath) || normalizeCachePart(file.relativePath);
  return root && path ? `${root}\0${path}` : "";
}

function readUploadedImagePreviewCacheByKey(cacheKey: string) {
  const cached = uploadedImagePreviewCache.get(cacheKey);
  if (!cached) return undefined;
  uploadedImagePreviewCache.delete(cacheKey);
  uploadedImagePreviewCache.set(cacheKey, cached);
  return cached.src;
}

export function readUploadedImagePreviewCache(
  workspaceRoot: string | undefined,
  file: Pick<PendingUploadedFile, "absolutePath" | "relativePath">,
) {
  const cacheKey = getUploadedImagePreviewCacheKey(workspaceRoot, file);
  return cacheKey ? readUploadedImagePreviewCacheByKey(cacheKey) : undefined;
}

function writeUploadedImagePreviewCache(cacheKey: string, entry: UploadedImagePreviewCacheEntry) {
  const previous = uploadedImagePreviewCache.get(cacheKey);
  if (previous?.src !== entry.src) {
    previous?.revoke?.();
  }
  uploadedImagePreviewCache.delete(cacheKey);
  uploadedImagePreviewCache.set(cacheKey, entry);

  while (uploadedImagePreviewCache.size > UPLOADED_IMAGE_PREVIEW_CACHE_LIMIT) {
    const oldestKey = uploadedImagePreviewCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = uploadedImagePreviewCache.get(oldestKey);
    oldest?.revoke?.();
    uploadedImagePreviewCache.delete(oldestKey);
  }
}

function canCreateObjectUrl() {
  return typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
}

function createLocalPreviewCacheEntry(file: File): UploadedImagePreviewCacheEntry | null {
  if (!canCreateObjectUrl()) return null;
  const src = URL.createObjectURL(file);
  return {
    src,
    revoke: typeof URL.revokeObjectURL === "function" ? () => URL.revokeObjectURL(src) : undefined,
  };
}

function isImageSourceFile(file: File) {
  return typeof file.type === "string" && file.type.toLowerCase().startsWith("image/");
}

function takeMatchingSourceFile(
  uploadedFile: PendingUploadedFile,
  sourceFiles: File[],
  usedSourceIndexes: Set<number>,
) {
  const exactIndex = sourceFiles.findIndex(
    (sourceFile, index) =>
      !usedSourceIndexes.has(index) &&
      isImageSourceFile(sourceFile) &&
      sourceFile.name === uploadedFile.fileName &&
      sourceFile.size === uploadedFile.sizeBytes,
  );
  if (exactIndex >= 0) {
    const exactMatch = sourceFiles[exactIndex];
    if (!exactMatch) return null;
    usedSourceIndexes.add(exactIndex);
    return exactMatch;
  }

  const sameSizeMatches = sourceFiles
    .map((sourceFile, index) => ({ sourceFile, index }))
    .filter(
      ({ sourceFile, index }) =>
        !usedSourceIndexes.has(index) &&
        isImageSourceFile(sourceFile) &&
        sourceFile.size === uploadedFile.sizeBytes,
    );
  if (sameSizeMatches.length === 1) {
    const sameSizeMatch = sameSizeMatches[0];
    if (!sameSizeMatch) return null;
    usedSourceIndexes.add(sameSizeMatch.index);
    return sameSizeMatch.sourceFile;
  }
  return null;
}

export function registerLocalUploadedImagePreviews(params: {
  workspaceRoot: string | undefined;
  uploadedFiles: PendingUploadedFile[];
  sourceFiles: File[];
}) {
  const { workspaceRoot, uploadedFiles, sourceFiles } = params;
  const usedSourceIndexes = new Set<number>();

  for (const uploadedFile of uploadedFiles) {
    if (uploadedFile.kind !== "image") continue;
    const cacheKey = getUploadedImagePreviewCacheKey(workspaceRoot, uploadedFile);
    if (!cacheKey) continue;
    const sourceFile = takeMatchingSourceFile(uploadedFile, sourceFiles, usedSourceIndexes);
    if (!sourceFile) continue;
    const entry = createLocalPreviewCacheEntry(sourceFile);
    if (!entry) continue;
    writeUploadedImagePreviewCache(cacheKey, entry);
  }
}

export async function loadUploadedImagePreview(params: {
  workspaceRoot: string;
  file: PendingUploadedFile;
  loader: UploadedImagePreviewLoader;
}) {
  const { workspaceRoot, file, loader } = params;
  const cacheKey = getUploadedImagePreviewCacheKey(workspaceRoot, file);
  if (!cacheKey) return null;

  const cached = readUploadedImagePreviewCacheByKey(cacheKey);
  if (cached !== undefined) return cached;

  const absolutePath = normalizeCachePart(file.absolutePath);
  if (!absolutePath) return null;

  const existing = uploadedImagePreviewRequests.get(cacheKey);
  if (existing) return existing;

  const request = loader(workspaceRoot, absolutePath)
    .then((result) => {
      const mimeType =
        typeof result?.mimeType === "string" && result.mimeType.trim()
          ? result.mimeType.trim()
          : "application/octet-stream";
      const data = typeof result?.data === "string" ? result.data.trim() : "";
      const next = data ? `data:${mimeType};base64,${data}` : null;
      if (next) {
        writeUploadedImagePreviewCache(cacheKey, { src: next });
      }
      return next;
    })
    .catch(() => null)
    .finally(() => {
      uploadedImagePreviewRequests.delete(cacheKey);
    });

  uploadedImagePreviewRequests.set(cacheKey, request);
  return request;
}
