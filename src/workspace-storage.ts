import type { Draft } from "./Session";
import type { SaveInput, WorkspaceHome } from "./workspace-api";

let database: Promise<IDBDatabase> | undefined;
function open() {
  if (!database)
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("workout-competition", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("training");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("Workout storage is blocked by another tab."));
    }).catch((error) => {
      database = undefined;
      throw error;
    });
  return database;
}
export async function read<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction("training").objectStore("training").get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}
export async function write(key: string, value: unknown): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("training", "readwrite");
    if (value === null) tx.objectStore("training").delete(key);
    else tx.objectStore("training").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(
        tx.error ?? new Error("Could not store the workout on this device."),
      );
  });
}
export async function changePending(
  owner: string,
  change: (items: PendingWorkout[]) => PendingWorkout[],
  clearDraft?: string,
): Promise<PendingWorkout[]> {
  const db = await open(),
    keys = localKeys(owner);
  return new Promise((resolve, reject) => {
    const tx = db.transaction("training", "readwrite");
    const store = tx.objectStore("training"),
      lookup = store.get(keys.pending);
    let next: PendingWorkout[] = [];
    lookup.onsuccess = () => {
      next = change(lookup.result ?? []);
      store.put(next, keys.pending);
    };
    if (clearDraft) {
      const draft = store.get(keys.draft);
      draft.onsuccess = () => {
        if (draft.result?.id === clearDraft) store.delete(keys.draft);
      };
    }
    tx.oncomplete = () => resolve(next);
    tx.onabort = () =>
      reject(tx.error ?? new Error("Could not update pending workouts."));
  });
}
export const localKeys = (owner: string) => ({
  draft: "draft:" + owner,
  pending: "pending:" + owner,
  home: "home:" + owner,
  history: "workouts:" + owner,
});
export async function loadDraft(owner: string) {
  const key = localKeys(owner).draft;
  const stored = await read<Draft>(key);
  if (stored) return stored;
  const oldKey = "workout-draft-v1:" + owner;
  const legacy = localStorage.getItem(oldKey);
  if (!legacy) return null;
  const value = JSON.parse(legacy) as Draft;
  await write(key, value);
  localStorage.removeItem(oldKey);
  return value;
}
export type PendingWorkout = {
  payload: SaveInput;
  error?: string;
  conflict?: boolean;
};
export function cachedHome(home: WorkspaceHome): WorkspaceHome {
  return { ...home, groups: [], people: [], permissions: [] };
}
