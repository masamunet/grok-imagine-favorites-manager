/**
 * Grok Imagine Favorites Manager - API Layer
 */

var Api = {
  /**
   * Request deep analysis for a post from the background script
   * Returns a Promise that resolves to an array of media objects [{url, id, type}]
   */
  endpoints: {
    analysis: 'https://grok.com/rest/app-chat/conversations',
    unlike: 'https://grok.com/rest/media/post/unlike'
  },

  /**
   * Request deep analysis for a post from the background script
   * Returns a Promise that resolves to an array of media objects [{url, id, type}]
   */
  async requestAnalysis(postId, postUrl, attempt = 0) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'analyzePost', postId, url: postUrl }, async (response) => {
        if (chrome.runtime.lastError) {
          // If extension context invalidated or other runtime error
          return reject(chrome.runtime.lastError);
        }

        if (response && response.success) {
          resolve(response.data || []);
        } else {
          // Check for "Extension warming up" error and retry
          const errorMsg = response?.error || 'Unknown analysis error';
          if (errorMsg.includes('warming up') && attempt < 3) {
            console.log(`[Api] Extension warming up, retrying analysis for ${postId} (Attempt ${attempt + 1})...`);
            await new Promise(r => setTimeout(r, 1000));
            try {
              const result = await this.requestAnalysis(postId, postUrl, attempt + 1);
              resolve(result);
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error(errorMsg));
          }
        }
      });
    });
  },

  /**
   * Unlikes a post by ID
   */
  async unlikePost(postId) {
    try {
      const response = await fetch(this.endpoints.unlike, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: postId })
      });
      return response.ok;
    } catch (e) {
      console.error('[Api] Unlike Failed:', e);
      return false;
    }
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
