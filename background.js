/**
 * Grok Imagine Favorites Manager - Background Service Worker
 * Handles download operations and Deep Analysis via Network Interception (God Mode)
 */

// Global error handler to catch "Uncaught (in promise)" errors - MUST BE FIRST
self.addEventListener('unhandledrejection', event => {
  // Suppress only specific startup errors
  if (event.reason && event.reason.message &&
    (event.reason.message.includes('Tabs cannot be edited') || event.reason.message.includes('Extension warming up'))) {
    event.preventDefault();
    return;
  }
  // Let other unhandled rejections propagate normally for debugging
  console.warn('[Background] Unhandled rejection:', event.reason);
});

// Constants
const DOWNLOAD_CONFIG = {
  RATE_LIMIT_MS: 1000,
  FOLDER: 'grok-imagine'
};

const START_TIME = Date.now();
const STARTUP_DELAY = 3000; // 3 seconds grace period

// Semaphore for concurrent tab analysis (prevents tab explosion)
const MAX_CONCURRENT_TABS = 3;
let activeTabCount = 0;
let isProcessingDownloads = false;

// Resume download queue on SW restart
chrome.storage.local.get(['downloadQueue'], (result) => {
  if (result.downloadQueue && result.downloadQueue.length > 0) {
    console.log(`[Background] Resuming ${result.downloadQueue.length} queued downloads after SW restart`);
    processNextDownload();
  }
});

/**
 * Handles messages from content script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startDownloads') {
    handleDownloads(request.media)
      .then((result) => { try { sendResponse({ success: true, ...result }); } catch (e) { } })
      .catch(error => { try { sendResponse({ success: false, error: error.message }); } catch (e) { } });
    return true;
  }

  // proxyLogInternal listener removed

  if (request.action === 'analyzePost') {
    // IGNORE requests during startup grace period to prevent "Tabs cannot be edited" storm
    if (Date.now() - START_TIME < STARTUP_DELAY) {
      sendResponse({ success: false, error: 'Extension warming up' });
      return true;
    }

    analyzePostInTab(request.postId, request.url)
      .then(result => {
        try { sendResponse({ success: true, data: result }); } catch (e) { }
      })
      .catch(error => {
        try { sendResponse({ success: false, error: error.message }); } catch (e) { }
      });
    return true;
  }

  if (request.action === 'extractFiber') {
    if (!sender.tab) {
      sendResponse({ success: false, error: 'No associated tab for extractFiber request' });
      return true;
    }
    try {
      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        func: async () => {
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

          const elements = Array.from(document.querySelectorAll('img, video, [data-testid="video-player"], [data-testid="video-component"]'));
          for (let i = 0; i < elements.length; i++) {
            // 20件ごとにメインスレッドを解放してブラウザフリーズを防ぐ
            if (i > 0 && i % 20 === 0) {
              await new Promise(r => setTimeout(r, 0));
            }
            const el = elements[i];
            try {
              let domNode = el;
              let found = false;
              for (let domLevel = 0; domLevel < 10; domLevel++) {
                if (!domNode) break;
                const reactPropsKey = Object.keys(domNode).find(key => key.startsWith('__reactFiber$'));
                if (reactPropsKey) {
                  let fiberNode = domNode[reactPropsKey];
                  for (let j = 0; j < 15; j++) {
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
  // Semaphore: wait until a slot is available (max 30s to avoid infinite spin)
  const semaphoreDeadline = Date.now() + 30000;
  while (activeTabCount >= MAX_CONCURRENT_TABS) {
    if (Date.now() > semaphoreDeadline) throw new Error(`Semaphore timeout for post ${postId}`);
    await new Promise(r => setTimeout(r, 300));
  }
  activeTabCount++;

  // Semaphore already prevents thundering herd; jitter removed to reduce latency

  let tabId = null;
  const collectedMedia = new Set();

  try {
    const targetUrl = postUrl || `https://grok.com/imagine/post/${postId}`;

    const tab = await createTabSafe(targetUrl);
    tabId = tab.id;

    // Wait for load with settled flag to prevent double-resolve side effects
    await new Promise(resolve => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      };
      const listener = (tid, changeInfo) => {
        if (tid === tabId && changeInfo.status === 'complete') {
          setTimeout(done, 500);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(done, 8000);
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

    // --- STEP 0.5: COLLECT IMAGE URLs DIRECTLY FROM DOM ---
    // Video posts only trigger .mp4 via fetch/XHR; static images are already in <img> tags
    try {
      const domResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: collectDomMediaUrls
      });
      if (domResults && domResults[0] && domResults[0].result) {
        domResults[0].result.forEach(u => collectedMedia.add(u));
      }
    } catch (e) {
      console.warn(`[Background] Failed to collect DOM images (Tab ${tabId}):`, e);
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
    let tabSwitched = false;
    try {
      const switchResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: switchTab
      });
      tabSwitched = switchResult?.[0]?.result === true;
    } catch (e) {
      console.warn(`[Background] Failed to switch tab (Tab ${tabId}):`, e);
    }

    // --- STEP 3: COLLECT ASSETS AGAIN (Only if tab was actually switched) ---
    if (tabSwitched) {
      await new Promise(r => setTimeout(r, 500));
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
    }

    // Cleanup
    try {
      if (tabId) await chrome.tabs.remove(tabId);
    } catch (e) {
      // console.warn('[Background] Tab cleanup warning:', e.message); // Quieter cleanup
    }

    // Deduplicate by path, preferring URLs that retain query strings
    // (collectDomMediaUrls strips queries for dedup; sniffer keeps full URLs for auth tokens)
    const pathMap = new Map();
    for (const url of collectedMedia) {
      if (!url || url.length <= 5) continue;
      try {
        const u = new URL(url);
        const key = u.origin + u.pathname;
        if (!pathMap.has(key) || u.search.length > 0) {
          pathMap.set(key, url); // prefer URL with query params over path-only
        }
      } catch (e) {
        pathMap.set(url, url);
      }
    }

    // Map URLs to formatted objects
    return Array.from(pathMap.values()).map(url => {
      const id = extractPostIdFromUrl(url) || postId;
      const isVideo = /\.mp4(\?|$)/i.test(url);
      const type = isVideo ? 'video' : 'image';
      return { url, id, type };
    });

  } catch (e) {
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch (err) { }
    }
    console.error(`[Background] Analysis critical failure for ${postId}:`, e);
    return [];
  } finally {
    activeTabCount--;
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

  // Guard against double-patching if sniffer is injected more than once on the same tab
  if (relay.dataset.snifferActive === 'true') return;
  relay.dataset.snifferActive = 'true';

  const collectedSet = new Set();
  try {
    const existing = JSON.parse(relay.dataset.collectedUrls || '[]');
    existing.forEach(u => collectedSet.add(u));
  } catch (e) { }

  const pushUrl = (url) => {
    if (!url) return;
    if (typeof url !== 'string') {
      if (url instanceof URL) url = url.href;
      else if (url instanceof Request) url = url.url;
    }

    if (url.includes('.mp4') || url.includes('.jpg') || url.includes('.png') || url.includes('.webp')) {
      if (!collectedSet.has(url)) {
        collectedSet.add(url);
        relay.dataset.collectedUrls = JSON.stringify([...collectedSet]);
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

  // Record baseline count instead of resetting (prevents race with MAIN world sniffer)
  let baselineUrls = [];
  try { baselineUrls = JSON.parse(relay.dataset.collectedUrls || '[]'); } catch (e) { }
  const baselineCount = baselineUrls.length;

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
        // Write to separate attribute to avoid race with MAIN world sniffer
        let isolated = [];
        try { isolated = JSON.parse(relay.dataset.isolatedUrls || '[]'); } catch (e) { }
        if (!isolated.includes(dlBtn.href)) {
          isolated.push(dlBtn.href);
          relay.dataset.isolatedUrls = JSON.stringify(isolated);
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

  // Max wait 4s - background tabs throttle setTimeout to 1000ms minimum,
  // so we need enough wall-clock time for at least 3-4 polling cycles
  while (Date.now() - startTime < 4000) {
    await new Promise(r => setTimeout(r, 100));

    let currentCount = 0;
    try {
      const current = JSON.parse(relay.dataset.collectedUrls || '[]');
      currentCount = current.length - baselineCount;
    } catch (e) { }

    const elapsed = Date.now() - startTime;

    if (currentCount > 0) {
      if (!firstDiscoveryTime) {
        firstDiscoveryTime = Date.now();
      }

      if (currentCount === lastCount) {
        if (!idleStartTime) idleStartTime = Date.now();
        // 1500ms idle - accounts for background tab throttling (1000ms min setTimeout)
        if (Date.now() - idleStartTime >= 1500) {
          break;
        }
      } else {
        idleStartTime = null;
      }
    } else {
      idleStartTime = null;
      if (buttonFound && elapsed >= 2000) {
        break;
      }
      if (!buttonFound && elapsed >= 1500) {
        break;
      }
    }
    lastCount = currentCount;
  }

  // Merge URLs from both MAIN world (collectedUrls) and ISOLATED world (isolatedUrls)
  const resultSet = new Set();
  try {
    const mainUrls = JSON.parse(relay.dataset.collectedUrls || '[]');
    mainUrls.slice(baselineCount).forEach(u => resultSet.add(u));
  } catch (e) { }
  try {
    const isolatedUrls = JSON.parse(relay.dataset.isolatedUrls || '[]');
    isolatedUrls.forEach(u => resultSet.add(u));
  } catch (e) { }
  relay.dataset.isolatedUrls = '[]';

  return Array.from(resultSet);
}

/**
 * Collects media URLs directly from DOM (img src, video src/poster)
 * Runs in ISOLATED world - captures images that sniffer cannot catch via fetch/XHR
 */
function collectDomMediaUrls() {
  const urls = new Set();
  document.querySelectorAll('img').forEach(img => {
    if (!img.src) return;
    if (!(img.src.includes('.jpg') || img.src.includes('.png') || img.src.includes('.webp'))) return;
    // Skip profile pictures, avatars, icons
    if (img.src.includes('profile-picture') || img.src.includes('/profile/') || img.src.includes('/avatar/')) return;
    if (img.naturalWidth > 0 && img.naturalWidth < 100) return;
    // Normalize: strip query string to avoid duplicates (e.g. ?cache=1 vs ?cache=1&d=...)
    try {
      const u = new URL(img.src);
      urls.add(u.origin + u.pathname);
    } catch (e) {
      urls.add(img.src);
    }
  });
  return Array.from(urls);
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
      return true;
    }
  }
  return false;
}

/**
 * Download queue - persisted to chrome.storage.local for SW restart resilience
 */
async function handleDownloads(media) {
  if (!Array.isArray(media) || media.length === 0) throw new Error('No media provided');

  const existing = await chrome.storage.local.get([
    'activeOperation',
    'downloadQueue',
    'downloadDatePath',
    'downloadCounts',
    'totalDownloads',
    'downloadProgress'
  ]);
  const existingQueue = existing.downloadQueue || [];
  const queuedKeys = new Set(existingQueue.map(item => `${item.filename}::${item.url}`));
  const newMedia = media.filter(item => {
    const key = `${item.filename}::${item.url}`;
    if (queuedKeys.has(key)) return false;
    queuedKeys.add(key);
    return true;
  });

  if (newMedia.length === 0) {
    return { queued: 0, total: existing.totalDownloads || 0 };
  }

  const videoCount = newMedia.filter(item => item.filename && item.filename.toLowerCase().endsWith('.mp4')).length;
  const imageCount = newMedia.length - videoCount;
  const reuseSession = Boolean(existing.downloadDatePath) && (
    existing.activeOperation || existingQueue.length > 0 || isProcessingDownloads
  );

  await chrome.storage.local.set({
    totalDownloads: reuseSession ? (existing.totalDownloads || 0) + newMedia.length : newMedia.length,
    downloadProgress: reuseSession ? (existing.downloadProgress || {}) : {},
    downloadCounts: {
      video: (reuseSession ? (existing.downloadCounts?.video || 0) : 0) + videoCount,
      image: (reuseSession ? (existing.downloadCounts?.image || 0) : 0) + imageCount
    },
    downloadQueue: existingQueue.concat(newMedia),
    downloadDatePath: reuseSession ? existing.downloadDatePath : buildDownloadDatePath()
  });

  if (!isProcessingDownloads) {
    processNextDownload();
  }

  return {
    queued: newMedia.length,
    total: (reuseSession ? (existing.totalDownloads || 0) : 0) + newMedia.length
  };
}

async function processNextDownload() {
  if (isProcessingDownloads) return;
  isProcessingDownloads = true;

  try {
    while (true) {
      const data = await chrome.storage.local.get(['downloadQueue', 'downloadDatePath']);
      const queue = data.downloadQueue || [];

      if (queue.length === 0) break;

      const item = queue.shift();
      await chrome.storage.local.set({ downloadQueue: queue });

      if (item.url && item.filename) {
        const datePath = data.downloadDatePath || 'unknown';
        await new Promise((resolve) => {
          chrome.downloads.download({
            url: item.url,
            filename: `${DOWNLOAD_CONFIG.FOLDER}/${datePath}/${item.filename}`,
            saveAs: false
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              console.error(`[Background] Download failed for ${item.filename}:`, chrome.runtime.lastError.message);
            }
            resolve(downloadId);
          });
        });
      }

      if (queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, DOWNLOAD_CONFIG.RATE_LIMIT_MS));
      }
    }
  } finally {
    // Release lock BEFORE storage read. JS is single-threaded: if handleDownloads runs
    // during the await and starts a new processor, that processor sets the flag to true
    // before its first await — so the restart call below becomes a safe no-op.
    isProcessingDownloads = false;
    const pending = await chrome.storage.local.get(['downloadQueue']);
    if ((pending.downloadQueue || []).length > 0) {
      processNextDownload();
    }
  }
}

function buildDownloadDatePath() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${yyyy}_${mm}_${dd}/${hh}_${min}`;
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
