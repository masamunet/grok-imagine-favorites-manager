/**
 * Grok Imagine Favorites Manager - Content Script (Entry Point)
 */

console.log('[GrokManager] Content script initialized.');

/**
 * Message listener for actions from popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action } = request;

  if (action === 'ping') {
    sendResponse({ loaded: true });
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

      if (action === 'upscaleVideos') {
        // Placeholder or future implementation
        console.log('[GrokManager] Upscale requested (not yet implemented)');
      } else if (action.startsWith('save')) {
        await handleSaveFlow(action);
      } else if (action === 'unsaveAll') {
        // Placeholder or future implementation
        console.log('[GrokManager] Unsave requested (not yet implemented)');
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
});

/**
 * High-level flow for saving media
 */
async function handleSaveFlow(type) {
  try {
    if (!window.ProgressModal) {
      throw new Error('UI Module not loaded. Please refresh the page.');
    }
    window.ProgressModal.show('Collecting Favorites', 'Scanning page...');
    
    // Delegate core work to MediaScanner
    const mediaList = await window.MediaScanner.scan(type);

    if (mediaList.length === 0) {
      throw new Error('No media found.');
    }

    window.ProgressModal.update(100, `Found ${mediaList.length} items. Starting downloads...`);
    
    // Send work to background script
    window.Api.startDownloads(mediaList);
    
  } catch (error) {
    console.error('[GrokManager] Save flow error:', error);
    throw error;
  } finally {
    if (window.ProgressModal) {
      setTimeout(() => window.ProgressModal.remove(), 2500);
    }
  }
}
