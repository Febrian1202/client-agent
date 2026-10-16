export function formatHeartbeat(workerId: string = 'worker-1'): string {
  return `[${new Date().toISOString()}] Worker ${workerId} heartbeat - alive at ${new Date().toLocaleTimeString()}`;
}
