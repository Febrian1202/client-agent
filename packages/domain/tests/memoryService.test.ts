import { describe, expect, it } from 'bun:test';
import {
  MemoryType,
  MemoryCategory,
  MemorySource,
  MemoryConfidence,
  addMemory,
  getClientMemories,
  updateMemory,
  deleteMemory,
  type MemoryRepository,
  type ClientMemory,
} from '../src';

describe('Client Memory Domain Service', () => {
  const store = new Map<number, ClientMemory>();
  let nextId = 1;

  const mockRepo: MemoryRepository = {
    async insertMemory(data) {
      const item: ClientMemory = {
        id: nextId++,
        clientId: data.clientId,
        type: data.type,
        category: data.category,
        content: data.content,
        source: data.source ?? MemorySource.USER_NOTE,
        confidence: data.confidence ?? MemoryConfidence.HIGH,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(item.id, item);
      return item;
    },
    async getMemoryById(id) {
      return store.get(id) ?? null;
    },
    async listMemoriesByClientId(clientId, type) {
      return Array.from(store.values()).filter(
        (m) => m.clientId === clientId && (!type || m.type === type)
      );
    },
    async updateMemory(id, content) {
      const item = store.get(id);
      if (!item) return null;
      item.content = content;
      item.updatedAt = new Date();
      return item;
    },
    async deleteMemory(id) {
      return store.delete(id);
    },
  };

  it('validates and inserts memory rejecting empty content', async () => {
    await expect(
      addMemory(mockRepo, {
        clientId: 1,
        type: MemoryType.FACT,
        category: MemoryCategory.TECHNICAL,
        content: '   ',
      })
    ).rejects.toThrow('Memory content cannot be empty');

    const created = await addMemory(mockRepo, {
      clientId: 1,
      type: MemoryType.FACT,
      category: MemoryCategory.TECHNICAL,
      content: 'Uses VTube Studio',
    });
    expect(created.id).toBeDefined();
    expect(created.content).toBe('Uses VTube Studio');
  });

  it('groups memories into facts, preferences, and inferences', async () => {
    await addMemory(mockRepo, {
      clientId: 1,
      type: MemoryType.PREFERENCE,
      category: MemoryCategory.SCOPE,
      content: 'Wants rough sketch approval first',
    });

    await addMemory(mockRepo, {
      clientId: 1,
      type: MemoryType.INFERENCE,
      category: MemoryCategory.GENERAL,
      content: 'Might be planning a holiday stream',
    });

    const grouped = await getClientMemories(mockRepo, 1);
    expect(grouped.facts.length).toBe(1);
    expect(grouped.preferences.length).toBe(1);
    expect(grouped.inferences.length).toBe(1);
    expect(grouped.facts[0].type).toBe(MemoryType.FACT);
  });

  it('updates memory content rejecting empty update', async () => {
    const list = await mockRepo.listMemoriesByClientId(1);
    const target = list[0];

    await expect(updateMemory(mockRepo, target.id, '')).rejects.toThrow(
      'Memory content cannot be empty'
    );

    const updated = await updateMemory(mockRepo, target.id, 'Updated note content');
    expect(updated.content).toBe('Updated note content');
  });

  it('deletes memory and confirms removal', async () => {
    const list = await mockRepo.listMemoriesByClientId(1);
    const target = list[0];

    const deleted = await deleteMemory(mockRepo, target.id);
    expect(deleted).toBe(true);

    const check = await mockRepo.getMemoryById(target.id);
    expect(check).toBeNull();
  });
});
