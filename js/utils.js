/**
 * Grok Imagine Favorites Manager - Utilities
 */

var Utils = {
  /**
   * Logger utility to control debug output
   */
  Logger: {
    DEBUG_MODE: false, // Set to true to enable detailed debug logs
    log(...args) {
      if (this.DEBUG_MODE) console.log(...args);
    },
    warn(...args) {
      if (this.DEBUG_MODE) console.warn(...args);
    },
    error(...args) {
      console.error(...args); // Errors should usually still be logged
    }
  },

  /**
   * Extract UUID from a URL
   */
  extractPostId(url) {
    if (!url) return null;
    // 1. Priority: Look for ID after specific path markers
    const pathMatch = url.match(/\/(?:generated|post|status|imagine\/post)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (pathMatch && pathMatch[1]) return pathMatch[1].toLowerCase();

    // 2. Fallback: Get ALL UUIDs and pick the LAST one (Assets URLs: /users/[UserID]/generated/[PostID]/...)
    const allMatches = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig);
    if (allMatches && allMatches.length > 0) {
      return allMatches[allMatches.length - 1].toLowerCase();
    }
    return null;
  },

  /**
   * Deep search React props for a Post UUID
   */
  findUUIDinProps(obj, depth = 0) {
    if (depth > 5 || !obj) return null;
    if (typeof obj === 'string') {
      const urlMatch = obj.match(/\/(?:post|status|imagine\/post)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (urlMatch) return urlMatch[1].toLowerCase();
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
          const res = this.findUUIDinProps(obj[k], depth + 1);
          if (res) return res;
        } catch (e) { }
      }
    }
    return null;
  },

  /**
   * Extract Post Data {id, url, isFallback} from a card element
   */
  extractPostDataFromElement(element) {
    try {
      if (!element) return null;

      let current = element;
      let searchedElements = [current];

      // Strategy 0: Direct React Fiber State Extraction (Ultimate solution for SPA)
      // Sometimes the base64 image or video is deeply nested inside a container,
      // and the React element that holds the postId is far up the tree.
      // NOTE: Chrome Extension Isolated World prevents content scripts from reading React propertes.
      // So scanner.js injects a script into the MAIN world, which sets the ID to a data attribute.
      try {
        if (element.hasAttribute && element.hasAttribute('data-grok-extracted-id')) {
          const id = element.getAttribute('data-grok-extracted-id');
          if (id && id.length >= 36) {
            return {
              id: id.toLowerCase(),
              url: `${window.location.origin}/imagine/post/${id.toLowerCase()}`,
              strategy: 'React Fiber State (MAIN World Injection)',
              isFallback: false
            };
          }
        }
      } catch (err) {
        console.debug('[Utils] React Fiber extraction via data attribute failed:', err);
      }

      // Collect the element and its ancestors (up to 15 levels) to handle deep bottom-up search
      for (let i = 0; i < 15; i++) {
        if (current.parentElement) {
          current = current.parentElement;
          searchedElements.push(current);

          // Stop climbing if we hit a distinct item boundary to prevent stealing neighboring IDs
          if (current.getAttribute && current.getAttribute('role') === 'listitem') break;
          if (current.className && typeof current.className === 'string' && current.className.includes('masonry-card')) break;
        } else {
          break;
        }
      }

      // Strategy 1: Find an 'A' tag among the element or its ancestors
      for (const el of searchedElements) {
        if (el.tagName === 'A' && el.href && !el.href.includes('/profile/')) {
          const match = el.href.match(/\/(?:post|status|imagine\/post)\/([0-9a-f-]{36}|[0-9a-f]{8,})/i);
          if (match) {
            const uuid = match[1].toLowerCase();
            return {
              id: uuid,
              url: el.href,
              strategy: 'Ancestor A-Tag',
              isFallback: false
            };
          }
        }
      }

      // Strategy 2: Search for A tags INSIDE the element (if it's a container)
      const links = element.querySelectorAll ? element.querySelectorAll('a') : [];
      for (const link of links) {
        if (!link.href || link.href.includes('/profile/')) continue;
        const match = link.href.match(/\/(?:post|status|imagine\/post)\/([0-9a-f-]{36}|[0-9a-f]{8,})/i);
        if (match) {
          const uuid = match[1].toLowerCase();
          return {
            id: uuid,
            url: link.href,
            strategy: 'Inner A-Tag',
            isFallback: false
          };
        }
      }

      // Strategy 3: Check the element itself if it's an image
      if (element.tagName === 'IMG' && element.src) {
        const id = this.extractPostId(element.src);
        if (id) {
          return { id, url: `${window.location.origin}/imagine/post/${id}`, strategy: 'Self IMG Tag', isFallback: true };
        }
      }

      // Strategy 4: Check if element has an image inside it
      const img = element.querySelector ? element.querySelector(window.SELECTORS.IMAGE) : null;
      if (img && img.src) {
        const id = this.extractPostId(img.src);
        if (id) {
          return { id, url: `${window.location.origin}/imagine/post/${id}`, strategy: 'Inner IMG Tag', isFallback: true };
        }
      }

      // Strategy 5: Ultra fallback: innerHTML of the topmost ancestor we found
      const topContainer = searchedElements[searchedElements.length - 1];
      const html = topContainer.innerHTML || topContainer.outerHTML || "";
      const match = html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (match) {
        const id = match[0].toLowerCase();
        console.debug(`[Utils] 🚨 Using ultra fallback ID from innerHTML: ${id}`);
        return {
          id,
          url: `${window.location.origin}/imagine/post/${id}`,
          strategy: 'HTML Regex Fallback',
          isFallback: true
        };
      }

      return null;
    } catch (e) {
      console.error('[Utils] Error extracting data from element:', e);
      return null;
    }
  },

  /**
   * Sleep for specified duration
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};

window.Utils = Utils;
