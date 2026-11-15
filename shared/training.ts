export type { LoggedWorkout } from "./training-schema";

export const manualPrefix = "manual:";
export const isManualWorkout = (id: string) => id.startsWith(manualPrefix);
export const equipmentOptions = [
  "barbell",
  "dumbbell",
  "machine",
  "cable",
  "kettlebell",
  "bodyweight",
  "other",
] as const;

export type TrainingEquipment = (typeof equipmentOptions)[number];
