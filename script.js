/**
 * Grist Image Map Widget
 * Modernized, ES6+, Full Support for Grist Attachment Uploads and Custom Styling.
 */

// =============================================================================
// Application State
// =============================================================================
const AppState = {
  // Grist Data
  records: [],
  selectedRecordId: null,
  columnMapping: null,
  
  // Image State
  currentImageSource: null,
  currentImageAttachmentId: null,
  currentImageUrl: null,
  availableImages: new Map(), // key -> { id, label, type: 'attachment' | 'url', value }
  
  // Interaction Mode: 'select' | 'move' | 'add-pin'
  interactionMode: 'select',
  
  // Settings
  settings: {
    moveEnabled: false,
    scrollIntoView: true,
    showDetails: true,
    filterByImage: true,
    gridSnap: 1,
    theme: 'dark'
  },

  // Token cache
  tokenInfo: null,
  tokenExpiry: 0,
  isGristConnected: false
};

// =============================================================================
// Viewport Engine (Pan, Zoom, Coordinate Transformations)
// =============================================================================
class ViewportEngine {
  constructor(viewportEl, canvasEl, imageEl) {
    this.viewportEl = viewportEl;
    this.canvasEl = canvasEl;
    this.imageEl = imageEl;

    this.panX = 0;
    this.panY = 0;
    this.scale = 1;

    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;

    this.touchDistance = null;

    this.initEvents();
  }

  initEvents() {
    // Mouse Pan on Viewport
    this.viewportEl.addEventListener('mousedown', (e) => {
      // Ignore if clicking on UI controls (HUD, modals, cards) or directly on a marker
      if (e.target.closest('.floating-hud, .details-card, .settings-modal, .marker-item, .demo-banner, .toast-container')) {
        return;
      }

      e.preventDefault();

      if (AppState.interactionMode === 'add-pin') {
        const coords = this.screenToImage(e.clientX, e.clientY);
        GristManager.addPinAt(coords.x, coords.y);
        return;
      }

      // Start panning (left click or middle click)
      if (e.button === 0 || e.button === 1) {
        this.isPanning = true;
        this.panStartX = e.clientX - this.panX;
        this.panStartY = e.clientY - this.panY;
        this.viewportEl.classList.add('panning');
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.panX = e.clientX - this.panStartX;
        this.panY = e.clientY - this.panStartY;
        this.applyTransform();
      }

      // Update cursor coordinates display
      const coords = this.screenToImage(e.clientX, e.clientY);
      const coordsBadge = document.getElementById('cursorCoordinates');
      if (coordsBadge) {
        coordsBadge.textContent = `X: ${Math.round(coords.x)}, Y: ${Math.round(coords.y)}`;
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false;
        this.viewportEl.classList.remove('panning');
      }
    });

    // Mouse Wheel Zoom (Directed at mouse pointer)
    this.viewportEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.viewportEl.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.15 : (1 / 1.15);
      this.zoomAtPoint(mouseX, mouseY, zoomFactor);
    }, { passive: false });

    // Touch Support for mobile / trackpads
    this.viewportEl.addEventListener('touchstart', (e) => {
      if (e.target.closest('.floating-hud, .details-card, .settings-modal, .marker-item, .demo-banner, .toast-container')) {
        return;
      }

      if (AppState.interactionMode === 'add-pin') {
        if (e.touches.length === 1) {
          const touch = e.touches[0];
          const coords = this.screenToImage(touch.clientX, touch.clientY);
          GristManager.addPinAt(coords.x, coords.y);
        }
        return;
      }

      if (e.touches.length === 1) {
        const touch = e.touches[0];
        this.isPanning = true;
        this.panStartX = touch.clientX - this.panX;
        this.panStartY = touch.clientY - this.panY;
      } else if (e.touches.length === 2) {
        this.isPanning = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this.touchDistance = Math.hypot(dx, dy);
      }
    }, { passive: true });

    this.viewportEl.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && this.isPanning) {
        const touch = e.touches[0];
        this.panX = touch.clientX - this.panStartX;
        this.panY = touch.clientY - this.panStartY;
        this.applyTransform();
      } else if (e.touches.length === 2 && this.touchDistance) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const newDist = Math.hypot(dx, dy);
        const factor = newDist / this.touchDistance;
        this.touchDistance = newDist;

        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = this.viewportEl.getBoundingClientRect();
        this.zoomAtPoint(midX - rect.left, midY - rect.top, factor);
      }
    }, { passive: true });

    this.viewportEl.addEventListener('touchend', () => {
      this.isPanning = false;
      this.touchDistance = null;
    });

    // Resize Observer to re-center when window or widget dimensions change
    window.addEventListener('resize', () => {
      this.updateZoomBadge();
    });
  }

  zoomAtPoint(pivotX, pivotY, factor) {
    const minScale = 0.05;
    const maxScale = 20.0;
    const oldScale = this.scale;
    const newScale = Math.min(Math.max(oldScale * factor, minScale), maxScale);

    // Keep point invariant under the pivot
    this.panX = pivotX - (pivotX - this.panX) * (newScale / oldScale);
    this.panY = pivotY - (pivotY - this.panY) * (newScale / oldScale);
    this.scale = newScale;

    this.applyTransform();
  }

  zoomIn() {
    const rect = this.viewportEl.getBoundingClientRect();
    this.zoomAtPoint(rect.width / 2, rect.height / 2, 1.25);
  }

  zoomOut() {
    const rect = this.viewportEl.getBoundingClientRect();
    this.zoomAtPoint(rect.width / 2, rect.height / 2, 0.8);
  }

  resetZoom() {
    this.scale = 1;
    const rect = this.viewportEl.getBoundingClientRect();
    const imgW = this.imageEl.naturalWidth || this.imageEl.width || 800;
    const imgH = this.imageEl.naturalHeight || this.imageEl.height || 600;

    this.panX = (rect.width - imgW) / 2;
    this.panY = (rect.height - imgH) / 2;
    this.applyTransform(true);
  }

  fitToScreen() {
    const imgW = this.imageEl.naturalWidth || this.imageEl.width;
    const imgH = this.imageEl.naturalHeight || this.imageEl.height;
    if (!imgW || !imgH) return;

    const vpW = this.viewportEl.clientWidth;
    const vpH = this.viewportEl.clientHeight;
    const margin = 32;

    const availableW = Math.max(vpW - margin * 2, 100);
    const availableH = Math.max(vpH - margin * 2, 100);

    const scaleX = availableW / imgW;
    const scaleY = availableH / imgH;
    this.scale = Math.min(scaleX, scaleY, 2.0);

    this.panX = (vpW - imgW * this.scale) / 2;
    this.panY = (vpH - imgH * this.scale) / 2;

    this.applyTransform(true);
  }

  panTo(imageX, imageY, smooth = true) {
    const vpW = this.viewportEl.clientWidth;
    const vpH = this.viewportEl.clientHeight;

    this.panX = vpW / 2 - imageX * this.scale;
    this.panY = vpH / 2 - imageY * this.scale;

    this.applyTransform(smooth);
  }

  screenToImage(clientX, clientY) {
    const rect = this.viewportEl.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    return {
      x: (mouseX - this.panX) / this.scale,
      y: (mouseY - this.panY) / this.scale
    };
  }

  applyTransform(smooth = false) {
    if (smooth) {
      this.canvasEl.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
      setTimeout(() => {
        this.canvasEl.style.transition = '';
      }, 320);
    } else {
      this.canvasEl.style.transition = '';
    }

    this.canvasEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    this.updateZoomBadge();
  }

  updateZoomBadge() {
    const badge = document.getElementById('zoomLevelBadge');
    if (badge) {
      badge.textContent = `${Math.round(this.scale * 100)}%`;
    }
  }

  setImage(src, onLoadCallback) {
    if (!src) {
      this.imageEl.src = '';
      document.getElementById('emptyState').classList.remove('hidden');
      return;
    }

    document.getElementById('emptyState').classList.add('hidden');
    this.imageEl.onload = () => {
      this.fitToScreen();
      if (onLoadCallback) onLoadCallback();
    };
    this.imageEl.onerror = () => {
      showToast('Failed to load image from source', 'error');
    };
    this.imageEl.src = src;
  }
}

let Viewport = null;

// =============================================================================
// Grist Service (Grist Plugin API & Attachment Management)
// =============================================================================
const GristManager = {
  async init() {
    if (typeof grist === 'undefined') {
      console.warn("Grist Plugin API not found. Activating Standalone Demo Mode.");
      StandaloneDemo.init();
      return;
    }

    // Configure required columns in Grist
    grist.ready({
      requiredAccess: 'full',
      columns: [
        { name: 'Title', title: 'Label / Title', type: 'Text', optional: false, description: 'Text label for marker' },
        { name: 'X', title: 'X Position', type: 'Numeric', optional: false, description: 'X pixel coordinate on image' },
        { name: 'Y', title: 'Y Position', type: 'Numeric', optional: false, description: 'Y pixel coordinate on image' },
        { name: 'bgImageAttachment', title: 'Background Image (Attachment)', type: 'Attachments', optional: true, description: 'Uploaded image file' },
        { name: 'bgImage', title: 'Background Image (URL)', type: 'Text', optional: true, description: 'Fallback image URL' },
        { name: 'fontSize', title: 'Font Size', type: 'Numeric', optional: true, description: 'Font size in px' },
        { name: 'bgColor', title: 'Badge Background Color', type: 'Text', optional: true, description: 'Badge color (e.g. #3b82f6)' },
        { name: 'fgColor', title: 'Badge Text Color', type: 'Text', optional: true, description: 'Badge text color (e.g. #ffffff)' },
        { name: 'details', title: 'Details', allowMultiple: true, optional: true, description: 'Additional details columns' },
      ],
      onEditOptions: () => {
        UI.toggleSettings(true);
      }
    });

    // Listen to Grist Events
    grist.onRecord(this.onRecordHandler.bind(this));
    grist.onRecords(this.onRecordsHandler.bind(this));
    grist.onOptions(this.onOptionsHandler.bind(this));

    // Fallback timer: if no records received after 1.5 seconds and running outside iframe, load demo
    setTimeout(() => {
      if (!AppState.isGristConnected && window.self === window.top) {
        StandaloneDemo.init();
      }
    }, 1500);
  },

  async getAccessToken(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && AppState.tokenInfo && now < AppState.tokenExpiry) {
      return AppState.tokenInfo;
    }

    try {
      const tokenInfo = await grist.docApi.getAccessToken({ readOnly: true });
      AppState.tokenInfo = tokenInfo;
      AppState.tokenExpiry = now + 45 * 60 * 1000; // 45 min cache
      return tokenInfo;
    } catch (err) {
      console.warn("Could not get Grist access token:", err);
      return null;
    }
  },

  /**
   * Robust parser for Grist Attachment IDs.
   * Grist stores attachments as ['L', id1, id2] or [id1, id2] or single integer.
   */
  parseAttachmentIds(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value
        .filter(item => typeof item === 'number' || (!isNaN(Number(item)) && item !== 'L'))
        .map(Number);
    }
    if (typeof value === 'number') return [value];
    if (typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '') {
      return [Number(value)];
    }
    return [];
  },

  async getAttachmentDownloadUrl(attachmentId) {
    if (!attachmentId) return null;
    const tokenInfo = await this.getAccessToken();
    if (!tokenInfo || !tokenInfo.baseUrl || !tokenInfo.token) return null;
    return `${tokenInfo.baseUrl}/attachments/${attachmentId}/download?auth=${encodeURIComponent(tokenInfo.token)}`;
  },

  async onRecordHandler(recordRaw, mappings) {
    AppState.isGristConnected = true;
    if (!recordRaw) return;

    AppState.columnMapping = mappings;
    const record = grist.mapColumnNames(recordRaw);
    if (!record) return;

    AppState.selectedRecordId = recordRaw.id;

    // Highlight selected marker
    MarkerManager.setSelected(recordRaw.id);

    // Auto pan if enabled
    if (AppState.settings.scrollIntoView && record.X !== undefined && record.Y !== undefined) {
      Viewport.panTo(Number(record.X), Number(record.Y), true);
    }

    // Determine background image from this record
    await this.resolveRecordImage(record);
  },

  async onRecordsHandler(recordsRaw, mappings) {
    AppState.isGristConnected = true;
    AppState.columnMapping = mappings;

    AppState.records = recordsRaw.map(raw => {
      const mapped = grist.mapColumnNames(raw) || {};
      return {
        id: raw.id,
        _raw: raw,
        ...mapped
      };
    });

    // Populate available images map for multi-image switching
    await this.scanAvailableImages();

    // Render markers
    MarkerManager.render();

    // If no active image is currently set, pick default or first image
    if (!AppState.currentImageSource) {
      await this.pickInitialImage();
    }
  },

  onOptionsHandler(options) {
    if (options && typeof options === 'object') {
      Object.assign(AppState.settings, options);
      UI.syncSettingsUI();
      MarkerManager.render();
    }
  },

  async scanAvailableImages() {
    AppState.availableImages.clear();

    for (const record of AppState.records) {
      // Check attachment column
      const attachmentIds = this.parseAttachmentIds(record.bgImageAttachment);
      if (attachmentIds.length > 0) {
        const id = attachmentIds[0];
        const key = `attachment_${id}`;
        if (!AppState.availableImages.has(key)) {
          const downloadUrl = await this.getAttachmentDownloadUrl(id);
          AppState.availableImages.set(key, {
            id,
            key,
            label: `Attachment #${id} (${record.Title || 'Image'})`,
            type: 'attachment',
            url: downloadUrl
          });
        }
      }

      // Check URL column
      if (record.bgImage && typeof record.bgImage === 'string' && record.bgImage.trim() !== '') {
        const url = record.bgImage.trim();
        const key = `url_${url}`;
        if (!AppState.availableImages.has(key)) {
          AppState.availableImages.set(key, {
            id: url,
            key,
            label: `URL: ${record.Title || url.substring(url.lastIndexOf('/') + 1) || 'Image'}`,
            type: 'url',
            url: url
          });
        }
      }
    }

    UI.updateImageSwitcher();
  },

  async resolveRecordImage(record) {
    let newImageUrl = null;
    let newAttachmentId = null;

    // Check attachment column first
    const attachmentIds = this.parseAttachmentIds(record.bgImageAttachment);
    if (attachmentIds.length > 0) {
      newAttachmentId = attachmentIds[0];
      newImageUrl = await this.getAttachmentDownloadUrl(newAttachmentId);
    } else if (record.bgImage && record.bgImage.trim() !== '') {
      newImageUrl = record.bgImage.trim();
    }

    if (newImageUrl && newImageUrl !== AppState.currentImageSource) {
      this.setActiveImage(newImageUrl, newAttachmentId, newImageUrl);
    }
  },

  async pickInitialImage() {
    // 1. Query parameter ?backgroundImage=
    const params = new URLSearchParams(window.location.search);
    const paramImage = params.get('backgroundImage');
    if (paramImage) {
      this.setActiveImage(paramImage, null, paramImage);
      return;
    }

    // 2. First image from available images
    if (AppState.availableImages.size > 0) {
      const first = AppState.availableImages.values().next().value;
      this.setActiveImage(first.url, first.type === 'attachment' ? first.id : null, first.url);
      return;
    }

    // 3. Fallback to empty state
    Viewport.setImage(null);
  },

  setActiveImage(url, attachmentId = null, sourceKey = null) {
    AppState.currentImageSource = url;
    AppState.currentImageAttachmentId = attachmentId;
    AppState.currentImageUrl = sourceKey;

    Viewport.setImage(url, () => {
      MarkerManager.filterMarkersByImage();
    });

    UI.syncImageSwitcherSelect();
  },

  async updateCoordinates(recordId, x, y) {
    const snap = parseInt(AppState.settings.gridSnap, 10) || 1;
    const snappedX = Math.round(x / snap) * snap;
    const snappedY = Math.round(y / snap) * snap;

    // Update in-memory record for instant feedback
    const record = AppState.records.find(r => r.id === Number(recordId));
    if (record) {
      record.X = snappedX;
      record.Y = snappedY;
      if (AppState.selectedRecordId === record.id) {
        UI.showDetailsCard(record);
      }
    }

    if (!AppState.isGristConnected || !AppState.columnMapping) {
      showToast(`Position updated: (${snappedX}, ${snappedY})`);
      return;
    }

    const xCol = AppState.columnMapping['X'] || 'X';
    const yCol = AppState.columnMapping['Y'] || 'Y';

    try {
      await grist.selectedTable.updateRecords({
        [xCol]: [snappedX],
        [yCol]: [snappedY]
      }, [Number(recordId)]);

      showToast(`Position saved: (${snappedX}, ${snappedY})`);
    } catch (err) {
      console.error("Failed to update coordinates in Grist:", err);
      showToast("Failed to save coordinates to Grist", "error");
    }
  },

  async selectRowInGrist(recordId) {
    if (!AppState.isGristConnected) return;
    try {
      await grist.setCursorPos({ rowId: Number(recordId) });
    } catch (e) {
      try {
        await grist.setSelectedRows([Number(recordId)]);
      } catch (err) {
        console.debug("Could not select row in Grist:", err);
      }
    }
  },

  async addPinAt(imageX, imageY) {
    const snap = parseInt(AppState.settings.gridSnap, 10) || 1;
    const snappedX = Math.round(imageX / snap) * snap;
    const snappedY = Math.round(imageY / snap) * snap;

    if (!AppState.isGristConnected || !AppState.columnMapping) {
      // Standalone demo mode fallback: add local pin
      const newId = (AppState.records.reduce((max, r) => Math.max(max, r.id), 0) || 0) + 1;
      const newRecord = {
        id: newId,
        Title: `Pin #${newId}`,
        X: snappedX,
        Y: snappedY,
        bgColor: '#3b82f6',
        fgColor: '#ffffff',
        fontSize: 13,
        details: [`Created at (${snappedX}, ${snappedY})`]
      };
      AppState.records.push(newRecord);
      MarkerManager.render();
      MarkerManager.setSelected(newId);
      showToast(`Created Pin #${newId} at (${snappedX}, ${snappedY})`);
      setInteractionMode('select');
      return;
    }

    const fields = {};
    const titleCol = AppState.columnMapping['Title'] || 'Title';
    const xCol = AppState.columnMapping['X'] || 'X';
    const yCol = AppState.columnMapping['Y'] || 'Y';

    fields[titleCol] = `New Pin #${AppState.records.length + 1}`;
    fields[xCol] = snappedX;
    fields[yCol] = snappedY;

    // Associate with current background image
    if (AppState.currentImageAttachmentId && AppState.columnMapping['bgImageAttachment']) {
      fields[AppState.columnMapping['bgImageAttachment']] = ['L', AppState.currentImageAttachmentId];
    } else if (AppState.currentImageUrl && AppState.columnMapping['bgImage']) {
      fields[AppState.columnMapping['bgImage']] = AppState.currentImageUrl;
    }

    try {
      await grist.selectedTable.create({ fields });
      showToast(`Added pin at (${snappedX}, ${snappedY})`);
      setInteractionMode('select');
    } catch (err) {
      console.error("Could not add pin to Grist:", err);
      showToast("Could not create record. Check Grist table permissions.", "error");
    }
  },

  async uploadImageFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast("Please choose an image file (PNG, JPEG, WebP, SVG)", "error");
      return;
    }

    showToast(`Loading ${file.name}...`);
    const localUrl = URL.createObjectURL(file);
    this.setActiveImage(localUrl, null, file.name);

    // Attempt Grist attachment upload if docApi write token is accessible
    try {
      const tokenInfo = await grist.docApi.getAccessToken({ readOnly: false });
      if (tokenInfo && tokenInfo.baseUrl && tokenInfo.token) {
        const formData = new FormData();
        formData.append('upload', file, file.name);

        const uploadUrl = `${tokenInfo.baseUrl}/attachments?auth=${encodeURIComponent(tokenInfo.token)}`;
        const res = await fetch(uploadUrl, { method: 'POST', body: formData });

        if (res.ok) {
          const result = await res.json();
          const attachmentId = Array.isArray(result) ? result[0] : (result.id || result[0]);
          if (attachmentId && AppState.selectedRecordId && AppState.columnMapping?.bgImageAttachment) {
            const col = AppState.columnMapping.bgImageAttachment;
            await grist.selectedTable.updateRecords({
              [col]: [['L', attachmentId]]
            }, [AppState.selectedRecordId]);
            showToast(`Attached ${file.name} to record #${AppState.selectedRecordId}!`);
            return;
          }
        }
      }
    } catch (err) {
      console.warn("Direct attachment upload via REST API not available:", err);
    }

    showToast(`Image loaded! Drag into your Grist Attachment column to persist permanently.`);
  }
};

// =============================================================================
// Marker Manager (Rendering, Selection, Drag & Drop)
// =============================================================================
const MarkerManager = {
  layer: null,
  activeDragMarker: null,
  dragStartX: 0,
  dragStartY: 0,
  markerOrigX: 0,
  markerOrigY: 0,

  init(layerEl) {
    this.layer = layerEl;
    this.initDragListeners();
  },

  render() {
    if (!this.layer) return;
    this.layer.innerHTML = '';

    let visibleCount = 0;

    for (const record of AppState.records) {
      const x = Number(record.X);
      const y = Number(record.Y);

      if (isNaN(x) || isNaN(y)) continue;

      // Image association filtering
      if (AppState.settings.filterByImage && AppState.currentImageSource) {
        const hasAttachment = record.bgImageAttachment && GristManager.parseAttachmentIds(record.bgImageAttachment).length > 0;
        const recordAttachmentId = hasAttachment ? GristManager.parseAttachmentIds(record.bgImageAttachment)[0] : null;
        const recordBgUrl = record.bgImage ? record.bgImage.trim() : null;

        if (hasAttachment) {
          if (recordAttachmentId !== AppState.currentImageAttachmentId) continue;
        } else if (recordBgUrl) {
          if (recordBgUrl !== AppState.currentImageUrl) continue;
        }
      }

      visibleCount++;

      const el = document.createElement('div');
      el.className = 'marker-item';
      el.id = `marker-${record.id}`;
      el.dataset.gristId = record.id;
      el.dataset.x = x;
      el.dataset.y = y;

      // Position marker in image coordinates
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;

      // Custom badge styles from Grist columns
      if (record.bgColor) el.style.backgroundColor = record.bgColor;
      if (record.fgColor) el.style.color = record.fgColor;
      if (record.fontSize) el.style.fontSize = `${record.fontSize}px`;

      // Indicator dot
      const dot = document.createElement('span');
      dot.className = 'marker-dot';
      if (record.bgColor) dot.style.backgroundColor = record.fgColor || '#ffffff';

      // Label text
      const titleSpan = document.createElement('span');
      titleSpan.className = 'marker-title';
      titleSpan.textContent = record.Title || `ID #${record.id}`;

      el.appendChild(dot);
      el.appendChild(titleSpan);

      // Selected state
      if (record.id === AppState.selectedRecordId) {
        el.classList.add('selected');
      }

      // Marker click / tap
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onMarkerClick(record);
      });

      // Marker drag start
      el.addEventListener('mousedown', (e) => {
        if (!AppState.settings.moveEnabled) return;
        e.stopPropagation();
        e.preventDefault();
        this.startDrag(el, record, e.clientX, e.clientY);
      });

      // Marker touch drag start
      el.addEventListener('touchstart', (e) => {
        if (!AppState.settings.moveEnabled || e.touches.length !== 1) return;
        e.stopPropagation();
        const touch = e.touches[0];
        this.startDrag(el, record, touch.clientX, touch.clientY);
      }, { passive: true });

      this.layer.appendChild(el);
    }

    const badge = document.getElementById('pinCountBadge');
    if (badge) {
      badge.textContent = `${visibleCount} ${visibleCount === 1 ? 'pin' : 'pins'}`;
    }
  },

  filterMarkersByImage() {
    this.render();
  },

  setSelected(recordId) {
    const prev = this.layer.querySelector('.marker-item.selected');
    if (prev) prev.classList.remove('selected');

    const current = this.layer.querySelector(`[data-grist-id="${recordId}"]`);
    if (current) {
      current.classList.add('selected');
    }

    const record = AppState.records.find(r => r.id === recordId);
    if (record && AppState.settings.showDetails) {
      UI.showDetailsCard(record);
    }
  },

  onMarkerClick(record) {
    AppState.selectedRecordId = record.id;
    this.setSelected(record.id);

    // Sync row cursor back to Grist
    GristManager.selectRowInGrist(record.id);

    // Display inspector details
    if (AppState.settings.showDetails) {
      UI.showDetailsCard(record);
    }
  },

  startDrag(markerEl, record, clientX, clientY) {
    this.activeDragMarker = markerEl;
    this.dragStartX = clientX;
    this.dragStartY = clientY;
    this.markerOrigX = parseFloat(markerEl.dataset.x) || 0;
    this.markerOrigY = parseFloat(markerEl.dataset.y) || 0;

    markerEl.classList.add('dragging');
  },

  initDragListeners() {
    const handleMove = (clientX, clientY) => {
      if (!this.activeDragMarker) return;

      const scale = Viewport ? Viewport.scale : 1;
      const deltaScreenX = clientX - this.dragStartX;
      const deltaScreenY = clientY - this.dragStartY;

      // Exact scale-compensated delta
      const deltaImgX = deltaScreenX / scale;
      const deltaImgY = deltaScreenY / scale;

      let newX = this.markerOrigX + deltaImgX;
      let newY = this.markerOrigY + deltaImgY;

      // Snap preview to grid if configured
      const snap = parseInt(AppState.settings.gridSnap, 10) || 1;
      newX = Math.round(newX / snap) * snap;
      newY = Math.round(newY / snap) * snap;

      this.activeDragMarker.style.left = `${newX}px`;
      this.activeDragMarker.style.top = `${newY}px`;
      this.activeDragMarker.dataset.x = newX;
      this.activeDragMarker.dataset.y = newY;
    };

    const handleEnd = () => {
      if (!this.activeDragMarker) return;

      const markerEl = this.activeDragMarker;
      const recordId = markerEl.dataset.gristId;
      const finalX = parseFloat(markerEl.dataset.x);
      const finalY = parseFloat(markerEl.dataset.y);

      markerEl.classList.remove('dragging');
      this.activeDragMarker = null;

      // Write back to Grist table
      GristManager.updateCoordinates(recordId, finalX, finalY);

      // Update in-memory record
      const record = AppState.records.find(r => r.id === Number(recordId));
      if (record) {
        record.X = finalX;
        record.Y = finalY;
        if (AppState.selectedRecordId === record.id) {
          UI.showDetailsCard(record);
        }
      }
    };

    window.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', handleEnd);

    window.addEventListener('touchmove', (e) => {
      if (!this.activeDragMarker || e.touches.length !== 1) return;
      handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    window.addEventListener('touchend', handleEnd);
  }
};

// =============================================================================
// UI Controller (Buttons, Settings, Details Card, Toasts)
// =============================================================================
const UI = {
  init() {
    // Mode Buttons
    document.getElementById('btnSelectMode').addEventListener('click', () => setInteractionMode('select'));
    document.getElementById('btnMoveMode').addEventListener('click', () => setInteractionMode('move'));
    document.getElementById('btnAddPinMode').addEventListener('click', () => setInteractionMode('add-pin'));

    // Zoom Buttons
    document.getElementById('btnZoomIn').addEventListener('click', () => Viewport.zoomIn());
    document.getElementById('btnZoomOut').addEventListener('click', () => Viewport.zoomOut());
    document.getElementById('btnFitView').addEventListener('click', () => Viewport.fitToScreen());
    document.getElementById('btnResetZoom').addEventListener('click', () => Viewport.resetZoom());

    // Settings Toggle & Modal
    document.getElementById('btnToggleSettings').addEventListener('click', () => this.toggleSettings());
    document.getElementById('btnCloseSettings').addEventListener('click', () => this.toggleSettings(false));

    // Settings Inputs
    document.getElementById('settingMoveEnabled').addEventListener('change', (e) => {
      AppState.settings.moveEnabled = e.target.checked;
      setInteractionMode(e.target.checked ? 'move' : 'select');
    });

    document.getElementById('settingScrollIntoView').addEventListener('change', (e) => {
      AppState.settings.scrollIntoView = e.target.checked;
    });

    document.getElementById('settingShowDetails').addEventListener('change', (e) => {
      AppState.settings.showDetails = e.target.checked;
      if (!e.target.checked) document.getElementById('detailsCard').classList.add('hidden');
    });

    document.getElementById('settingFilterByImage').addEventListener('change', (e) => {
      AppState.settings.filterByImage = e.target.checked;
      MarkerManager.render();
    });

    document.getElementById('settingGridSnap').addEventListener('change', (e) => {
      AppState.settings.gridSnap = parseInt(e.target.value, 10);
    });

    document.getElementById('settingTheme').addEventListener('change', (e) => {
      AppState.settings.theme = e.target.value;
      this.applyTheme(e.target.value);
    });

    // Details Inspector
    document.getElementById('btnDetailsClose').addEventListener('click', () => {
      document.getElementById('detailsCard').classList.add('hidden');
    });

    document.getElementById('btnDetailsSelectInGrist').addEventListener('click', () => {
      if (AppState.selectedRecordId) {
        GristManager.selectRowInGrist(AppState.selectedRecordId);
        showToast(`Record #${AppState.selectedRecordId} active in Grist`);
      }
    });

    // Image Switcher Select
    document.getElementById('imageSelect').addEventListener('change', (e) => {
      const key = e.target.value;
      const item = AppState.availableImages.get(key);
      if (item) {
        GristManager.setActiveImage(item.url, item.type === 'attachment' ? item.id : null, item.url);
      }
    });

    // File Upload Inputs & Drag-and-Drop
    const fileInput = document.getElementById('imageFileInput');
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        GristManager.uploadImageFile(e.target.files[0]);
      }
    });

    // Drag and Drop files onto window
    const dropOverlay = document.getElementById('dropOverlay');
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropOverlay.classList.remove('hidden');
    });

    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) {
        dropOverlay.classList.add('hidden');
      }
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dropOverlay.classList.add('hidden');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        GristManager.uploadImageFile(e.dataTransfer.files[0]);
      }
    });

    // Demo actions
    document.getElementById('btnLoadDemoImage').addEventListener('click', () => {
      StandaloneDemo.loadSampleImage();
    });

    document.getElementById('btnDismissDemo').addEventListener('click', () => {
      document.getElementById('demoBanner').classList.add('hidden');
    });
  },

  toggleSettings(forceState) {
    const modal = document.getElementById('settingsModal');
    const isHidden = modal.classList.contains('hidden');
    const shouldShow = forceState !== undefined ? forceState : isHidden;

    if (shouldShow) {
      modal.classList.remove('hidden');
    } else {
      modal.classList.add('hidden');
    }
  },

  syncSettingsUI() {
    document.getElementById('settingMoveEnabled').checked = AppState.settings.moveEnabled;
    document.getElementById('settingScrollIntoView').checked = AppState.settings.scrollIntoView;
    document.getElementById('settingShowDetails').checked = AppState.settings.showDetails;
    document.getElementById('settingFilterByImage').checked = AppState.settings.filterByImage;
    document.getElementById('settingGridSnap').value = String(AppState.settings.gridSnap || 1);
    document.getElementById('settingTheme').value = AppState.settings.theme || 'dark';
    this.applyTheme(AppState.settings.theme);
  },

  applyTheme(theme) {
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  },

  showDetailsCard(record) {
    const card = document.getElementById('detailsCard');
    const title = document.getElementById('detailsTitle');
    const dot = document.getElementById('detailsColorDot');
    const coordX = document.getElementById('detailsCoordX');
    const coordY = document.getElementById('detailsCoordY');
    const recId = document.getElementById('detailsRecordId');
    const content = document.getElementById('detailsContent');

    title.textContent = record.Title || `Record #${record.id}`;
    dot.style.backgroundColor = record.bgColor || 'var(--accent-primary)';
    coordX.textContent = `X: ${record.X ?? 0}`;
    coordY.textContent = `Y: ${record.Y ?? 0}`;
    recId.textContent = `ID: #${record.id}`;

    content.innerHTML = '';

    // Render details array or object fields
    if (record.details && Array.isArray(record.details)) {
      record.details.forEach((val, i) => {
        if (val !== undefined && val !== null && val !== '') {
          const row = document.createElement('div');
          row.className = 'detail-row';
          row.innerHTML = `<span class="detail-label">Detail ${i + 1}</span><span class="detail-val">${escapeHtml(String(val))}</span>`;
          content.appendChild(row);
        }
      });
    }

    // Also display any other raw mapped properties (excluding coordinates and internal ids)
    const exclude = ['id', '_raw', 'X', 'Y', 'Title', 'details', 'bgImageAttachment', 'bgImage', 'bgColor', 'fgColor', 'fontSize'];
    Object.keys(record).forEach(key => {
      if (!exclude.includes(key) && record[key] !== null && record[key] !== undefined && record[key] !== '') {
        const row = document.createElement('div');
        row.className = 'detail-row';
        row.innerHTML = `<span class="detail-label">${escapeHtml(key)}</span><span class="detail-val">${escapeHtml(String(record[key]))}</span>`;
        content.appendChild(row);
      }
    });

    card.classList.remove('hidden');
  },

  updateImageSwitcher() {
    const container = document.getElementById('imageSwitcherContainer');
    const select = document.getElementById('imageSelect');

    if (AppState.availableImages.size > 1) {
      container.style.display = 'flex';
      select.innerHTML = '';

      AppState.availableImages.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.key;
        opt.textContent = item.label;
        select.appendChild(opt);
      });

      this.syncImageSwitcherSelect();
    } else {
      container.style.display = 'none';
    }
  },

  syncImageSwitcherSelect() {
    const select = document.getElementById('imageSelect');
    if (!select) return;

    if (AppState.currentImageAttachmentId) {
      select.value = `attachment_${AppState.currentImageAttachmentId}`;
    } else if (AppState.currentImageUrl) {
      select.value = `url_${AppState.currentImageUrl}`;
    }
  }
};

function setInteractionMode(mode) {
  AppState.interactionMode = mode;
  AppState.settings.moveEnabled = (mode === 'move');
  document.getElementById('settingMoveEnabled').checked = AppState.settings.moveEnabled;

  const btnSelect = document.getElementById('btnSelectMode');
  const btnMove = document.getElementById('btnMoveMode');
  const btnAdd = document.getElementById('btnAddPinMode');
  const viewportEl = document.getElementById('viewport');

  btnSelect.classList.toggle('active', mode === 'select');
  btnMove.classList.toggle('active', mode === 'move');
  btnAdd.classList.toggle('active', mode === 'add-pin');

  viewportEl.classList.toggle('mode-move', mode === 'move');
  viewportEl.classList.toggle('mode-add-pin', mode === 'add-pin');

  if (mode === 'move') {
    showToast('Move Mode: Drag pins to reposition coordinates');
  } else if (mode === 'add-pin') {
    showToast('Add Pin Mode: Click anywhere on image to place a new pin');
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 260);
  }, 2800);
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// =============================================================================
// Standalone Demo Mode (Preview outside Grist iframe)
// =============================================================================
const StandaloneDemo = {
  init() {
    if (AppState.isGristConnected) return;
    document.getElementById('demoBanner').classList.remove('hidden');

    this.loadSampleImage();

    // Mock records mapped onto test image (servers)
    AppState.records = [
      { id: 1, Title: 'Core Gateway Router 01', X: 480, Y: 430, bgColor: '#2563eb', fgColor: '#ffffff', fontSize: 13, details: ['IP: 192.168.1.1', 'Status: Online', 'Rack: A1'] },
      { id: 2, Title: 'Distribution Switch S-12', X: 480, Y: 620, bgColor: '#059669', fgColor: '#ffffff', fontSize: 13, details: ['Ports: 48x 10GbE', 'VLANs: 10, 20, 50', 'Status: Active'] },
      { id: 3, Title: 'SAN Storage Array', X: 1180, Y: 560, bgColor: '#7c3aed', fgColor: '#ffffff', fontSize: 13, details: ['Capacity: 120 TB', 'RAID 6', 'IOPS: 85,000'] },
      { id: 4, Title: 'UPS Battery Bank', X: 1180, Y: 980, bgColor: '#d97706', fgColor: '#ffffff', fontSize: 13, details: ['Load: 42%', 'Runtime: 45 min', 'Battery Health: 98%'] }
    ];

    MarkerManager.render();
  },

  loadSampleImage() {
    const samplePath = 'testimages/CITIB-servers.jpg';
    AppState.currentImageSource = samplePath;
    Viewport.setImage(samplePath, () => {
      MarkerManager.render();
    });
  }
};

// =============================================================================
// App Initialization
// =============================================================================
window.addEventListener('DOMContentLoaded', () => {
  const viewportEl = document.getElementById('viewport');
  const canvasEl = document.getElementById('canvas');
  const imageEl = document.getElementById('backgroundImage');
  const markersLayerEl = document.getElementById('markersLayer');

  Viewport = new ViewportEngine(viewportEl, canvasEl, imageEl);
  MarkerManager.init(markersLayerEl);
  UI.init();
  UI.syncSettingsUI();

  GristManager.init();
});
