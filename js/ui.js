/**
 * Grok Imagine Favorites Manager - UI
 */

var ProgressModal = {
  modal: null,
  cancelled: false,
  // Cached DOM references — set once in create(), avoids getElementById on every update
  _barEl: null,
  _detailsEl: null,
  _substatusEl: null,
  _titleEl: null,
  _subtitleEl: null,
  _cancelBtnEl: null,
  _lastProgress: -1,

  create() {
    if (this.modal) return;

    this.modal = document.createElement('div');
    this.modal.id = 'grok-favorites-progress-modal';
    this.modal.innerHTML = `
      <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.4); z-index: 999999; display: flex; align-items: center; justify-content: center; font-family: -apple-system, system-ui, sans-serif; pointer-events: none;">
        <div style="background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 16px; padding: 32px; min-width: 400px; max-width: 500px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5); pointer-events: auto;">
          <div style="font-size: 20px; font-weight: 600; color: #e5e5e5; margin-bottom: 8px;" id="grok-progress-title">Processing...</div>
          <div style="font-size: 14px; color: #888; margin-bottom: 20px;" id="grok-progress-subtitle">Please wait</div>
          <div style="background: #0a0a0a; border-radius: 8px; height: 8px; overflow: hidden; margin-bottom: 16px;">
            <div style="background: linear-gradient(90deg, #3b82f6, #8b5cf6); height: 100%; width: 0%; transition: width 0.3s ease; border-radius: 8px;" id="grok-progress-bar"></div>
          </div>
          <div style="font-size: 13px; color: #a0a0a0; line-height: 1.6; margin-bottom: 12px;" id="grok-progress-details">Starting...</div>
          <div style="font-size: 12px; color: #60a5fa; margin-bottom: 16px; min-height: 16px;" id="grok-progress-substatus"></div>
          <div style="background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.2); border-radius: 6px; padding: 8px 12px; margin-bottom: 16px; color: #fbbf24; font-size: 12px;">
             ⚠️ Operations may open background tabs. Do not close them manually.
          </div>
          <button id="grok-cancel-button" style="width: 100%; padding: 10px 16px; background: #2a1a1a; border: 1px solid #4a2a2a; border-radius: 8px; color: #ff6b6b; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.15s ease;">
            Cancel Operation
          </button>
        </div>
      </div>`;

    document.body.appendChild(this.modal);

    // Cache all DOM references once
    this._barEl = document.getElementById('grok-progress-bar');
    this._detailsEl = document.getElementById('grok-progress-details');
    this._substatusEl = document.getElementById('grok-progress-substatus');
    this._titleEl = document.getElementById('grok-progress-title');
    this._subtitleEl = document.getElementById('grok-progress-subtitle');
    this._cancelBtnEl = document.getElementById('grok-cancel-button');
    this._cancelBtnEl.addEventListener('click', () => this.cancel());
  },

  show(title, subtitle = '') {
    this.cancelled = false;
    this._lastProgress = -1;
    this.create();
    this.modal.style.display = 'flex';
    if (this._titleEl) this._titleEl.textContent = title;
    if (this._subtitleEl) this._subtitleEl.textContent = subtitle;
    if (this._barEl) this._barEl.style.width = '0%';
    if (this._detailsEl) this._detailsEl.textContent = 'Starting...';
    if (this._substatusEl) this._substatusEl.textContent = '';

    if (this._cancelBtnEl) {
      this._cancelBtnEl.textContent = 'Cancel Operation';
      this._cancelBtnEl.disabled = false;
      this._cancelBtnEl.style.opacity = '1';
    }
  },

  update(progress, details) {
    if (!this.modal) return;
    const percentage = Math.min(100, Math.max(0, progress));
    // Throttle: skip DOM write if progress hasn't changed by at least 1%
    if (Math.abs(percentage - this._lastProgress) < 1 && this._detailsEl && this._detailsEl.textContent === details) return;
    this._lastProgress = percentage;
    if (this._barEl) this._barEl.style.width = `${percentage}%`;
    if (this._detailsEl) this._detailsEl.textContent = details;
  },

  updateSubStatus(text) {
    if (!this.modal) return;
    if (this._substatusEl) this._substatusEl.textContent = text;
  },

  cancel() {
    this.cancelled = true;
    this.update(0, 'Cancelling operation...');
    if (this._cancelBtnEl) {
      this._cancelBtnEl.textContent = 'Cancelling...';
      this._cancelBtnEl.disabled = true;
      this._cancelBtnEl.style.opacity = '0.5';
    }
    setTimeout(() => this.remove(), 1000);
  },

  isCancelled() {
    return this.cancelled;
  },

  hide() {
    if (this.modal) this.modal.style.display = 'none';
  },

  remove() {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
      // Clear cached references
      this._barEl = null;
      this._detailsEl = null;
      this._substatusEl = null;
      this._titleEl = null;
      this._subtitleEl = null;
      this._cancelBtnEl = null;
      this._lastProgress = -1;
    }
  }
};

window.ProgressModal = ProgressModal;
