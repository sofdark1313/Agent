export type ClawHubSort = "downloads" | "stars" | "installs" | "updated" | "newest";

export type ClawHubSkillCard = {
  slug: string;
  displayName: string;
  summary: string;
  latestVersion: string | null;
  downloads: number;
  stars: number;
  installsCurrent: number;
  updatedAt: number | null;
  ownerHandle: string | null;
  webUrl?: string | null;
  downloadUrl?: string | null;
};

export type ClawHubSkillDetail = ClawHubSkillCard & {
  createdAt: number | null;
  latestVersionCreatedAt: number | null;
  latestVersionChangelog: string | null;
  license: string | null;
  ownerDisplayName: string | null;
  ownerImage: string | null;
  supportedOs: string[];
  supportedSystems: string[];
  moderationStatus: string | null;
};

export type ClawHubListResponse = {
  items: ClawHubSkillCard[];
  nextCursor: string | null;
};

const CLAWHUB_API_BASE = "https://clawhub.ai";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => asString(item)).filter((item): item is string => Boolean(item))
    : [];
}

function buildClawHubWebUrl(ownerHandle: string | null, slug: string) {
  if (!ownerHandle) return null;
  return `${CLAWHUB_API_BASE}/${encodeURIComponent(ownerHandle)}/${encodeURIComponent(slug)}`;
}

function normalizeSkillCard(raw: unknown): ClawHubSkillCard | null {
  const item = asRecord(raw);
  const slug = asString(item.slug);
  if (!slug) return null;
  const stats = asRecord(item.stats);
  const latestVersion = asRecord(item.latestVersion);
  const tags = asRecord(item.tags);
  const owner = asRecord(item.owner);
  const ownerHandle = asString(item.ownerHandle) ?? asString(owner.handle);

  return {
    slug,
    displayName: asString(item.displayName) ?? slug,
    summary: asString(item.summary) ?? "",
    latestVersion:
      asString(latestVersion.version) ?? asString(tags.latest) ?? asString(item.version),
    downloads: asNumber(stats.downloads),
    stars: asNumber(stats.stars),
    installsCurrent: asNumber(stats.installsCurrent),
    updatedAt: asNullableNumber(item.updatedAt),
    ownerHandle,
    webUrl: asString(item.webUrl) ?? buildClawHubWebUrl(ownerHandle, slug),
    downloadUrl: asString(item.downloadUrl) ?? buildClawHubDownloadUrl(slug),
  };
}

function normalizeSkillDetail(raw: unknown): ClawHubSkillDetail | null {
  const payload = asRecord(raw);
  const skill = asRecord(payload.skill);
  const item = Object.keys(skill).length > 0 ? skill : payload;
  const latestVersion = asRecord(payload.latestVersion ?? item.latestVersion);
  const owner = asRecord(payload.owner ?? item.owner);
  const metadata = asRecord(payload.metadata ?? item.metadata);
  const moderation = asRecord(payload.moderation ?? item.moderation);
  const card = normalizeSkillCard({
    ...item,
    latestVersion,
    owner,
  });
  if (!card) return null;

  return {
    ...card,
    createdAt: asNullableNumber(item.createdAt),
    latestVersionCreatedAt: asNullableNumber(latestVersion.createdAt),
    latestVersionChangelog: asString(latestVersion.changelog),
    license: asString(latestVersion.license),
    ownerDisplayName: asString(owner.displayName),
    ownerImage: asString(owner.image),
    supportedOs: asStringArray(metadata.os),
    supportedSystems: asStringArray(metadata.systems),
    moderationStatus:
      asString(moderation.status) ?? asString(moderation.result) ?? asString(moderation.state),
  };
}

async function fetchClawHubJson(url: URL): Promise<unknown> {
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`ClawHub request failed with HTTP ${response.status}`);
  }
  return response.json();
}

export async function listClawHubSkills(params: {
  sort: ClawHubSort;
  cursor?: string | null;
  limit?: number;
}): Promise<ClawHubListResponse> {
  const url = new URL("/api/v1/skills", CLAWHUB_API_BASE);
  url.searchParams.set("limit", String(params.limit ?? 24));
  url.searchParams.set("sort", params.sort);
  url.searchParams.set("nonSuspiciousOnly", "true");
  if (params.cursor) {
    url.searchParams.set("cursor", params.cursor);
  }

  const json = asRecord(await fetchClawHubJson(url));
  const items = Array.isArray(json.items)
    ? json.items.map(normalizeSkillCard).filter((item): item is ClawHubSkillCard => Boolean(item))
    : [];
  return {
    items,
    nextCursor: asString(json.nextCursor),
  };
}

export async function searchClawHubSkills(params: {
  query: string;
  limit?: number;
}): Promise<ClawHubSkillCard[]> {
  const url = new URL("/api/v1/search", CLAWHUB_API_BASE);
  url.searchParams.set("q", params.query);
  url.searchParams.set("limit", String(params.limit ?? 24));
  url.searchParams.set("nonSuspiciousOnly", "true");

  const json = asRecord(await fetchClawHubJson(url));
  return Array.isArray(json.results)
    ? json.results.map(normalizeSkillCard).filter((item): item is ClawHubSkillCard => Boolean(item))
    : [];
}

export async function getClawHubSkillDetail(slug: string): Promise<ClawHubSkillDetail> {
  const url = new URL(`/api/v1/skills/${encodeURIComponent(slug)}`, CLAWHUB_API_BASE);
  const detail = normalizeSkillDetail(await fetchClawHubJson(url));
  if (!detail) {
    throw new Error("ClawHub skill detail not found");
  }
  return detail;
}

export function buildClawHubDownloadUrl(slug: string) {
  const url = new URL("/api/v1/download", CLAWHUB_API_BASE);
  url.searchParams.set("slug", slug);
  url.searchParams.set("tag", "latest");
  return url.toString();
}
