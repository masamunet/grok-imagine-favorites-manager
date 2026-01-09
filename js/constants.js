/**
 * Grok Imagine Favorites Manager - Constants
 */

var SELECTORS = {
  CARD: '.group\\/media-post-masonry-card',
  IMAGE: 'img[alt*="Generated"]',
  VIDEO: 'video, [data-testid="video-player"], .video-js',
  PLAY_ICON: 'svg[data-icon="play"], svg[data-icon="play-fill"], [aria-label*="Play"], .fa-play',
  LIST_ITEM: '[role="listitem"]'
};

var CONFIG = {
  SCROLL_ATTEMPTS: 3,
  SCROLL_DELAY_MS: 1000,
  ANALYSIS_DELAY_MS: 1000,
  MAX_WAIT_FOR_TAB_MS: 15000
};

// Export-like pattern for content scripts
window.SELECTORS = SELECTORS;
window.CONFIG = CONFIG;
