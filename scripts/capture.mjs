import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const frames = path.join(root, "frames");
const fps = 60;
const seconds = 15;
const width = 1920;
const height = 1080;

function waitFor(url) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {
        /* server still booting */
      }
      if (Date.now() - started > 20000) reject(new Error("dev server did not start"));
      else setTimeout(tick, 200);
    };
    tick();
  });
}

let server = null;
try {
  await waitFor("http://127.0.0.1:5173/");
} catch {
  server = spawn("pnpm", ["dev", "--host", "127.0.0.1"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
  await waitFor("http://127.0.0.1:5173/");
}

try {
  await rm(frames, { recursive: true, force: true });
  await mkdir(frames, { recursive: true });

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto("http://127.0.0.1:5173/?capture=1", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__dial);

  const count = fps * seconds;
  for (let i = 0; i < count; i++) {
    await page.evaluate((t) => window.__dial.seek(t), i / fps);
    await page.screenshot({ path: path.join(frames, `${String(i).padStart(4, "0")}.png`) });
    if (i % 60 === 0) console.log(`frame ${i}/${count}`);
  }

  const wav = await page.evaluate(() => window.__dial.wav());
  await writeFile(path.join(root, "clicks.wav"), Buffer.from(wav, "base64"));
  await browser.close();

  await new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-y",
        "-framerate",
        String(fps),
        "-i",
        path.join(frames, "%04d.png"),
        "-i",
        path.join(root, "clicks.wav"),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "17",
        "-preset",
        "medium",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        path.join(root, "dial-demo.mp4"),
      ],
      { stdio: "inherit" },
    );
    ff.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
  });
  console.log("wrote dial-demo.mp4");
} finally {
  server?.kill();
}
