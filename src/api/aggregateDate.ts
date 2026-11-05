export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isTodayOrFutureUtc(date: string): boolean {
  return date >= utcToday();
}
