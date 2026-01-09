/**
 * Grok Imagine Favorites Manager - Background Service Worker
 * Handles download operations and Deep Analysis via Network Interception (God Mode)
 */

// Constants
const DOWNLOAD_CONFIG = {
  RATE_LIMIT_MS: 300,
  FOLDER: 'grok-imagine'
};

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
        console.error('Download error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'analyzePost') {
    analyzePostInTab(request.postId, request.url)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => {
        console.error('Analysis error:', error);
        sendResponse({ success: false, error: error.message });
      });
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
    console.log('[Background] Opening analysis tab:', targetUrl);
    const tab = await chrome.tabs.create({ url: targetUrl, active: false });
    tabId = tab.id;

    // Wait for load
    await new Promise(resolve => {
        const listener = (tid, changeInfo) => {
            if (tid === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(resolve, 1000); 
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 8000);
    });

    // --- INJECT SNIFFER (MAIN WORLD) ---
    await chrome.scripting.executeScript({
        target: { tabId },
        func: networkSniffer,
        world: 'MAIN'
    });
    await new Promise(r => setTimeout(r, 500));

    // --- STEP 1: COLLECT VIDEO ASSETS ---
    const vResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: scrapeAndIntercept,
      args: ['video']
    });
    if (vResults && vResults[0] && vResults[0].result) {
        vResults[0].result.forEach(u => collectedMedia.add(u));
    }

    // --- STEP 2: SWITCH TO IMAGE/VARIATIONS TAB ---
    await chrome.scripting.executeScript({
      target: { tabId },
      func: switchTab
    });
    await new Promise(r => setTimeout(r, 1000));

    // --- STEP 3: COLLECT IMAGE ASSETS (AND ANY NEW TRAFFIC) ---
    const iResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: scrapeAndIntercept,
        args: ['image']
    });
    if (iResults && iResults[0] && iResults[0].result) {
        iResults[0].result.forEach(u => collectedMedia.add(u));
    }
    
    // Cleanup
    chrome.tabs.remove(tabId);
    
    // Map URLs to formatted objects
    return Array.from(collectedMedia)
        .filter(url => url && url.length > 5)
        .map(url => {
            const id = extractPostIdFromUrl(url) || postId;
            const type = url.includes('.mp4') ? 'video' : 'image';
            return { url, id, type };
        });

  } catch (e) {
    if (tabId) chrome.tabs.remove(tabId);
    throw e;
  }
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
        if (url.includes('.mp4') || url.includes('.jpg') || url.includes('.png') || url.includes('.webp') || url.includes('blob:')) {
            console.log('[Sniffer] Intercepted:', url);
            let current = [];
            try { current = JSON.parse(relay.dataset.collectedUrls || '[]'); } catch(e){}
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
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        pushUrl(url);
        return originalOpen.apply(this, [method, url, ...rest]);
    };
    
    console.log('[Sniffer] Network hooks installed.');
}

/**
 * SCRAPER - Runs in ISOLATED world, clicks button and watches relay
 */
async function scrapeAndIntercept(mode) {
    const relay = document.getElementById('grok-sniffer-relay');
    if (!relay) return [];

    // Reset collected urls
    relay.dataset.collectedUrls = '[]';
    
    // Click DL button
    const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    const dlBtn = btns.find(b => {
        const label = (b.ariaLabel || "").toLowerCase();
        const text = (b.innerText || "").toLowerCase();
        const title = (b.title || "").toLowerCase();
        
        const isDownload = 
            label.includes('download') || text.includes('download') || title.includes('download') ||
            label.includes('ダウンロード') || text.includes('ダウンロード') || title.includes('ダウンロード') ||
            label.includes('保存') || text.includes('保存') || title.includes('保存');
            
        return isDownload && !text.includes('upscale') && !label.includes('upscale');
    });
    
    if (dlBtn) {
        console.log('[Scraper] Clicking button...');
        dlBtn.click();
    } else {
        console.log('[Scraper] No download button found for ' + mode + '. Waiting for passive traffic.');
    }

    // Wait for traffic to accumulate (passive + active)
    await new Promise(r => setTimeout(r, 2500));
    
    let results = [];
    try {
        results = JSON.parse(relay.dataset.collectedUrls || '[]');
    } catch(e) {}
    
    console.log('[Scraper] Collected URLs:', results);
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
  await chrome.storage.local.set({ totalDownloads: media.length, downloadProgress: {} });
  media.forEach((item, index) => {
    setTimeout(() => { downloadFile(item); }, index * DOWNLOAD_CONFIG.RATE_LIMIT_MS);
  });
}

function downloadFile(item) {
  if (!item.url || !item.filename) return;
  chrome.downloads.download({ 
    url: item.url, 
    filename: `${DOWNLOAD_CONFIG.FOLDER}/${item.filename}`,
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
