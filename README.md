
# Architecture: Gemini Media Aggregator

## Tooling Naming Convention
The suite of tools is organized as follows:
- s1: Creative Studio (pink icon)
- s2: Media Suite (orange icon)
- s3: Finance Terminal (Green)
- s4: Office Tools (Blue icon)

Any reference to the full name or icon points to these identifiers.

## Persistence Rule: System Architecture & Toolset
Any remix or future development MUST resume updates to this 'System Architecture & Toolset' documentation. This is a mandatory requirement.

## Overview
The Gemini Media Aggregator is a Single Page Application (SPA) built with React 18, TypeScript, and Tailwind CSS. It leverages the Google GenAI SDK (`@google/genai`) or local **Ollama** instances to allow users to upload multiple media types (Images, Text, PDF, Video, Audio) or add **Web Links** and query them as a collective context.

## Core Concepts

### 1. State Management (App.tsx)
The application state is centralized in the root `App` component and is structured around **Sessions** and **Themes**.
- **Session**: A self-contained object representing a specific context.
  ```typescript
  interface Session {
    id: string;
    name: string;
    mediaItems: MediaItem[]; // Array of Base64 data (files) or URLs (links)
    selectedMediaIds: string[]; // Array of IDs currently active (checked) for the context
    history: Message[];      // Chat conversation history (with grounding)
    suggestions: string[];   // AI generated questions
    createdAt: number;
    // Caching
    geminiCacheName?: string; // Resource ID of server-side cache
    geminiCacheHash?: string; // Signature of the media content cached
  }
  ```
- **Theme**: The application-level theme supports `dark` (default), `light`, and `olive`. Persisted in localStorage (`gemini_media_aggregator_theme`). This is the [`SettingsPanel`](components/SettingsPanel.tsx) "Theme Mode" control and drives the global `--c-bg-app`/`--c-text-main` CSS variables.
- **Creative-Studio theme**: the Studio/Media Suite applets honour a second theme system (`creative_studio_theme`) with 11 palettes — `charcoal` (default), `silver`, `white`, `cosmic`, `emerald`, `amber`, `cyberpunk`, `slate`, `crimson`, `orchid`, `olive` — defined in `constants/creativeStudioTheme.ts` and cycled from the app header (`creative_studio_theme_change` window event keeps the choice in sync across tools).
- **ThemeSettings**: 
  - `bgBrightness`: 20-100% slider.
  - `textBrightness`: 50-150% slider.
  - `hue`: 0-360 degrees color rotation slider.
  - `textSize`: 80-140% font scaling slider.
  - `provider`: 'gemini' | 'ollama' | 'custom'.
  - `model`: 'gemini-3.5-flash' | 'gemini-3.1-pro-preview' | 'gemini-3.1-flash-lite' (Gemini).
  - `enableCaching`: boolean (Context Caching for Gemini).
  - `ollamaEndpoint`: URL (default http://localhost:11434).
  - `ollamaModel`: Selected local model name.
  - `customBaseUrl`: Base URL for OpenAI-compatible endpoint.
  - `customApiKey`: API key for Custom AI provider.
  - `customModelName`: Selected model name (e.g. gpt-4o).
  - `customApiPath`: API path (default /v1/chat/completions).
- **Persistence**:
  - **IndexedDB**: Used for storing `sessions` (Media, Chat History) to overcome LocalStorage quota limits (approx 5MB) and for large audio blobs. Handled via `services/storage.ts`.
  - **LocalStorage**: Used for lightweight preferences like `theme` and `settings`. **Sensitive keys (Gemini/Custom AI keys, GitHub tokens) are NEVER persisted** — `hooks/useThemeEngine.ts` strips them on save and forces them empty on load; `GitHubPublisherTool` keeps its token in memory only for the session.
  - **Global podcast history**: lightweight (audio blobs live in IndexedDB); see `services/historyStorage.ts` (tiered localStorage fallback so large WAVs never blow the 5MB quota).
- **Active Session**: The app tracks an `activeSessionId`. All uploads and chats occur within the context of the active session.
- **Split View State**: Tracks `previewCode` (for artifacts) or `focusedMediaItem` (for media) to render a split-screen pane.

### 2. Services
The app uses an abstraction layer in `App.tsx` to route requests to the correct service based on `settings.provider`.

#### `services/gemini.ts`
Interacts directly with the Google GenAI API.
- **Models**: The catalog lives in `constants/geminiModels.ts` (`DEFAULT_GEMINI_MODEL` = `gemini-3.8-flash`). Selectable Flash: `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-4-hydrogen`; reasoning: `gemini-4-neon`; image/video: `gemini-4-argon`, `gemini-4-carbon`; lightweight: `gemini-3.1-flash-lite`; preview: `gemini-3.1-pro-preview`. Legacy names in the request are normalized server-side (`normalizeModel` in `server/gemini.ts`).
- **Tools**: Uses `googleSearch` tool for resolving Web Link media items.
- **Context Caching**: Implements `ai.caches.create` to store large media contexts on the server for 10 minutes (TTL), reducing token costs for subsequent queries.
- **Capabilities**: Supports Text, Images, PDF, Video, Audio.
- **System Prompts**: Configured to provide timestamps for AV content and self-contained HTML for UI artifacts.

#### `services/ollama.ts`
Interacts with a local Ollama instance via Fetch API.
- **Connection**: Local/private endpoints are called directly from the user’s browser, including MAGGI’s Ollama brain. Set Ollama’s `OLLAMA_ORIGINS` to allow the app origin; the backend cannot reach a remote user’s localhost. Public tunnel endpoints use the server proxy.
- **Capabilities**: Supports Text and Images (if model is multimodal). Non-text/image media are summarized by name/metadata in the prompt context but not processed natively.
- **Endpoints**: `/api/tags` (list models), `/api/chat` (generate response).

#### Local Ollama setup

1. Install and start Ollama on the computer running your browser. Pull a model, for example `ollama pull llama3.2`.
2. Allow the app's exact origin (shown in Settings → AI Engine → Ollama) in Ollama's `OLLAMA_ORIGINS`, then restart Ollama. On macOS/Linux, when running Ollama manually, for example: `OLLAMA_ORIGINS="https://your-app-origin" ollama serve`. Stop any existing Ollama server first. On Windows, set `OLLAMA_ORIGINS` as a user environment variable and restart the Ollama application. Use the actual app origin, including its port; avoid `*` unless you understand that it allows requests from any website.
3. Select **Ollama**, use `http://localhost:11434`, click **Test Connection**, and choose or type the installed model. **Test model submission** sends a short real request. MAGGI → Brain → Ollama uses the same local connection and model discovery.

Localhost refers to the browser's computer, not the hosted application server. Grant any browser local-network permission requested. Some browsers or embedded HTTPS previews block direct local access even with CORS configured; open the app in a new tab, run the app locally, or use a secured HTTPS tunnel. Local Ollama does not require an API key. Do not expose an unauthenticated Ollama service publicly.

#### `services/customAi.ts`
Interacts with custom OpenAI-compatible endpoints securely.
- **Connection**: Proxied through `/api/custom-ai` on the server. The key is sent **per request via the `x-custom-ai-key` header** (never in the JSON body, never persisted) — the same per-session pattern as the Gemini proxy routes.
- **Server-side guard**: `/api/custom-ai` blocks private/loopback hosts (SSRF protection mirroring `server/maggi/keyPool.ts`) and rejects non-http(s) URLs.
- **Capabilities**: Embeds text contents, Web Links, and document metadata as part of the prompt context messages.
- **Endpoints**: Configured via settings (`customBaseUrl`, `customApiPath`, `customModelName`, `customApiKey`).

#### `services/unifiedAi.ts`
Unified provider-agnostic bridge used by interactive Creation Studio applets.
- Reads active configuration (`gemini_media_aggregator_settings`) from `localStorage`.
- Dynamically resolves and routes generative prompts to either Gemini API (`services/gemini`), Ollama API (`services/ollama`), or Custom OpenAI-Compatible Endpoints (`services/customAi`) to ensure the entire creation workspace flows seamlessly.

### 3. Styling & Theming (Dynamic Engine)
- **Engine**: The app uses a JavaScript-driven styling engine in `App.tsx` that performs real-time color math.
- **HSL Color Processing**:
  - The engine converts base Hex colors to HSL (Hue, Saturation, Lightness).
  - **Hue Rotation**: Adds the `settings.hue` (0-360) value to the base color's Hue.
  - **Brightness Scaling**: Scales the RGB channels of the rotated color based on `bgBrightness` and `textBrightness` sliders.
  - **Reconstruction**: Converts back to Hex (preserving Alpha channels) and injects into CSS variables.
- **Text Scaling**:
  - Modifies `document.documentElement.style.fontSize` based on `settings.textSize`. This scales all Tailwind `rem` units globally.
- **Presets**: Base palettes (`dark`, `light`, `olive`) are defined as JS constants.
- **CSS Variables**: Injected into `:root` (e.g., `--c-bg-app`, `--c-text-main`).
- **Transparency**: The engine supports 8-digit Hex codes to allow transparent backgrounds (e.g., for the "Olive" theme's glass effect).

### 3.1 Server Architecture (Node + Express)
`server.ts` is now a thin wiring layer. Route groups live in dedicated modules:
- `server/security.ts` — security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production) and a per-IP fixed-window rate limiter.
- `server/gemini.ts` — Gemini client, retry queue, model normalization, `/api/gemini/*`, `/api/custom-ai`, `/api/architecture`.
- `server/ollamaProxy.ts` — `/api/ollama/*` tunnel proxy with endpoint validation (loopback/private hosts blocked).
- `server/crypto.ts` — `/api/crypto/*` (prices/info/OHLC/SEK/news) with CoinGecko caching + resilient fallbacks. `/api/crypto/rss` and `/api/crypto/stock-rss` use the allowlisted RSS aggregator in `server/rss.ts`. The stock and crypto readers aggregate sources independently, cache each source for 60 seconds, and label stale results (up to one hour) or unavailable feeds rather than inventing headlines. The RSS routes accept only sanitized `symbol` values and never fetch arbitrary URLs or redirects; XML, links and thumbnails are sanitized before display.
- `server/maggiRoutes.ts` + `server/maggi/keyPool.ts` — MAGGI RAG engine routes; key-pool/model-resolution logic is extracted into `server/maggi/keyPool.ts`.

**Rate limits** (per IP): `/api/gemini/*` 30/min, `/api/custom-ai` 30/min, `/api/maggi/*` 60/min, `/api/ollama/*` 40/min, `/api/crypto/*` 30/min, `/api/architecture` 120/min.

### 4. Component Structure
- **Layout**: Main container with a responsive split-pane design (Sidebar + Main Chat + Optional Preview Pane).
- **SessionModal**:
    - Modal dialog for naming new sessions.
    - Triggered via the `MediaPanel` "New Session" button.
- **MediaPanel (Sidebar)**:
    - **Settings Drawer**: A slide-up panel containing:
        - Icon-based Theme Switcher (Sun/Moon/Leaf).
        - **AI Provider**: Toggle between Gemini, MAGGI (FreeLLMAPI), Ollama, and Custom AI.
        - **Model Config**: Dropdowns/Inputs specific to the selected provider.
        - **Context Caching**: Toggle for Gemini server-side caching.
        - **Color Tint Slider**: 0-360 degree hue rotation with rainbow gradient.
        - **Text Size Slider**: 80-140% global zoom.
        - Incremental Sliders for Background and Text brightness.
    - **Session List**: Displays available sessions with timestamps. Allows switching and deleting sessions.
        - **Global Search**: Search bar to filter sessions by name or chat content.
        - **Export**: Ability to download sessions as JSON or Markdown.
    - **Current Media List**: Lists active media files and links for the *selected* session. 
        - **Selection Toggles**: Checkboxes to toggle individual media items on/off from the context.
        - **Master Toggle**: "Include All Sources" switch (Pill style).
        - **Media Player**: Renders actual HTML5 `<video>` and `<audio>` elements (visually compact) to support DOM-based timestamp seeking.
        - **View/Focus**: "Eye" icon button to open media in split-screen viewer.
    - **Upload & Link Controls**: Handles file input and web URL addition. Supports **Drag and Drop** file uploads on the entire panel.
- **ChatPanel (Main)**:
    - Renders the chat scroll view with word-wrap enabled for long outputs.
    - **History Search**: Toggleable search bar to filter conversation messages.
    - **Voice Input (STT)**: Microphone icon to transcribe speech to text input (Web Speech API).
    - **Text-to-Speech (TTS)**: Speaker icon on model messages to read responses aloud (SpeechSynthesis API).
    - **Source Rendering**: Displays `groundingChunks` (search citations) as clickable links in model responses (Gemini only).
    - **Timestamp Parsing**: Detects `[mm:ss]` patterns in text and renders them as clickable links that control the media players in the sidebar.
    - **Artifact Detection**: Detects code blocks (HTML/JS/React). Renders an "Open Preview" button for them.
    - **Export/Copy**: Ability to save individual Model responses as Markdown files via a download button or Copy to Clipboard.
    - **Quick Action Menus**: Three colored icons (Insight, Discovery, Structure) providing slide-up menus. These now pull dynamically from the **Prompt Library** via tags.
    - **Prompt Library**: Book icon opens a modal to manage, add, and select reusable prompts.
- **PromptLibraryModal**:
    - Manage custom and system prompts.
    - Supports JSON Export of the library.
- **ArtifactPreview**:
    - A dedicated pane (Split-Screen) that renders generated HTML/JS code in a secure `<iframe>`.
    - Toggled via `ChatPanel` "Open Preview" buttons.
- **MediaViewer**:
    - A dedicated pane (Split-Screen) for focused viewing of Images, PDFs, Videos, or Text.
    - Toggled via `MediaPanel` "Eye" buttons.
- **SuggestionBar**:
    - Displays auto-generated questions in a responsive, wrapping layout.
    - Clicking a suggestion immediately submits it to the chat.

### 5. Data Flow
1. **New Session**: User clicks "+", triggering `SessionModal`. User enters name -> `App` creates named `Session`.
2. **Upload/Link**: User adds file (Drag & Drop or Select) or URL -> `MediaPanel` -> `App` updates the *targeted* session's `mediaItems` AND `selectedMediaIds` (auto-select).
3. **Selection**: User toggles checkboxes -> `App` updates `selectedMediaIds` -> Future chat requests only use filtered list.
4. **Suggestion**: `App` checks Provider -> Calls `gemini` or `ollama` service -> Returns questions -> `App` updates `suggestions`.
5. **Chat**: User types/clicks suggestion or uses **Voice Input** -> `ChatPanel` -> `App` appends User Message -> `App` filters media -> Service called -> Returns Text -> `App` appends Model Response.
6. **TTS**: User clicks "Listen" -> `ChatPanel` uses SpeechSynthesis to read response.
7. **Preview/Focus**: 
    - User clicks "Open Preview" -> `App` sets `previewCode` state -> Layout splits to show `ArtifactPreview`.
    - User clicks "Eye" on media -> `App` sets `focusedMediaItem` state -> Layout splits to show `MediaViewer`.
8. **Seek**: User clicks `[01:30]` -> `ChatPanel` fires event -> `App` finds valid `<video>`/`<audio>` -> Sets `currentTime`.
9. **Export**: User clicks Download -> `App` generates JSON/Markdown Blob -> Trigger download.
10. **Storage**: Any change to `sessions` triggers an async write to **IndexedDB**. Theme, settings, and **Prompt Library** go to `localStorage`.

---

**Last Updated**: `2026-07-07 09:00:00-07:00`
- Integrated six additional interactive Creation Studio suites, completing the total interactive suite coverage:
  - **10. Creative Brainstorm** (`brainstormer` ID): High-divergence ideation sandbox incorporating lateral thinking lenses (e.g., Silicon Valley Disruption, Solarpunk, Sci-Fi Future) and divergence selectors to brainstorm 10 unconventional perspectives.
  - **11. Email Drafter** (`email_drafter` ID): Full-scale professional email compiler with tone selectors, recipient configurations, and alternative subject line matrix builders, rendered in a simulated desktop mail client preview.
  - **12. Marketing Copywriter** (`marketing_copy` ID): Visual copywriting bench supporting multiple conversion-rate optimization (CRO) frameworks (e.g., AIDA, PAS) with custom headline, hook, and body generators, plus live-rendered search and feed mockup components.
  - **13. SWOT Analysis** (`swot_analysis` ID): Analytical SWOT evaluator with perspective selectors (e.g., PMF, Security & Compliance, Moat) that maps findings in an interactive 2x2 grid alongside prioritized action blueprinting.
  - **14. Code Explainer** (`code_explainer` ID): Side-by-side developer workspace containing a syntax-styled input editor and an interactive breakdown view, presenting high-level summaries, step-by-step deconstructions, Big O analysis, and refactoring audits tailored for specific user profiles (ELI5 to Security Lead).
  - **15. Ebook Generator** (`ebook_generator` ID): A comprehensive book-drafting hub featuring automated Table of Contents structuring and an interactive Chapter Compiler to narrative-draft full, detailed Markdown pages.
- Formulated `services/unifiedAi.ts` to seamlessly route Creation Studio generative prompts to the active user-configured provider (Gemini, Ollama, or Custom AI).
- Documented secure server-side endpoint proxying `/api/custom-ai` in `server.ts` to manage API key secrets and CORS headers.
- Described state representation and local/system prompt injection in `services/customAi.ts`.

**Last Updated**: `2026-07-08 06:05:00-07:00`
- **Category Templates & CSV Import/Export**: Integrated dynamic Session Category Templates (`TemplateManager.tsx`) to allow users to structure session creation. Features:
  - Custom category definition and persistence in local storage.
  - Suffix and index processing to auto-increment newly created sessions.
  - CSV templates export (`exportTemplatesToCSV`) and CSV template import (`parseTemplatesCSV`) with automatic schema validation.
  - Session-level template association matching so any existing session can be rebranded under another category dynamically.
- **Program Architecture Specs Actions**: Integrated dedicated actions panel in the Architecture Specs Markdown Overlay:
  - **Copy**: Copy raw Markdown specifications directly to the system clipboard via `navigator.clipboard`.
  - **Save TXT**: Download the raw `.md` content as a standard `.txt` file using dynamic file blob generators.
  - **Export CSV**: Parses the hierarchical markdown document by structural section headers (`#`, `##`, `###`) and compiles it into a tabular comma-separated layout, allowing spreadsheets to consume architecture metadata directly.

**Last Updated**: `2026-07-08 06:17:00-07:00`
- **Dynamic File Naming & Style Enhancements**:
  - **Custom TXT Filename format**: Dynamic exports are now saved uniquely using `architecture_specs_DD_MM-HH-MM.txt` pattern to guarantee sequence integrity.
  - **Custom Spreadsheet/CSV Filename format**: Multi-column tabular exports are now uniquely named as `architecture_specss_DD_MM-HH-MM-SS.csv`.
  - **Aesthetic Text Color Cycling**: Program Architecture Specs header text and icon color dynamically cycle through 7 distinct colors (`text-rose-400`, `text-amber-400`, `text-emerald-400`, `text-teal-400`, `text-blue-400`, `text-indigo-400`, `text-purple-400`) based on the day of the week to beautifully signify the progression of days.

**Last Updated**: `2026-07-09 10:15:00-07:00`
- **Media Suite Migration**: 
  - Created a dedicated `MediaSuiteView` component and migrated media-centric tools out of `StudioView` (Creation Studio).
  - Moved tools include: **SegCarver** (formerly a modal, now embedded), **Video Script Writer**, **Script Writer**, and **Image Describer**.
  - Removed `SegCarverModal` component entirely.
- **Media Suite UI/UX**:
  - Added a **View Mode Toggle** to switch the Media Suite layout between a responsive Grid and a List view.
  - Integrated the global **Theme Cycler** into the Media Suite header for immediate visual customization.
- **Library View Updates**:
  - Updated the "Media Suite" launch button in `LibraryView` to feature a bold, solid orange background with custom shadow effects for improved visibility.

- **Creation Studio Restoration**:
  - Restored **16. Image Generator Prompts** back to the Creation Studio grid from the Media Suite after confirming it's not a direct visual media tool but a prompt generator.

- **Media Suite Theme Isolation**:
  - Extracted `themeStyles` from `StudioView` into `constants/creativeStudioTheme.ts` to enable shared access.
  - Refactored `MediaSuiteView` to consume `themeStyles[localTheme]` for localized UI elements (e.g., backgrounds, borders) instead of relying on global `bg-app-bg` variables. This correctly connects the local theme cycler.
- **Media Suite View Modes**:
  - Added a third `icon` state to the view mode cycler in `MediaSuiteView`, rendering purely the tool icons in a dense responsive grid (up to 8 columns).
- **Creation Studio Tool UX**:
  - Fixed `Image Generator Prompts` tool execution flow in `StudioView` to properly navigate the user back to the `LibraryView` (ChatPanel) immediately upon triggering the prompt generation.

- **SegCarver Storyboard Maker**:
  - Added a third operational mode `storyboard` to the `SegCarverTool` (Crop -> Grid Split -> Storyboard).
  - Users can now click **Storyboard Maker** after setting their carve grid, which dynamically slices the image into memory without downloading.
  - Generates a 9-screen storyboard grid (3x3) where users can intuitively drag-and-drop the carved slices directly into the provisional screens.

- **Storyboard Maker Text Integration**:
  - Enhanced storyboard tiles to no longer crop images (`object-contain` instead of `object-cover`) preventing distortion.
  - Upgraded `storyboardSlots` state to hold objects containing `url`, `name`, and `story`.
  - Added text input fields for "Screen Name" and "Story" directly inside each storyboard slot, turning the simple grid into a fully functional narrative board.

- **SegCarver Sidebar Layout Fix**:
  - Fixed a critical layout bug where the Storyboard Controls menu was injected outside the `<aside>` grid container, causing it to render as a 1-column sliver and break the main workspace grid layout.
  - The Storyboard controls are now correctly bounded inside the 3-column configuration panel.

- **Storyboard Maker Export & Import Flow**:
  - Implemented the capability to save/export the completed storyboard as a fully self-contained JSON file (which includes embedded base64 slices).
  - Added a **Load Storyboard** function that parses a storyboard JSON file, repopulates the 9-screen grid (with texts, stories, and images), and correctly extracts unique slice assets back into the sidebar palette for continued editing.

- **Storyboard Maker Updates**:
  - Changed the default Grid Split from 2x2 to 3x3 to align with standard storyboard generation needs.
  - Added real-time pixel size dimension displays directly attached to the drag-handles for both horizontal and vertical grid split lines, providing high accuracy layout metrics.
  - Introduced a **Download Assets (ZIP)** button that recursively compiles all images deposited into the storyboard slots into a single ZIP file, maintaining their sequential visual order (1 through 9) and preserving user-defined filenames.

- **Storyboard Multi-Mode & Dynamic Layouts**:
  - Implemented cell multi-mode configuration that cycles through three states: "Image Only" (removes all text inputs), "Image + Name" (displays image and name input), and "Full" (displays image, name, and story description). The default state is now "Image + Name" to keep things cleaner by default.
  - Added a Layout mode toggle to switch between the traditional fixed 3x3 (9 Screens) grid, and a new dynamic "List Match Grid" layout.
  - The dynamic layout perfectly matches the number of slices dictated by the grid split parameters (e.g. 3x3 creates exactly 9 slots, 2x4 creates exactly 8 slots) and renders each slot as a full-width horizontal card, displaying the image on the left and the text inputs dynamically expanding on the right.

- **Model Upgrades**:
  - Replaced all usages of the deprecated `gemini-2.5-flash` and `gemini-1.5-flash` models across the application.
  - Upgraded the default model configuration to the latest `gemini-3.5-flash` for core capabilities.
  - Adjusted model fallbacks inside the Node server router to seamlessly redirect legacy requests to `gemini-3.5-flash`.

- **API Reliability Enhancements**:
  - Expanded the `callWithRetry` module inside the Node server to natively catch and handle HTTP 503 (Service Unavailable) and HTTP 500 errors.
  - Mitigates temporary spikes in Gemini service demand (e.g., "The model is currently experiencing high demand") by seamlessly utilizing exponential backoff and jitter without immediately surfacing transient failures to the user.

- **API Reliability Enhancements**:
  - Expanded the `callWithRetry` module inside the Node server to natively catch and handle HTTP 503 (Service Unavailable) and HTTP 500 errors.
  - Mitigates temporary spikes in Gemini service demand (e.g., "The model is currently experiencing high demand") by seamlessly utilizing exponential backoff and jitter without immediately surfacing transient failures to the user.

- **Cascading Model Fallbacks**:
  - Implemented cascading fallback chains in the `generateContentWithFallback` proxy module.
  - If a top-tier model (e.g. `gemini-3.5-flash`) experiences high demand (HTTP 503), the server will automatically intercept the transient error and degrade gracefully to the ultra-stable `gemini-3.1-flash-lite` model seamlessly.
  - Pro models gracefully degrade to flash models, while flash models gracefully degrade to ultra-stable older generation flash models to ensure 100% request completion.

**Last Updated**: `2026-10-29 00:00:00+01:00`
- **Media Suite — AniComposer (new tool)**:
  - Added `src/media_suite/AniComposer/` and registered it in `MediaSuiteView` as tool id `ani_composer` ("AniComposer", emerald clapper icon), rendered with its own full-bleed header (`hasCustomHeader`).
  - Purpose: convert storyboard plates into a **timed animatic** — per-shot hold duration, camera move presets (push in / pull out / pan / tilt / diagonal / handheld), in-point transition + length, burn-in captions, look filters, scratch audio, and real-time video export.
  - **Architecture**:
    - `App.tsx` — orchestrator: project state, transport (play/pause/scrub/shot step), keyboard shortcuts (`Space`, `←/→`, `Alt` = 0.1s, `Shift` = shot step, `Home/End`), debounced `localStorage` autosave (`anicomposer_project_v1`), autosave-failure banner when the quota is exceeded.
    - `utils/render.ts` — single canvas compositor shared by the live preview, PNG stills and video export: cover-fit plate drawing, camera interpolation, 9 transition modes (fade, dip-to-black, wipes, slides, zoom, defocus) plus caption burn-in, safe-frame and timecode overlays. Captions of the outgoing shot are suppressed during a transition and the incoming caption fades in, avoiding ghosted text.
    - `utils/recorder.ts` — `MediaRecorder` + `canvas.captureStream()` real-time capture at 960/1280/1920 long edge, optional scratch-audio mixing via `MediaStreamDestination`, with codec negotiation (VP9 → VP8 → MP4) and graceful video-only fallback.
    - `utils/camera.ts` / `utils/storage.ts` / `utils/media.ts` — easing + camera presets, defensive project normalisation for older/partial JSON, and data-URL vs. CORS-safe remote media handling.
    - `hooks/useShotImages.ts` — plate loader/cache keyed by URL so reordering or rewriting the project never re-decodes images.
  - **Import pipeline**: per-shot plate replacement or batch import from the active session library, local file upload (data URLs, nothing leaves the browser) or a remote URL (embedded to a data URL where CORS allows), plus scratch audio import.
  - **Export pipeline**: WebM/MP4 animatic download or "Save to session" (video artifact via `onSaveArtifact`), PNG of the current frame (download or session artifact), and portable project JSON export/import.
  - **Timings/persistence**: project autosaves locally (mirrors the `SxaBoardTool`/`FilmStripEditor` offline-first pattern); session media is consumed read-only through the `activeSession` prop.

- **Media Suite — Magic Layers (new tool)**:
  - Added `src/media_suite/MagicLayers/` and registered it as tool id `magic_layers` ("Magic Layers", indigo stacked-layers icon) with its own full-bleed header (`hasCustomHeader`).
  - Purpose: **AI colour segmentation** — split one image into distinct component layers, inspect them individually, and export each as a transparent PNG.
  - **Architecture**:
    - `App.tsx` — five view modes (Stacked / Explode / Compare / Grid / Original), layer list with visibility + reorder + duplicate, colour palette swatches, layer-detail inspector (dominant colour, hex, RGB, coverage) and a drag-to-compare slider.
    - `utils/segment.ts` — pure client-side segmentation: pixels converted to **CIELAB** (perceptually uniform), **k-means++** seeding with deterministic LCG RNG, up to 14 Lloyd iterations on a bounded 14k-pixel sample, then full-resolution assignment. Work resolution is capped at 900px long edge so large uploads stay responsive.
    - **Alpha handling**: the dominant cluster is always fully opaque while the runner-up receives a feather (0 → 0.5) based on cluster-distance ambiguity. Masks store the *original* pixel colour, so the stacked composite reconstructs the source with ~0.02/255 error and zero seams — a naive shared-alpha or shared-centroid blend leaves visible white bands where clusters meet.
    - Layer names are derived from cluster colour (hue/lightness family, e.g. "Deep Indigo", "Charcoal"), largest component first.
  - **Integration**: uploads via drag-and-drop, file picker, the built-in demo scene, or **images already in the active session**; layers can be downloaded individually or written back into the workspace as image artifacts via `onSaveArtifact`.
  - Added the shared `.checkerboard` transparency utility to `index.css`.

- **Application infographic**: `docs/application-infographic.html` is a standalone, printable and searchable visual overview of the session workflow, suite launcher tools, AI routes and persistence. It is based on the current code snapshot; update its tool directory and caveats when the underlying architecture or launchers change.

**Last Updated**: `2026-11-21 00:00:00+01:00`
- **Testing & CI**: `npm test` runs Vitest unit tests (`tests/`: podcast gating, history storage, tool prompts, podcast HTML, MAGGI key pool). `npm run lint` typechecks (strict mode). GitHub Actions (`.github/workflows/ci.yml`) runs install → lint → test → build on every push/PR.

- **MAGGI — RAG engine rebuilt, with FreeLLMAPI as the brain**:
  - New top-level engine (`services/maggi/`, `components/MaggiView.tsx`, `hooks/useMaggi.ts`, `server/maggiRoutes.ts`) reachable from the library header via the **🧠** button. Full design doc: [`aDOCS/MAGGI.md`](aDOCS/MAGGI.md).
  - **Why**: the previous retrieval layer packed every session media item into one prompt (300k-char truncation) or a single Gemini context cache. That has no ranking, no citations and silently drops content. MAGGI replaces it with a real pipeline — extract → chunk → embed → index → hybrid retrieve → grounded generate → cite. The old path is untouched, so nothing regresses.
  - **Ingest**: PDF (`pdf-parse`), DOCX (`mammoth`), HTML, CSV/JSON/MD/TXT, remote URLs (SSRF-guarded) and pasted notes, plus one-click *Import workspace* for the active session's sources.
  - **Chunking**: structure-aware recursive splitter (paragraph → line → sentence → clause → word) with heading breadcrumbs, configurable size/overlap, content hashes and character offsets.
  - **Retrieval**: hybrid **BM25 + dense vectors**, fused with **Reciprocal Rank Fusion**, plus optional **LLM re-ranking**, **MMR diversification**, **multi-query expansion**, **HyDE** and recency decay. Runs entirely in the browser; only the final context block leaves the machine.
  - **Embeddings**: `text-embedding-004` when a Gemini key exists, `/v1/embeddings` when the brain is FreeLLMAPI, and a genuine offline fallback (hashed word/bigram/char-4-gram, signed hashing, L2-normalised) so the engine always works.
  - **Brain**: **FreeLLMAPI** first-class (`/v1/chat/completions`, `model: auto`, `x-routed-via` surfaced in the UI), with OpenAI-compatible, Gemini and Ollama as alternatives behind one interface. Streaming SSE, connectivity probe and model discovery built in.
  - **Answers**: numbered, citation-ready context (`[1] (report.pdf — Risks › Currency)`), strict/balanced grounding modes, inline `[n]` markers resolved back to exact chunks, clickable citations that jump to the passage, and a per-answer **Retrieval inspector** showing fused/semantic/lexical scores and pipeline traces.
  - **Persistence**: IndexedDB index with localStorage fallback; incremental re-indexing by content hash means a reload never re-embeds and an unchanged file is a no-op.
  - **Server**: `/api/maggi/{chat,chat-stream,embed,extract,probe,health}`, with env-first secret resolution (`FREELLMAPI_BASE_URL`, `FREELLMAPI_API_KEY`), timeouts on every upstream call and actionable error translation.
  - **Tests**: `npm run test:maggi` — 42 offline assertions across tokenizer, chunker, BM25, embeddings, vector index, hybrid fusion, MMR, budget enforcement and citation assembly.
