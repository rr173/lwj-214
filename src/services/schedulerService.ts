import { releaseNoShowBookings } from './checkInService';

let intervalId: ReturnType<typeof setInterval> | null = null;
const CHECK_INTERVAL_MS = 60 * 1000;

export function startScheduler() {
  if (intervalId) return;

  const tick = async () => {
    try {
      const released = await releaseNoShowBookings();
      if (released.length > 0) {
        console.log(`[调度器] 释放了 ${released.length} 条未签到预约`);
        for (const r of released) {
          console.log(`  - ${r.bookerName} ${r.roomNumber} ${r.timeSlot} (触发 ${r.conversions.length} 个候补转正)`);
        }
      }
    } catch (error) {
      console.error('[调度器] 自动释放检查出错:', error);
    }
  };

  intervalId = setInterval(tick, CHECK_INTERVAL_MS);
  console.log(`[调度器] 已启动，每 ${CHECK_INTERVAL_MS / 1000} 秒检查一次未签到释放`);
}

export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[调度器] 已停止');
  }
}
