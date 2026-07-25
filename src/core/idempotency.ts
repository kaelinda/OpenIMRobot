/**
 * 幂等状态模型（评审意见 #3）：
 * SDK 提供的是 at-least-once 投递 + 幂等去重，而非 exactly-once。
 * 状态只在业务处理**成功**后才标记 succeeded；处理中标记 processing 并带租约（lease），
 * 租约过期或处理失败允许平台重推时重新进入处理，避免“首次失败即被去重丢弃”的问题。
 */
export type IdempotencyState = "processing" | "succeeded" | "failed";

export interface IdempotencyRecord {
  state: IdempotencyState;
  /** 持有该 key 处理权的租约到期时间（毫秒时间戳） */
  leaseExpiresAt: number;
  attempts: number;
}

export interface AcquireResult {
  /** 是否获得处理权：key 不存在、租约已过期，或此前状态为 failed 时可获得 */
  acquired: boolean;
  /** key 是否已经成功处理过（业务层应短路跳过） */
  alreadySucceeded: boolean;
  record: IdempotencyRecord;
}

export interface IdempotencyStore {
  /**
   * 尝试获取某个幂等 key 的处理权。
   * @param leaseMs 租约时长；处理进程崩溃时，其他消费者可在租约到期后重新接管，避免消息永久卡死。
   */
  acquire(key: string, leaseMs: number): Promise<AcquireResult>;
  /** 标记处理成功，之后同 key 的 acquire 将返回 alreadySucceeded=true 且不可再次获取处理权 */
  markSucceeded(key: string): Promise<void>;
  /** 标记处理失败，释放处理权，允许下一次重推重新 acquire */
  markFailed(key: string): Promise<void>;
}

/**
 * 进程内实现，仅用于单实例开发/测试。生产环境必须替换为 Redis 等外部存储实现
 * （持久化、跨实例共享、原子 CAS 写入），否则多实例部署下幂等语义不成立。
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  async acquire(key: string, leaseMs: number): Promise<AcquireResult> {
    const now = Date.now();
    const existing = this.records.get(key);

    if (existing?.state === "succeeded") {
      return { acquired: false, alreadySucceeded: true, record: existing };
    }

    if (existing?.state === "processing" && existing.leaseExpiresAt > now) {
      return { acquired: false, alreadySucceeded: false, record: existing };
    }

    const record: IdempotencyRecord = {
      state: "processing",
      leaseExpiresAt: now + leaseMs,
      attempts: (existing?.attempts ?? 0) + 1,
    };
    this.records.set(key, record);
    return { acquired: true, alreadySucceeded: false, record };
  }

  async markSucceeded(key: string): Promise<void> {
    const existing = this.records.get(key);
    this.records.set(key, {
      state: "succeeded",
      leaseExpiresAt: Number.POSITIVE_INFINITY,
      attempts: existing?.attempts ?? 1,
    });
  }

  async markFailed(key: string): Promise<void> {
    const existing = this.records.get(key);
    if (!existing) return;
    this.records.set(key, { ...existing, state: "failed", leaseExpiresAt: 0 });
  }
}
