import { describe, expect, it } from 'vitest';
import { RequestOrder } from '../src/requestOrder';

describe('request ordering', () => {
  it('does not overwrite saved data with a late initial response', async () => {
    const order = new RequestOrder();
    let finish!: (value: string) => void;
    let displayed = '';
    const initial = new Promise<string>((resolve) => { finish = resolve; });
    const initialCurrent = order.begin('customers');
    const pending = initial.then((value) => { if (initialCurrent()) displayed = value; });
    const refreshCurrent = order.begin('customers');
    if (refreshCurrent()) displayed = 'saved';
    finish('old');
    await pending;
    expect(displayed).toBe('saved');
  });

  it('allows independent resources to finish progressively', () => {
    const order = new RequestOrder();
    const customers = order.begin('customers');
    const devices = order.begin('devices');
    const retry = order.begin('devices');
    expect(customers()).toBe(true);
    expect(devices()).toBe(false);
    expect(retry()).toBe(true);
  });
});
