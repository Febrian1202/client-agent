import type { ClientMemory } from '../entities';
import { MemoryType, MemoryCategory, MemorySource, MemoryConfidence } from '../enums';

export class MemoryContentEmptyError extends Error {
  constructor(message: string = 'Memory content cannot be empty') {
    super(message);
    this.name = 'MemoryContentEmptyError';
  }
}

export class MemoryNotFoundError extends Error {
  constructor(id: number) {
    super(`Memory with ID ${id} not found`);
    this.name = 'MemoryNotFoundError';
  }
}

export interface AddMemoryInput {
  clientId: number;
  type: MemoryType | string;
  category: MemoryCategory | string;
  content: string;
  source?: MemorySource | string;
  confidence?: MemoryConfidence | string;
}

export interface GroupedClientMemories {
  facts: ClientMemory[];
  preferences: ClientMemory[];
  inferences: ClientMemory[];
}

export interface MemoryRepository {
  insertMemory(data: AddMemoryInput): Promise<ClientMemory>;
  getMemoryById(id: number): Promise<ClientMemory | null>;
  listMemoriesByClientId(clientId: number, type?: string): Promise<ClientMemory[]>;
  updateMemory(id: number, content: string): Promise<ClientMemory | null>;
  deleteMemory(id: number): Promise<boolean>;
}

export async function addMemory(repo: MemoryRepository, input: AddMemoryInput): Promise<ClientMemory> {
  if (!input.content || !input.content.trim()) {
    throw new MemoryContentEmptyError();
  }

  return repo.insertMemory({
    clientId: input.clientId,
    type: input.type,
    category: input.category,
    content: input.content.trim(),
    source: input.source ?? MemorySource.USER_NOTE,
    confidence: input.confidence ?? MemoryConfidence.HIGH,
  });
}

export async function getClientMemories(repo: MemoryRepository, clientId: number): Promise<GroupedClientMemories> {
  const allMemories = await repo.listMemoriesByClientId(clientId);

  const facts: ClientMemory[] = [];
  const preferences: ClientMemory[] = [];
  const inferences: ClientMemory[] = [];

  for (const memory of allMemories) {
    if (memory.type === MemoryType.FACT) {
      facts.push(memory);
    } else if (memory.type === MemoryType.PREFERENCE) {
      preferences.push(memory);
    } else if (memory.type === MemoryType.INFERENCE) {
      inferences.push(memory);
    } else {
      facts.push(memory);
    }
  }

  return {
    facts,
    preferences,
    inferences,
  };
}

export async function updateMemory(
  repo: MemoryRepository,
  memoryId: number,
  content: string
): Promise<ClientMemory> {
  if (!content || !content.trim()) {
    throw new MemoryContentEmptyError();
  }

  const existing = await repo.getMemoryById(memoryId);
  if (!existing) {
    throw new MemoryNotFoundError(memoryId);
  }

  const updated = await repo.updateMemory(memoryId, content.trim());
  if (!updated) {
    throw new MemoryNotFoundError(memoryId);
  }

  return updated;
}

export async function deleteMemory(repo: MemoryRepository, memoryId: number): Promise<boolean> {
  return repo.deleteMemory(memoryId);
}
