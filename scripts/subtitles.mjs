// Burns word-highlighted subtitles into the demo video.
//   node scripts/subtitles.mjs   → demo-out/concord-demo-subs.mp4
// Uses ElevenLabs per-character timings (demo-out/audio/*.align.json) and the scene timeline written
// by record-demo.mjs. Each spoken word lights up gold exactly when it is said.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const OUT = root + "demo-out/";
const VOICE_OFFSET = 0.35; // must match record-demo.mjs adelay
const MAX_CHARS = 52;

const { timeline } = JSON.parse(readFileSync(OUT + "timeline.json", "utf8"));

const fontDir = OUT + "fonts/";
mkdirSync(fontDir, { recursive: true });
copyFileSync(root + "web/node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff", fontDir + "IBMPlexSans-SemiBold.woff");

const ts = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
};
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/{/g, "(").replace(/}/g, ")");

const GOLD = "&H005AB9E7&", WHITE = "&H00F1EDE4&";
const events = [];

for (const scene of timeline) {
  const a = JSON.parse(readFileSync(`${OUT}audio/${scene.id}.align.json`, "utf8"));
  const base = scene.start + VOICE_OFFSET;
  // characters → words with start/end times
  const words = [];
  let cur = null;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) { if (cur) { words.push(cur); cur = null; } return; }
    if (!cur) cur = { text: "", start: a.character_start_times_seconds[i], end: 0 };
    cur.text += ch;
    cur.end = a.character_end_times_seconds[i];
  });
  if (cur) words.push(cur);

  // words → lines (break on length or sentence end)
  const lines = [];
  let line = [];
  for (const w of words) {
    const len = [...line, w].map((x) => x.text).join(" ").length;
    if (line.length && len > MAX_CHARS) { lines.push(line); line = []; }
    line.push(w);
    if (/[.!?]$/.test(w.text) && line.join("").length > 0 && [...line].map((x) => x.text).join(" ").length > 18) { lines.push(line); line = []; }
  }
  if (line.length) lines.push(line);

  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    const lineEnd = li + 1 < lines.length ? lines[li + 1][0].start : L[L.length - 1].end + 0.6;
    for (let wi = 0; wi < L.length; wi++) {
      const start = wi === 0 ? L[0].start : L[wi].start;
      const end = wi + 1 < L.length ? L[wi + 1].start : lineEnd;
      const text = L.map((w, k) => (k === wi ? `{\\c${GOLD}}${esc(w.text)}{\\c${WHITE}}` : esc(w.text))).join(" ");
      events.push(`Dialogue: 0,${ts(base + start)},${ts(base + end)},Sub,,0,0,0,,${text}`);
    }
  }
}

const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,IBM Plex Sans SemiBold,46,${WHITE},${WHITE},&H00000000&,&H96000000&,0,0,0,0,100,100,0.3,0,1,3.2,1.5,2,160,160,168,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
writeFileSync(OUT + "subs.ass", ass);
console.log(`${events.length} subtitle events`);

execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", "-i", OUT + "concord-demo.mp4",
  "-vf", `ass=${OUT}subs.ass:fontsdir=${fontDir}`,
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy",
  OUT + "concord-demo-subs.mp4",
]);
console.log(`✓ ${OUT}concord-demo-subs.mp4`);
