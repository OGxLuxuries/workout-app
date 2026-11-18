import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import workerPath from "tesseract.js/dist/worker.min.js?url";
import corePath from "tesseract.js-core/tesseract-core-lstm.wasm.js?url";
import englishPath from "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url";
import { parseSplits, parseSummary } from "./strava-card";

async function imageCanvas(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(
      1,
      1800 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Image recognition is unavailable.");
    ctx.fillStyle = "#242424";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, ctx };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function splitRows(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  const bars: { top: number; bottom: number; left: number; right: number }[] = [];
  const minimum = Math.max(14, Math.floor(width * 0.04));
  for (let y = Math.floor(height * 0.24); y < height * 0.76; y++) {
    let run = 0,
      right = 0,
      left = 0;
    for (let x = Math.floor(width * 0.14); x < width * 0.88; x++) {
      const at = (y * width + x) * 4;
      const bright = data[at] > 185 && data[at + 1] < 143 && data[at + 2] < 100;
      run = bright ? run + 1 : 0;
      if (run >= minimum) {
        if (!left) left = x - run + 1;
        right = x;
      }
    }
    if (!right) continue;
    const last = bars.at(-1);
    if (last && last.bottom === y - 1) {
      last.bottom = y;
      last.left = Math.min(last.left, left);
      last.right = Math.max(last.right, right);
    } else bars.push({ top: y, bottom: y, left, right });
  }
  const useful = bars.filter(
    (b) => b.bottom - b.top >= 2 && b.bottom - b.top < height * 0.04,
  );
  const aligned = useful.filter(
    (bar) => useful.filter((other) => Math.abs(bar.left - other.left) <= 6).length >= 2,
  );
  return aligned.length > 200 ? [] : aligned;
}

function crop(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
  scale: number,
  faint = false,
  useWhiteText = false,
) {
  const out = document.createElement("canvas");
  out.width = width * scale;
  out.height = height * scale;
  const target = out.getContext("2d")!;
  target.drawImage(canvas, x, y, width, height, 0, 0, out.width, out.height);
  if (!faint) return out;
  const pixels = target.getImageData(0, 0, out.width, out.height);
  // Amplify the shadows around white text in cards flattened onto white.
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray = Math.min(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
    const boosted = useWhiteText
      ? Math.max(0, (254 - gray) * 85)
      : Math.max(0, 255 - (255 - gray) * 15);
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = boosted;
  }
  target.putImageData(pixels, 0, 0);
  return out;
}

export async function recognizeCards(summaryFile: File, splitsFile: File) {
  const summaryImage = await imageCanvas(summaryFile);
  const splitsImage = await imageCanvas(splitsFile);
  const worker = await new Promise<Worker>((resolve, reject) => {
    void createWorker("eng", OEM.LSTM_ONLY, {
      workerPath,
      corePath,
      langPath: new URL(".", new URL(englishPath, location.href)).href,
      workerBlobURL: false,
      cacheMethod: "none",
      errorHandler: reject,
    }).then(resolve, reject);
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const summary = parseSummary(
      (await worker.recognize(summaryImage.canvas)).data.text,
    );
    const { canvas, ctx } = splitsImage;
    const bars = splitRows(canvas, ctx);
    const full = (await worker.recognize(canvas)).data.text;
    const fraction = full.match(/^\s*(0[.,]\d+)\s+/m)?.[1].replace(",", ".");
    const splits = parseSplits(full, fraction);
    if (bars.length) {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        tessedit_char_whitelist: "0123456789:.",
      });
      const right = Math.max(...bars.map((bar) => bar.right)) + 5;
      const left = Math.min(...bars.map((bar) => bar.left));
      const rowHeight = Math.min(...bars.slice(1).map((bar, i) => bar.top - bars[i].top));
      const width = Math.min(canvas.width - right, Math.ceil(rowHeight * 3.4));
      if (width > 10) {
        const rows = [];
        for (const bar of bars) {
          const y = Math.round((bar.top + bar.bottom - rowHeight) / 2);
          const faint = ctx.getImageData(right + 1, y, 1, 1).data[0] > 220;
          const line = crop(canvas, right, y, width, rowHeight, 5, faint);
          const text = (await worker.recognize(line)).data.text;
          let pace = parseSplits(text)[0]?.pace;
          if (!pace && faint) {
            const whiteText = crop(canvas, right, y, width, rowHeight, 5, true, true);
            const result = await worker.recognize(whiteText);
            pace = parseSplits(result.data.text)[0]?.pace;
          }
          rows.push({ distance: "1", pace: pace ?? "" });
        }
        const finalY = Math.round((bars.at(-1)!.top + bars.at(-1)!.bottom - rowHeight) / 2);
        const labelWidth = Math.min(left, Math.ceil(rowHeight * 2.9));
        const label = crop(canvas, left - labelWidth, finalY, labelWidth, rowHeight, 5,
          ctx.getImageData(left - labelWidth, finalY, 1, 1).data[0] > 220);
        const labelText = (await worker.recognize(label)).data.text;
        const partial = labelText.match(/\b0[.,]\d+\b/)?.[0].replace(",", ".") ?? fraction;
        if (partial) rows.at(-1)!.distance = partial;
        return { summary, splits: rows, fractionRecognized: !!partial };
      }
    }
    return {
      summary,
      splits,
      fractionRecognized: !!fraction,
    };
  } finally {
    await worker.terminate();
  }
}
