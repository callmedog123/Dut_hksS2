// This is the single classic Manifest content-script entry. The runtime and
// its existing dependencies remain ES Modules and execute in the isolated
// world through an extension URL scoped to the approved Bilibili origin.

(() => {
  const runtimeModuleUrl = chrome.runtime.getURL("content/bilibiliRuntime.js");
  import(runtimeModuleUrl)
    .then(({ startBilibiliRuntime }) => {
      startBilibiliRuntime();
    })
    .catch((error) => {
      console.warn("[The Unclicked] Bilibili Runtime unavailable.", error);
    });
})();
