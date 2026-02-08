import { z } from 'zod';

export const createDraftSchema = z.object({
  marketId: z.string().uuid().optional(),
  source: z.string().min(1).optional()
});

export const updateDraftSchema = z.object({
  what: z
    .object({
      itemTypeId: z.string().uuid().optional(),
      brand: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      yearFrom: z.number().int().min(1900).optional(),
      yearTo: z.number().int().min(1900).optional(),
      side: z.string().min(1).optional(),
      position: z.string().min(1).optional()
    })
    .optional(),
  howMuch: z
    .object({
      priceType: z.string().min(1).optional(),
      priceAmount: z.number().positive().optional(),
      currency: z.string().min(1).optional()
    })
    .optional(),
  location: z
    .object({
      department: z.string().min(1).optional(),
      municipality: z.string().min(1).optional()
    })
    .optional(),
  contact: z
    .object({
      sellerType: z.string().min(1).optional(),
      contactName: z.string().min(1).optional(),
      whatsapp: z.string().min(1).optional()
    })
    .optional()
});

export const publishSchema = z.object({});

export const revealContactSchema = z.object({
  tokenCost: z.number().int().positive()
});

export type CreateDraftInput = z.infer<typeof createDraftSchema>;
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;
export type RevealContactInput = z.infer<typeof revealContactSchema>;
