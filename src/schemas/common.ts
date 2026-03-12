import { z } from 'zod';

export const CollIdSchema = z.number().int().positive().describe('Collection ID');
export const DocIdSchema = z.number().int().positive().describe('Document ID');
export const PageNrSchema = z.number().int().min(1).describe('Page number');
export const ModelIdSchema = z.number().int().positive().describe('Model/HTR ID');
export const IdSchema = z.number().int().positive().describe('Resource ID');

export const PaginationParams = {
  index: z.number().int().min(0).optional().describe('Start index (0-based)'),
  nValues: z.number().int().optional().describe('Number of results (-1 for all)'),
  sortColumn: z.string().optional().describe('Column to sort by'),
  sortDirection: z.string().optional().describe('Sort direction: asc or desc'),
};
