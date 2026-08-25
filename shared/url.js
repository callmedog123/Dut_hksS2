// @ts-check

const TRACKING_PARAMETER_NAMES = new Set([
  "dclid",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "msclkid"
]);

/**
 * @param {string} name
 * @returns {boolean}
 */
function isTrackingParameter(name) {
  const normalizedName = name.toLowerCase();
  return (
    normalizedName.startsWith("utm_") ||
    TRACKING_PARAMETER_NAMES.has(normalizedName)
  );
}

/**
 * Normalize a Candidate URL without applying site-specific rules.
 *
 * @param {URL | string} input
 * @param {URL | string} [base]
 * @returns {string | null}
 */
export function normalizeCandidateUrl(input, base) {
  try {
    let normalizedUrl;

    if (input instanceof URL) {
      normalizedUrl = new URL(input.href);
    } else if (typeof input === "string") {
      normalizedUrl =
        base === undefined ? new URL(input) : new URL(input, base);
    } else {
      return null;
    }

    if (
      normalizedUrl.protocol !== "http:" &&
      normalizedUrl.protocol !== "https:"
    ) {
      return null;
    }

    normalizedUrl.hash = "";

    for (const name of [...normalizedUrl.searchParams.keys()]) {
      if (isTrackingParameter(name)) {
        normalizedUrl.searchParams.delete(name);
      }
    }

    normalizedUrl.searchParams.sort();
    return normalizedUrl.href;
  } catch {
    return null;
  }
}
