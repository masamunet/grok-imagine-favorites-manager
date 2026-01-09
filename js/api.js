/**
 * Grok Imagine Favorites Manager - API Layer
 */

var Api = {
  /**
   * Request deep analysis for a post from the background script
   * Returns a Promise that resolves to an array of media objects [{url, id, type}]
   */
  async requestAnalysis(postId, postUrl) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'analyzePost', postId, url: postUrl }, response => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        if (response && response.success) {
          // Response data is guaranteed to be an array after background.js update
          resolve(response.data || []);
        } else {
          reject(new Error(response?.error || 'Unknown analysis error'));
        }
      });
    });
  },

  /**
   * Send collected media list to background script to start downloads
   */
  startDownloads(mediaList) {
    if (!mediaList || mediaList.length === 0) return;
    chrome.runtime.sendMessage({ action: 'startDownloads', media: mediaList });
  }
};

window.Api = Api;
