import { z } from 'zod';
import { listingStatusSchema } from '../domain/contracts';

export const updateListingStatusSchema = z.object({
  status: listingStatusSchema
});

export type UpdateListingStatusInput = z.infer<typeof updateListingStatusSchema>;
