import { isValidTimeFormat, isValidDateFormat, isTimeInWorkingHours, isTimeGranularityValid, isBookingDurationValid, isDateInRange, isPastDateTime } from './time';

export interface ValidationError {
  field: string;
  message: string;
}

export function validateRoomNumber(roomNumber: string): ValidationError | null {
  if (!roomNumber || typeof roomNumber !== 'string') {
    return { field: 'roomNumber', message: '房间编号不能为空' };
  }
  if (roomNumber.length > 50) {
    return { field: 'roomNumber', message: '房间编号不能超过50个字符' };
  }
  return null;
}

export function validateRoomName(name: string): ValidationError | null {
  if (!name || typeof name !== 'string') {
    return { field: 'name', message: '房间名称不能为空' };
  }
  if (name.length > 100) {
    return { field: 'name', message: '房间名称不能超过100个字符' };
  }
  return null;
}

export function validateCapacity(capacity: number): ValidationError | null {
  if (capacity === undefined || capacity === null || typeof capacity !== 'number') {
    return { field: 'capacity', message: '容量不能为空' };
  }
  if (!Number.isInteger(capacity) || capacity <= 0) {
    return { field: 'capacity', message: '容量必须是正整数' };
  }
  if (capacity > 1000) {
    return { field: 'capacity', message: '容量不能超过1000' };
  }
  return null;
}

export function validateFloor(floor: number): ValidationError | null {
  if (floor === undefined || floor === null || typeof floor !== 'number') {
    return { field: 'floor', message: '楼层不能为空' };
  }
  if (!Number.isInteger(floor)) {
    return { field: 'floor', message: '楼层必须是整数' };
  }
  return null;
}

export function validateFacilities(facilities: string[]): ValidationError | null {
  if (!Array.isArray(facilities)) {
    return { field: 'facilities', message: '设备标签必须是数组' };
  }
  const validFacilities = ['投影仪', '白板', '视频会议系统', '电话会议'];
  for (const f of facilities) {
    if (!validFacilities.includes(f)) {
      return { field: 'facilities', message: `无效的设备标签: ${f}，有效值为: ${validFacilities.join(', ')}` };
    }
  }
  return null;
}

export function validateDate(date: string): ValidationError | null {
  if (!date || typeof date !== 'string') {
    return { field: 'date', message: '日期不能为空' };
  }
  if (!isValidDateFormat(date)) {
    return { field: 'date', message: '日期格式必须为 YYYY-MM-DD' };
  }
  if (!isDateInRange(date)) {
    return { field: 'date', message: '日期必须在今天到未来30天范围内' };
  }
  return null;
}

export function validateTimeRange(startTime: string, endTime: string, date: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!startTime || typeof startTime !== 'string') {
    errors.push({ field: 'startTime', message: '开始时间不能为空' });
    return errors;
  }
  if (!endTime || typeof endTime !== 'string') {
    errors.push({ field: 'endTime', message: '结束时间不能为空' });
    return errors;
  }

  if (!isValidTimeFormat(startTime)) {
    errors.push({ field: 'startTime', message: '开始时间格式必须为 HH:mm' });
  }
  if (!isValidTimeFormat(endTime)) {
    errors.push({ field: 'endTime', message: '结束时间格式必须为 HH:mm' });
  }

  if (errors.length > 0) return errors;

  if (!isTimeGranularityValid(startTime)) {
    errors.push({ field: 'startTime', message: '开始时间必须以15分钟为粒度（如 10:00, 10:15, 10:30, 10:45）' });
  }
  if (!isTimeGranularityValid(endTime)) {
    errors.push({ field: 'endTime', message: '结束时间必须以15分钟为粒度（如 10:00, 10:15, 10:30, 10:45）' });
  }

  if (!isTimeInWorkingHours(startTime, endTime)) {
    errors.push({ field: 'timeRange', message: '预约时间必须在 08:00-22:00 之间' });
  }

  if (!isBookingDurationValid(startTime, endTime)) {
    errors.push({ field: 'timeRange', message: '预约时长必须在15分钟到4小时之间' });
  }

  if (isPastDateTime(date, startTime)) {
    errors.push({ field: 'startTime', message: '不能预约过去的时间' });
  }

  return errors;
}

export function validateAttendeeCount(attendeeCount: number, capacity: number): ValidationError | null {
  if (attendeeCount === undefined || attendeeCount === null || typeof attendeeCount !== 'number') {
    return { field: 'attendeeCount', message: '参会人数不能为空' };
  }
  if (!Number.isInteger(attendeeCount) || attendeeCount <= 0) {
    return { field: 'attendeeCount', message: '参会人数必须是正整数' };
  }
  if (attendeeCount > capacity) {
    return { field: 'attendeeCount', message: `参会人数(${attendeeCount})不能超过房间容量(${capacity})` };
  }
  return null;
}

export function validateBookerName(bookerName: string): ValidationError | null {
  if (!bookerName || typeof bookerName !== 'string') {
    return { field: 'bookerName', message: '预约人姓名不能为空' };
  }
  if (bookerName.length > 50) {
    return { field: 'bookerName', message: '预约人姓名不能超过50个字符' };
  }
  return null;
}

export function validateTopic(topic: string): ValidationError | null {
  if (!topic || typeof topic !== 'string') {
    return { field: 'topic', message: '会议主题不能为空' };
  }
  if (topic.length > 200) {
    return { field: 'topic', message: '会议主题不能超过200个字符' };
  }
  return null;
}

export function validateCancelReason(reason: string): ValidationError | null {
  if (!reason || typeof reason !== 'string') {
    return { field: 'cancelReason', message: '取消原因不能为空' };
  }
  if (reason.length > 500) {
    return { field: 'cancelReason', message: '取消原因不能超过500个字符' };
  }
  return null;
}
