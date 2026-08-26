// The Unclicked（余路）· Side Panel 静态原型交互
// 仅演示界面状态变化，使用本地假数据，不请求任何外部服务。
// 用户的操作（打开 / 忽略 / 删除）会保存在浏览器 localStorage 中，刷新后仍然保留。

(function () {
  "use strict";

  // ===== 演示数据（假数据，仅用于原型展示）=====
  // 以后接入真实数据时，只需要替换下面这两个变量的内容，界面代码不用改。
  // 注意：每条卡片必须有一个唯一的 id，本地保存要靠它认出是哪张卡片。

  var DEMO_SESSION = {
    subject: "机器人导航", // 当前主题
    // “已选择”的基数：代表用户在侧边栏之外已经点开过的内容数量。
    // 顶部显示的“已选择” = 这个基数 + 侧边栏里已打开的卡片数。
    chosenBase: 2
  };

  var DEMO_CARDS = [
    {
      id: "demo-missed-1",            // 唯一编号，不要和别的卡片重复
      type: "missed",                 // missed = 未选择路径
      kind: "未选择路径",
      title: "Human Cognitive Map and Spatial Representation",
      source: "来源：Local Demo Search",
      url: "https://example.com/cognitive-map", // 点“打开”时跳转的网址
      reasonLabel: "为什么被记录",
      reasons: [
        "页面停留约 4.7 秒",
        "曾回看 2 次",
        "最终没有点击"
      ],
      counted: true                   // 是否计入“考虑过未选择”
    },
    {
      id: "demo-reunion-1",
      type: "reunion",                // reunion = 情境化重逢
      kind: "情境化重逢",
      title: "你曾经差一点走向这里",
      source: "Human Cognitive Map and Spatial Representation",
      url: "https://example.com/cognitive-map", // 与上面指向同一内容
      reasonLabel: "为什么现在出现",
      reasons: [
        "当前主题与你过去未选择的内容相关",
        "它曾进入你的考虑范围，但当时没有打开"
      ],
      counted: false
    }
  ];

  // ===== 本地保存（localStorage）=====
  // 只用一个键保存所有状态。不使用服务器、数据库或网络请求。

  var STORAGE_KEY = "the-unclicked.side-panel.demo.v1";

  // 卡片状态只有这四种
  var STATUS_PENDING = "pending"; // 待处理
  var STATUS_OPENED = "opened";   // 已打开
  var STATUS_IGNORED = "ignored"; // 已忽略
  var STATUS_DELETED = "deleted"; // 已删除（不再显示）

  var state = null;        // 当前所有状态，来自 localStorage 或默认演示数据
  var storageNote = "";    // 保存出问题时，附在状态栏后面的友好提示
  var canSave = true;      // 本地保存是否可用

  function isValidStatus(value) {
    return value === STATUS_PENDING ||
      value === STATUS_OPENED ||
      value === STATUS_IGNORED ||
      value === STATUS_DELETED;
  }

  // 没有保存记录时使用的初始状态。
  // 只保存每张卡片的状态，两个数字不保存，由卡片状态实时数出来。
  function buildDefaultState() {
    var cards = {};
    for (var i = 0; i < DEMO_CARDS.length; i++) {
      var item = DEMO_CARDS[i];
      cards[item.id] = {
        status: STATUS_PENDING,
        counted: item.counted === true
      };
    }
    return { cards: cards };
  }

  // 从 localStorage 读取。任何一步失败都回到默认演示数据，不让页面崩掉。
  function loadState() {
    var raw = null;

    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      // 例如浏览器禁用了本地存储
      canSave = false;
      storageNote = "（提示：本地保存不可用，操作刷新后会重置）";
      return buildDefaultState();
    }

    if (!raw) {
      // 第一次打开，没有保存过
      return buildDefaultState();
    }

    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      storageNote = "（提示：本地保存的数据读不出来，已恢复演示数据）";
      removeSavedState();
      return buildDefaultState();
    }

    var fresh = buildDefaultState();

    if (!parsed || typeof parsed !== "object") {
      storageNote = "（提示：本地保存的数据格式不对，已恢复演示数据）";
      removeSavedState();
      return fresh;
    }

    // 读取每张卡片的状态。只认当前 DEMO_CARDS 里存在的 id。
    if (parsed.cards && typeof parsed.cards === "object") {
      for (var id in fresh.cards) {
        if (!Object.prototype.hasOwnProperty.call(fresh.cards, id)) {
          continue;
        }
        var saved = parsed.cards[id];
        if (!saved || typeof saved !== "object") {
          continue;
        }
        if (isValidStatus(saved.status)) {
          fresh.cards[id].status = saved.status;
        }
        if (typeof saved.counted === "boolean") {
          fresh.cards[id].counted = saved.counted;
        }
      }
    }

    return fresh;
  }

  function saveState() {
    if (!canSave) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      // 例如存储空间已满
      canSave = false;
      storageNote = "（提示：本地保存失败，操作刷新后会重置）";
    }
  }

  function removeSavedState() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      canSave = false;
    }
  }

  // ===== 页面元素 =====

  var cardList = document.getElementById("card-list");
  var statusEl = document.getElementById("status");
  var emptyEl = document.getElementById("empty-state");
  var chosenEl = document.getElementById("chosen-count");
  var missedEl = document.getElementById("missed-count");
  var subjectEl = document.getElementById("session-subject");
  var resetBtn = document.getElementById("reset-demo");

  // ===== 根据数据生成卡片 =====

  // 创建一个元素，并写入文字内容
  function createEl(tag, className, text) {
    var el = document.createElement(tag);
    if (className) {
      el.className = className;
    }
    if (text) {
      el.textContent = text;
    }
    return el;
  }

  function createActionButton(action, label, extraClass) {
    var btn = createEl("button", extraClass, label);
    btn.type = "button";
    btn.setAttribute("data-action", action);
    return btn;
  }

  // 生成一张卡片，结构与原来写在 HTML 里的完全一致
  function buildCard(item) {
    var card = document.createElement("article");
    card.className = item.type === "reunion" ? "card card-reunion" : "card";
    card.setAttribute("data-card-type", item.type);
    card.setAttribute("data-card-id", item.id);

    card.appendChild(createEl("p", "card-kind", item.kind));
    card.appendChild(createEl("h3", "card-title", item.title));
    card.appendChild(createEl("p", "card-source", item.source));

    // 为什么被记录 / 为什么现在出现
    var reasonBox = createEl("div", "card-reason");
    reasonBox.appendChild(createEl("p", "reason-label", item.reasonLabel));

    var reasonList = createEl("ul", "reason-list");
    var reasons = item.reasons || [];
    for (var i = 0; i < reasons.length; i++) {
      reasonList.appendChild(createEl("li", "", reasons[i]));
    }
    reasonBox.appendChild(reasonList);
    card.appendChild(reasonBox);

    var stateLine = createEl("p", "card-state", "状态：待处理");
    stateLine.setAttribute("data-role", "state");
    card.appendChild(stateLine);

    var actions = createEl("div", "card-actions");
    actions.appendChild(createActionButton("open", "打开", "btn btn-primary"));
    actions.appendChild(createActionButton("ignore", "忽略", "btn"));
    actions.appendChild(createActionButton("delete", "删除", "btn btn-quiet"));
    card.appendChild(actions);

    return card;
  }

  function renderCards() {
    cardList.innerHTML = "";
    for (var i = 0; i < DEMO_CARDS.length; i++) {
      var item = DEMO_CARDS[i];
      var cardState = state.cards[item.id];
      if (!cardState || cardState.status === STATUS_DELETED) {
        continue; // 已删除的卡片不再显示
      }
      var card = buildCard(item);
      card.setAttribute("data-counted", cardState.counted ? "true" : "false");
      applyCardStatus(card, cardState.status);
      cardList.appendChild(card);
    }
  }

  // ===== 界面更新 =====

  function renderSession() {
    if (subjectEl) {
      subjectEl.textContent = DEMO_SESSION.subject;
    }
  }

  // 两个数字不保存，每次都根据卡片状态数出来，保证和眼前的卡片一致。
  function countChosen() {
    var total = DEMO_SESSION.chosenBase || 0;
    for (var i = 0; i < DEMO_CARDS.length; i++) {
      var cardState = state.cards[DEMO_CARDS[i].id];
      if (cardState && cardState.status === STATUS_OPENED) {
        total += 1;
      }
    }
    return total;
  }

  function countMissed() {
    var total = 0;
    for (var i = 0; i < DEMO_CARDS.length; i++) {
      var cardState = state.cards[DEMO_CARDS[i].id];
      if (!cardState || cardState.status === STATUS_DELETED) {
        continue;
      }
      if (cardState.counted) {
        total += 1;
      }
    }
    return total;
  }

  function renderCounts() {
    chosenEl.textContent = String(countChosen());
    missedEl.textContent = String(countMissed());
  }

  function setStatus(message) {
    statusEl.textContent = storageNote ? message + " " + storageNote : message;
  }

  function setCardState(card, text) {
    var stateEl = card.querySelector('[data-role="state"]');
    if (stateEl) {
      stateEl.textContent = "状态：" + text;
    }
  }

  function stateTextFor(status) {
    if (status === STATUS_OPENED) {
      return "已打开";
    }
    if (status === STATUS_IGNORED) {
      return "已忽略，稍后降低出现频率";
    }
    return "待处理";
  }

  // 把某个状态对应的外观和按钮可用性套到卡片上。
  // 刷新后恢复状态、以及点击按钮后更新状态，都走这一个函数，行为保持一致。
  function applyCardStatus(card, status) {
    card.classList.remove("is-opened");
    card.classList.remove("is-ignored");

    if (status === STATUS_OPENED) {
      card.classList.add("is-opened");
    } else if (status === STATUS_IGNORED) {
      card.classList.add("is-ignored");
    }

    setCardState(card, stateTextFor(status));

    var openBtn = card.querySelector('[data-action="open"]');
    var ignoreBtn = card.querySelector('[data-action="ignore"]');

    // 已打开：打开和忽略都不能再点
    // 已忽略：忽略不能再点，但仍然允许打开（用户可以改变主意）
    if (openBtn) {
      openBtn.disabled = status === STATUS_OPENED;
    }
    if (ignoreBtn) {
      ignoreBtn.disabled = status === STATUS_OPENED || status === STATUS_IGNORED;
    }
  }

  function updateEmptyState() {
    var remaining = cardList.querySelectorAll(".card").length;
    emptyEl.hidden = remaining > 0;
  }

  function getTitle(card) {
    var titleEl = card.querySelector(".card-title");
    return titleEl ? titleEl.textContent.trim() : "该内容";
  }

  function getCardState(card) {
    var id = card.getAttribute("data-card-id");
    if (!id) {
      return null;
    }
    return state.cards[id] || null;
  }

  // 按 id 找到对应的演示数据（用于取 url）
  function findCardData(id) {
    for (var i = 0; i < DEMO_CARDS.length; i++) {
      if (DEMO_CARDS[i].id === id) {
        return DEMO_CARDS[i];
      }
    }
    return null;
  }

  // 检查网址是否可以安全打开。
  // 只允许 http:// 和 https://，其他（例如 javascript:）一律拒绝。
  function checkUrl(url) {
    if (typeof url !== "string" || url.trim() === "") {
      return { ok: false, reason: "这条记录没有保存网址，无法打开。" };
    }

    var parsed = null;
    try {
      parsed = new URL(url.trim());
    } catch (err) {
      return { ok: false, reason: "网址格式不正确，无法打开：" + url };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, reason: "只支持打开 http 或 https 网址。" };
    }

    return { ok: true, url: parsed.href };
  }

  // 这张卡片不再计入“考虑过未选择”。
  // 数字由 renderCounts() 重新数出来，这里只改状态。
  function releaseCount(card, cardState) {
    if (cardState.counted) {
      cardState.counted = false;
      card.setAttribute("data-counted", "false");
    }
  }

  // ===== 三个操作 =====

  function handleOpen(card) {
    var cardState = getCardState(card);
    if (!cardState) {
      return;
    }

    if (cardState.status === STATUS_OPENED) {
      setStatus("已经打开过：" + getTitle(card));
      return;
    }

    // 先检查网址。打不开就不改状态、不加计数，保持卡片原样。
    var cardData = findCardData(card.getAttribute("data-card-id"));
    var checked = checkUrl(cardData ? cardData.url : "");

    if (!checked.ok) {
      setStatus(checked.reason);
      return;
    }

    // 用新标签打开。
    // 注意：带 noopener 时 window.open 即使成功也会返回 null，
    // 所以不能用返回值判断成功与否，只用 try/catch 兜住异常。
    try {
      window.open(checked.url, "_blank", "noopener");
    } catch (err) {
      setStatus("打开失败，请稍后重试：" + getTitle(card));
      return;
    }

    cardState.status = STATUS_OPENED;
    applyCardStatus(card, STATUS_OPENED);
    releaseCount(card, cardState);

    renderCounts();
    saveState();
    setStatus("已打开并计入本次选择：" + getTitle(card));
  }

  function handleIgnore(card) {
    var cardState = getCardState(card);
    if (!cardState) {
      return;
    }

    if (cardState.status === STATUS_OPENED) {
      setStatus("已打开的内容不再标记为忽略。");
      return;
    }

    cardState.status = STATUS_IGNORED;
    applyCardStatus(card, STATUS_IGNORED);

    saveState();
    setStatus("已忽略：" + getTitle(card));
  }

  function handleDelete(card) {
    var cardState = getCardState(card);
    if (!cardState) {
      return;
    }

    var title = getTitle(card);
    releaseCount(card, cardState);

    cardState.status = STATUS_DELETED;
    card.remove();

    renderCounts();
    updateEmptyState();
    saveState();
    setStatus("已从本地记录中删除：" + title);
  }

  cardList.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-action]");
    if (!button || button.disabled) {
      return;
    }

    var card = button.closest(".card");
    if (!card) {
      return;
    }

    var action = button.getAttribute("data-action");
    if (action === "open") {
      handleOpen(card);
    } else if (action === "ignore") {
      handleIgnore(card);
    } else if (action === "delete") {
      handleDelete(card);
    }
  });

  // ===== 重置演示数据 =====
  // 清空本地保存，把界面恢复到初始演示状态。不刷新页面，直接重新渲染。

  function resetDemo() {
    removeSavedState();

    // 重新可用：之前如果保存失败过，重置后再试一次
    canSave = true;
    storageNote = "";

    state = buildDefaultState();

    renderCards();
    renderCounts();
    updateEmptyState();
    saveState();
    setStatus("已重置为初始演示数据。");
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", resetDemo);
  }

  // 测试辅助：在浏览器控制台执行 unclickedResetDemo() 也能重置
  window.unclickedResetDemo = resetDemo;

  // ===== 启动 =====

  state = loadState();

  renderSession();
  renderCards();
  renderCounts();
  updateEmptyState();
  setStatus("等待操作");
})();
