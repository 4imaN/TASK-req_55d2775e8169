import { getCollection } from '../config/db';
import { createNotification } from '../routes/notification.routes';
import { LEAD_SLA_HOURS } from '@studyroomops/shared-policy';

// Statuses that are actively pending staff attention
const ACTIVE_STATUSES = ['New', 'In Discussion', 'Quoted'];

/**
 * processLeadSlaReminders
 *
 * Finds leads in active statuses (New / In Discussion / Quoted) whose
 * lastActivityAt is older than LEAD_SLA_HOURS (24h). For each such lead,
 * creates a notification for all users with the 'creator' or 'administrator'
 * role, deduplicating within a 24-hour window so staff are not spammed.
 */
export async function processLeadSlaReminders(): Promise<number> {
  const now = new Date();
  const slaThreshold = new Date(now.getTime() - LEAD_SLA_HOURS * 60 * 60 * 1000);
  const dedupeWindow = new Date(now.getTime() - LEAD_SLA_HOURS * 60 * 60 * 1000);

  const leadsCol = getCollection('leads');

  const overdueLeads = await leadsCol
    .find({
      status: { $in: ACTIVE_STATUSES },
      lastActivityAt: { $lt: slaThreshold },
    })
    .toArray() as any[];

  if (overdueLeads.length === 0) return 0;

  // Fetch all staff users (creators + administrators)
  const usersCol = getCollection('users');
  const staffUsers = await usersCol
    .find({
      roles: { $in: ['creator', 'administrator'] },
      isActive: true,
      isDeleted: { $ne: true },
    })
    .project({ _id: 1, roles: 1 })
    .toArray() as any[];

  if (staffUsers.length === 0) return 0;

  const notificationsCol = getCollection('notifications');
  let processed = 0;

  for (const lead of overdueLeads) {
    const leadId = lead._id.toString();
    const hoursOverdue = Math.floor(
      (now.getTime() - new Date(lead.lastActivityAt).getTime()) / (60 * 60 * 1000)
    );

    for (const staffUser of staffUsers) {
      const staffUserId = staffUser._id.toString();

      // Deduplicate: skip if we already notified this staff member about this
      // lead within the SLA window
      const existingNotification = await notificationsCol.findOne({
        userId: staffUserId,
        type: 'lead_sla_overdue',
        referenceType: 'lead',
        referenceId: leadId,
        createdAt: { $gte: dedupeWindow },
      });

      if (existingNotification) continue;

      await createNotification(
        staffUserId,
        'lead_sla_overdue',
        'Lead SLA Overdue',
        `Lead #${leadId.slice(-6).toUpperCase()} (${lead.type}, ${lead.status}) has had no activity for ${hoursOverdue} hour${hoursOverdue !== 1 ? 's' : ''}. SLA target is ${LEAD_SLA_HOURS} hours.`,
        'lead',
        leadId
      );

      processed++;
    }
  }

  return processed;
}
