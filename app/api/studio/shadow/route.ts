import { handleShadow } from './handler';
export const runtime = 'nodejs';
export const maxDuration = 75;
export async function POST(request: Request) { return handleShadow(request); }
