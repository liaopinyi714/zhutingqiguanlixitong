/** Keep late responses from replacing newer data for the same resource. */
export class RequestOrder {
  private versions = new Map<string, number>();

  begin(resource: string): () => boolean {
    const version = (this.versions.get(resource) ?? 0) + 1;
    this.versions.set(resource, version);
    return () => this.versions.get(resource) === version;
  }
}
