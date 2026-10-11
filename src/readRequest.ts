/** One replaceable read. Aborting fetch alone does not guard an already settled response. */
export class ReadRequest {
  private active: AbortController | null = null;

  begin() {
    this.cancel();
    const controller = new AbortController();
    this.active = controller;
    return {
      signal: controller.signal,
      current: () => this.active === controller && !controller.signal.aborted,
    };
  }

  cancel() {
    const previous = this.active;
    this.active = null;
    previous?.abort();
  }
}
