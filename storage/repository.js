// @ts-check

import {
  SCHEMA_VERSION,
  isCandidateSignalsV1,
  isCandidateV1,
  isSearchContextV1
} from "../shared/types.js";
import { normalizeCandidateUrl } from "../shared/url.js";

export const REPOSITORY_SCHEMA_KEY = "meta:schema";

export const REPOSITORY_KINDS = Object.freeze({
  CHOSEN: "chosen",
  MISSED_PATH: "missed-path",
  REENCOUNTER: "reencounter",
  SESSION: "session",
  SESSION_FINALIZATION: "session-finalization",
  SETTINGS: "settings"
});

const SETTINGS_ID = "current";
const REASON_CODES = new Set([
  "LONG_EXPOSURE",
  "LONG_HOVER",
  "REPEATED_HOVER",
  "RETURN_VIEW",
  "NOT_CLICKED",
  "CONTEXT_MATCH"
]);
const MISSED_PATH_STATUSES = new Set([
  "MISSED",
  "ELIGIBLE",
  "REENCOUNTERED",
  "ARCHIVED"
]);
const REENCOUNTER_OUTCOMES = new Set([
  "OPENED",
  "LATER",
  "DISMISSED",
  "NOT_RELEVANT",
  "DELETED"
]);

export class RepositoryVersionError extends Error {
  constructor(actualVersion) {
    super(
      `Unsupported repository schemaVersion: ${String(actualVersion)}; expected ${SCHEMA_VERSION}.`
    );
    this.name = "RepositoryVersionError";
    this.code = "SCHEMA_VERSION_UNSUPPORTED";
    this.expectedVersion = SCHEMA_VERSION;
    this.actualVersion = actualVersion;
  }
}

export class RepositoryDataError extends Error {
  constructor(message) {
    super(message);
    this.name = "RepositoryDataError";
    this.code = "REPOSITORY_DATA_INVALID";
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) {
    return false;
  }

  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isUnitNumber(value) {
  return isFiniteNonNegativeNumber(value) && value <= 1;
}

function isStringList(value) {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isReason(value) {
  if (!isRecord(value)) {
    return false;
  }

  const hasContribution = Object.hasOwn(value, "contribution");
  return Boolean(
    hasExactKeys(
      value,
      hasContribution
        ? ["code", "label", "contribution"]
        : ["code", "label"]
    ) &&
      REASON_CODES.has(value.code) &&
      isNonEmptyString(value.label) &&
      (!hasContribution || isFiniteNonNegativeNumber(value.contribution))
  );
}

function isSessionCandidate(value, sessionId) {
  return Boolean(
    hasExactKeys(value, ["candidate", "signals"]) &&
      isCandidateV1(value.candidate) &&
      isCandidateSignalsV1(value.signals) &&
      value.candidate.sessionId === sessionId &&
      value.signals.sessionId === sessionId &&
      value.signals.candidateId === value.candidate.id
  );
}

function isSessionState(value) {
  if (
    !hasExactKeys(value, [
      "sessionId",
      "context",
      "candidates",
      "updatedAt"
    ]) ||
    !isNonEmptyString(value.sessionId) ||
    !isSearchContextV1(value.context) ||
    !Array.isArray(value.candidates) ||
    !isFiniteNonNegativeNumber(value.updatedAt)
  ) {
    return false;
  }

  const candidateIds = new Set();
  for (const entry of value.candidates) {
    if (
      !isSessionCandidate(entry, value.sessionId) ||
      candidateIds.has(entry.candidate.id)
    ) {
      return false;
    }
    candidateIds.add(entry.candidate.id);
  }
  return true;
}

function isChosen(value) {
  return Boolean(
    hasExactKeys(value, ["id", "candidate", "context", "chosenAt"]) &&
      isNonEmptyString(value.id) &&
      isCandidateV1(value.candidate) &&
      isSearchContextV1(value.context) &&
      isFiniteNonNegativeNumber(value.chosenAt)
  );
}

function isMissedPath(value) {
  return Boolean(
    hasExactKeys(value, [
      "id",
      "candidate",
      "context",
      "score",
      "reasons",
      "status",
      "createdAt"
    ]) &&
      isNonEmptyString(value.id) &&
      isCandidateV1(value.candidate) &&
      isSearchContextV1(value.context) &&
      isUnitNumber(value.score) &&
      Array.isArray(value.reasons) &&
      value.reasons.every(isReason) &&
      MISSED_PATH_STATUSES.has(value.status) &&
      isFiniteNonNegativeNumber(value.createdAt)
  );
}

function isReencounter(value) {
  if (!isRecord(value)) {
    return false;
  }

  const hasOutcome = Object.hasOwn(value, "outcome");
  return Boolean(
    hasExactKeys(
      value,
      hasOutcome
        ? [
            "id",
            "missedPathId",
            "triggerContext",
            "score",
            "reasons",
            "shownAt",
            "outcome"
          ]
        : [
            "id",
            "missedPathId",
            "triggerContext",
            "score",
            "reasons",
            "shownAt"
          ]
    ) &&
      isNonEmptyString(value.id) &&
      isNonEmptyString(value.missedPathId) &&
      isSearchContextV1(value.triggerContext) &&
      isUnitNumber(value.score) &&
      Array.isArray(value.reasons) &&
      value.reasons.every(isReason) &&
      isFiniteNonNegativeNumber(value.shownAt) &&
      (!hasOutcome || REENCOUNTER_OUTCOMES.has(value.outcome))
  );
}

function isSettings(value) {
  return Boolean(
    hasExactKeys(value, [
      "enabled",
      "allowlist",
      "blocklist",
      "thresholds",
      "demoMode"
    ]) &&
      typeof value.enabled === "boolean" &&
      isStringList(value.allowlist) &&
      isStringList(value.blocklist) &&
      hasExactKeys(value.thresholds, ["consideration", "reencounter"]) &&
      isUnitNumber(value.thresholds.consideration) &&
      isUnitNumber(value.thresholds.reencounter) &&
      typeof value.demoMode === "boolean"
  );
}

function isSessionFinalization(value) {
  return Boolean(
    hasExactKeys(value, [
      "sessionId",
      "finalizedAt",
      "chosenIds",
      "missedPathIds"
    ]) &&
      isNonEmptyString(value.sessionId) &&
      isFiniteNonNegativeNumber(value.finalizedAt) &&
      isStringList(value.chosenIds) &&
      new Set(value.chosenIds).size === value.chosenIds.length &&
      isStringList(value.missedPathIds) &&
      new Set(value.missedPathIds).size === value.missedPathIds.length
  );
}

function cloneJson(value) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError("Value is not JSON serializable.");
    }
    return JSON.parse(serialized);
  } catch (error) {
    if (error instanceof RepositoryDataError) {
      throw error;
    }
    throw new RepositoryDataError("Repository data must be JSON serializable.");
  }
}

function isSameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function recordKey(kind, id) {
  return `${kind}:${id}`;
}

function assertAdapter(adapter) {
  if (!isRecord(adapter)) {
    throw new TypeError("Repository requires a storage adapter.");
  }
  for (const method of ["get", "entries", "commit"]) {
    if (typeof adapter[method] !== "function") {
      throw new TypeError(`Storage adapter must implement ${method}().`);
    }
  }
}

/**
 * @param {{
 *   get: (key: string) => Promise<unknown>,
 *   entries: () => Promise<Array<{key: string, value: unknown}>>,
 *   commit: (changes: {
 *     clear?: boolean,
 *     puts?: Array<{key: string, value: unknown}>,
 *     deletes?: string[]
 *   }) => Promise<void>
 * }} adapter
 */
export function createRepository(adapter) {
  assertAdapter(adapter);

  async function ensureCompatibleVersion() {
    const metadata = await adapter.get(REPOSITORY_SCHEMA_KEY);
    if (metadata === undefined) {
      await adapter.commit({
        puts: [
          {
            key: REPOSITORY_SCHEMA_KEY,
            value: { schemaVersion: SCHEMA_VERSION }
          }
        ]
      });
      return;
    }

    if (
      !hasExactKeys(metadata, ["schemaVersion"]) ||
      metadata.schemaVersion !== SCHEMA_VERSION
    ) {
      throw new RepositoryVersionError(metadata?.schemaVersion);
    }
  }

  function validateStoredRecord(record, expectedKind, expectedId) {
    if (
      !hasExactKeys(record, ["schemaVersion", "kind", "id", "data"]) ||
      record.schemaVersion !== SCHEMA_VERSION
    ) {
      throw new RepositoryVersionError(record?.schemaVersion);
    }
    if (record.kind !== expectedKind || record.id !== expectedId) {
      throw new RepositoryDataError("Stored repository record identity is invalid.");
    }
    return record.data;
  }

  async function saveRecord(kind, id, data, validator) {
    if (!validator(data)) {
      throw new RepositoryDataError(`Invalid ${kind} data.`);
    }
    await ensureCompatibleVersion();

    const key = recordKey(kind, id);
    const nextRecord = {
      schemaVersion: SCHEMA_VERSION,
      kind,
      id,
      data: cloneJson(data)
    };
    const existingRecord = await adapter.get(key);
    if (existingRecord !== undefined) {
      validateStoredRecord(existingRecord, kind, id);
      if (isSameJson(existingRecord, nextRecord)) {
        return false;
      }
    }

    await adapter.commit({ puts: [{ key, value: nextRecord }] });
    return true;
  }

  async function getRecord(kind, id, validator) {
    if (!isNonEmptyString(id)) {
      throw new RepositoryDataError(`${kind} id must be a non-empty string.`);
    }
    await ensureCompatibleVersion();

    const record = await adapter.get(recordKey(kind, id));
    if (record === undefined) {
      return null;
    }
    const data = validateStoredRecord(record, kind, id);
    if (!validator(data)) {
      throw new RepositoryDataError(`Stored ${kind} data is invalid.`);
    }
    return cloneJson(data);
  }

  async function listRecords(kind, validator) {
    await ensureCompatibleVersion();
    const prefix = `${kind}:`;
    const records = [];
    for (const entry of await adapter.entries()) {
      if (!isRecord(entry) || !isNonEmptyString(entry.key)) {
        throw new RepositoryDataError("Storage adapter returned an invalid entry.");
      }
      if (!entry.key.startsWith(prefix)) {
        continue;
      }

      const id = entry.key.slice(prefix.length);
      const data = validateStoredRecord(entry.value, kind, id);
      if (!validator(data)) {
        throw new RepositoryDataError(`Stored ${kind} data is invalid.`);
      }
      records.push({ id, data: cloneJson(data) });
    }
    return records
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((record) => record.data);
  }

  async function deleteRecord(kind, id, validator) {
    const existing = await getRecord(kind, id, validator);
    if (existing === null) {
      return false;
    }
    await adapter.commit({ deletes: [recordKey(kind, id)] });
    return true;
  }

  function createStoredRecord(kind, id, data) {
    return {
      schemaVersion: SCHEMA_VERSION,
      kind,
      id,
      data: cloneJson(data)
    };
  }

  async function assertNoConflictingRecord(kind, data, validator) {
    const key = recordKey(kind, data.id);
    const nextRecord = createStoredRecord(kind, data.id, data);
    const existingRecord = await adapter.get(key);
    if (existingRecord === undefined) {
      return { key, value: nextRecord };
    }

    const existingData = validateStoredRecord(existingRecord, kind, data.id);
    if (!validator(existingData)) {
      throw new RepositoryDataError(`Stored ${kind} data is invalid.`);
    }
    if (!isSameJson(existingRecord, nextRecord)) {
      throw new RepositoryDataError(
        `Atomic session finalization conflicts with existing ${kind} data.`
      );
    }
    return null;
  }

  return Object.freeze({
    async getSchemaVersion() {
      await ensureCompatibleVersion();
      return SCHEMA_VERSION;
    },

    saveSession(session) {
      return saveRecord(
        REPOSITORY_KINDS.SESSION,
        session?.sessionId,
        session,
        isSessionState
      );
    },
    async mergeDiscoveredCandidates(discovery) {
      if (
        !hasExactKeys(discovery, [
          "sessionId",
          "context",
          "candidates",
          "discoveredAt"
        ]) ||
        !isNonEmptyString(discovery.sessionId) ||
        !isSearchContextV1(discovery.context) ||
        !Array.isArray(discovery.candidates) ||
        discovery.candidates.length === 0 ||
        !isFiniteNonNegativeNumber(discovery.discoveredAt)
      ) {
        throw new RepositoryDataError("Invalid Candidate discovery data.");
      }

      const batchIds = new Set();
      const batchUrls = new Set();
      for (const candidate of discovery.candidates) {
        const normalizedUrl = isCandidateV1(candidate)
          ? normalizeCandidateUrl(candidate.url)
          : null;
        if (
          normalizedUrl === null ||
          normalizedUrl !== candidate.url ||
          candidate.sessionId !== discovery.sessionId ||
          batchIds.has(candidate.id) ||
          batchUrls.has(normalizedUrl)
        ) {
          throw new RepositoryDataError(
            "Candidate discovery contains invalid or duplicate Candidates."
          );
        }
        batchIds.add(candidate.id);
        batchUrls.add(normalizedUrl);
      }

      await ensureCompatibleVersion();
      const sessionKey = recordKey(
        REPOSITORY_KINDS.SESSION,
        discovery.sessionId
      );
      const finalizationKey = recordKey(
        REPOSITORY_KINDS.SESSION_FINALIZATION,
        discovery.sessionId
      );
      const storedFinalization = await adapter.get(finalizationKey);
      if (storedFinalization !== undefined) {
        const finalization = validateStoredRecord(
          storedFinalization,
          REPOSITORY_KINDS.SESSION_FINALIZATION,
          discovery.sessionId
        );
        if (!isSessionFinalization(finalization)) {
          throw new RepositoryDataError(
            "Stored session-finalization data is invalid."
          );
        }
        throw new RepositoryDataError(
          `Cannot add Candidates to finalized session: ${discovery.sessionId}`
        );
      }

      const storedSession = await adapter.get(sessionKey);
      let session;
      if (storedSession === undefined) {
        session = {
          sessionId: discovery.sessionId,
          context: cloneJson(discovery.context),
          candidates: [],
          updatedAt: discovery.discoveredAt
        };
      } else {
        session = validateStoredRecord(
          storedSession,
          REPOSITORY_KINDS.SESSION,
          discovery.sessionId
        );
        if (!isSessionState(session)) {
          throw new RepositoryDataError("Stored session data is invalid.");
        }
        if (!isSameJson(session.context, discovery.context)) {
          throw new RepositoryDataError(
            `SearchContext conflicts with session: ${discovery.sessionId}`
          );
        }
        session = cloneJson(session);
      }

      const candidatesById = new Map(
        session.candidates.map((entry) => [entry.candidate.id, entry.candidate])
      );
      const candidateIdsByUrl = new Map();
      for (const entry of session.candidates) {
        const normalizedUrl = normalizeCandidateUrl(entry.candidate.url);
        if (normalizedUrl === null) {
          throw new RepositoryDataError(
            "Stored session Candidate URL is invalid."
          );
        }
        candidateIdsByUrl.set(normalizedUrl, entry.candidate.id);
      }

      const acceptedCandidateIds = [];
      for (const candidate of discovery.candidates) {
        const existingCandidate = candidatesById.get(candidate.id);
        if (existingCandidate !== undefined) {
          if (
            existingCandidate.url !== candidate.url ||
            existingCandidate.title !== candidate.title ||
            existingCandidate.source !== candidate.source
          ) {
            throw new RepositoryDataError(
              `Candidate identity conflicts with stored Candidate: ${candidate.id}`
            );
          }
          continue;
        }

        const existingIdForUrl = candidateIdsByUrl.get(candidate.url);
        if (existingIdForUrl !== undefined) {
          throw new RepositoryDataError(
            `Candidate URL conflicts with stored Candidate: ${existingIdForUrl}`
          );
        }

        session.candidates.push({
          candidate: cloneJson(candidate),
          signals: {
            candidateId: candidate.id,
            sessionId: discovery.sessionId,
            visibleMs: 0,
            hoverMs: 0,
            hoverCount: 0,
            returnCount: 0,
            clicked: false
          }
        });
        candidatesById.set(candidate.id, candidate);
        candidateIdsByUrl.set(candidate.url, candidate.id);
        acceptedCandidateIds.push(candidate.id);
      }

      if (acceptedCandidateIds.length > 0) {
        session.updatedAt = Math.max(
          session.updatedAt,
          discovery.discoveredAt
        );
        await adapter.commit({
          puts: [
            {
              key: sessionKey,
              value: createStoredRecord(
                REPOSITORY_KINDS.SESSION,
                discovery.sessionId,
                session
              )
            }
          ]
        });
      }

      return {
        sessionId: discovery.sessionId,
        acceptedCandidateIds,
        totalCandidateCount: session.candidates.length,
        updatedAt: session.updatedAt
      };
    },
    getSession(sessionId) {
      return getRecord(REPOSITORY_KINDS.SESSION, sessionId, isSessionState);
    },
    listSessions() {
      return listRecords(REPOSITORY_KINDS.SESSION, isSessionState);
    },
    async mergeCandidateSignalsSnapshot(update) {
      if (
        !hasExactKeys(update, ["signals", "updatedAt"]) ||
        !isCandidateSignalsV1(update.signals) ||
        !isFiniteNonNegativeNumber(update.updatedAt)
      ) {
        throw new RepositoryDataError("Invalid Candidate signals snapshot.");
      }

      await ensureCompatibleVersion();
      const { signals, updatedAt } = update;
      const sessionKey = recordKey(
        REPOSITORY_KINDS.SESSION,
        signals.sessionId
      );
      const storedSession = await adapter.get(sessionKey);
      if (storedSession === undefined) {
        throw new RepositoryDataError(
          `Session not found: ${signals.sessionId}`
        );
      }

      const session = validateStoredRecord(
        storedSession,
        REPOSITORY_KINDS.SESSION,
        signals.sessionId
      );
      if (!isSessionState(session)) {
        throw new RepositoryDataError("Stored session data is invalid.");
      }

      const finalizationKey = recordKey(
        REPOSITORY_KINDS.SESSION_FINALIZATION,
        signals.sessionId
      );
      const storedFinalization = await adapter.get(finalizationKey);
      if (storedFinalization !== undefined) {
        const finalization = validateStoredRecord(
          storedFinalization,
          REPOSITORY_KINDS.SESSION_FINALIZATION,
          signals.sessionId
        );
        if (!isSessionFinalization(finalization)) {
          throw new RepositoryDataError(
            "Stored session-finalization data is invalid."
          );
        }
        throw new RepositoryDataError(
          `Cannot update finalized session: ${signals.sessionId}`
        );
      }

      const candidateIndex = session.candidates.findIndex(
        (entry) => entry.candidate.id === signals.candidateId
      );
      if (candidateIndex < 0) {
        throw new RepositoryDataError(
          `Candidate ${signals.candidateId} is not part of session ${signals.sessionId}.`
        );
      }

      const previousSignals = session.candidates[candidateIndex].signals;
      const mergedSignals = {
        candidateId: previousSignals.candidateId,
        sessionId: previousSignals.sessionId,
        visibleMs: Math.max(previousSignals.visibleMs, signals.visibleMs),
        hoverMs: Math.max(previousSignals.hoverMs, signals.hoverMs),
        hoverCount: Math.max(
          previousSignals.hoverCount,
          signals.hoverCount
        ),
        returnCount: Math.max(
          previousSignals.returnCount,
          signals.returnCount
        ),
        clicked: previousSignals.clicked || signals.clicked
      };
      const changed = !isSameJson(previousSignals, mergedSignals);
      if (changed) {
        const nextSession = cloneJson(session);
        nextSession.candidates[candidateIndex].signals = mergedSignals;
        nextSession.updatedAt = Math.max(session.updatedAt, updatedAt);
        await adapter.commit({
          puts: [
            {
              key: sessionKey,
              value: createStoredRecord(
                REPOSITORY_KINDS.SESSION,
                signals.sessionId,
                nextSession
              )
            }
          ]
        });
        return {
          sessionId: signals.sessionId,
          candidateId: signals.candidateId,
          updatedAt: nextSession.updatedAt,
          changed: true
        };
      }

      return {
        sessionId: signals.sessionId,
        candidateId: signals.candidateId,
        updatedAt: session.updatedAt,
        changed: false
      };
    },
    async markCandidateChosen(sessionId, candidateId, updatedAt) {
      if (
        !isNonEmptyString(sessionId) ||
        !isNonEmptyString(candidateId) ||
        !isFiniteNonNegativeNumber(updatedAt)
      ) {
        throw new RepositoryDataError(
          "Chosen session, candidate, and timestamp are invalid."
        );
      }

      await ensureCompatibleVersion();
      const sessionKey = recordKey(REPOSITORY_KINDS.SESSION, sessionId);
      const storedSession = await adapter.get(sessionKey);
      if (storedSession === undefined) {
        throw new RepositoryDataError(`Session not found: ${sessionId}`);
      }

      const session = validateStoredRecord(
        storedSession,
        REPOSITORY_KINDS.SESSION,
        sessionId
      );
      if (!isSessionState(session)) {
        throw new RepositoryDataError("Stored session data is invalid.");
      }

      const candidateIndex = session.candidates.findIndex(
        (entry) => entry.candidate.id === candidateId
      );
      if (candidateIndex < 0) {
        throw new RepositoryDataError(
          `Candidate ${candidateId} is not part of session ${sessionId}.`
        );
      }
      if (session.candidates[candidateIndex].signals.clicked) {
        return false;
      }

      const finalizationKey = recordKey(
        REPOSITORY_KINDS.SESSION_FINALIZATION,
        sessionId
      );
      const storedFinalization = await adapter.get(finalizationKey);
      if (storedFinalization !== undefined) {
        const finalization = validateStoredRecord(
          storedFinalization,
          REPOSITORY_KINDS.SESSION_FINALIZATION,
          sessionId
        );
        if (!isSessionFinalization(finalization)) {
          throw new RepositoryDataError(
            "Stored session-finalization data is invalid."
          );
        }
        throw new RepositoryDataError(
          `Cannot update finalized session: ${sessionId}`
        );
      }

      const nextSession = cloneJson(session);
      nextSession.candidates[candidateIndex].signals.clicked = true;
      nextSession.updatedAt = Math.max(nextSession.updatedAt, updatedAt);
      await adapter.commit({
        puts: [
          {
            key: sessionKey,
            value: createStoredRecord(
              REPOSITORY_KINDS.SESSION,
              sessionId,
              nextSession
            )
          }
        ]
      });
      return true;
    },
    deleteSession(sessionId) {
      return deleteRecord(
        REPOSITORY_KINDS.SESSION,
        sessionId,
        isSessionState
      );
    },

    getSessionFinalization(sessionId) {
      return getRecord(
        REPOSITORY_KINDS.SESSION_FINALIZATION,
        sessionId,
        isSessionFinalization
      );
    },

    async finalizeSessionAtomically(finalization) {
      if (
        !hasExactKeys(finalization, [
          "sessionId",
          "finalizedAt",
          "chosen",
          "missedPaths"
        ]) ||
        !isNonEmptyString(finalization.sessionId) ||
        !isFiniteNonNegativeNumber(finalization.finalizedAt) ||
        !Array.isArray(finalization.chosen) ||
        !finalization.chosen.every(isChosen) ||
        !Array.isArray(finalization.missedPaths) ||
        !finalization.missedPaths.every(isMissedPath)
      ) {
        throw new RepositoryDataError("Invalid atomic session finalization data.");
      }

      const chosenIds = finalization.chosen.map((chosen) => chosen.id);
      const missedPathIds = finalization.missedPaths.map(
        (missedPath) => missedPath.id
      );
      const candidateIds = [
        ...finalization.chosen.map((chosen) => chosen.candidate.id),
        ...finalization.missedPaths.map(
          (missedPath) => missedPath.candidate.id
        )
      ];
      if (
        new Set(chosenIds).size !== chosenIds.length ||
        new Set(missedPathIds).size !== missedPathIds.length ||
        new Set(candidateIds).size !== candidateIds.length ||
        finalization.chosen.some(
          (chosen) => chosen.candidate.sessionId !== finalization.sessionId
        ) ||
        finalization.missedPaths.some(
          (missedPath) =>
            missedPath.candidate.sessionId !== finalization.sessionId
        )
      ) {
        throw new RepositoryDataError("Invalid atomic session finalization data.");
      }

      await ensureCompatibleVersion();
      const markerKey = recordKey(
        REPOSITORY_KINDS.SESSION_FINALIZATION,
        finalization.sessionId
      );
      const existingMarker = await adapter.get(markerKey);
      if (existingMarker !== undefined) {
        const marker = validateStoredRecord(
          existingMarker,
          REPOSITORY_KINDS.SESSION_FINALIZATION,
          finalization.sessionId
        );
        if (!isSessionFinalization(marker)) {
          throw new RepositoryDataError(
            "Stored session-finalization data is invalid."
          );
        }
        return { created: false, finalization: cloneJson(marker) };
      }

      const marker = {
        sessionId: finalization.sessionId,
        finalizedAt: finalization.finalizedAt,
        chosenIds,
        missedPathIds
      };
      const puts = [];
      for (const chosen of finalization.chosen) {
        const put = await assertNoConflictingRecord(
          REPOSITORY_KINDS.CHOSEN,
          chosen,
          isChosen
        );
        if (put !== null) {
          puts.push(put);
        }
      }
      for (const missedPath of finalization.missedPaths) {
        const put = await assertNoConflictingRecord(
          REPOSITORY_KINDS.MISSED_PATH,
          missedPath,
          isMissedPath
        );
        if (put !== null) {
          puts.push(put);
        }
      }
      puts.push({
        key: markerKey,
        value: createStoredRecord(
          REPOSITORY_KINDS.SESSION_FINALIZATION,
          finalization.sessionId,
          marker
        )
      });

      await adapter.commit({ puts });
      return { created: true, finalization: cloneJson(marker) };
    },

    saveChosen(chosen) {
      return saveRecord(
        REPOSITORY_KINDS.CHOSEN,
        chosen?.id,
        chosen,
        isChosen
      );
    },
    getChosen(id) {
      return getRecord(REPOSITORY_KINDS.CHOSEN, id, isChosen);
    },
    listChosen() {
      return listRecords(REPOSITORY_KINDS.CHOSEN, isChosen);
    },
    deleteChosen(id) {
      return deleteRecord(REPOSITORY_KINDS.CHOSEN, id, isChosen);
    },

    saveMissedPath(missedPath) {
      return saveRecord(
        REPOSITORY_KINDS.MISSED_PATH,
        missedPath?.id,
        missedPath,
        isMissedPath
      );
    },
    getMissedPath(id) {
      return getRecord(REPOSITORY_KINDS.MISSED_PATH, id, isMissedPath);
    },
    listMissedPaths() {
      return listRecords(REPOSITORY_KINDS.MISSED_PATH, isMissedPath);
    },
    async deleteMissedPath(id) {
      const existing = await getRecord(
        REPOSITORY_KINDS.MISSED_PATH,
        id,
        isMissedPath
      );
      if (existing === null) {
        return false;
      }

      const linkedReencounters = (await listRecords(
        REPOSITORY_KINDS.REENCOUNTER,
        isReencounter
      )).filter((reencounter) => reencounter.missedPathId === id);
      await adapter.commit({
        deletes: [
          recordKey(REPOSITORY_KINDS.MISSED_PATH, id),
          ...linkedReencounters.map((reencounter) =>
            recordKey(REPOSITORY_KINDS.REENCOUNTER, reencounter.id)
          )
        ]
      });
      return true;
    },

    saveReencounter(reencounter) {
      return saveRecord(
        REPOSITORY_KINDS.REENCOUNTER,
        reencounter?.id,
        reencounter,
        isReencounter
      );
    },
    getReencounter(id) {
      return getRecord(REPOSITORY_KINDS.REENCOUNTER, id, isReencounter);
    },
    listReencounters() {
      return listRecords(REPOSITORY_KINDS.REENCOUNTER, isReencounter);
    },
    deleteReencounter(id) {
      return deleteRecord(REPOSITORY_KINDS.REENCOUNTER, id, isReencounter);
    },

    saveSettings(settings) {
      return saveRecord(
        REPOSITORY_KINDS.SETTINGS,
        SETTINGS_ID,
        settings,
        isSettings
      );
    },
    getSettings() {
      return getRecord(REPOSITORY_KINDS.SETTINGS, SETTINGS_ID, isSettings);
    },
    deleteSettings() {
      return deleteRecord(
        REPOSITORY_KINDS.SETTINGS,
        SETTINGS_ID,
        isSettings
      );
    },

    async deleteAll() {
      await ensureCompatibleVersion();
      await adapter.commit({
        clear: true,
        puts: [
          {
            key: REPOSITORY_SCHEMA_KEY,
            value: { schemaVersion: SCHEMA_VERSION }
          }
        ]
      });
    }
  });
}
