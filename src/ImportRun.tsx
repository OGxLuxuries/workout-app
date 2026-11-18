import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  runExercise,
  stravaRunInput,
  trainingDay,
  trainingTime,
  workoutInput,
  type StravaRun,
  type WorkoutEntry,
} from "../shared/workspace";
import { manualPrefix } from "../shared/training";
import { useResource, titleFor } from "./Research";
import { formatClock, paceSeconds } from "./strava-card";
import {
  query,
  type SaveInput,
  type WorkoutPage,
  type WorkspaceHome,
} from "./workspace-api";

const emptySplit = () => ({ distance: "", pace: "" });
const factor = (unit: "mi" | "km") => (unit === "mi" ? 1609.344 : 1000);

function RunCardPreview({ file, label }: { file: File; label: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const preview = URL.createObjectURL(file);
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [file]);
  return (
    <figure>
      {url && <img src={url} alt={label} />}
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function RunSplits({ run }: { run: StravaRun }) {
  return (
    <div className="workspace-form">
      <p>
        Average pace{" "}
        <strong>
          {formatClock(run.paceSeconds)} /{run.unit}
        </strong>
      </p>
      <table className="run-splits">
        <caption>Strava splits</caption>
        <thead>
          <tr>
            <th scope="col">Split</th>
            <th scope="col">Distance ({run.unit})</th>
            <th scope="col">Pace (/{run.unit})</th>
          </tr>
        </thead>
        <tbody>
          {run.splits.map((split, index) => (
            <tr key={index}>
              <td>{index + 1}</td>
              <td>{split.distance}</td>
              <td>{formatClock(split.paceSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ImportRun({
  home,
  initial,
  save,
}: {
  home: WorkspaceHome;
  initial?: WorkoutEntry;
  save: (payload: SaveInput) => Promise<void>;
}) {
  const existing = initial?.details?.stravaRun;
  const savedSet = initial?.details?.movements[0]?.sets[0];
  const zone = home.settings.timezone;
  const [title, setTitle] = useState(
    initial ? titleFor(initial) : "Strava run",
  );
  const [day, setDay] = useState(
    initial ? trainingDay(initial.workout.start_time, zone) : "",
  );
  const [unit, setUnit] = useState<"mi" | "km">(existing?.unit ?? "mi");
  const [distance, setDistance] = useState(
    savedSet?.meters
      ? String(Number((savedSet.meters / factor(unit)).toFixed(3)))
      : "",
  );
  const [duration, setDuration] = useState(
    savedSet?.seconds ? formatClock(savedSet.seconds) : "",
  );
  const [pace, setPace] = useState(
    existing ? formatClock(existing.paceSeconds) : "",
  );
  const [splits, setSplits] = useState(
    existing?.splits.map((s) => ({
      distance: String(s.distance),
      pace: formatClock(s.paceSeconds),
    })) ?? [emptySplit()],
  );
  const [group, setGroup] = useState(initial?.details?.groupId ?? "");
  const [summary, setSummary] = useState<File | null>(null);
  const [splitCard, setSplitCard] = useState<File | null>(null);
  const [review, setReview] = useState(!!existing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const id = useRef(initial?.workout.id.slice(manualPrefix.length));
  async function readImages(event: FormEvent) {
    event.preventDefault();
    if (!summary || !splitCard) return;
    if (
      [summary, splitCard].some(
        (file) => !file.type.startsWith("image/") || file.size > 12_000_000,
      )
    ) {
      setError("Choose two images smaller than 12 MB each.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("Reading both images on this device…");
    try {
      const { recognizeCards } = await import("./strava-ocr");
      const result = await recognizeCards(summary, splitCard);
      const stats = result.summary;
      setTitle(stats.title ?? "Strava run");
      setUnit(stats.unit);
      setDistance(stats.distance ?? "");
      setPace(stats.pace ?? "");
      setDuration(stats.seconds ? formatClock(Number(stats.seconds)) : "");
      const rows = result.splits;
      if (rows.length) {
        const last = rows.at(-1)!;
        const remainder = Number(stats.distance) - rows.length + 1;
        if (!result.fractionRecognized && remainder > 0 && remainder < 1)
          last.distance = String(Number(remainder.toFixed(3)));
        setSplits(rows);
      }
      setStatus(
        stats.distance &&
          stats.seconds &&
          stats.pace &&
          rows.length &&
          rows.every((row) => row.pace)
          ? "Review the numbers against both cards before sharing."
          : "Some numbers were hard to read. Check both cards and fill in any missing fields.",
      );
    } catch {
      setStatus(
        "The image reader couldn’t read these cards. You can enter the values below.",
      );
    } finally {
      setReview(true);
      setBusy(false);
    }
  }
  async function saveRun(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!home.groups.some((item) => item.id === group))
      return setError("Choose the group that can see this run.");
    const seconds = paceSeconds(duration);
    const meters = Number(distance) * factor(unit);
    const run = stravaRunInput.safeParse({
      unit,
      paceSeconds: paceSeconds(pace),
      splits: splits.map((row) => ({
        distance: Number(row.distance),
        paceSeconds: paceSeconds(row.pace),
      })),
    });
    if (
      !run.success ||
      !seconds ||
      !Number.isFinite(meters) ||
      meters <= 0 ||
      !day
    )
      return setError(
        "Enter a date, distance, time, and a valid pace for every split.",
      );
    const earliest = Date.parse(trainingTime(day, zone));
    const daytime = Date.parse(trainingTime(day, zone, "12:00:00"));
    const start = Math.max(
      earliest,
      Math.min(daytime, Date.now() - seconds * 1000),
    );
    if (start + seconds * 1000 > Date.now() + 120000)
      return setError("Check the run date and duration.");
    const workout = workoutInput.safeParse({
      title,
      startedAt: new Date(start).toISOString(),
      finishedAt: new Date(start + seconds * 1000).toISOString(),
      audience: "group",
      groupId: group,
      stravaRun: run.data,
      movements: [
        {
          ...runExercise,
          rowId: initial?.details?.movements[0].rowId ?? crypto.randomUUID(),
          group: null,
          restSeconds: null,
          sets: [
            {
              id: savedSet?.id ?? crypto.randomUUID(),
              reps: null,
              weightKg: null,
              seconds,
              meters,
              warmup: false,
            },
          ],
        },
      ],
    });
    if (!workout.success)
      return setError("Check the run title, distance, and time.");
    setBusy(true);
    try {
      await save({
        id: (id.current ??= crypto.randomUUID()),
        mutationId: crypto.randomUUID(),
        expectedRevision: initial?.revision ?? 0,
        workout: workout.data,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this run.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="train-stack">
      <details className="card workspace-form">
        <summary>Upload a Strava run tutorial</summary>
        <ol className="strava-tutorial">
          <li>
            <p>
              In Strava, open your run and tap <strong>Share</strong>. Select a
              card with <strong>Distance, Pace, and Time</strong>, then tap{" "}
              <strong>Save</strong>.
            </p>
            <img
              loading="lazy"
              src="/api/app/v2/run-tutorial/summary"
              width="638"
              height="1280"
              alt="Strava share menu with the distance, pace, and time card selected and Save below it"
            />
          </li>
          <li>
            <p>
              In the same menu, select <strong>Mile Splits</strong> and tap{" "}
              <strong>Save</strong> again. Choose both saved images below.
            </p>
            <img
              loading="lazy"
              src="/api/app/v2/run-tutorial/splits"
              width="636"
              height="1280"
              alt="Strava share menu with the Mile Splits card selected and Save below it"
            />
          </li>
        </ol>
      </details>
      {!review ? (
        <form className="card workspace-form" onSubmit={readImages}>
          <p>
            Your phone reads the images here. The app saves the reviewed stats
            and keeps the images on your device.
          </p>
          <label>
            Distance, pace, and time image
            <input
              type="file"
              accept="image/*"
              required
              disabled={busy}
              onChange={(e) => setSummary(e.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Mile splits image
            <input
              type="file"
              accept="image/*"
              required
              disabled={busy}
              onChange={(e) => setSplitCard(e.target.files?.[0] ?? null)}
            />
          </label>
          <button className="primary" disabled={busy || !summary || !splitCard}>
            Read images and review splits
          </button>
        </form>
      ) : (
        <form className="card workspace-form" onSubmit={saveRun}>
          <h2>Review run and splits</h2>
          {summary && splitCard && (
            <details>
              <summary>View selected images</summary>
              <div className="run-card-previews">
                <RunCardPreview file={summary} label="Distance, pace, and time" />
                <RunCardPreview file={splitCard} label="Mile splits" />
              </div>
            </details>
          )}
          <label>
            Run title
            <input
              required
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Run date
            <input
              type="date"
              required
              max={trainingDay(new Date(), zone)}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <div className="run-fields">
            <label>
              Distance
              <input
                required
                type="number"
                min="0.001"
                step="any"
                inputMode="decimal"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
              />
            </label>
            <label>
              Units
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value === "km" ? "km" : "mi")}
              >
                <option value="mi">Miles</option>
                <option value="km">Kilometers</option>
              </select>
            </label>
            <label>
              Time (min:sec)
              <input
                required
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="30:12"
              />
            </label>
            <label>
              Pace (min:sec per {unit})
              <input
                required
                value={pace}
                onChange={(e) => setPace(e.target.value)}
                placeholder="12:50"
              />
            </label>
          </div>
          <fieldset className="workspace-form">
            <legend>Splits</legend>
            {splits.map((row, index) => (
              <div key={index} className="run-fields">
                <label>
                  Split {index + 1} distance ({unit})
                  <input
                    required
                    type="number"
                    min="0.001"
                    max="1"
                    step="any"
                    inputMode="decimal"
                    value={row.distance}
                    onChange={(e) =>
                      setSplits((old) =>
                        old.map((r, i) =>
                          i === index ? { ...r, distance: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Split {index + 1} pace
                  <input
                    required
                    value={row.pace}
                    onChange={(e) =>
                      setSplits((old) =>
                        old.map((r, i) =>
                          i === index ? { ...r, pace: e.target.value } : r,
                        ),
                      )
                    }
                    placeholder="10:39"
                  />
                </label>
                <button
                  type="button"
                  className="text-button"
                  disabled={splits.length < 2}
                  onClick={() =>
                    setSplits((old) => old.filter((_, i) => i !== index))
                  }
                >
                  Remove split {index + 1}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              disabled={splits.length === 200}
              onClick={() => setSplits((old) => [...old, emptySplit()])}
            >
              Add split
            </button>
          </fieldset>
          <label>
            <span id="run-share-group-label">Share with competition group</span>
            <select
              aria-labelledby="run-share-group-label"
              required
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            >
              <option value="">Choose a group</option>
              {home.groups.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <p>
            Members of the selected group can see the run and splits in Compare.
            Runs don’t add to lifting scores.
          </p>
          <button className="primary" disabled={busy || !group}>
            Save and share run
          </button>
          {!initial && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setReview(false);
                setStatus("");
              }}
            >
              Choose images again
            </button>
          )}
        </form>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function CompetitionRuns({
  home,
  owner,
  revision,
  initialGroup,
}: {
  home: WorkspaceHome;
  owner: string;
  revision: number;
  initialGroup?: string;
}) {
  const [selection, setSelection] = useState(initialGroup ?? "");
  const group =
    home.groups.find((g) => g.id === selection) ??
    home.groups.find((g) => g.id === "original") ??
    home.groups[0];
  const { value, error } = useResource<WorkoutPage>(
    group ? query("/workouts", { runGroup: group.id }) : null,
    revision,
  );
  return (
    <section className="card workspace-form">
      <h3>Shared runs</h3>
      {group && (
        <label>
          Competition group
          <select
            value={group.id}
            onChange={(e) => setSelection(e.target.value)}
          >
            {home.groups.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!group && <p>Join a competition group to see shared runs.</p>}
      {error && <p role="alert">{error}</p>}
      {group && !error && !value && <p role="status">Loading shared runs…</p>}
      {value?.items.length === 0 && <p>No runs shared with this group yet.</p>}
      {value?.items.map((entry) => {
        const run = entry.details?.stravaRun;
        const set = entry.details?.movements[0]?.sets[0];
        if (!run || !set?.meters || !set.seconds) return null;
        return (
          <details key={entry.workout.id + ":" + entry.owner}>
            <summary>
              {titleFor(entry)} ·{" "}
              {entry.owner === owner
                ? "You"
                : (home.people.find((p) => p.id === entry.owner)?.name ??
                  "Group member")}
            </summary>
            <p>
              {trainingDay(
                entry.workout.start_time,
                group?.timezone ?? home.settings.timezone,
              )}{" "}
              · {Number((set.meters / factor(run.unit)).toFixed(3))} {run.unit}{" "}
              · {formatClock(set.seconds)}
            </p>
            <RunSplits run={run} />
          </details>
        );
      })}
    </section>
  );
}
