// This classic isolated-world entry loads only the approved local Zhihu
// Runtime module. No page scripts, remote code or page-private state are used.

(() => {
  const runtimeModuleUrl = chrome.runtime.getURL("content/zhihuRuntime.js");
  import(runtimeModuleUrl)
    .then(({ startZhihuRuntime }) => {
      startZhihuRuntime();
    })
    .catch((error) => {
      console.warn("[The Unclicked] Zhihu Runtime unavailable.", error);
    });
})();
