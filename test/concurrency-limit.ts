interface Waiter {
  resolve(): void;
  weight: number;
}

export function createConcurrencyLimit(maximum: number) {
  assertWeight(maximum, maximum);
  let activeWeight = 0;
  const waiters: Waiter[] = [];

  return async function withConcurrencyLimit<T>(task: () => T | Promise<T>, weight = 1) {
    assertWeight(weight, maximum);
    await acquire(weight);
    try {
      return await task();
    } finally {
      activeWeight -= weight;
      drainWaiters();
    }
  };

  function acquire(weight: number) {
    if (waiters.length === 0 && activeWeight + weight <= maximum) {
      activeWeight += weight;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiters.push({ resolve, weight }));
  }

  function drainWaiters() {
    while (waiters[0] && activeWeight + waiters[0].weight <= maximum) {
      const waiter = waiters.shift()!;
      activeWeight += waiter.weight;
      waiter.resolve();
    }
  }
}

function assertWeight(weight: number, maximum: number) {
  if (!Number.isInteger(weight) || weight < 1 || weight > maximum) {
    throw new Error("Concurrency weight must be a positive integer within the limit");
  }
}
