import type {
  CatalogExercise,
  Routine,
  TrainingPreferences,
  TrainingWorkout,
  WorkoutEntry,
  personalRecords,
  summarize,
} from "../shared/workspace";

export type TrainingGroup = {
  id: string;
  name: string;
  timezone: string;
  owner_id: string | null;
};
export type Person = { id: string; name: string };
export type Permission = {
  scope: "person" | "group";
  target_id: string;
  named: number;
};
export type WorkspaceHome = {
  settings: TrainingPreferences;
  routines: Routine[];
  groups: TrainingGroup[];
  people: Person[];
  permissions: Permission[];
  catalog: CatalogExercise[];
};
export type Cursor = { after: string; key: string };
export type WorkoutPage = { items: WorkoutEntry[]; next: Cursor | null };
export type Summary = ReturnType<typeof summarize>;
export type MetricView = Summary & {
  days: ({ day: string } & Summary)[];
  latest: string | null;
  sources: string[];
};
export type Metrics = {
  summary: MetricView;
  variants: { id: string; label: string }[];
  records: ReturnType<typeof personalRecords>;
};
export type Comparison = {
  self: MetricView;
  peer?: { name: string; summary: MetricView } | null;
  reason?: string;
  median?: Pick<
    Summary,
    "volume" | "sets" | "seconds" | "sessions" | "reps" | "top"
  > | null;
  contributors?: number;
  named?: {
    name: string;
    summary: Pick<
      Summary,
      "volume" | "sets" | "seconds" | "sessions" | "reps" | "top"
    >;
  }[];
};
export type SaveInput = {
  id: string;
  mutationId: string;
  expectedRevision: number;
  workout: TrainingWorkout;
  routine?: Routine;
  exportToStrava?: boolean;
};
export type StravaStatus = {
  enabled: boolean;
  connected: boolean;
  jobs: { workout_id: string; state: string; updated_at: string }[];
};
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public revision?: number,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api/app/v2" + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-Workout-Request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) {
    const failure = value as { error?: string; revision?: number };
    throw new RequestError(
      failure.error ?? "Request failed. Try again.",
      response.status,
      failure.revision,
    );
  }
  return value as T;
}
export function query(
  path: string,
  params: Record<string, string | undefined>,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value) search.set(key, value);
  return path + (search.size ? "?" + search.toString() : "");
}
