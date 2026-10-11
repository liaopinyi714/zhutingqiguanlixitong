import { describe, expect, it } from 'vitest';
import { ReadRequest } from '../src/readRequest';

describe('replaceable list reads', () => {
  it('cancels an obsolete read without cancelling independent resources', () => {
    const customers = new ReadRequest();
    const summary = new ReadRequest();
    const initial = customers.begin();
    const independent = summary.begin();
    const refreshed = customers.begin();

    expect(initial.signal.aborted).toBe(true);
    expect(initial.current()).toBe(false);
    expect(refreshed.current()).toBe(true);
    expect(independent.signal.aborted).toBe(false);
    expect(independent.current()).toBe(true);
  });

  it('rejects a late result even if the underlying transport ignores cancellation', async () => {
    const request = new ReadRequest();
    let finish!: (value: string) => void;
    let displayed = '';
    const oldResponse = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const oldRead = request.begin();
    const pending = oldResponse.then((data) => {
      if (oldRead.current()) displayed = data;
    });

    const newRead = request.begin();
    if (newRead.current()) displayed = 'current store / new query';
    finish('previous store / old query');
    await pending;
    expect(displayed).toBe('current store / new query');
  });

  it('retires the request on unmount and permits a fresh read after effect reattachment', () => {
    const request = new ReadRequest();
    const unmounted = request.begin();
    request.cancel();
    request.cancel();
    const remounted = request.begin();

    expect(unmounted.signal.aborted).toBe(true);
    expect(unmounted.current()).toBe(false);
    expect(remounted.signal.aborted).toBe(false);
    expect(remounted.current()).toBe(true);
  });
});
