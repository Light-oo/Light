import { z } from 'zod';
import { userRoleSchema } from '../domain/contracts';

export const updateProfileSchema = z
  .object({
    role: userRoleSchema.optional(),
    whatsapp: z.string().min(1).optional(),
    contactUrl: z.string().url().optional()
  })
  .refine((data) => data.role !== 'seller' || data.whatsapp || data.contactUrl, {
    message: 'Provide at least one contact method for sellers',
    path: ['whatsapp']
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
