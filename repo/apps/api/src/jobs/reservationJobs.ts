import { getCollection } from '../config/db';
import { createNotification } from '../routes/notification.routes';
import { checkAutoBlacklist } from '../services/blacklist.service';
import {
  DEFAULT_NOSHOW_GRACE_MINUTES,
  DEFAULT_CHECKIN_REMINDER_MINUTES,
} from '@studyroomops/shared-policy';
import { logger } from '../utils/logger';

// Process overdue check-in reminders
// Runs every minute, finds confirmed reservations past start+10 min without check-in
export async function processCheckinReminders(): Promise<number> {
  const col = getCollection('reservations');
  const now = new Date();
  const reminderThreshold = new Date(now.getTime() - DEFAULT_CHECKIN_REMINDER_MINUTES * 60 * 1000);

  // Find reservations that started 10+ minutes ago but haven't been checked in
  const overdueReservations = await col
    .find({
      status: 'confirmed',
      startAtUtc: { $lte: reminderThreshold },
    })
    .toArray() as any[];

  let processed = 0;
  for (const res of overdueReservations) {
    // Check if we already sent a reminder
    const existingReminder = await getCollection('notifications').findOne({
      userId: res.userId,
      type: 'checkin_overdue',
      referenceType: 'reservation',
      referenceId: res._id.toString(),
    });

    if (!existingReminder) {
      await createNotification(
        res.userId,
        'checkin_overdue',
        'Check-in Overdue',
        `Your reservation is past start time and awaiting check-in. Please check in or your reservation may expire.`,
        'reservation',
        res._id.toString(),
        now
      );
      processed++;
    }
  }

  return processed;
}

// Process no-show expiry
// Finds confirmed reservations past start+15 min (grace period) and expires them
export async function processNoshowExpiry(): Promise<number> {
  const col = getCollection('reservations');
  const now = new Date();
  const graceThreshold = new Date(now.getTime() - DEFAULT_NOSHOW_GRACE_MINUTES * 60 * 1000);

  const noshowReservations = await col
    .find({
      status: 'confirmed',
      startAtUtc: { $lte: graceThreshold },
    })
    .toArray() as any[];

  let processed = 0;
  for (const res of noshowReservations) {
    // Transition to expired_no_show
    const updated = await col.findOneAndUpdate(
      { _id: res._id, status: 'confirmed', version: res.version },
      {
        $set: {
          status: 'expired_no_show',
          updatedAt: now,
        },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' }
    );

    if (updated) {
      // Release future unused slices
      await getCollection('reservation_slices').deleteMany({
        reservationId: res._id.toString(),
        slotStartUtc: { $gte: now },
      });

      // Create notification
      await createNotification(
        res.userId,
        'noshow_expired',
        'Reservation Expired - No Show',
        `Your reservation has expired due to no check-in within the grace period.`,
        'reservation',
        res._id.toString()
      );

      // Check auto-blacklist threshold after recording no-show
      await checkAutoBlacklist(res.userId).catch((err: any) => {
        logger.error('noshow-expiry', { action: 'checkAutoBlacklist', userId: res.userId, error: err.message });
      });

      processed++;
    }
  }

  return processed;
}

// Process reservation completion
// Finds checked-in reservations past their end time and completes them
export async function processReservationCompletion(): Promise<number> {
  const col = getCollection('reservations');
  const now = new Date();

  const completableReservations = await col
    .find({
      status: 'checked_in',
      endAtUtc: { $lte: now },
    })
    .toArray() as any[];

  let processed = 0;
  for (const res of completableReservations) {
    await col.updateOne(
      { _id: res._id, status: 'checked_in' },
      {
        $set: {
          status: 'completed',
          completedAt: now,
          updatedAt: now,
        },
        $inc: { version: 1 },
      }
    );
    processed++;
  }

  return processed;
}
