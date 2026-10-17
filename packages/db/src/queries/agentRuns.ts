import { eq, desc } from 'drizzle-orm';
import { db } from '../client';
import { agentRuns, type AgentRun, type NewAgentRun } from '../schema/agent_runs';

export async function insertAgentRun(data: NewAgentRun): Promise<AgentRun> {
  const [created] = await db.insert(agentRuns).values(data).returning();
  return created;
}

export async function getAgentRunsByTaskId(taskId: number): Promise<AgentRun[]> {
  return db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.taskId, taskId))
    .orderBy(desc(agentRuns.createdAt));
}
