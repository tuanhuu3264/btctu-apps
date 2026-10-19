/** Nguồn thời gian có thể thay trong test (khóa tài khoản, hạn phiên đều phụ thuộc thời gian). */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
