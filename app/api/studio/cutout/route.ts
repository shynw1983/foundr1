import { handleCutout } from './handler';
export const runtime = 'nodejs';
export const maxDuration = 180;
export async function POST(request: Request) { return handleCutout(request); }
