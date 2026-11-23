# Panda R-6 radio

A retro portable radio for the browser: AM, FM, an MP3 player and Bluetooth output.

## Run it on your computer

1. Unzip `panda-radio-v9.zip` anywhere (for example on the Desktop).
2. Double-click `index.html` inside the `panda-radio` folder. It opens in your browser; no install needed.

Chrome or Edge give the most features (picking a Bluetooth speaker inside the radio).
AM/FM need internet; the MP3 player works offline.

## Put it online with Render (free)

Render publishes websites from a GitHub repository, so the folder goes to GitHub first.

1. **GitHub:** create a new repository (for example `panda-radio`) and upload everything
   inside the `panda-radio` folder: on the repository page choose **Add file → Upload files**
   and drag the files and the `songs` folder in. Upload `songs` in two or three batches,
   because GitHub's web uploader takes at most 100 files / about 100 MB at once.
2. **Render:** sign in at render.com → **New → Static Site** → pick the `panda-radio` repository.
   - Build command: *(leave empty)*
   - Publish directory: `.`
   Then **Create Static Site**. After a minute you get an address like `https://panda-radio.onrender.com`.
   (Or choose **New → Blueprint**: the included `render.yaml` fills in these settings for you.)
3. **Updating later:** upload the changed files to GitHub again; Render republishes by itself.

Netlify works too: drag the whole `panda-radio` folder onto app.netlify.com/drop.

## Using it

| Control | What it does |
|---|---|
| **POWER** | On / off. Sound starts after this first press (browsers require a click). |
| **AM / FM** | Live internet stations laid out on a real dial. FM = music stations, AM = news & talk. Between stations you hear static, and on AM a whistle when slightly off. |
| **TUNING knob** | Drag in a circle, scroll the mouse wheel, or use the arrow keys. You can also click or drag on the dial window. |
| **VOLUME knob** | Same as above. |
| **◀◀ ▶▶** | Seek to the previous / next station. |
| **1–6 (MEMORY)** | Tap to jump to a saved station; hold for about a second to save the current one. |
| **MP3** | Your own songs. ⏮ ⏯ ⏭, SHUFFLE, REPEAT (all → one → off), SONGS opens the list. In MP3 mode the TUNING knob and the dial move through the song. |
| **BT** | Bluetooth & setup: choose the speaker or headphones to play on, which country the stations come from, and the radio's color (Ivory, Graphite, Sage, Cherry). |
| **– (top right)** | Shrinks the radio to a small mini player; ⤢ makes it full size again. |

### Adding your songs
Drop a **.zip** of songs (or MP3 files, or a folder) onto the radio, or use **SONGS → + Songs / ZIP**.
Song names come from the files' tags or from file names like `01 - Artist - Title.mp3`.
The songs are saved in this browser, so they're still there next time.

### Moving the radio
On the desk, drag the radio by its **handle** (the strap on top) or its **speaker** to any spot on the screen, so it does not hide the picture behind it. It stays where you let go, even after you reload the page.
When embedding, add the `movable` attribute to `<retro-radio>` to allow this.

### Wall pictures
In the desk view, the buttons at the top switch the wall behind the radio: **Plain wall**, **Beach**, **Marble**, **Spring train**, **Evening train** or **My picture…**.
All of these were drawn for this project (the files in `walls/`), so they are free to share. The two train walls are animated: a high-speed train crosses the rapeseed fields of 皖南 every few seconds.
**My picture…** lets anyone use their own photo. It stays private in their browser; click it again to pick a different photo.
Marble is the default. The page remembers the last wall you picked.

### Bluetooth
First connect the speaker or headphones in your Mac's Bluetooth settings. Then:
- **Chrome / Edge:** BT → Audio output, then pick the speaker. To show device names, the browser asks once for microphone permission. Nothing is recorded.
- **Safari / Firefox on Mac:** the radio plays through whatever macOS uses (Control Center → Sound).
- The play/pause and skip buttons on the headphones or speaker control the radio.

## Putting it in another app later

```html
<script src="radio.js"></script>

<!-- floating in a corner over the app, shrunk to 70% -->
<retro-radio floating corner="bottom-left" scale="0.7"></retro-radio>

<!-- or as a small pill -->
<retro-radio floating mini corner="bottom-right"></retro-radio>
```

- `corner`: `top-left`, `top-right`, `bottom-left`, `bottom-right`. The user can drag the radio by its handle, and it snaps to the nearest corner.
- `scale`: size (1 = full size, 520 px wide).
- `finish`: `ivory`, `graphite`, `sage`, `cherry`.
- The radio is a self-contained web component (shadow DOM), so its styles never clash with the app around it.
- Events: `radio-change` (power, band, frequency, station, track) and `radio-corner`.

### Shipping songs with the app (optional)
Put songs in a `songs/` folder next to `index.html`, and add `songs/playlist.js`:

```js
window.RETRO_RADIO_PLAYLIST = [
  { src: 'songs/01 - Artist - Title.mp3', title: 'Title', artist: 'Artist' },
];
```
They then show up in the MP3 list for everyone using the app.
