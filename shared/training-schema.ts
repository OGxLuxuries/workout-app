import { z } from "zod";
import { equipmentOptions } from "./training";

export const loggedWorkoutSchema = z
  .object({
    id: z.uuid(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    exercises: z
      .array(
        z
          .object({
            templateId: z.string().min(1).max(160).nullable(),
            title: z.string().trim().min(1).max(100),
            equipment: z.enum(equipmentOptions),
            sets: z
              .array(
                z
                  .object({
                    reps: z.number().int().min(1).max(999),
                    weightKg: z.number().min(0).max(2500).nullable(),
                    warmup: z.boolean(),
                  })
                  .strict(),
              )
              .min(1)
              .max(20),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict();

export type LoggedWorkout = z.infer<typeof loggedWorkoutSchema>;
