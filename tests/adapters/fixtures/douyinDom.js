// @ts-check

/**
 * Douyin search page DOM fixture for testing.
 * Uses the same mock DOM pattern as zhihuDom.js for Node.js compatibility.
 */

class FixtureElement {
  constructor(tagName = "div", { className = "", attributes = {}, text = "", id = "" } = {}) {
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.id = id;
    this.attributes = new Map(Object.entries(attributes));
    this._explicitText = text;
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
  }

  get textContent() {
    if (this._explicitText) {
      return this._explicitText;
    }
    return this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._explicitText = value;
  }

  getAttribute(name) {
    if (name === "class") {
      return this.className || null;
    }
    if (name === "id") {
      return this.id || null;
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

function matchesSelector(element, selector) {
  // Match [id^="waterfall_item_"]
  if (selector === '[id^="waterfall_item_"]') {
    return element.id && element.id.startsWith("waterfall_item_");
  }
  // Match .search-result-card
  if (selector === ".search-result-card") {
    return element.className.split(/\s+/u).includes("search-result-card");
  }
  // Match tag name
  if (selector === element.tagName.toLowerCase()) {
    return true;
  }
  return false;
}

class FixtureDocument {
  constructor(url = "https://www.douyin.com/search/test") {
    this.location = { href: url };
    this.baseURI = url;
    this.documentElement = new FixtureElement("html");
    this.body = new FixtureElement("body");
    this.documentElement.appendChild(this.body);
  }

  querySelector(selector) {
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }

  createElement(tagName) {
    return new FixtureElement(tagName);
  }
}

export const DOUYIN_SEARCH_URL = "https://www.douyin.com/search/%E5%A5%BD%E5%90%83%E7%9A%84";
export const DOUYIN_SEARCH_URL_VIDEO = "https://www.douyin.com/search/%E5%A5%BD%E5%90%83%E7%9A%84?type=video";
export const DOUYIN_SEARCH_URL_USER = "https://www.douyin.com/search/%E5%A5%BD%E5%90%83%E7%9A%84?type=user";

export const VIDEO_NUMERIC_ID = "7664911070490126501";
export const VIDEO_PERMANENT_URL = "https://www.douyin.com/video/7664911070490126501";

export const NOTE_NUMERIC_ID = "7651849412163225458";
export const NOTE_PERMANENT_URL = "https://www.douyin.com/note/7651849412163225458";

export const HASHTAG_NUMERIC_ID = "7577281433874566434";
export const HASHTAG_PERMANENT_URL = "https://www.douyin.com/video/7577281433874566434";

/**
 * Create a Douyin search page fixture.
 * @param {object} options
 * @param {string} options.url
 * @param {Array<{id: string, title: string}>} options.cards
 * @returns {FixtureDocument}
 */
export function createDouyinSearchDom(options = {}) {
  const { url = DOUYIN_SEARCH_URL, cards = [] } = options;
  const doc = new FixtureDocument(url);
  
  const container = new FixtureElement("div", { id: "waterFallScrollContainer" });
  doc.body.appendChild(container);
  
  for (const card of cards) {
    const cardEl = new FixtureElement("div", { id: card.id });
    const innerCard = new FixtureElement("div", { className: "search-result-card" });
    const clickable = new FixtureElement("div", { className: "PtY9QFFE" });
    const flexCol = new FixtureElement("div", { className: "flex flex-col" });
    const titleWrapper = new FixtureElement("div", { className: "K4Ja9W9H" });
    const titleInner = new FixtureElement("div", { className: "vrPRtA6U" });
    const titleText = new FixtureElement("div", { className: "BjLsdJMi", text: card.title });
    
    titleInner.appendChild(titleText);
    titleWrapper.appendChild(titleInner);
    flexCol.appendChild(titleWrapper);
    clickable.appendChild(flexCol);
    innerCard.appendChild(clickable);
    cardEl.appendChild(innerCard);
    container.appendChild(cardEl);
  }
  
  return doc;
}

/**
 * Create a video card fixture.
 * @param {string} id
 * @param {string} title
 * @returns {{id: string, title: string}}
 */
export function createVideoCard(id, title) {
  return { id: `waterfall_item_${id}`, title };
}

/**
 * Create a note card fixture.
 * @param {string} id
 * @param {string} title
 * @returns {{id: string, title: string}}
 */
export function createNoteCard(id, title) {
  return { id: `waterfall_item_${id}`, title };
}
