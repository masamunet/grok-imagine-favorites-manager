/**
 * Grok Imagine Favorites Manager - Media Scanner
 */

var MediaScanner = {
  /**
   * Requests background.js to inject a script into the MAIN world to extract React Fiber IDs and attach them as data attributes.
   * This is required because Content Scripts (Isolated World) cannot see Javascript properties set by the page,
   * and inline scripts are blocked by CSP.
   */
  async injectFiberExtractor() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'extractFiber' }, (response) => {
        if (chrome.runtime.lastError) {
          window.Utils.Logger.warn('[Scanner] Fiber extraction lastError:', chrome.runtime.lastError.message);
          resolve(false);
          return;
        }
        resolve(response && response.success);
      });
    });
  },

  /**
   * Phase 1: Expand Page and Scan (Visual Only)
   */
  async scanPage(visualizeOnly = false) {
    if (window.ProgressModal) window.ProgressModal.update(10, 'Scanning items...');

    // SPA transition support
    await window.Utils.sleep(800);

    // PRE-PROCESSING: Inject Fiber extraction script into MAIN world
    try {
      await this.injectFiberExtractor();
    } catch (e) {
      window.Utils.Logger.warn(`[Scanner] Main world injection failed: ${e.message}`);
    }

    const mediaElements = Array.from(document.querySelectorAll(
      'img[alt*="Generated" i], video, [data-testid="video-player"], [data-testid="video-component"], .video-js'
    )).filter(el => {
      if (el.tagName === 'IMG' && el.src && el.src.includes('/profile/')) return false;
      return true;
    });

    if (mediaElements.length === 0) {
      window.Utils.Logger.warn(`[Scanner] No media found. img=${document.querySelectorAll('img').length}, video=${document.querySelectorAll('video').length}`);
      throw new Error(`アイテムが見つかりませんでした。「Download」を再試行するか、ページをリロードしてください。`);
    }

    window.Utils.Logger.log(`[Scanner] Found ${mediaElements.length} media elements in DOM.`);

    const foundItems = await this.collectVisibleItems(mediaElements);

    if (foundItems.length === 0) {
      throw new Error(`アイテムが見つかりませんでした。「Download」を再試行するか、ページをリロードしてください。`);
    }

    window.Utils.Logger.log(`[Scanner] Total IDs Collected: ${foundItems.length}`);
    return foundItems;
  },

  /**
   * Finds the likely scrollable container
   */
  getScrollContainer() {
    // 1. naive check for easy selectors
    const candidates = [
      document.querySelector('.overflow-y-auto'),
      document.querySelector('main'),
      document.documentElement,
      document.body
    ].filter(el => el);

    // 2. Find the one with biggest scrollHeight that is scrollable
    let bestContainer = window;
    let maxScrollHeight = 0;

    for (const el of candidates) {
      const style = window.getComputedStyle(el);
      const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll' || el === document.documentElement;
      if (isScrollable && el.scrollHeight > el.clientHeight && el.scrollHeight > maxScrollHeight) {
        maxScrollHeight = el.scrollHeight;
        bestContainer = el;
      }
    }

    // Fallback: if window scrollY > 0, window is definitely scrollable
    if (window.scrollY > 0) return window;

    return bestContainer;
  },

  /**
   * Scrolls to the bottom repeatedly until no new content loads.
   */
  async expandPageToBottom() {
    let scrollContainer = this.getScrollContainer();
    window.Utils.Logger.log('[Scanner] Identified scroll container:', scrollContainer);

    let lastScrollHeight = 0;
    let unchangedCount = 0;
    const MAX_UNCHANGED = 3;

    while (true) {
      if (window.ProgressModal?.isCancelled()) throw new Error('Operation cancelled by user');

      // Handle Window vs Element logic
      const isWindow = scrollContainer === window;
      const currentScrollHeight = isWindow ? document.body.scrollHeight : scrollContainer.scrollHeight;

      // Scroll Action
      if (isWindow) {
        window.scrollTo(0, document.body.scrollHeight);
      } else {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }

      await window.Utils.sleep(window.CONFIG.SCROLL_DELAY_MS);

      // Check results
      const newScrollHeight = isWindow ? document.body.scrollHeight : scrollContainer.scrollHeight;

      if (Math.abs(newScrollHeight - lastScrollHeight) < 10) {
        unchangedCount++;
        window.Utils.Logger.log(`[Scanner] Height unchanged (${unchangedCount}/${MAX_UNCHANGED})`);
      } else {
        unchangedCount = 0;
        lastScrollHeight = newScrollHeight;
        window.Utils.Logger.log(`[Scanner] Height increased to ${newScrollHeight}`);

        // Update container if page structure changed (SPA Dynamic loading)
        scrollContainer = this.getScrollContainer();
      }

      if (unchangedCount >= MAX_UNCHANGED) {
        window.Utils.Logger.log('[Scanner] Page expansion finished.');
        break;
      }
    }
  },

  /**
   * Scans the current DOM for items
   */
  async collectVisibleItems(mediaElements) {
    const processedPostIds = new Set();
    const foundItems = [];

    // Use passed-in elements, or query DOM as fallback
    if (!mediaElements || mediaElements.length === 0) {
      mediaElements = Array.from(document.querySelectorAll(
        'img[alt*="Generated" i], video, [data-testid="video-player"], [data-testid="video-component"], .video-js'
      )).filter(el => {
        if (el.tagName === 'IMG' && el.src && el.src.includes('/profile/')) return false;
        return true;
      });
    }

    window.Utils.Logger.log(`[Scanner] DOM上で ${mediaElements.length} 件のメディア要素候補を取得しました。`);

    for (let idx = 0; idx < mediaElements.length; idx++) {
      // 20件ごとにメインスレッドを解放してブラウザフリーズを防ぐ
      if (idx > 0 && idx % 20 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }

      const el = mediaElements[idx];
      const postData = window.Utils.extractPostDataFromElement(el);

      if (!postData) {
        window.Utils.Logger.warn(`[Scanner] 抽出失敗: 要素<${el.tagName}> からIDを見つけられませんでした。`);
        continue;
      }

      if (!processedPostIds.has(postData.id)) {
        processedPostIds.add(postData.id);
        foundItems.push({
          id: postData.id,
          url: postData.url,
          details: {}
        });
        window.Utils.Logger.log(`[Scanner] リストに追加: ${postData.id} (抽出戦略: ${postData.strategy})`);
      } else {
        window.Utils.Logger.warn(`[Scanner] 重複スキップ: 要素<${el.tagName}>から抽出されたID (${postData.id}) は既に別要素で取得済みです。`);
      }
    }

    // 2. Fallback: Search A tags directly if still low/zero
    if (foundItems.length === 0) {
      const links = document.querySelectorAll('a[href*="/post/"]');
      for (const link of links) {
        if (link.href.includes('/profile/')) continue;
        const postData = window.Utils.extractPostDataFromElement(link);
        if (postData && !processedPostIds.has(postData.id)) {
          processedPostIds.add(postData.id);
          foundItems.push({
            id: postData.id,
            url: postData.url,
            details: {}
          });
        }
      }
    }

    window.Utils.Logger.log(`[Scanner] 重複排除後、最終的に ${foundItems.length} 件のアイテムを認識しました。`);
    return foundItems;
  },

  async prepareForDownload(items, filterType, onBatchReady) {
    const allMediaData = new Map(); // dedupKey (id+ext) -> {url, filename, type}
    const CONCURRENCY = 3; // 同時分析数（サーバー負荷を配慮）

    window.Utils.Logger.log(`[Scanner] 🕵️ Starting Strict Analysis for ${items.length} items (concurrency=${CONCURRENCY})...`);

    for (let i = 0; i < items.length; i += CONCURRENCY) {
      if (window.ProgressModal.isCancelled()) break;

      const batch = items.slice(i, Math.min(i + CONCURRENCY, items.length));
      window.ProgressModal.update(50 + ((i / items.length) * 40), `Analyzing ${i + 1}-${Math.min(i + CONCURRENCY, items.length)}/${items.length}...`);

      const promises = batch.map(item =>
        window.Api.requestAnalysis(item.id, item.url).catch(e => {
          console.error(`[Scanner] ❌ Analysis failed for ${item.id}:`, e);
          return [];
        })
      );

      const batchResults = await Promise.all(promises);

      const batchReady = [];

      for (const results of batchResults) {
        if (Array.isArray(results) && results.length > 0) {
          const perItemMedia = new Map();

          results.forEach(res => {
            if (res.url) {
              const ext = res.type === 'video' ? 'mp4' : 'jpg';
              const filename = `${res.id}.${ext}`;
              const dedupKey = `${res.id}.${ext}`;
              if (!perItemMedia.has(dedupKey)) {
                perItemMedia.set(dedupKey, { url: res.url, filename, type: res.type });
              }
            }
          });

          let readyItems = Array.from(perItemMedia.values());
          if (filterType === 'saveImages') {
            readyItems = readyItems.filter(item => !item.filename.toLowerCase().endsWith('.mp4'));
          } else if (filterType === 'saveVideos') {
            readyItems = readyItems.filter(item => item.filename.toLowerCase().endsWith('.mp4'));
          }

          readyItems.forEach(item => {
            if (!allMediaData.has(item.filename)) {
              allMediaData.set(item.filename, item);
              batchReady.push(item);
            }
          });
        }
      }

      if (batchReady.length > 0 && typeof onBatchReady === 'function') {
        await onBatchReady(batchReady, {
          processed: Math.min(i + CONCURRENCY, items.length),
          total: items.length,
          queued: allMediaData.size
        });
      }

      // バッチ間のディレイ（サーバー負荷軽減）
      if (i + CONCURRENCY < items.length) {
        await window.Utils.sleep(window.CONFIG.ANALYSIS_DELAY_MS);
      }
    }

    // allMediaData already contains only filtered items (filtered per-batch above)
    return Array.from(allMediaData.values());
  },

  async unsaveAll() {
    return this.unsaveAllLegacy();
  },

  /**
   * Unfavorites all items found on the page
   */
  async unsaveAllLegacy() {
    window.Utils.Logger.log('[Scanner] Starting unsave sweep...');

    // Inject Fiber extractor to get correct post IDs (especially for video cards)
    try {
      await this.injectFiberExtractor();
    } catch (e) {
      window.Utils.Logger.warn('[Scanner] Fiber injection failed for unsave, falling back to DOM extraction');
    }

    let scrollContainer = document.documentElement;
    const possibleContainers = [document.querySelector('main'), document.querySelector('.overflow-y-auto')]
      .filter(el => el !== null);
    if (possibleContainers.length) scrollContainer = possibleContainers[0];

    let totalProcessed = 0;
    const processedIds = new Set();
    let unchangedCount = 0;
    let lastScrollHeight = 0;

    while (!window.ProgressModal.isCancelled()) {
      const cards = document.querySelectorAll(window.SELECTORS.LIST_ITEM);
      let actedOnThisTurn = 0;

      for (let i = 0; i < cards.length; i++) {
        if (window.ProgressModal.isCancelled()) break;
        const card = cards[i];

        // 1. Physical Click (Try this first as it's most robust)
        const unsaveBtn = card.querySelector(window.SELECTORS.UNSAVE_BUTTON);
        let clicked = false;

        if (unsaveBtn) {
          try {
            unsaveBtn.click();
            clicked = true;
            actedOnThisTurn++;
            totalProcessed++;
            await window.Utils.sleep(300);
          } catch (e) { }
        }

        // 2. API Fallback (Only if we can identify the ID and haven't clicked)
        const postData = window.Utils.extractPostDataFromElement(card);
        if (postData && postData.id && !processedIds.has(postData.id)) {
          processedIds.add(postData.id);
          if (!clicked) {
            await window.Api.unlikePost(postData.id);
            actedOnThisTurn++;
            totalProcessed++;
            await window.Utils.sleep(window.CONFIG.UNFAVORITE_DELAY_MS || 200);
          }
        }

        // 対数スケールで進捗表示: 25件=50%, 100件=80%, 1000件=95% (上限98%)
        window.ProgressModal.update(
          Math.min(98, Math.round(40 * Math.log10(totalProcessed + 1))),
          `Unfavorited ${totalProcessed} items...`
        );
      }

      // Scroll logic
      const currentScrollHeight = scrollContainer.scrollHeight;
      if (currentScrollHeight === lastScrollHeight) unchangedCount++;
      else { unchangedCount = 0; lastScrollHeight = currentScrollHeight; }

      // Exit if no actions taken and scroll didn't change (end of list)
      if (actedOnThisTurn === 0 && unchangedCount >= 2) break;

      scrollContainer.scrollTop += window.innerHeight / 2;
      await window.Utils.sleep(window.CONFIG.SCROLL_DELAY_MS);
    }

    return totalProcessed;
  }
};

window.MediaScanner = MediaScanner;
