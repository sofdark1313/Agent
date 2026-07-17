export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function normalizeReleaseTag(input) {
  const rawTag = String(input ?? "").trim();
  if (!rawTag) {
    throw new Error("Release tag is required. Example: v0.1.3");
  }

  const releaseTag = rawTag.replace(/^refs\/tags\//, "");
  if (!releaseTag.startsWith("v")) {
    throw new Error(`Release tag must start with "v". Received: ${rawTag}`);
  }

  const appVersion = releaseTag.slice(1);
  if (!SEMVER_PATTERN.test(appVersion)) {
    throw new Error(`Release tag must be a semver tag like v0.1.3. Received: ${rawTag}`);
  }

  return releaseTag;
}

export function parseReleaseVersion(input) {
  const releaseTag = normalizeReleaseTag(input);
  const appVersion = releaseTag.slice(1);

  return {
    appVersion,
    isPrerelease: appVersion.split("+", 1)[0].includes("-"),
    releaseTag,
  };
}

export function tauriVersionConfig(appVersion) {
  if (!SEMVER_PATTERN.test(appVersion)) {
    throw new Error(`App version must be a valid semver string. Received: ${appVersion}`);
  }

  return {
    version: appVersion,
  };
}
