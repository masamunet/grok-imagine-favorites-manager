# Grok Imagine Favorites Manager

A modern Chrome extension to download and manage your favorited Grok Imagine images and videos.

<img width="335" height="559" alt="grok-imagine-favorites-manager" src="https://github.com/user-attachments/assets/df849e4b-e1b2-4bb3-bba4-97d53fe1087d" />

## Features

- Download all images and/or videos from your favorites
- Unfavorite items with both images and videos
- Automatic filename matching (videos use image names)

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the folder containing this extension
5. Pin the extension to your toolbar for easy access

## Usage

1. Navigate to https://grok.com/imagine/favorites
2. Log in and scroll to load all your favorites
3. Click the extension icon
4. Choose your desired action

### Available Actions

**Download:**
- **Download All Media** - Downloads both images and videos (videos named to match images)
- **Download Images Only** - Downloads only images
- **Download Videos Only** - Downloads only videos (named to match images)

**Manage:**
- **Unfavorite (Items with Images & Videos)** - Removes favorites that have both image and video formats

## Files

- `manifest.json` - Extension configuration
- `popup.html` - Extension popup UI
- `popup.js` - Popup logic and event handlers
- `content.js` - Page interaction and media extraction
- `background.js` - Download management and rate limiting

## Downloads Location

Files are saved to your default Chrome downloads folder in a `grok-imagine/` subdirectory.

Videos are automatically named to match their corresponding image files (using the image UUID/filename).

## Technical Details

- Downloads are rate-limited to 1 per second to avoid issues
- Unfavorite actions are staggered at 300ms intervals
- Progress tracking updates in real-time via Chrome storage API
- Content script runs on all /imagine/* pages

## Important Notes

- The extension only works on https://grok.com/imagine/favorites
- Make sure to scroll down to load all favorites before downloading
- Video filenames automatically match their corresponding image names for easy pairing
- Keep the tab open while unfavoriting to allow all actions to complete
- **Only items with BOTH images and videos can be unfavorited** (image-only items don't have unfavorite buttons on Grok's main favorites page)
- Check browser console (F12) for detailed logs during unfavorite operations

## Support

This extension is designed specifically for Grok Imagine favorites management. If the Grok website structure changes, selectors may need updating.
