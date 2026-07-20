import type { StatisticsDb } from './statisticsDb';

/** Cloud stats sync removed — local statistics only. */
export async function pushStats(_stats: StatisticsDb, _client: unknown): Promise<void> {}

export async function pullStats(_stats: StatisticsDb, _client: unknown): Promise<void> {}
