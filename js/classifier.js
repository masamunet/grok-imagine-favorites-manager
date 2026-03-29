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

    // User Requirement: Check ONLY if the thumbnail is a video (has video tag).
    // Icons, text, duration are ignored.
    const isVideo = !!video;

    // It is a STATIC_IMAGE only if it has an image and is NOT a video.
    const isStrictlyImage = !!img && !isVideo;

    const classification = isStrictlyImage ? this.TYPES.STATIC_IMAGE : this.TYPES.VIDEO_COMPLEX;

    // Debug logging for classification decisions
    if (window.Utils) window.Utils.Logger.log(`[Classifier] Item ${index}:`, {
      classification,
      indicators: {
        hasVideoTag: !!video,
        cardTextShort: (card.innerText || "").substring(0, 20) + '...'
      }
    });

    return {
      type: classification,
      details: {
        hasImage: !!img,
        hasVideo: !!video
      }
    };
  }
};

window.ItemClassifier = ItemClassifier;
