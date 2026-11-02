export function idleSessions(
  sessions: { key: string; state: 'working' | 'ask' | 'done'; at: number }[],
  now: number,
  vaulted: Record<string, number>,
  idleMs = 3_600_000,
): string[] {
  return sessions
    .filter(
      (session) =>
        session.state !== 'working' && now - session.at >= idleMs && vaulted[session.key] !== session.at,
    )
    .map((session) => session.key);
}
