/**
 * Grok Imagine Favorites Manager - Content Script (Entry Point)
 */

console.log('[GrokManager] Content script initialized.');

// Initialize simple modules map for debugging if needed
window.GrokModules = {
  Scanner: window.MediaScanner,
  Classifier: window.ItemClassifier,
  Api: window.Api,
  UI: window.ProgressModal,
  Utils: window.Utils
};

/**
 * Message listener for actions from popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action } = request;

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
    if (window.ProgressModal) window.ProgressModal.cancel();
    chrome.storage.local.set({ activeOperation: false });
    sendResponse({ success: true });
    return;
  }

  // Handle Main Actions
  (async () => {
    try {
      chrome.storage.local.set({ activeOperation: true });

      if (action.startsWith('save') || action === 'scanOnly') {
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

/**
 * High-level flow for saving media
 */
async function handleSaveFlow(type) {
  try {
    if (!window.ProgressModal) {
      throw new Error('UI Module not loaded. Please refresh the page.');
    }
    // 0. Pre-roll: Expand Page First
    // USER REQUEST: "Scroll is meaningless" -> Disabled auto-scroll logic
    console.log('[GrokManager] Auto-scroll disabled by user request.');
    // await window.MediaScanner.expandPageToBottom();

    window.ProgressModal.show('Collecting Favorites', 'Scanning page...');

    // 1. Collect IDs (DOM Only, no analysis)
    const foundItems = await window.MediaScanner.scanPage(type === 'scanOnly');

    if (foundItems.length === 0) {
      throw new Error('No media found.');
    }

    // 2. Deep Analysis (Runs for BOTH ScanOnly and Download)
    // This opens tabs in background to verify media existence
    window.ProgressModal.update(50, `Found ${foundItems.length} items. Starting Deep Analysis (Tabs)...`);
    const analyzedMedia = await window.MediaScanner.prepareForDownload(foundItems, type);

    // 3. Scan Only: Report and Exit -> REMOVED (Feature deprecated)
    /*
    if (type === 'scanOnly') {
      const videoCount = analyzedMedia.filter(i => i.filename.endsWith('.mp4')).length;
      const imageCount = analyzedMedia.length - videoCount;

      window.ProgressModal.update(100, `Scan Complete! Found ${analyzedMedia.length} verified items.`);
      await window.Utils.sleep(500);

      alert(`Deep Scan Complete (Verified via Tabs):\n` +
        `Total Verified: ${analyzedMedia.length}\n` +
        `Videos: ${videoCount}\n` +
        `Images: ${imageCount}`);
      return;
    }
    */

    if (analyzedMedia.length === 0) {
      throw new Error('No downloadable media could be resolved from analysis.');
    }

    // 4. Download
    window.ProgressModal.update(100, `Ready to download ${analyzedMedia.length} files. Starting...`);

    console.log(`[GrokManager] Starting batch download for ${analyzedMedia.length} files.`);
    console.table(analyzedMedia);

    // Send work to background script
    window.Api.startDownloads(analyzedMedia);

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
