/**
 * A deterministic in-memory tag provider for Task 8. It never touches a real
 * platform, network, DOM or Chrome API.
 */
export function createFakeTagProvider(options = {}) {
  const tagsByCandidateId = new Map(
    Object.entries(options.tagsByCandidateId ?? {})
  );
  const failingCandidateIds = new Set(options.failingCandidateIds ?? []);
  const calls = [];
  let releaseGate = null;
  let gate = null;

  return {
    async fetchNativeTags(candidate) {
      calls.push(candidate.id);
      if (gate !== null) {
        await gate;
      }
      if (failingCandidateIds.has(candidate.id)) {
        throw new Error(`Fake provider failure: ${candidate.id}`);
      }
      return tagsByCandidateId.get(candidate.id) ?? [];
    },

    /** Hold every in-flight request until release() is called. */
    block() {
      gate = new Promise((resolve) => {
        releaseGate = resolve;
      });
    },

    release() {
      const resolve = releaseGate;
      gate = null;
      releaseGate = null;
      resolve?.();
    },

    setTags(candidateId, tags) {
      tagsByCandidateId.set(candidateId, tags);
    },

    stopFailing(candidateId) {
      failingCandidateIds.delete(candidateId);
    },

    get calls() {
      return [...calls];
    },

    get callCount() {
      return calls.length;
    },

    callCountFor(candidateId) {
      return calls.filter((id) => id === candidateId).length;
    }
  };
}
