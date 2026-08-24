import { PrismaClient, AppointmentStatus, CancelledBy } from "@prisma/client";

export class HoldCleanupService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Releases expired holds, making slots available for booking again.
   * 
   * Idempotency & Concurrency:
   * Uses a single `updateMany` query which translates to an atomic 
   * `UPDATE ... WHERE status='HELD' AND heldUntil < now()` in PostgreSQL. 
   * If two cron jobs fire simultaneously, the DB engine handles the lock, 
   * and one will update the rows while the other safely updates 0 rows. 
   * No read-then-write race conditions.
   * 
   * Updates to EXPIRED instead of deleting to retain a metric of 
   * "abandoned checkouts" for product analytics.
   * 
   * @returns The number of holds released
   */
  async releaseExpiredHolds(): Promise<number> {
    const result = await this.prisma.appointment.updateMany({
      where: {
        status: AppointmentStatus.HELD,
        heldUntil: {
          lt: new Date()
        }
      },
      data: {
        status: AppointmentStatus.EXPIRED,
        cancelledBy: CancelledBy.SYSTEM,
        cancelReason: "Checkout hold expired"
      }
    });

    if (result.count > 0) {
      console.log(`🧹 HoldCleanup: Released ${result.count} expired holds.`);
    }

    return result.count;
  }
}
