# Grist Image Map Widget

A modern, interactive custom widget for [Grist](https://lasuite.numerique.gouv.fr/produits/grist) that displays custom text markers, badges, and pins on a background image or floor plan.

Supports **uploaded file attachments** directly from Grist, multi-image layers, smooth pan & zoom, pin dragging, and real-time synchronization with your Grist records.

Try it out with GitHub's “Pages” feature: https://floriangagnard.github.io/gristImageMap/

---

## ✨ Features

- 📁 **Native Grist Attachment Support**: Upload any image (floor plans, diagrams, server racks, blueprints, maps) into an **Attachments** column in your Grist table, and the widget automatically displays it.
- 🎛️ **Multi-Image Switching**: If your table contains different images across rows, the widget automatically detects them and provides an image switcher dropdown in the toolbar.
- 🔍 **Smooth Pan & Zoom**: Intuitive mouse wheel zoom centered at cursor position, drag-to-pan, touch pinch-to-zoom, "Fit to Screen", and 1:1 view reset.
- 🏷️ **Interactive Markers & Badges**:
  - Displays record `Title` at `(X, Y)` image coordinates.
  - Supports custom badge styling per record: background color (`bgColor`), text color (`fgColor`), and font size (`fontSize`).
  - Active record highlight with smooth glowing animation.
  - Click any marker to synchronize and select that row in Grist (`setCursorPos` and `setSelectedRows`).
- ✋ **Reposition / Move Mode**: Drag markers directly across the canvas to visually reposition them; updated `(X, Y)` coordinates are saved immediately back into your Grist table.
- ➕ **Add Pin Mode**: Click anywhere on the image to create a new record in your Grist table at that exact position.
- 📐 **Grid Snapping**: Option to snap coordinates to a 10px, 20px, or 50px grid.
- 🔍 **Details Inspector Card**: Click any pin to open a popover displaying all mapped detail columns with quick jump to Grist.
- 🎨 **Modern Aesthetic**: Dark/Light mode support, glassmorphic floating toolbars, and responsive UI.
- 🧪 **Offline & Standalone Demo Mode**: Works seamlessly in preview outside of Grist with built-in mock data and sample images.

---

## 🚀 Setup in Grist

### 1. Add Custom Widget
1. In your Grist document, click **Add New** > **Select Widget** > **Custom**.
2. Set the widget URL to the hosted URL of this widget (or your local development server, e.g. `http://localhost:8089`).
3. Set **Access Level** to **Full** (required to fetch attachment download tokens and update `(X, Y)` coordinates).

### 2. Configure Columns

Map the following columns in the Grist widget configuration panel:

| Column Requirement | Type | Required? | Description |
| :--- | :--- | :--- | :--- |
| **Title** | `Text` | **Yes** | Text label shown on the badge / pin |
| **X** | `Numeric` | **Yes** | X pixel coordinate on the image |
| **Y** | `Numeric` | **Yes** | Y pixel coordinate on the image |
| **bgImageAttachment** | `Attachments` | *Optional* | **Uploaded image file(s)** stored in Grist |
| **bgImage** | `Text` | *Optional* | Fallback external image URL |
| **bgColor** | `Text` | *Optional* | Badge background color (e.g. `#3b82f6` or `teal`) |
| **fgColor** | `Text` | *Optional* | Badge text color (e.g. `#ffffff` or `black`) |
| **fontSize** | `Numeric` | *Optional* | Font size in pixels (default: `12`) |
| **details** | *Any* (Multiple) | *Optional* | Extra columns displayed in the Details Inspector |

---

## 🖼️ How Background Images Work

1. **Grist Attachment Column (Recommended)**:
   - Create an `Attachments` column in your Grist table.
   - Drag & drop or upload your image into this cell in Grist.
   - Map it to **bgImageAttachment** in the widget panel.
   - The widget uses Grist's secure `grist.docApi.getAccessToken()` to display the image.

2. **Image URL Column**:
   - Provide direct URLs to images hosted online.

3. **URL Query Parameter**:
   - You can also specify a default image via URL parameter: `https://your-widget-url/?backgroundImage=https://example.com/map.jpg`.

---

## ⌨️ Controls & Shortcuts

- **Pan**: Click and drag the canvas background or middle-click.
- **Zoom**: Scroll wheel (zooms towards cursor), or use `+` / `-` buttons in the bottom toolbar.
- **Fit View**: Click the **Fit** button to scale and center the image to the current window size.
- **1:1 Reset**: Click **1:1** to reset scale to 100%.
- **Move Pins**: Toggle **Move Pins** mode to drag pins to new coordinates.
- **Add Pin**: Toggle **Add Pin** mode and click anywhere on the image.

---

## 🛠️ Local Development

To run locally:
```bash
python3 -m http.server 8089
```
Open `http://localhost:8089` in your browser. When loaded outside of an iframe, the widget automatically launches in **Standalone Demo Mode** with a sample server room photo and interactive mock pins.
