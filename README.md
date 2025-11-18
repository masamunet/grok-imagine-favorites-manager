# Grok Imagine Favorites Manager

A modern Chrome extension to download and manage your favorited Grok Imagine images and videos.

<img width="339" height="597" alt="Screenshot 2025-11-17 at 10 47 06 AM" src="https://github.com/user-attachments/assets/1e41fc40-7bda-4be1-b959-ca9b66d44c2d" />

<img width="408" height="257" alt="Screenshot 2025-11-17 at 10 23 38 AM" src="https://github.com/user-attachments/assets/51ac09e1-8973-4cf3-a5e7-034677b62cdf" />

## ⚠️ Disclaimer

**Grok Imagine is constantly evolving and changing.** This extension may break or require updates as Grok's interface and API endpoints change. Use at your own risk and be prepared for potential issues as the platform updates.

## Features

- Download all images and/or videos from your favorites with automatic scrolling
- Upscale standard videos to HD quality with fast parallel requests
- Unfavorite items selectively (videos, images, or both)
- Automatic filename matching (videos use image names)
- On-screen progress modal with live updates
- Cancel operations at any time
- API-based unfavoriting for reliability

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the folder containing this extension
5. Pin the extension to your toolbar for easy access

## Usage

1. Log in to your account
2. Navigate to https://grok.com/imagine/favorites
3. Click the extension icon
4. Choose your desired action

The extension will automatically scroll and load all favorites before processing.

### Available Actions

**Download:**
- **Download All Media** - Downloads both images and videos (videos named to match images)
- **Download Images Only** - Downloads only images
- **Download Videos Only** - Downloads only videos (named to match images)

*Note: Video downloads only capture the most recently generated video. If you've regenerated a video multiple times, only the latest version will be downloaded.*

**Video Tools:**
- **Upscale Videos to HD** - Requests upscaling for all standard videos to HD quality (requests are staggered and complete in background)

*Note: Upscaling only applies to the most recently generated video. Previous video versions cannot be upscaled through this tool.*

<img width="405" height="253" alt="Screenshot 2025-11-17 at 11 38 04 AM" src="https://github.com/user-attachments/assets/f32d2142-9bb5-46ee-ae6c-801c98d4996f" />

**Manage:**
- **Unfavorite (Images & Videos)** - Removes favorites that have both image and video formats
- **Unfavorite (Images Only)** - Removes favorites that only have images (no video)
- **Unfavorite (Videos Only)** - Removes all favorites that have videos (with or without images)

**Utilities:**
- **Cancel Current Operation** - Stops any running download or unfavorite operation
- **Open Downloads Folder** - Opens Chrome downloads page
- **Open Download Settings** - Opens Chrome download settings

## Files

- `manifest.json` - Extension configuration
- `popup.html` - Extension popup UI
- `popup.js` - Popup logic and event handlers
- `content.js` - Page interaction, media extraction, and unfavorite operations
- `background.js` - Download management and rate limiting

## Downloads Location

Files are saved to your default Chrome downloads folder in a `grok-imagine/` subdirectory.

Videos are automatically named to match their corresponding image files (using the image UUID/filename).

## Technical Details

- Downloads are rate-limited to approximately 3 per second to avoid browser issues
- Unfavorite requests are delayed by 150ms between calls
- Upscale requests are staggered with 300ms delays and run in parallel
- Progress tracking displays in an on-screen modal with visual progress bar
- Content script automatically scrolls to load all lazy-loaded content
- Virtual scrolling is handled by collecting items during scroll process
- Operations support cancellation at any point

## Important Notes

- **⚠️ Grok Imagine is constantly changing** - This extension may break with platform updates
- The extension works on https://grok.com/imagine/favorites
- No manual scrolling needed - the extension handles it automatically
- Video filenames automatically match their corresponding image names for easy pairing
- **Only the most recently generated video is processed** - Earlier video versions are not accessible
- Keep the tab open while operations run to ensure completion
- Progress is shown in an on-screen modal with cancellation option
- Unfavorite operations work by calling `/rest/media/post/unlike` with the post id
- Upscale requests are sent to `/rest/media/video/upscale` and complete in the background
- Refresh the page after a few minutes to see newly upscaled HD videos
- Check browser console (F12) for detailed logs during operations

## Progress Tracking

The extension shows a gradient progress modal on the page with:
- Operation name and current status
- Visual progress bar
- Real-time count of processed items
- Cancel button to stop the operation

## Support

This extension is designed specifically for Grok Imagine favorites management. **The Grok platform is actively developed and frequently changes.** If features stop working, the extension will need updates to match new DOM structures, API endpoints, or workflows. Check the repository for updates or open an issue if you encounter problems.
