class FixtureElement {
  constructor(tagName = "div", { className = "", attributes = {}, text = "" } = {}) {
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.attributes = new Map(Object.entries(attributes));
    this.textContent = text;
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
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

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  querySelector(selector) {
    if (this.throwOnQuery) {
      throw new Error("Fixture selector failure");
    }
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    if (this.throwOnQuery) {
      throw new Error("Fixture selector failure");
    }
    const selectors = selector.split(",").map((part) => part.trim());
    const matches = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (selectors.some((part) => matchesSelector(child, part))) {
          matches.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

function hasClass(element, name) {
  return element.className.split(/\s+/u).includes(name);
}

function matchesSelector(element, selector) {
  if (selector === ".ContentItem-title a[href]") {
    if (element.tagName !== "A" || !element.getAttribute("href")) {
      return false;
    }
    let current = element.parentNode;
    while (current && current.tagName) {
      if (hasClass(current, "ContentItem-title")) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  }

  const attributeEquals = /^\[([A-Za-z0-9_-]+)="([^"]+)"\]$/u.exec(selector);
  if (attributeEquals !== null) {
    return element.getAttribute(attributeEquals[1]) === attributeEquals[2];
  }

  const classMatch = /^\.([A-Za-z0-9_-]+)$/u.exec(selector);
  if (classMatch !== null) {
    return hasClass(element, classMatch[1]);
  }

  throw new TypeError(`Unsupported Zhihu fixture selector: ${selector}`);
}

class FixtureDocument {
  constructor(documentElement, href) {
    this.documentElement = documentElement;
    this.documentElement.parentNode = this;
    this.location = { href };
    this.hidden = false;
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

function moduleForType(type) {
  return {
    answer: "AnswerItem",
    article: "PostItem",
    question: "Content",
    user: "UserItem"
  }[type] ?? type;
}

function createResultCard({
  type = "answer",
  title,
  href,
  ad = false,
  throwOnQuery = false
} = {}) {
  const moduleName = moduleForType(type);
  const card = new FixtureElement("div", {
    className:
      type === "answer"
        ? "Card SearchResult-Card AnswerItem"
        : type === "article"
          ? "Card SearchResult-Card ArticleItem"
          : "ContentItem",
    attributes: {
      "data-za-detail-view-path-module": moduleName,
      ...(ad ? { "data-za-detail-view-path-is_ad": "true" } : {})
    }
  });
  const heading = new FixtureElement("h2", {
    className: "ContentItem-title"
  });
  const link =
    href === undefined
      ? null
      : new FixtureElement("a", { attributes: { href } });
  const clickTarget = new FixtureElement("em", { text: title ?? "" });

  if (link !== null) {
    if (title !== undefined) {
      link.appendChild(clickTarget);
      link.textContent = title;
    }
    heading.textContent = title ?? "";
    heading.appendChild(link);
    card.appendChild(heading);
  } else if (title !== undefined) {
    heading.appendChild(clickTarget);
    card.appendChild(heading);
  }
  card.textContent = title ?? "";
  card.throwOnQuery = throwOnQuery;
  return { card, clickTarget };
}

function createResults(candidates) {
  const resultsRoot = new FixtureElement("main", { className: "SearchMain" });
  const cards = [];
  const clickTargets = [];
  for (const candidate of candidates) {
    const result = createResultCard(candidate);
    resultsRoot.appendChild(result.card);
    cards.push(result.card);
    clickTargets.push(result.clickTarget);
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

export function createZhihuDocumentFixture({
  url = "https://www.zhihu.com/search?type=content&q=robot%20navigation",
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
      state.clickTargets.push(result.clickTarget);
      return result.card;
    },
    addUnrelatedNode() {
      state.resultsRoot.appendChild(new FixtureElement("aside"));
    },
    replaceCandidates(nextCandidates) {
      replaceResults(nextCandidates);
    },
    removeCandidate(index) {
      const [removed] = state.cards.splice(index, 1);
      state.clickTargets.splice(index, 1);
      state.resultsRoot.replaceChildren(...state.cards);
      return removed ?? null;
    },
    navigate(url, nextCandidates = []) {
      document.location.href = url;
      replaceResults(nextCandidates);
    }
  };
}
