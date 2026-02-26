/**
 * Grok Imagine Favorites Manager - Media Scanner
 */

var MediaScanner = {
  /**
   * Phase 1: Expand Page and Scan (Visual Only)
   */
  async scanPage(visualizeOnly = false) {
    // 2. Once fully expanded, scan the DOM
    window.Utils.Logger.log('[Scanner] Expansion complete. Starting Scan...');
    const foundItems = this.collectVisibleItems();

    window.Utils.Logger.log(`[Scanner] 📊 Total IDs Collected: ${foundItems.length} 件のアイテムを認識しました`);
    window.Utils.Logger.log(`[Scanner] ⏳ Preparing deep analysis...`);

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
    console.log('[Scanner] Identified scroll container:', scrollContainer);

    let lastScrollHeight = 0;
    let unchangedCount = 0;
    const MAX_UNCHANGED = 3;

    while (true) {
      if (window.ProgressModal.isCancelled()) throw new Error('Operation cancelled by user');

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
        console.log(`[Scanner] Height unchanged (${unchangedCount}/${MAX_UNCHANGED})`);
      } else {
        unchangedCount = 0;
        lastScrollHeight = newScrollHeight;
        console.log(`[Scanner] Height increased to ${newScrollHeight}`);

        // Update container if page structure changed (SPA Dynamic loading)
        scrollContainer = this.getScrollContainer();
      }

      if (unchangedCount >= MAX_UNCHANGED) {
        console.log('[Scanner] Page expansion finished.');
        break;
      }
    }
  },

  /**
   * Scans the current DOM for items
   */
  collectVisibleItems() {
    const processedPostIds = new Set();
    const foundItems = [];

    const cards = document.querySelectorAll(window.SELECTORS.CARD);
    window.Utils.Logger.log(`[Scanner] DOM上で ${cards.length} 件のアイテムを取得しました。抽出を開始します...`);

    for (let idx = 0; idx < cards.length; idx++) {
      const card = cards[idx];
      const postData = window.Utils.extractPostDataFromElement(card);

      if (!postData) continue;

      // CRITICAL: NO DOM CLASSIFICATION
      // User requested to rely 100% on detailed page analysis (Tabs).
      // We purely collect IDs here.

      if (!processedPostIds.has(postData.id)) {
        processedPostIds.add(postData.id);
        foundItems.push({
          id: postData.id,
          url: postData.url,
          // type: 'unknown', // We don't know yet. Analysis will determine.
          details: {}
        });
        window.Utils.Logger.log(`[Scanner] リストに追加: ${postData.id} (URL: ${postData.url})`);
      }
    }

    window.Utils.Logger.log(`[Scanner] 重複排除後、最終的に ${foundItems.length} 件のアイテムを認識しました。`);
    return foundItems;
  },

  async prepareForDownload(items, filterType) {
    const allMediaData = new Map(); // URL -> {url, filename}

    // CRITICAL CHANGE: User confirmed DOM detection is unreliable.
    // We must analyze ALL items via API to ensure we don't miss videos.
    // Previous "Static Image" optimization is removed.

    window.Utils.Logger.log(`[Scanner] 🕵️ Starting Strict Analysis for ${items.length} items...`);

    for (let i = 0; i < items.length; i++) {
      if (window.ProgressModal.isCancelled()) break;
      const item = items[i];

      window.ProgressModal.update(50 + ((i / items.length) * 40), `Opening Tab & Analyzing Item ${i + 1}/${items.length}...`);

      try {
        // ALWAYS use API/Background Tab Analysis
        // This triggers background.js to open a tab, inject sniffer, and capture media
        const results = await window.Api.requestAnalysis(item.id, item.url);

        if (Array.isArray(results) && results.length > 0) {
          results.forEach(res => {
            if (res.url) {
              const ext = res.type === 'video' ? 'mp4' : 'jpg';
              // Keep original ID for filename if possible, usage depends on API response structure
              // The API usually returns the variant ID. We might want to use the Post ID.
              const filename = `${res.id}.${ext}`;

              if (!allMediaData.has(res.url)) {
                allMediaData.set(res.url, { url: res.url, filename, type: res.type });
              }
            }
          });
        } else {
          // Fallback: If API returns nothing, AND it was physically an image, maybe we can save it?
          // But user wants strictness. If API fails, maybe we shouldn't guess.
          // Let's assume API is the source of truth.
          console.warn(`[Scanner] No media found via API for ${item.id}`);
        }

      } catch (e) {
        console.error(`[Scanner] ❌ Analysis failed for ${item.id}:`, e);
      }
      await window.Utils.sleep(window.CONFIG.ANALYSIS_DELAY_MS);
    }

    // Filter results based on requested type
    let finalResults = Array.from(allMediaData.values());

    const rawVideoCount = finalResults.filter(item => item.filename.endsWith('.mp4')).length;
    const rawImageCount = finalResults.length - rawVideoCount;
    window.Utils.Logger.log(`[Scanner] 🔎 [フィルタ前] 全アイテムから抽出されたメディア総数: ${finalResults.length} (動画: ${rawVideoCount}, 静止画: ${rawImageCount})`);

    if (filterType === 'saveImages') {
      finalResults = finalResults.filter(item => !item.filename.toLowerCase().endsWith('.mp4'));
    } else if (filterType === 'saveVideos') {
      finalResults = finalResults.filter(item => item.filename.toLowerCase().endsWith('.mp4'));
    }

    const videoCount = finalResults.filter(item => item.filename.endsWith('.mp4')).length;
    const imageCount = finalResults.length - videoCount;

    // DETAILED LOGGING as requested by User
    window.Utils.Logger.log(`[Scanner] 📦 [フィルタ後] ダウンロード対象(${filterType}) メディア数: ${finalResults.length}`);
    window.Utils.Logger.log(`[Scanner] 📹 DL予定 動画: ${videoCount}`);
    window.Utils.Logger.log(`[Scanner] 🖼️ DL予定 静止画: ${imageCount}`);

    return finalResults;
  },

  async scan(type) {
    console.warn('MediaScanner.scan is deprecated.');
    return [];
  },

  async unsaveAll() {
    return this.unsaveAllLegacy(); // Keeping legacy name internal if needed
  },

  /**
   * Unfavorites all items found on the page
   */
  async unsaveAllLegacy() {
    console.log('[Scanner] Starting unsave sweep...');

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
            await window.Utils.sleep(300); // Wait for UI update
          } catch (e) { }
        }

        // 2. API Fallback (Only if we can identify the ID and haven't clicked)
        const postData = window.Utils.extractPostDataFromElement(card);
        if (postData && postData.id && !processedIds.has(postData.id)) {
          processedIds.add(postData.id);
          // If button click didn't happen (or failed), try API logic
          // But note: if button clicked, we still add ID to processed to avoid double counting
          if (!clicked) {
            await window.Api.unlikePost(postData.id);
            actedOnThisTurn++;
            totalProcessed++;
            await window.Utils.sleep(window.CONFIG.UNFAVORITE_DELAY_MS || 200);
          }
        }

        window.ProgressModal.update(Math.min(98, totalProcessed * 2), `Unfavorited ${totalProcessed} items...`);
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
