// @ts-check

import { SESSION_LIFECYCLE_STATUSES } from "../shared/types.js";
import { SESSION_FINALIZATION_CONFIG } from "./sessionManager.js";

export const SESSION_RECOVERY_CONFIG = Object.freeze({
  // Provisional P0 grace period. It gives a restored page time to re-register
  // before an old OPEN Session is considered abandoned by its page instance.
  recoveryWindowMs: 30_000,
  leaseDurationMs: SESSION_FINALIZATION_CONFIG.leaseDurationMs
});

function createDefaultLeaseId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function assertDependencies(repository, sessionManager) {
  if (
    typeof repository !== "object" ||
    repository === null ||
    typeof repository.listSessions !== "function" ||
    typeof sessionManager !== "object" ||
    sessionManager === null ||
    typeof sessionManager.finalizeSession !== "function"
  ) {
    throw new TypeError("Session Recovery dependencies are invalid.");
  }
}

async function assumePageInstanceInactive() {
  return false;
}

function isLeaseUnavailable(error) {
  return (
    error instanceof Error &&
    /^Session finalization lease is unavailable:/u.test(error.message)
  );
}

/**
 * One-shot recovery coordinator. It owns no timer and no in-memory lock; each
 * attempt must first acquire a persisted Repository lease.
 *
 * @param {ReturnType<typeof import("../storage/repository.js").createRepository>} repository
 * @param {ReturnType<typeof import("./sessionManager.js").createSessionManager>} sessionManager
 * @param {{
 *   now?: () => number,
 *   leaseIdFactory?: (session: object) => string,
 *   recoveryWindowMs?: number,
 *   isPageInstanceActive?: (session: object) => Promise<boolean>
 * }} [options]
 */
export function createSessionRecoveryCoordinator(
  repository,
  sessionManager,
  options = {}
) {
  assertDependencies(repository, sessionManager);
  const now = options.now ?? (() => Date.now());
  const leaseIdFactory = options.leaseIdFactory ?? createDefaultLeaseId;
  const isPageInstanceActive =
    options.isPageInstanceActive ?? assumePageInstanceInactive;
  const recoveryWindowMs =
    options.recoveryWindowMs ?? SESSION_RECOVERY_CONFIG.recoveryWindowMs;
  if (
    typeof now !== "function" ||
    typeof leaseIdFactory !== "function" ||
    typeof isPageInstanceActive !== "function" ||
    !Number.isFinite(recoveryWindowMs) ||
    recoveryWindowMs < 0
  ) {
    throw new TypeError("Session Recovery configuration is invalid.");
  }

  return Object.freeze({
    /**
     * @param {{includeOpen?: boolean}} [scanOptions]
     */
    async scan(scanOptions = {}) {
      const scannedAt = now();
      if (!Number.isFinite(scannedAt) || scannedAt < 0) {
        throw new TypeError("Session Recovery clock is invalid.");
      }
      const includeOpen = scanOptions.includeOpen ?? true;
      if (typeof includeOpen !== "boolean") {
        throw new TypeError("Session Recovery scan options are invalid.");
      }

      const sessions = await repository.listSessions();
      const result = {
        scannedAt,
        scanned: sessions.length,
        finalized: [],
        abandoned: [],
        skipped: [],
        failed: []
      };
      for (const session of sessions) {
        const staleOpen =
          includeOpen &&
          session.status === SESSION_LIFECYCLE_STATUSES.OPEN &&
          session.updatedAt + recoveryWindowMs <= scannedAt;
        const expiredFinalizing =
          session.status === SESSION_LIFECYCLE_STATUSES.FINALIZING &&
          (!Number.isFinite(session.leaseUntil) ||
            session.leaseUntil <= scannedAt);
        if (!staleOpen && !expiredFinalizing) {
          result.skipped.push(session.sessionId);
          continue;
        }

        // OPEN recovery is safe only after checking the exact persisted page
        // instance. An expired FINALIZING lease remains recoverable: a living
        // page can reopen it by re-registering before the lease expires.
        if (staleOpen && Object.hasOwn(session, "owner")) {
          try {
            const pageIsActive = await isPageInstanceActive(session);
            if (typeof pageIsActive !== "boolean") {
              throw new TypeError(
                "Session Recovery page-instance check must return boolean."
              );
            }
            if (pageIsActive) {
              result.skipped.push(session.sessionId);
              continue;
            }
          } catch (error) {
            result.failed.push({ sessionId: session.sessionId, error });
            continue;
          }
        }

        const finalizationLeaseId = leaseIdFactory(session);
        if (typeof finalizationLeaseId !== "string" || finalizationLeaseId.length === 0) {
          throw new TypeError("Session Recovery lease ID is invalid.");
        }
        try {
          const recovered = await sessionManager.finalizeSession(
            session.sessionId,
            scannedAt,
            session.owner,
            { finalizationLeaseId, abandonIfNoMeaningful: true }
          );
          if (recovered.abandoned === true) {
            result.abandoned.push(session.sessionId);
          } else {
            result.finalized.push(session.sessionId);
          }
        } catch (error) {
          if (isLeaseUnavailable(error)) {
            result.skipped.push(session.sessionId);
            continue;
          }
          result.failed.push({ sessionId: session.sessionId, error });
        }
      }
      return result;
    }
  });
}
