const clock = /\b(\d{1,2})\s*[:.]\s*([0-5]\d)\b/g;

export function parseSummary(text: string) {
  const distance = text.match(/(?<![:/\d])\b(\d{1,3}(?:[.,]\d{1,3})?)\s*(mi|km)\b/i);
  const pace = text.match(/\b(\d{1,2})\s*:\s*([0-5]\d)\s*\/\s*(mi|km)\b/i);
  const duration = text.match(
    /\b(?:(\d+)\s*h(?:r)?\s*)?(\d{1,2})\s*m(?:in)?(?![a-z])\s*(?:(\d+)\s*s(?:ec)?)?/i,
  );
  const title = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(
      (line) =>
        /^[\p{L}][\p{L}\d '’&-]{2,70}$/u.test(line) &&
        /\b(run|jog|race|5k|10k|marathon)\b/i.test(line),
    );
  return {
    title,
    distance: distance?.[1].replace(",", "."),
    unit:
      (distance?.[2] ?? pace?.[3])?.toLowerCase() === "km"
        ? ("km" as const)
        : ("mi" as const),
    pace: pace ? pace[1] + ":" + pace[2] : undefined,
    seconds: duration
      ? String(
          Number(duration[1] ?? 0) * 3600 +
            Number(duration[2]) * 60 +
            Number(duration[3] ?? 0),
        )
      : undefined,
  };
}

export function parseSplits(text: string, finalDistance?: string) {
  const rows = [...text.matchAll(clock)].slice(0, 200);
  return rows.map(([_, minutes, seconds], index) => ({
    distance: index === rows.length - 1 && finalDistance ? finalDistance : "1",
    pace: minutes + ":" + seconds,
  }));
}

export function paceSeconds(value: string) {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

export function formatClock(seconds: number) {
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}
