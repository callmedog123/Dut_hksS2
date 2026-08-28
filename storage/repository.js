// @ts-check

import {
  DEFAULT_SETTINGS_V1,
  SCHEMA_VERSION,
  isCandidateSignalsV1,
  isCandidateV1,
  isMissedPathV1,
  isReencounterFeedbackV1,
  isReencounterRecordV1,
  isSearchContextV1,
  isSettingsV1
} from "../shared/types.js";
import { normalizeCandidateUrl } from "../shared/url.js";

export const REPOSITORY_SCHEMA_KEY = "meta:schema";

export const REPOSITORY_KINDS = Object.freeze({
  ACTIVE_CONTEXT: "active-context",
  CHOSEN: "chosen",
  MISSED_PATH: "missed-path",
  REENCOUNTER: "reencounter",
  SESSION: "session",
  SESSION_FINALIZATION: "session-finalization",
  SETTINGS: "settings"
});

const ACTIVE_CONTEXT_ID = "current";
const SETTINGS_ID = "current";

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
  constructor(message, code = "REPOSITORY_DATA_INVALID") {
    super(message);
    this.name = "RepositoryDataError";
    this.code = code;
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

function isStringList(value) {
  return Array.isArray(value) && value.every(isNonEmptyString);
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

function isActiveContextState(value) {
  return Boolean(
    hasExactKeys(value, ["sessionId", "context", "activatedAt"]) &&
      isNonEmptyString(value.sessionId) &&
      isSearchContextV1(value.context) &&
      isFiniteNonNegativeNumber(value.activatedAt)
  );
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

  async function hasCompatibleVersion() {
    const metadata = await adapter.get(REPOSITORY_SCHEMA_KEY);
    if (metadata === undefined) {
      return false;
    }

    if (
      !hasExactKeys(metadata, ["schemaVersion"]) ||
      metadata.schemaVersion !== SCHEMA_VERSION
    ) {
      throw new RepositoryVersionError(metadata?.schemaVersion);
    }
    return true;
  }

  async function ensureCompatibleVersion() {
    if (await hasCompatibleVersion()) {
      return;
    }
    await adapter.commit({
      puts: [
        {
          key: REPOSITORY_SCHEMA_KEY,
          value: { schemaVersion: SCHEMA_VERSION }
        }
      ]
    });
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
      const activeContextKey = recordKey(
        REPOSITORY_KINDS.ACTIVE_CONTEXT,
        ACTIVE_CONTEXT_ID
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

      const storedActiveContext = await adapter.get(activeContextKey);
      let activeContext = null;
      if (storedActiveContext !== undefined) {
        activeContext = validateStoredRecord(
          storedActiveContext,
          REPOSITORY_KINDS.ACTIVE_CONTEXT,
          ACTIVE_CONTEXT_ID
        );
        if (!isActiveContextState(activeContext)) {
          throw new RepositoryDataError("Stored active-context data is invalid.");
        }
        if (
          activeContext.sessionId === discovery.sessionId &&
          !isSameJson(activeContext.context, discovery.context)
        ) {
          throw new RepositoryDataError(
            "Stored active context conflicts with its Session."
          );
        }
      }

      const puts = [];
      if (acceptedCandidateIds.length > 0) {
        session.updatedAt = Math.max(
          session.updatedAt,
          discovery.discoveredAt
        );
        puts.push({
          key: sessionKey,
          value: createStoredRecord(
            REPOSITORY_KINDS.SESSION,
            discovery.sessionId,
            session
          )
        });
      }
      if (activeContext?.sessionId !== discovery.sessionId) {
        puts.push({
          key: activeContextKey,
          value: createStoredRecord(
            REPOSITORY_KINDS.ACTIVE_CONTEXT,
            ACTIVE_CONTEXT_ID,
            {
              sessionId: discovery.sessionId,
              context: discovery.context,
              activatedAt: discovery.discoveredAt
            }
          )
        });
      }
      if (puts.length > 0) {
        await adapter.commit({ puts });
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
    async getActiveContext() {
      const key = recordKey(
        REPOSITORY_KINDS.ACTIVE_CONTEXT,
        ACTIVE_CONTEXT_ID
      );
      if (!(await hasCompatibleVersion())) {
        if ((await adapter.get(key)) !== undefined) {
          throw new RepositoryVersionError(undefined);
        }
        return null;
      }
      const record = await adapter.get(key);
      if (record === undefined) {
        return null;
      }
      const data = validateStoredRecord(
        record,
        REPOSITORY_KINDS.ACTIVE_CONTEXT,
        ACTIVE_CONTEXT_ID
      );
      if (!isActiveContextState(data)) {
        throw new RepositoryDataError("Stored active-context data is invalid.");
      }
      return cloneJson(data);
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
    async deleteSession(sessionId) {
      const existing = await getRecord(
        REPOSITORY_KINDS.SESSION,
        sessionId,
        isSessionState
      );
      if (existing === null) {
        return false;
      }
      const activeContext = await getRecord(
        REPOSITORY_KINDS.ACTIVE_CONTEXT,
        ACTIVE_CONTEXT_ID,
        isActiveContextState
      );
      await adapter.commit({
        deletes: [
          recordKey(REPOSITORY_KINDS.SESSION, sessionId),
          ...(activeContext?.sessionId === sessionId
            ? [
                recordKey(
                  REPOSITORY_KINDS.ACTIVE_CONTEXT,
                  ACTIVE_CONTEXT_ID
                )
              ]
            : [])
        ]
      });
      return true;
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
        !finalization.missedPaths.every(isMissedPathV1)
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
      const activeContextKey = recordKey(
        REPOSITORY_KINDS.ACTIVE_CONTEXT,
        ACTIVE_CONTEXT_ID
      );
      const storedActiveContext = await adapter.get(activeContextKey);
      let clearsActiveContext = false;
      if (storedActiveContext !== undefined) {
        const activeContext = validateStoredRecord(
          storedActiveContext,
          REPOSITORY_KINDS.ACTIVE_CONTEXT,
          ACTIVE_CONTEXT_ID
        );
        if (!isActiveContextState(activeContext)) {
          throw new RepositoryDataError("Stored active-context data is invalid.");
        }
        clearsActiveContext =
          activeContext.sessionId === finalization.sessionId;
      }
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
        if (clearsActiveContext) {
          await adapter.commit({ deletes: [activeContextKey] });
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
          isMissedPathV1
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

      await adapter.commit({
        puts,
        ...(clearsActiveContext ? { deletes: [activeContextKey] } : {})
      });
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
        isMissedPathV1
      );
    },
    getMissedPath(id) {
      return getRecord(REPOSITORY_KINDS.MISSED_PATH, id, isMissedPathV1);
    },
    listMissedPaths() {
      return listRecords(REPOSITORY_KINDS.MISSED_PATH, isMissedPathV1);
    },
    async deleteMissedPath(id) {
      const existing = await getRecord(
        REPOSITORY_KINDS.MISSED_PATH,
        id,
        isMissedPathV1
      );
      if (existing === null) {
        return false;
      }

      const linkedReencounters = (await listRecords(
        REPOSITORY_KINDS.REENCOUNTER,
        isReencounterRecordV1
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
        isReencounterRecordV1
      );
    },
    async recordReencounterShown(reencounter) {
      if (
        !isReencounterRecordV1(reencounter) ||
        Object.hasOwn(reencounter, "outcome")
      ) {
        throw new RepositoryDataError("Invalid Re-encounter shown data.");
      }
      await ensureCompatibleVersion();

      const missedPathKey = recordKey(
        REPOSITORY_KINDS.MISSED_PATH,
        reencounter.missedPathId
      );
      const storedMissedPath = await adapter.get(missedPathKey);
      if (storedMissedPath === undefined) {
        throw new RepositoryDataError(
          `Missed Path not found: ${reencounter.missedPathId}`,
          "MISSED_PATH_NOT_FOUND"
        );
      }
      const missedPath = validateStoredRecord(
        storedMissedPath,
        REPOSITORY_KINDS.MISSED_PATH,
        reencounter.missedPathId
      );
      if (!isMissedPathV1(missedPath)) {
        throw new RepositoryDataError("Stored missed-path data is invalid.");
      }

      const activeContextKey = recordKey(
        REPOSITORY_KINDS.ACTIVE_CONTEXT,
        ACTIVE_CONTEXT_ID
      );
      const storedActiveContext = await adapter.get(activeContextKey);
      if (storedActiveContext === undefined) {
        throw new RepositoryDataError(
          "Re-encounter shown has no active SearchContext.",
          "REENCOUNTER_SHOWN_STALE"
        );
      }
      const activeContext = validateStoredRecord(
        storedActiveContext,
        REPOSITORY_KINDS.ACTIVE_CONTEXT,
        ACTIVE_CONTEXT_ID
      );
      if (!isActiveContextState(activeContext)) {
        throw new RepositoryDataError("Stored active-context data is invalid.");
      }
      if (!isSameJson(activeContext.context, reencounter.triggerContext)) {
        throw new RepositoryDataError(
          "Re-encounter shown belongs to a stale SearchContext.",
          "REENCOUNTER_SHOWN_STALE"
        );
      }

      const key = recordKey(REPOSITORY_KINDS.REENCOUNTER, reencounter.id);
      const nextRecord = createStoredRecord(
        REPOSITORY_KINDS.REENCOUNTER,
        reencounter.id,
        reencounter
      );
      const existingRecord = await adapter.get(key);
      if (existingRecord !== undefined) {
        const existing = validateStoredRecord(
          existingRecord,
          REPOSITORY_KINDS.REENCOUNTER,
          reencounter.id
        );
        if (!isReencounterRecordV1(existing)) {
          throw new RepositoryDataError("Stored reencounter data is invalid.");
        }
        if (isSameJson(existingRecord, nextRecord)) {
          return {
            reencounterId: reencounter.id,
            missedPathId: reencounter.missedPathId,
            shownAt: reencounter.shownAt,
            created: false
          };
        }
        throw new RepositoryDataError(
          `Re-encounter shown identity conflicts: ${reencounter.id}`,
          "REENCOUNTER_SHOWN_CONFLICT"
        );
      }

      await adapter.commit({ puts: [{ key, value: nextRecord }] });
      return {
        reencounterId: reencounter.id,
        missedPathId: reencounter.missedPathId,
        shownAt: reencounter.shownAt,
        created: true
      };
    },
    async recordReencounterFeedback(feedback) {
      if (!isReencounterFeedbackV1(feedback)) {
        throw new RepositoryDataError("Invalid Re-encounter feedback data.");
      }
      await ensureCompatibleVersion();

      const key = recordKey(
        REPOSITORY_KINDS.REENCOUNTER,
        feedback.reencounterId
      );
      const storedRecord = await adapter.get(key);
      if (storedRecord === undefined) {
        throw new RepositoryDataError(
          `Re-encounter not found: ${feedback.reencounterId}`,
          "REENCOUNTER_NOT_FOUND"
        );
      }
      const existing = validateStoredRecord(
        storedRecord,
        REPOSITORY_KINDS.REENCOUNTER,
        feedback.reencounterId
      );
      if (!isReencounterRecordV1(existing)) {
        throw new RepositoryDataError("Stored reencounter data is invalid.");
      }

      if (Object.hasOwn(existing, "outcome")) {
        if (existing.outcome !== feedback.outcome) {
          throw new RepositoryDataError(
            `Re-encounter feedback conflicts: ${feedback.reencounterId}`,
            "REENCOUNTER_FEEDBACK_CONFLICT"
          );
        }
        if (Object.hasOwn(existing, "feedbackAt")) {
          return {
            reencounterId: existing.id,
            outcome: existing.outcome,
            feedbackAt: existing.feedbackAt,
            updated: false
          };
        }
      }

      const updated = {
        ...existing,
        outcome: feedback.outcome,
        feedbackAt: feedback.feedbackAt
      };
      const nextRecord = createStoredRecord(
        REPOSITORY_KINDS.REENCOUNTER,
        existing.id,
        updated
      );
      await adapter.commit({ puts: [{ key, value: nextRecord }] });
      return {
        reencounterId: updated.id,
        outcome: updated.outcome,
        feedbackAt: updated.feedbackAt,
        updated: true
      };
    },
    getReencounter(id) {
      return getRecord(
        REPOSITORY_KINDS.REENCOUNTER,
        id,
        isReencounterRecordV1
      );
    },
    listReencounters() {
      return listRecords(
        REPOSITORY_KINDS.REENCOUNTER,
        isReencounterRecordV1
      );
    },
    deleteReencounter(id) {
      return deleteRecord(
        REPOSITORY_KINDS.REENCOUNTER,
        id,
        isReencounterRecordV1
      );
    },

    saveSettings(settings) {
      return saveRecord(
        REPOSITORY_KINDS.SETTINGS,
        SETTINGS_ID,
        settings,
        isSettingsV1
      );
    },
    async getSettings() {
      return (
        (await getRecord(
          REPOSITORY_KINDS.SETTINGS,
          SETTINGS_ID,
          isSettingsV1
        )) ?? DEFAULT_SETTINGS_V1
      );
    },
    deleteSettings() {
      return deleteRecord(
        REPOSITORY_KINDS.SETTINGS,
        SETTINGS_ID,
        isSettingsV1
      );
    },

    async deleteAll() {
      await ensureCompatibleVersion();
      const entries = await adapter.entries();
      const settingsKey = recordKey(
        REPOSITORY_KINDS.SETTINGS,
        SETTINGS_ID
      );
      const storedSettings = await adapter.get(settingsKey);
      if (storedSettings !== undefined) {
        const settings = validateStoredRecord(
          storedSettings,
          REPOSITORY_KINDS.SETTINGS,
          SETTINGS_ID
        );
        if (!isSettingsV1(settings)) {
          throw new RepositoryDataError("Stored settings data is invalid.");
        }
      }
      const hasDomainData = entries.some(
        ({ key }) => key !== REPOSITORY_SCHEMA_KEY && key !== settingsKey
      );
      if (!hasDomainData) {
        return false;
      }
      await adapter.commit({
        clear: true,
        puts: [
          {
            key: REPOSITORY_SCHEMA_KEY,
            value: { schemaVersion: SCHEMA_VERSION }
          },
          ...(storedSettings === undefined
            ? []
            : [{ key: settingsKey, value: storedSettings }])
        ]
      });
      return true;
    }
  });
}
