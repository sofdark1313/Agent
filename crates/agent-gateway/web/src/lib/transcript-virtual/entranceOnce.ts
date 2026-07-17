// Entrance-animation registry: a row animates once, when it is genuinely new
// to the transcript — never when the virtualizer remounts it on scroll
// re-entry, and never for rows that were already present when a conversation
// opened.
//
// The registry observes the full row-key list on every build (not just the
// rendered window, which would misclassify never-yet-rendered history rows as
// new). Keys present in the first observed build are stamped 0 = never
// animate; keys that appear in later builds are stamped with their birth
// time, and renders within the animation window play the entrance class.
// Decisions are pure reads afterwards, so StrictMode double-renders and
// double-mounts inside the window replay the same answer.

export const ENTRANCE_ANIMATION_WINDOW_MS = 600;

export type EntranceRegistry = {
  reset: () => void;
  observeRowKeys: (keys: readonly string[]) => void;
  shouldAnimate: (key: string) => boolean;
};

export function createEntranceRegistry(now: () => number = Date.now): EntranceRegistry {
  let initialized = false;
  // key -> birth timestamp; 0 marks initial-build rows that never animate.
  const bornAt = new Map<string, number>();

  return {
    reset: () => {
      initialized = false;
      bornAt.clear();
    },
    observeRowKeys: (keys) => {
      const stamp = initialized ? now() : 0;
      for (const key of keys) {
        if (!bornAt.has(key)) {
          bornAt.set(key, stamp);
        }
      }
      initialized = true;
    },
    shouldAnimate: (key) => {
      const stamp = bornAt.get(key);
      if (stamp === undefined || stamp === 0) {
        return false;
      }
      return now() - stamp < ENTRANCE_ANIMATION_WINDOW_MS;
    },
  };
}
