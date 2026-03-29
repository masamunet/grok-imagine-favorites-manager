/**
 * Grok Imagine Favorites Manager - API Layer
 */

var Api = {
  endpoints: {
    unlike: 'https://grok.com/rest/media/post/unlike'
  },

  /**
   * Request deep analysis for a post from the background script
   * Returns a Promise that resolves to an array of media objects [{url, id, type}]
   */
  async requestAnalysis(postId, postUrl, attempt = 0) {
    // Wrap sendMessage in a plain (non-async) Promise to avoid swallowed rejections
    // that occur when an async callback is passed to chrome.runtime.sendMessage
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'analyzePost', postId, url: postUrl }, (res) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(res);
        }
      });
    });

    if (response && response.success) {
      return response.data || [];
    }

    const errorMsg = response?.error || 'Unknown analysis error';
    if (errorMsg.includes('warming up') && attempt < 3) {
      console.log(`[Api] Extension warming up, retrying analysis for ${postId} (Attempt ${attempt + 1})...`);
      await new Promise(r => setTimeout(r, 1000));
      return this.requestAnalysis(postId, postUrl, attempt + 1);
    }

    throw new Error(errorMsg);
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
  async startDownloads(mediaList) {
    if (!mediaList || mediaList.length === 0) {
      return { success: true, queued: 0 };
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'startDownloads', media: mediaList }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        if (response && response.success) {
          resolve(response);
          return;
        }

        reject(new Error(response?.error || 'Failed to queue downloads'));
      });
    });
  }
};

window.Api = Api;
