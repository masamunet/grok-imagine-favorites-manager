/**
 * Grok Imagine Favorites Manager - Content Script (Entry Point)
 */

// Debug logs controlled by Utils.Logger.DEBUG_MODE

// Initialize simple modules map for debugging if needed
window.GrokModules = {
  Scanner: window.MediaScanner,
  Api: window.Api,
  UI: window.ProgressModal,
  Utils: window.Utils
};

/**
 * Message listener for actions from popup
 * Guard prevents duplicate listeners when popup.js re-injects scripts on a page
 * where manifest.json content_scripts are already loaded.
 */
if (!window._grokListenerRegistered) {
  window._grokListenerRegistered = true;
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const { action } = request;
    if (window.Utils) window.Utils.Logger.log('[Content] Message received:', action);

    if (action === 'ping') {
      // Basic connectivity check
      if (window.ProgressModal) {
        sendResponse({ loaded: true });
      } else {
        // Retry logic often handles this, but good to be explicit
        sendResponse({ loaded: false });
      }
      return true;
    }

    if (action === 'cancelOperation') {
      const wasCancelled = Boolean(window.ProgressModal);
      if (window.ProgressModal) window.ProgressModal.cancel();
      chrome.storage.local.set({ activeOperation: false });
      sendResponse({ success: wasCancelled });
      return true;
    }

    // Handle Main Actions
    const SAVE_ACTIONS = new Set(['saveImages', 'saveVideos', 'saveBoth', 'upscaleVideos']);
    (async () => {
      try {
        await resetFinishedDownloadState();
        chrome.storage.local.set({ activeOperation: true });

        if (SAVE_ACTIONS.has(action)) {
          await handleSaveFlow(action);
        } else if (action === 'unsaveAll') {
          await handleUnsaveFlow();
        }
      } catch (error) {
        console.error('[GrokManager] Error handling action:', error);
        if (window.ProgressModal) window.ProgressModal.hide();
        if (!error.message.includes('cancelled')) {
          alert(`Error: ${error.message}`);
        }
      } finally {
        chrome.storage.local.set({ activeOperation: false });
      }
    })();

    // Send immediate response so Popup doesn't wait (and can close cleanly)
    sendResponse({ success: true, status: 'started' });
    return false;
  });
}

async function resetFinishedDownloadState() {
  const result = await chrome.storage.local.get([
    'downloadQueue',
    'downloadDatePath',
    'downloadCounts',
    'totalDownloads',
    'downloadProgress'
  ]);
  const queue = result.downloadQueue || [];
  const total = result.totalDownloads || 0;
  const progress = result.downloadProgress || {};
  const finishedCount = Object.values(progress).filter(state => state === 'complete' || state === 'failed').length;

  if (queue.length === 0 && (total === 0 || finishedCount >= total)) {
    await chrome.storage.local.remove([
      'downloadQueue',
      'downloadDatePath',
      'downloadCounts',
      'totalDownloads',
      'downloadProgress'
    ]);
  }
}

/**
 * High-level flow for saving media
 */
async function handleSaveFlow(type) {
  try {
    if (!window.ProgressModal) {
      throw new Error('UI Module not loaded. Please refresh the page.');
    }

    window.ProgressModal.show('Collecting Favorites', 'Scanning page...');

    // 1. Collect IDs (DOM Only, no analysis)
    const foundItems = await window.MediaScanner.scanPage(type === 'scanOnly');

    if (foundItems.length === 0) {
      throw new Error('No media found.');
    }

    // 2. Deep Analysis (Runs for BOTH ScanOnly and Download)
    window.ProgressModal.update(50, `Found ${foundItems.length} items. Starting Deep Analysis (Tabs)...`);
    let queuedCount = 0;
    const analyzedMedia = await window.MediaScanner.prepareForDownload(
      foundItems,
      type,
      async (batchMedia, stats) => {
        await window.Api.startDownloads(batchMedia);
        queuedCount += batchMedia.length;

        const progress = 50 + ((stats.processed / stats.total) * 45);
        window.ProgressModal.update(progress, `Analyzing ${stats.processed}/${stats.total}... ${queuedCount} files queued.`);
        window.ProgressModal.updateSubStatus(`解析できた分から順次ダウンロード中: ${queuedCount} 件`);
      }
    );

    // Check cancellation BEFORE checking empty results to avoid showing an error
    // when the user intentionally cancelled mid-analysis
    if (window.ProgressModal?.isCancelled()) {
      window.ProgressModal.hide();
      return;
    }

    if (analyzedMedia.length === 0) {
      throw new Error('No downloadable media could be resolved from analysis.');
    }

    window.ProgressModal.update(100, `${analyzedMedia.length} files queued. Downloads continue in the background.`);
    window.ProgressModal.updateSubStatus('解析完了。残りのダウンロードはバックグラウンドで継続します。');

  } catch (error) {
    if (error.message === 'Operation cancelled by user') {
      window.ProgressModal.hide();
      return;
    }
    console.error('[GrokManager] Save flow error:', error);
    throw error;
  } finally {
    if (window.ProgressModal) {
      setTimeout(() => window.ProgressModal.remove(), 2500);
    }
  }
}

/**
 * High-level flow for unsaving all items
 */
async function handleUnsaveFlow() {
  try {
    if (!window.ProgressModal) {
      throw new Error('UI Module not loaded. Please refresh the page.');
    }
    const confirmUnsave = confirm('WARNING: This will remove ALL likes/favorites from the current list.\n\nAre you sure you want to continue?');
    if (!confirmUnsave) return;

    window.ProgressModal.show('Unfavoriting All Items', 'Starting sweep...');

    // Delegate core work to MediaScanner
    const processedCount = await window.MediaScanner.unsaveAll();
    window.ProgressModal.update(100, `Done! Unfavorited ${processedCount} items.`);

    await window.Utils.sleep(1000);
    alert(`Finished! ${processedCount} items were removed.\nThe page will now refresh.`);
    window.location.reload();

  } catch (error) {
    if (error.message === 'Operation cancelled by user') {
      window.ProgressModal.hide();
      return;
    }
    console.error('[GrokManager] Unsave flow error:', error);
    throw error;
  } finally {
    if (window.ProgressModal) {
      window.ProgressModal.remove();
    }
  }
}
