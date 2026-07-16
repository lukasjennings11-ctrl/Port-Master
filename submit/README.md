# Port Boss — submission files (everything in one place)

This folder holds **every file you need to submit Port Boss** to a game portal, sorted by portal.
You don't need the terminal — just download a file and drag it into the matching box on the form.

Two step-by-step guides live right here next to this file:
- **`SUBMIT-GUIDE.md`** — the simple, plain-English walkthrough (start here).
- **`SUBMIT-DETAILS.md`** — the exact text/answer for every field on the forms.

---

## 📁 `crazygames/` — for developer.crazygames.com

| File | Goes in the form box… |
|---|---|
| `portboss-crazygames.zip` | **Game file** (upload this) |
| `cover-landscape-1920x1080.png` | Cover images → **Landscape 16:9** |
| `cover-portrait-800x1200.png` | Cover images → **Portrait 2:3** |
| `cover-square-800x800.png` | Cover images → **Square 1:1** |
| `video-landscape-1920x1080.mp4` | Preview videos → **Landscape video** |
| `video-portrait-1080x1920.mp4` | Preview videos → **Portrait video** |

## 📁 `poki/` — for developers.poki.com

| File | Goes in the form box… |
|---|---|
| `portboss-poki.zip` | **Game file** (upload this — gambling event removed, so "no gambling" is honest) |
| `poki-thumbnail-1080x1080.png` | **Thumbnail** (1080×1080, no text) |

> Poki also asks for a short **animated** thumbnail (mp4) *before global release* — not needed to
> apply. Ask me when you get there and I'll make one.

---

## ⚠️ Don't mix the game files up
CrazyGames gets **`crazygames/portboss-crazygames.zip`**, Poki gets **`poki/portboss-poki.zip`**.
They're built differently (SDKs, and the wager event is stripped from the Poki one).

## If a portal emails you about an "SDK" / "integration" / "loading event"
Don't try to fix it yourself — paste the email into our chat and I'll patch the zip and send a new
one, usually the same day.
