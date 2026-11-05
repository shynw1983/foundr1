import { after } from 'next/server';
import { sweepGoogleHours } from './google-business-hours';

export function dispatchGoogleHours(storeId: string, hasQueuedWork: boolean | number) {
  if (!hasQueuedWork) return;
  after(async () => {
    try {
      await sweepGoogleHours(Date.now() + 65000, storeId);
    } catch (error) {
      console.error('Google hours dispatch failed; queued work can be retried', error);
    }
  });
}
