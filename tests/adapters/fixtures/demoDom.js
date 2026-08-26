class FixtureElement {
  constructor(attributes = {}, textContent = "") {
    this.attributes = new Map(Object.entries(attributes));
    this.textContent = textContent;
    this.children = [];
    this.parentNode = null;
    this.observers = new Set();
    this.listeners = new Map();
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    for (const observer of this.observers) {
      observer.notify();
    }
    return child;
  }

  replaceChildren(...children) {
    for (const child of this.children) {
      child.parentNode = null;
    }
    for (const child of children) {
      child.parentNode = this;
    }
    this.children = [...children];
    for (const observer of this.observers) {
      observer.notify();
    }
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    if (typeof event !== "object" || event === null) {
      throw new TypeError("Fixture event must be an object.");
    }
    event.target ??= this;
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event);
    }
    if (event.bubbles === true && this.parentNode !== null) {
      this.parentNode.dispatchEvent(event);
    }
    return event.defaultPrevented !== true;
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0;
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
    this.hidden = false;
    this.listeners = new Map();
    root.parentNode = this;
  }

  querySelector(selector) {
    return this.root.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.root.querySelectorAll(selector);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    event.target ??= this;
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event);
    }
    return event.defaultPrevented !== true;
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0;
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

export function createIntersectionObserverHarness({
  initiallyVisible = true
} = {}) {
  const instances = [];

  class FixtureIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.observed = new Set();
      this.disconnectCount = 0;
      instances.push(this);
    }

    observe(element) {
      this.observed.add(element);
      this.emit(element, initiallyVisible);
    }

    unobserve(element) {
      this.observed.delete(element);
    }

    disconnect() {
      this.disconnectCount += 1;
      this.observed.clear();
    }

    emit(element, visible) {
      if (!this.observed.has(element)) {
        return;
      }
      this.callback([
        {
          target: element,
          isIntersecting: visible,
          intersectionRatio: visible ? 1 : 0
        }
      ]);
    }
  }

  return {
    IntersectionObserver: FixtureIntersectionObserver,
    instances,
    setVisible(element, visible) {
      for (const instance of instances) {
        instance.emit(element, visible);
      }
    }
  };
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

  let candidateElements = candidates.map(createCandidateElement);
  results.replaceChildren(...candidateElements);

  return {
    document: new FixtureDocument(root, baseURI),
    get candidateElements() {
      return [...candidateElements];
    },
    addCandidate(candidate) {
      const element = createCandidateElement(candidate);
      candidateElements.push(element);
      results.appendChild(element);
      return element;
    },
    replaceCandidates(nextCandidates) {
      candidateElements = nextCandidates.map(createCandidateElement);
      results.replaceChildren(...candidateElements);
    },
    removeCandidate(index) {
      const [removed] = candidateElements.splice(index, 1);
      results.replaceChildren(...candidateElements);
      return removed ?? null;
    },
    addUnrelatedNode() {
      results.appendChild(new FixtureElement({ "data-unrelated": "" }));
    }
  };
}
