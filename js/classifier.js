/**
 * Grok Imagine Favorites Manager - Item Classifier
 */

var ItemClassifier = {
  TYPES: {
    STATIC_IMAGE: 'STATIC_IMAGE',
    VIDEO_COMPLEX: 'VIDEO_COMPLEX'
  },

  /**
   * Classifies a media card based on its DOM structure
   */
  classify(card, index = '?') {
    const img = card.querySelector(window.SELECTORS.IMAGE);
    const video = card.querySelector(window.SELECTORS.VIDEO);

    // Improved Play Icon Detection: Check for specific path data common in play buttons or aria-labels
    const playIcon = card.querySelector(window.SELECTORS.PLAY_ICON) ||
      card.querySelector('svg path[d^="M8 5v14l11-7z"]') || // Common play icon path
      card.querySelector('svg path[d^="M3 22v-20l18 10-18 10z"]'); // Another common play icon path

    // Improved Duration Detection: Check all text content for time format
    const cardText = card.innerText || "";
    const hasDuration = /\d+:\d+/.test(cardText);

    // Classification Logic:
    // If it has a video tag, play icon, OR duration text, it is likely a video/complex item.
    // We default to COMPLEX if there's any ambiguity to ensure we don't miss a video.
    const isVideoLike = !!video || !!playIcon || hasDuration;

    // It is a STATIC_IMAGE only if it has an image and NO video indicators.
    const isStrictlyImage = !!img && !isVideoLike;

    const classification = isStrictlyImage ? this.TYPES.STATIC_IMAGE : this.TYPES.VIDEO_COMPLEX;

    // Debug logging for classification decisions (Helpful for user reports)
    // console.log(`[Classifier] Item ${index}: ${classification}`, { hasImage: !!img, isVideoLike, hasDuration, hasPlayIcon: !!playIcon });

    return {
      type: classification,
      details: {
        hasImage: !!img,
        hasVideo: !!video,
        hasPlayIcon: !!playIcon,
        hasDuration: hasDuration
      }
    };
  }
};

window.ItemClassifier = ItemClassifier;
