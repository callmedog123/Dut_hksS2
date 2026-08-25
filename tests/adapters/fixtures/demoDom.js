class FixtureElement {
  constructor(attributes = {}, textContent = "") {
    this.attributes = new Map(Object.entries(attributes));
    this.textContent = textContent;
    this.children = [];
    this.observers = new Set();
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    this.children.push(child);
    for (const observer of this.observers) {
      observer.notify();
    }
    return child;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const attributeMatch = /^\[([a-zA-Z0-9_-]+)\]$/.exec(selector);
    if (attributeMatch === null) {
      throw new TypeError(`Unsupported fixture selector: ${selector}`);
    }

    const attribute = attributeMatch[1];
    const matches = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (child.attributes.has(attribute)) {
          matches.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

class FixtureDocument {
  constructor(root, baseURI) {
    this.root = root;
    this.baseURI = baseURI;
  }

  querySelector(selector) {
    return this.root.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.root.querySelectorAll(selector);
  }
}

function createCandidateElement({ id, title, href }) {
  const result = new FixtureElement({
    "data-demo-result": "",
    ...(id === undefined ? {} : { "data-candidate-id": id })
  });

  if (title !== undefined) {
    result.appendChild(
      new FixtureElement({ "data-demo-title": "" }, title)
    );
  }
  if (href !== undefined) {
    result.appendChild(
      new FixtureElement({ "data-demo-link": "", href })
    );
  }
  return result;
}

export function createMutationObserverHarness() {
  const instances = [];

  class FixtureMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.target = null;
      this.connected = false;
      this.disconnectCount = 0;
      instances.push(this);
    }

    observe(target) {
      this.target = target;
      this.connected = true;
      target.observers.add(this);
    }

    disconnect() {
      this.disconnectCount += 1;
      this.connected = false;
      this.target?.observers.delete(this);
    }

    notify() {
      if (this.connected) {
        this.callback([], this);
      }
    }
  }

  return { MutationObserver: FixtureMutationObserver, instances };
}

export function createDemoDocumentFixture({
  candidates = [],
  query = "robot navigation",
  source = "local-demo-search",
  sessionId = "demo-session-001",
  timestamp = 1787587200000,
  keywords = ["robotics", "navigation"],
  baseURI = "chrome-extension://test/demo/index.html"
} = {}) {
  const root = new FixtureElement();
  const page = new FixtureElement({
    "data-demo-search-page": "",
    "data-demo-query": query,
    "data-demo-source": source,
    "data-demo-session-id": sessionId,
    "data-demo-timestamp": String(timestamp),
    ...(keywords.length > 0
      ? { "data-demo-keywords": keywords.join(",") }
      : {})
  });
  const results = new FixtureElement({ "data-demo-results": "" });
  page.appendChild(results);
  root.appendChild(page);

  for (const candidate of candidates) {
    results.appendChild(createCandidateElement(candidate));
  }

  return {
    document: new FixtureDocument(root, baseURI),
    addCandidate(candidate) {
      results.appendChild(createCandidateElement(candidate));
    },
    addUnrelatedNode() {
      results.appendChild(new FixtureElement({ "data-unrelated": "" }));
    }
  };
}
