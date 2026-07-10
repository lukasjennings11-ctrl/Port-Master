# Design System — PortMaster

## Visual Theme

Dark arcade. Deep navy backgrounds with vivid accent colors. Each game owns a distinct color personality; the portal is the neutral host that lets game colors breathe. Motion is purposeful — stagger on load, feedback on interaction, silence everywhere else.

**Scene:** Someone with their phone in one hand at 11pm, one game tab open, the room dark. The UI should feel like a screen in that room — not a document, not an app store, not a product page. Electric and focused.

## Color Palette

### Portal tokens
```css
--bg:      #0c1020;   /* deep navy — page background */
--bg2:     #141a30;   /* slightly lighter — gradient from top */
--panel:   #1b2342;   /* card / surface */
--panel2:  #212a50;   /* active / elevated surface */
--text:    #eef2ff;   /* primary text */
--muted:   #8b95bf;   /* secondary text, labels, hints */
--accent:  #5b8cff;   /* primary accent — blue */
--accent2: #7af0d0;   /* secondary accent — teal */
--border:  rgba(255,255,255,.07);
```

### Per-game accent colors (use as `--gc` on cards and in game CSS)
| Game | Accent |
|---|---|
| Fuse | `#5b8cff` (blue) |
| Stack | `#7c6af7` (violet) |
| Orbit | `#7af0d0` (teal) |
| Gem Drop | `#a06af7` (purple) |
| Burst | `#ff8ed4` (pink) |
| Coin Forge | `#ffb347` (amber) |
| Splat | `#3ee6b8` (green-teal) |
| Dash Lanes | `#4fd6ff` (sky) |
| Equate | `#4fe0c8` (teal-mint) |
| Outpost | `#5ef79b` (green) |

Each game's style.css uses `--accent` and `--accent2` from its own palette. The portal uses `--gc` (game color) as a per-card custom property.

### Color strategy
**Committed dark** — the background IS the brand. Accents pop against near-black. No warm neutrals, no beige. The saturated per-game colors do the work; the portal surfaces stay dark and subordinate.

## Typography

**Font stack:** `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` — no web font load penalty.

### Scale
| Role | Size | Weight | Letter-spacing |
|---|---|---|---|
| Portal hero H1 | `clamp(40px, 10vw, 72px)` | 900 | -0.02em |
| Game brand (in HUD) | `clamp(22px–28px, 6–8vw, 30–40px)` | 900 | 2–3px |
| Card title | 20px | 800 | -0.01em |
| Section label / genre chip | 11–12px | 700 | 0.07–0.12em uppercase |
| Body / tagline | 13–15px | 400 | normal |
| Score number | 18–24px | 800 | normal |
| HUD label | 10px | — | 1.5px uppercase |

### Rules
- `text-wrap: balance` on H1 and card titles
- Line-height: 1.1 for display, 1.45–1.55 for body
- Cap body copy at 48–65ch

## Components

### Portal card
- Background: `--panel`, border: `1.5px solid var(--border)`
- Border-radius: 22px
- Top color band: `2px` absolute, using `--gc`
- Hover: `translateY(-4px)` + `box-shadow` glow with `--gc` at 1.5px ring
- Icon container: 44×44px, `border-radius: 12px`, `color-mix(in srgb, --gc 16%, transparent)` background
- Genre chip: 11px 700 uppercase, color `--gc`
- Play button: bordered pill using `--gc` at 18% fill + 50% border

### HUD (in-game)
- `.brand` → `<a>` linking to portal `../../`
- `.brand` hover: `opacity: .8`, 100ms ease
- Score boxes: `--panel`, `border-radius: 12px`, padding 5–6px 13–14px
- `.label`: 10px, 1.5px letter-spacing, uppercase, `--muted`
- Icon buttons: 36–38px square, `border-radius: 10px`, `--panel` bg
- Active/hover: `scale(.94)` on active, `brightness(1.12)` on hover

### Overlay / game-over panel
- Backdrop: `rgba(8,11,24,.72)` + `backdrop-filter: blur(4px)`
- Panel: `--panel`, `border-radius: 20px`, max-width 320px
- Entry animation: `translateY(14px) scale(.92)` → zero, 300ms `cubic-bezier(.2,1.3,.5,1)`
- CTA button: full width, gradient `linear-gradient(120deg, --accent, --accent2)`, dark text

### Filter chips (portal)
- `border-radius: 999px`, `1.5px solid --border`
- Active: `--panel2` bg, `--accent` border, white text
- Transition: 120ms ease on color + border-color + background

## Layout

- Portal max-width: 960px, centered
- Game app max-width: 420–520px per game (varies by genre needs)
- Portal grid: `repeat(auto-fill, minmax(260px, 1fr))`, gap 14px
- Wrap padding: `52px 20px 80px` desktop, `36px 16px 60px` mobile
- Flex for 1D (HUD rows, subbar, controls)
- Grid for 2D (card grid, game boards where applicable)

## Motion

### Easing vocabulary
```
--ease-out-quart: cubic-bezier(0.22, 1, 0.36, 1)   /* card reveal, overlays */
outCubic (juice.js): for tile/orb movement
outBack (juice.js): for spawn/pop effects
```

### Portal animations
- **Hero**: `heroFade` — `opacity 0 + translateY(10px)` → zero, 500ms `ease-out-quart`
- **Filter strip**: same, 60ms delay
- **Cards**: `cardReveal` — `opacity 0 + translateY(14px)` → zero, 420ms `ease-out-quart`, staggered `calc(var(--i) * 40ms + 80ms)` per card
- `@media (prefers-reduced-motion: reduce)`: all animations `none`

### In-game motion (via juice.js)
- Particle bursts: on merge, match, score milestone
- Screen shake: on game-over, big combos
- Float popups: score increments surface above action
- Tile/block movement: 110–120ms outCubic slide
- Merge pop: 180ms outBack scale pulse
- Overlay entry: 280–300ms `cubic-bezier(.2,1.3,.5,1)` pop

### Rules
- UI interactions: 80–140ms (button scale, hover lift)
- State transitions: 120–250ms (filter, overlay fade)
- Entrances: 300–500ms (hero, cards, panel pop)
- No layout property animation
- No decorative ambient animation (no floating particles, no idle loops on the portal)

## Elevation

| Level | Use | Shadow |
|---|---|---|
| 0 | Flat / inset | none |
| 1 | Cards, score boxes | `0 2px 8px rgba(0,0,0,.35)` |
| 2 | Panels, subbar items | `0 8px 28px rgba(0,0,0,.50)` |
| 3 | Overlays, hover cards | `0 16px 48px rgba(0,0,0,.60)` |

## Design Principles (from PRODUCT.md)

1. **Zero to game in one tap** — Cards behave like buttons
2. **Each game earns its own color** — Per-game `--gc` carries identity
3. **Copy as design** — Taglines describe the action, not the feeling
4. **Mobile as true canvas** — Max-widths, safe areas, `touch-action: manipulation`
5. **Motion signals state** — One stagger on load; silence after
