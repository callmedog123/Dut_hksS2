// The Unclicked（余路）· Side Panel 静态原型交互
// 仅演示界面状态变化，使用本地假数据，不请求任何外部服务。

(function () {
  "use strict";

  var cardList = document.getElementById("card-list");
  var statusEl = document.getElementById("status");
  var emptyEl = document.getElementById("empty-state");
  var chosenEl = document.getElementById("chosen-count");
  var missedEl = document.getElementById("missed-count");

  var counts = {
    chosen: parseInt(chosenEl.textContent, 10) || 0,
    missed: parseInt(missedEl.textContent, 10) || 0
  };

  function renderCounts() {
    chosenEl.textContent = String(counts.chosen);
    missedEl.textContent = String(counts.missed);
  }

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function setCardState(card, text) {
    var stateEl = card.querySelector('[data-role="state"]');
    if (stateEl) {
      stateEl.textContent = "状态：" + text;
    }
  }

  function disableAction(card, action) {
    var btn = card.querySelector('[data-action="' + action + '"]');
    if (btn) {
      btn.disabled = true;
    }
  }

  // 该卡片是否仍计入“考虑过未选择”
  function isCounted(card) {
    return card.getAttribute("data-counted") === "true";
  }

  function releaseCount(card) {
    if (isCounted(card)) {
      card.setAttribute("data-counted", "false");
      counts.missed = Math.max(0, counts.missed - 1);
      return true;
    }
    return false;
  }

  function updateEmptyState() {
    var remaining = cardList.querySelectorAll(".card").length;
    emptyEl.hidden = remaining > 0;
  }

  function getTitle(card) {
    var titleEl = card.querySelector(".card-title");
    return titleEl ? titleEl.textContent.trim() : "该内容";
  }

  function handleOpen(card) {
    if (card.classList.contains("is-opened")) {
      setStatus("已经打开过：" + getTitle(card));
      return;
    }

    card.classList.remove("is-ignored");
    card.classList.add("is-opened");
    setCardState(card, "已打开");
    disableAction(card, "open");
    disableAction(card, "ignore");

    if (releaseCount(card)) {
      counts.chosen += 1;
      renderCounts();
    }

    setStatus("已打开并计入本次选择：" + getTitle(card));
  }

  function handleIgnore(card) {
    if (card.classList.contains("is-opened")) {
      setStatus("已打开的内容不再标记为忽略。");
      return;
    }

    card.classList.add("is-ignored");
    setCardState(card, "已忽略，稍后降低出现频率");
    disableAction(card, "ignore");
    setStatus("已忽略：" + getTitle(card));
  }

  function handleDelete(card) {
    var title = getTitle(card);
    var changed = releaseCount(card);

    card.remove();
    if (changed) {
      renderCounts();
    }
    updateEmptyState();
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

  renderCounts();
  updateEmptyState();
  setStatus("等待操作");
})();