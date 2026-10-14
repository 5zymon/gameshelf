# README media

Images shown by the root [`README.md`](../../README.md). The app never loads
anything from this directory.

## Demo GIFs to record

| File               | README placeholder                | Shows                                      | Length  |
| ------------------ | --------------------------------- | ------------------------------------------ | ------- |
| `photo-import.gif` | right under the header            | a shelf photo turning into catalog entries | 15–25 s |
| `catalog-tour.gif` | "See it in action" after Features | browsing, filtering and a game page        | 10–20 s |

### `photo-import.gif`: the main selling point

Before recording: log in, configure the vision model in Settings and the IGDB
credentials in `.env`, and pick one or two well-lit shelf photos with 8–15
readable spines.

1. Start on **Import** with the photos ready in Finder.
2. Drag them onto the drop zone; show the thumbnails, then upload.
3. On the progress page, show photos moving from queued to done and the
   counter going up. Cut or speed up the wait for the vision model.
4. If a title is flagged, resolve it once: search, pick the match.
5. End on the catalog grid with the new covers in place.

### `catalog-tour.gif`

1. Catalog grid; type a few letters in search, toggle two platform chips,
   change the sort.
2. Open a game: scroll the page, open the gallery lightbox, close it.
3. Settings: switch the theme to dark, go back to the catalog.

## Recording settings

- Browser viewport 1280×800 at 100% zoom; hide the bookmarks bar and
  extensions; move the cursor deliberately.
- Export 960 px wide (the README shows them at up to 900 px), 12–15 fps,
  looping forever.
- Keep each file under 5 MB so it loads fast on GitHub; never above 10 MB.
- From a screen recording (e.g. QuickTime) with ffmpeg:

  ```bash
  ffmpeg -i recording.mov -vf "fps=15,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 photo-import.gif
  ```

## Privacy checklist

- Use the seeded `qa@gameshelf.local` account or a throwaway one, never a
  personal email.
- Never show the Settings LLM section with a real base URL or key, or the
  `.env` file.
- Close other tabs and silence notifications.

## Turning a placeholder on

Commit the GIF here under the exact file name above. In the root `README.md`,
find its `TODO(demo-gif)` comment, delete that line, then delete the `<!--`
line and the `-->` line around the block below it. Commit both in the same
change.
