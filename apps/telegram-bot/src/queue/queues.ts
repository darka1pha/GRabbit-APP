import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../config/constants.js';
import { MediaJobPayload } from '../core/types/job.js';
import { getRedisConnection } from './redis.js';

let mediaQueue: Queue<MediaJobPayload> | null = null;

export function getMediaQueue(): Queue<MediaJobPayload> {
  if (!mediaQueue) {
    const redis = getRedisConnection();
    mediaQueue = new Queue<MediaJobPayload>(QUEUE_NAMES.MEDIA_PROCESSING, {
      connection: redis,
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 3000,
        },
        removeOnComplete: {
          age: 3600, // keep 1 hour
          count: 500,
        },
        removeOnFail: {
          age: 86400, // keep 24 hours
          count: 1000,
        },
      },
    });
  }

  return mediaQueue;
}

export async function closeMediaQueue(): Promise<void> {
  if (mediaQueue) {
    await mediaQueue.close();
    mediaQueue = null;
  }
}
