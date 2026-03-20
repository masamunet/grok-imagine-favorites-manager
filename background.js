/**
 * Grok Imagine Favorites Manager - Background Service Worker
 * Handles download operations and Deep Analysis via Network Interception (God Mode)
 */

// Global error handler to catch "Uncaught (in promise)" errors - MUST BE FIRST
self.addEventListener('unhandledrejection', event => {
  // Suppress specific startup errors from cluttering the console/UI
  if (event.reason && event.reason.message &&
    (event.reason.message.includes('Tabs cannot be edited') || event.reason.message.includes('Extension warming up'))) {
    event.preventDefault();
    return;
  }
  console.warn('[Background] Unhandled rejection catch:', event.reason);
  event.preventDefault();
});

// Constants
const DOWNLOAD_CONFIG = {
  RATE_LIMIT_MS: 1000,
  FOLDER: 'grok-imagine'
};

const START_TIME = Date.now();
const STARTUP_DELAY = 3000; // 3 seconds grace period

// Global map to track analysis requests
const activeAnalysis = new Map();

/**
 * Handles messages from content script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startDownloads') {
    handleDownloads(request.media)
      .then(() => sendResponse({ success: true }))
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  // proxyLogInternal listener removed

  if (request.action === 'analyzePost') {
    // IGNORE requests during startup grace period to prevent "Tabs cannot be edited" storm
    if (Date.now() - START_TIME < STARTUP_DELAY) {
      console.warn('[Background] Ignoring analysis request during startup grace period.');
      sendResponse({ success: false, error: 'Extension warming up' });
      return true;
    }

    // Add jitter to prevent thundering herd
    const delay = Math.floor(Math.random() * 2000); // 0-2s delay
    setTimeout(() => {
      analyzePostInTab(request.postId, request.url)
        .then(result => sendResponse({ success: true, data: result }))
        .catch(error => {
          console.error('Analysis error:', error);
          sendResponse({ success: false, error: error.message });
        });
    }, delay);
    return true;
  }

  if (request.action === 'extractFiber') {
    try {
      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        func: () => {
          function findUUID(obj, depth = 0) {
            if (depth > 5 || !obj) return null;
            if (typeof obj === 'string') {
              const m = obj.match(/\/(?:post|status|imagine\/post)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
              if (m) return m[1].toLowerCase();
              return null;
            }
            if (typeof obj === 'object') {
              if (obj.postId && typeof obj.postId === 'string') {
                const m = obj.postId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
                if (m) return m[0].toLowerCase();
              }
              if (obj.id && typeof obj.id === 'string') {
                const m = obj.id.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
                if (m) return m[0].toLowerCase();
              }
              for (const k in obj) {
                if (k === 'children' || k === '$$typeof' || k === 'styles' || k === 'className' || k === 'sx') continue;
                try {
                  const res = findUUID(obj[k], depth + 1);
                  if (res) return res;
                } catch (e) { }
              }
            }
            return null;
          }

          const elements = document.querySelectorAll('img, video, [data-testid="video-player"], [data-testid="video-component"]');
          for (let el of elements) {
            try {
              let domNode = el;
              let found = false;
              for (let domLevel = 0; domLevel < 10; domLevel++) {
                if (!domNode) break;
                const reactPropsKey = Object.keys(domNode).find(key => key.startsWith('__reactFiber$'));
                if (reactPropsKey) {
                  let fiberNode = domNode[reactPropsKey];
                  for (let i = 0; i < 50; i++) {
                    if (!fiberNode) break;
                    if (fiberNode.memoizedProps) {
                      const id = findUUID(fiberNode.memoizedProps);
                      if (id) {
                        el.setAttribute('data-grok-extracted-id', id);
                        found = true;
                        break;
                      }
                    }
                    fiberNode = fiberNode.return;
                  }
                }
                if (found) break;
                domNode = domNode.parentElement;
              }
            } catch (err) { }
          }
        },
        world: 'MAIN'
      }).then(() => {
        sendResponse({ success: true });
      }).catch(err => {
        console.error('[Background] Fiber extraction failed:', err);
        sendResponse({ success: false, error: err.message });
      });
    } catch (error) {
      console.error('[Background] Fiber extraction error:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
});


/**
 * Opens a background tab, injects network sniffer, interacts, captures URLs
 */
async function analyzePostInTab(postId, postUrl) {
  let tabId = null;
  const collectedMedia = new Set(); // Use Set for uniqueness

  try {
    const targetUrl = postUrl || `https://grok.com/imagine/post/${postId}`;

    const tab = await createTabSafe(targetUrl);
    tabId = tab.id;

    // Wait for load
    await new Promise(resolve => {
      const listener = (tid, changeInfo) => {
        if (tid === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 500);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 8000);
    });

    // --- INJECT SNIFFER (MAIN WORLD) ---
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: networkSniffer,
        world: 'MAIN'
      });
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.warn(`[Background] Failed to inject sniffer (Tab ${tabId}):`, e);
      // Abort analysis for this item if sniffer fails
      try { await chrome.tabs.remove(tabId); } catch (err) { }
      return [];
    }

    // --- STEP 1: COLLECT VISIBLE ASSETS (Initial View) ---
    try {
      const initialResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: scrapeAndIntercept
      });
      if (initialResults && initialResults[0] && initialResults[0].result) {
        initialResults[0].result.forEach(u => collectedMedia.add(u));
      }
    } catch (e) {
      console.warn(`[Background] Failed to scrape initial view (Tab ${tabId}):`, e);
    }

    // --- STEP 2: SWITCH TAB IF AVAILABLE (Variations etc) ---
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: switchTab
      });
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.warn(`[Background] Failed to switch tab (Tab ${tabId}):`, e);
    }

    // --- STEP 3: COLLECT ASSETS AGAIN (After possible tab switch) ---
    try {
      const secondaryResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: scrapeAndIntercept
      });
      if (secondaryResults && secondaryResults[0] && secondaryResults[0].result) {
        secondaryResults[0].result.forEach(u => collectedMedia.add(u));
      }
    } catch (e) {
      console.warn(`[Background] Failed to scrape secondary view (Tab ${tabId}):`, e);
    }

    // Cleanup
    try {
      if (tabId) await chrome.tabs.remove(tabId);
    } catch (e) {
      // console.warn('[Background] Tab cleanup warning:', e.message); // Quieter cleanup
    }

    // Map URLs to formatted objects
    return Array.from(collectedMedia)
      .filter(url => url && url.length > 5)
      .map(url => {
        const id = extractPostIdFromUrl(url) || postId;
        const isVideo = url.includes('.mp4') || url.includes('video');
        const type = isVideo ? 'video' : 'image';
        return { url, id, type };
      });

  } catch (e) {
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch (err) { }
    }
    console.error(`[Background] Analysis critical failure for ${postId}:`, e);
    return []; // Return empty instead of throwing to keep service worker alive
  }
}

/**
 * Safe wrapper for creating tabs with retry logic
 */
async function createTabSafe(url) {
  let attempts = 0;
  while (attempts < 5) { // Increased retries
    try {
      return await chrome.tabs.create({ url, active: false });
    } catch (e) {
      // Catch ALL errors, not just specific ones.
      console.warn(`[Background] Tab creation failed (attempt ${attempts + 1}):`, e.message);

      // Exponential backoff
      await new Promise(r => setTimeout(r, 500 * (attempts + 1)));
      attempts++;
    }
  }
  throw new Error('Failed to create tab after multiple retries');
}

// Utility for background
function extractPostIdFromUrl(url) {
  if (!url) return null;
  const pathMatch = url.match(/\/(?:generated|post|status|imagine\/post)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (pathMatch && pathMatch[1]) return pathMatch[1].toLowerCase();

  const allMatches = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig);
  if (allMatches && allMatches.length > 0) {
    return allMatches[allMatches.length - 1].toLowerCase();
  }
  return null;
}

/**
 * SNIFFER - Runs in MAIN world, overrides fetch/XHR to leak URLs to DOM
 */
function networkSniffer() {
  // Hidden data exchange element
  let relay = document.getElementById('grok-sniffer-relay');
  if (!relay) {
    relay = document.createElement('div');
    relay.id = 'grok-sniffer-relay';
    relay.style.display = 'none';
    document.body.appendChild(relay);
  }

  const pushUrl = (url) => {
    if (!url) return;
    if (typeof url !== 'string') {
      if (url instanceof URL) url = url.href;
      else if (url instanceof Request) url = url.url;
    }

    // Check for interesting extensions
    if (url.includes('.mp4') || url.includes('.jpg') || url.includes('.png') || url.includes('.webp')) {


      let current = [];
      try { current = JSON.parse(relay.dataset.collectedUrls || '[]'); } catch (e) { }
      if (!current.includes(url)) {
        current.push(url);
        relay.dataset.collectedUrls = JSON.stringify(current);
        relay.setAttribute('data-timestamp', Date.now());
      }
    }
  };

  // Hook fetch
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const [resource, config] = args;
    pushUrl(resource);
    return originalFetch(...args);
  };

  // Hook XHR
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    pushUrl(url);
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  // Prevent native duplicate downloads from programmed clicks
  const originalClick = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function (...args) {
    if (this.tagName === 'A' && this.hasAttribute('download')) {
      const href = this.href;
      if (href) pushUrl(href);
      return; // Do not trigger native download
    }
    return originalClick.apply(this, args);
  };



}

/**
 * SCRAPER - Runs in ISOLATED world, clicks button and watches relay
 */
async function scrapeAndIntercept(mode) {
  const relay = document.getElementById('grok-sniffer-relay');

  if (!relay) {
    return [];
  }


  // Reset collected urls
  relay.dataset.collectedUrls = '[]';

  const findAllBtns = () => {
    const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    return btns.filter(b => {
      const label = (b.ariaLabel || "").toLowerCase();
      const text = (b.innerText || "").toLowerCase();
      const title = (b.title || "").toLowerCase();
      const isDownload =
        label.includes('download') || text.includes('download') || title.includes('download') ||
        label.includes('ダウンロード') || text.includes('ダウンロード') || title.includes('ダウンロード') ||
        label.includes('保存') || text.includes('保存') || title.includes('保存');
      return isDownload && !text.includes('upscale') && !label.includes('upscale');
    });
  };

  // 1. Wait for Buttons (Hydration/Render check) - Max 1.5s
  let dlBtns = findAllBtns();
  if (dlBtns.length === 0) {
    for (let i = 0; i < 15; i++) { // 100ms * 15 = 1.5s
      await new Promise(r => setTimeout(r, 100));
      dlBtns = findAllBtns();
      if (dlBtns.length > 0) break;
    }
  }

  let buttonFound = false;
  if (dlBtns.length > 0) {
    dlBtns.forEach(dlBtn => {
      if ((dlBtn.tagName === 'A' || dlBtn.hasAttribute('href')) && dlBtn.href) {
        let current = [];
        try { current = JSON.parse(relay.dataset.collectedUrls || '[]'); } catch (e) { }
        if (!current.includes(dlBtn.href)) {
          current.push(dlBtn.href);
          relay.dataset.collectedUrls = JSON.stringify(current);
          relay.setAttribute('data-timestamp', Date.now());
        }
      }
      try {
        dlBtn.click();
      } catch (e) {
        // Ignore click errors for invisible/disabled buttons
      }
    });
    buttonFound = true;
  }

  // 2. Wait for Network Idle (Dynamic Exit)
  // Use Time-based loop to handle background tab throttling (setTimeout becomes 1000ms in inactive tabs)
  const startTime = Date.now();
  let firstDiscoveryTime = null;
  let idleStartTime = null;
  let lastCount = 0;

  // Max wait 4 seconds (safe wall-clock time)
  while (Date.now() - startTime < 4000) {
    // Wait 100ms (or 1000ms if throttled)
    await new Promise(r => setTimeout(r, 100));

    // Check current results
    let currentCount = 0;
    try {
      const current = JSON.parse(relay.dataset.collectedUrls || '[]');
      currentCount = current.length;
    } catch (e) { }

    const elapsed = Date.now() - startTime;

    // Log occasionally (every ~500ms approx) - REMOVED


    // If we have items...
    if (currentCount > 0) {
      // First time detection
      if (!firstDiscoveryTime) {
        firstDiscoveryTime = Date.now();
      }

      // And count hasn't changed since last tick
      if (currentCount === lastCount) {
        if (!idleStartTime) idleStartTime = Date.now();

        const idleDuration = Date.now() - idleStartTime;
        // If quiet for 600ms, exit
        if (idleDuration >= 600) {
          break;
        }
      } else {
        // Count changed, reset idle timer
        idleStartTime = null;
      }
    } else {
      // 0 items
      idleStartTime = null;

      // If button was found and 2s passed, timeout early
      if (buttonFound && elapsed >= 2000) {
        break;
      }
      // If button NOT found, wait shorter (1.5s)
      if (!buttonFound && elapsed >= 1500) {
        break;
      }
    }
    lastCount = currentCount;
  }

  let results = [];
  try {
    results = JSON.parse(relay.dataset.collectedUrls || '[]');
  } catch (e) { }

  return results;
}

function switchTab() {
  const candidates = Array.from(document.querySelectorAll('[role="tab"], button'));
  for (const el of candidates) {
    const txt = (el.innerText || "").toLowerCase();
    const label = (el.ariaLabel || "").toLowerCase();
    const isImage =
      txt.includes('image') || label.includes('image') ||
      txt.includes('version') || label.includes('version') ||
      txt.includes('variations') || label.includes('variations') ||
      txt.includes('画像') || label.includes('画像') ||
      txt.includes('バリエーション') || label.includes('バリエーション');

    if (isImage) {
      el.click();
      return;
    }
  }
}

/**
 * Standard Download Logic
 */
async function handleDownloads(media) {
  if (!Array.isArray(media) || media.length === 0) throw new Error('No media provided');

  const videoCount = media.filter(item => item.filename && item.filename.toLowerCase().endsWith('.mp4')).length;
  const imageCount = media.length - videoCount;

  await chrome.storage.local.set({
    totalDownloads: media.length,
    downloadProgress: {},
    downloadCounts: { video: videoCount, image: imageCount }
  });

  const batchTimestamp = new Date();
  media.forEach((item, index) => {
    setTimeout(() => {
      downloadFile(item, batchTimestamp);
    }, index * DOWNLOAD_CONFIG.RATE_LIMIT_MS);
  });
}

function downloadFile(item, timestamp) {
  if (!item.url || !item.filename) return;
  const now = timestamp || new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const datePath = `${yyyy}_${mm}_${dd}/${hh}_${min}`;
  chrome.downloads.download({
    url: item.url,
    filename: `${DOWNLOAD_CONFIG.FOLDER}/${datePath}/${item.filename}`,
    saveAs: false
  });
}

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state) return;
  chrome.storage.local.get(['downloadProgress'], (result) => {
    const progress = result.downloadProgress || {};
    if (delta.state.current === 'complete') progress[delta.id] = 'complete';
    else if (delta.state.current === 'interrupted') progress[delta.id] = 'failed';
    chrome.storage.local.set({ downloadProgress: progress });
  });
});
