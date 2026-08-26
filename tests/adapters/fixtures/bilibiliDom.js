class FixtureElement {
  constructor(tagName = "div", { className = "", attributes = {}, text = "" } = {}) {
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.attributes = new Map(Object.entries(attributes));
    this.textContent = text;
    this.children = [];
    this.parentNode = null;
  }

  getAttribute(name) {
    if (name === "class") {
      return this.className || null;
    }
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    for (const child of this.children) {
      child.parentNode = null;
    }
    this.children = [];
    for (const child of children) {
      this.appendChild(child);
    }
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (matchesSimpleSelector(child, selector)) {
          matches.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

function matchesSimpleSelector(element, selector) {
  const classMatch = /^\.([A-Za-z0-9_-]+)$/.exec(selector);
  if (classMatch !== null) {
    return element.className.split(/\s+/u).includes(classMatch[1]);
  }

  const attributeContainsMatch =
    /^([A-Za-z][A-Za-z0-9-]*)\[([A-Za-z0-9_-]+)\*="([^"]*)"\]$/.exec(
      selector
    );
  if (attributeContainsMatch !== null) {
    const [, tagName, attributeName, substring] = attributeContainsMatch;
    return Boolean(
      element.tagName === tagName.toUpperCase() &&
        element.getAttribute(attributeName)?.includes(substring)
    );
  }

  throw new TypeError(`Unsupported fixture selector: ${selector}`);
}

class FixtureDocument {
  constructor(documentElement, href) {
    this.documentElement = documentElement;
    this.documentElement.parentNode = this;
    this.location = { href };
    this.listeners = new Map();
  }

  get baseURI() {
    return this.location.href;
  }

  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  addEventListener(type, listener) {
    const typeListeners = this.listeners.get(type) ?? new Set();
    typeListeners.add(listener);
    this.listeners.set(type, typeListeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, target, init = {}) {
    let preventDefaultCalls = 0;
    const event = {
      type,
      target,
      button: init.button ?? 0,
      ctrlKey: init.ctrlKey ?? false,
      metaKey: init.metaKey ?? false,
      defaultPrevented: false,
      preventDefault() {
        preventDefaultCalls += 1;
        this.defaultPrevented = true;
      },
      get preventDefaultCalls() {
        return preventDefaultCalls;
      }
    };

    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
    return event;
  }
}

function createResultCard({ title, href, throwOnQuery = false } = {}) {
  const card = new FixtureElement("div", { className: "bili-video-card" });
  const link =
    href === undefined
      ? null
      : new FixtureElement("a", { attributes: { href } });
  const titleElement =
    title === undefined
      ? null
      : new FixtureElement("h3", {
          className: "bili-video-card__info--tit",
          text: title
        });

  if (link !== null) {
    card.appendChild(link);
    if (titleElement !== null) {
      link.appendChild(titleElement);
    }
  } else if (titleElement !== null) {
    card.appendChild(titleElement);
  }

  if (throwOnQuery) {
    card.querySelector = () => {
      throw new Error("Fixture selector failure");
    };
    card.querySelectorAll = card.querySelector;
  }

  return { card, titleElement: titleElement ?? card };
}

function createResults(candidates) {
  const resultsRoot = new FixtureElement("div", { className: "video-list" });
  const cards = [];
  const clickTargets = [];
  for (const candidate of candidates) {
    const result = createResultCard(candidate);
    resultsRoot.appendChild(result.card);
    cards.push(result.card);
    clickTargets.push(result.titleElement);
  }
  return { resultsRoot, cards, clickTargets };
}

export function createMutationObserverHarness() {
  const instances = [];

  class FixtureMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      this.disconnectCount = 0;
      instances.push(this);
    }

    observe(target, options) {
      this.target = target;
      this.options = options;
      this.connected = true;
    }

    disconnect() {
      this.disconnectCount += 1;
      this.connected = false;
    }

    notify() {
      if (this.connected) {
        this.callback([], this);
      }
    }
  }

  return {
    MutationObserver: FixtureMutationObserver,
    instances,
    notifyAll() {
      for (const instance of instances) {
        instance.notify();
      }
    }
  };
}

export function createBilibiliDocumentFixture({
  url = "https://search.bilibili.com/all?keyword=robot%20navigation",
  candidates = []
} = {}) {
  const documentElement = new FixtureElement("html");
  const document = new FixtureDocument(documentElement, url);
  let state = createResults(candidates);
  documentElement.appendChild(state.resultsRoot);

  function replaceResults(nextCandidates) {
    state = createResults(nextCandidates);
    documentElement.replaceChildren(state.resultsRoot);
  }

  return {
    document,
    get cards() {
      return state.cards;
    },
    clickTarget(index) {
      return state.clickTargets[index];
    },
    addCandidate(candidate) {
      const result = createResultCard(candidate);
      state.resultsRoot.appendChild(result.card);
      state.cards.push(result.card);
      state.clickTargets.push(result.titleElement);
    },
    addUnrelatedNode() {
      state.resultsRoot.appendChild(new FixtureElement("aside"));
    },
    navigate(url, nextCandidates = []) {
      document.location.href = url;
      replaceResults(nextCandidates);
    }
  };
}
