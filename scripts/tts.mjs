// Generates the voiceover for each scene with ElevenLabs and records each clip's duration.
//   node scripts/tts.mjs            (reads ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID from .env.demo)
// Output: demo-out/audio/<scene>.mp3 and demo-out/audio/durations.json
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
for (const f of [".env.demo", ".env"])
  if (existsSync(root + f))
    for (const line of readFileSync(root + f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
const key = process.env.ELEVENLABS_API_KEY || process.env.key || process.env.KEY;
const voice = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";
const model = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
if (!key) { console.error("ELEVENLABS_API_KEY missing (.env.demo)"); process.exit(1); }

const scenes = JSON.parse(readFileSync(root + "scripts/narration.json", "utf8"));
const out = root + "demo-out/audio/";
mkdirSync(out, { recursive: true });
const durations = {};
for (const s of scenes) {
  const file = `${out}${s.id}.mp3`;
  const alignFile = `${out}${s.id}.align.json`;
  if (!existsSync(file) || !existsSync(alignFile) || process.argv.includes("--force")) {
    // with-timestamps returns the audio plus per-character timings, used for highlighted subtitles.
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ text: s.text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true } }),
    });
    if (!r.ok) { console.error(`ElevenLabs ${r.status} on ${s.id}: ${(await r.text()).slice(0, 300)}`); process.exit(1); }
    const j = await r.json();
    writeFileSync(file, Buffer.from(j.audio_base64, "base64"));
    writeFileSync(alignFile, JSON.stringify(j.alignment ?? j.normalized_alignment));
  }
  const d = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
  durations[s.id] = d;
  console.log(`${s.id.padEnd(14)} ${d.toFixed(2)}s`);
}
writeFileSync(out + "durations.json", JSON.stringify(durations, null, 2));
console.log(`total ${Object.values(durations).reduce((a, b) => a + b, 0).toFixed(1)}s`);
