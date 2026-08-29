// This classic isolated-world entry loads only the approved local Douyin
// Runtime module. No page scripts, remote code or page-private state are used.

(() => {
  const runtimeModuleUrl = chrome.runtime.getURL("content/douyinRuntime.js");
  import(runtimeModuleUrl)
    .then(({ startDouyinRuntime }) => {
      startDouyinRuntime();
    })
    .catch((error) => {
      console.warn("[The Unclicked] Douyin Runtime unavailable.", error);
    });
})();
