import { z } from "zod/v4";

export const CreateRatingSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    reason_low_rating: z.string().optional(),
    comment: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.rating <= 3) {
      const value = data.reason_low_rating?.trim() ?? "";
      if (!value) {
        ctx.addIssue({
          code: "custom",
          path: ["reason_low_rating"],
          message: "Motivo da nota é obrigatório para avaliações de 1 a 3",
        });
      }
    }
  });

export type CreateRatingInput = z.infer<typeof CreateRatingSchema>;
