import { ArrowLeft, ArrowRight } from 'lucide-react';
export type PageControl = {
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  loading: boolean;
  error: string;
  next: () => Promise<unknown>;
  previous: () => Promise<unknown>;
  retry: () => Promise<unknown>;
};
export function PageNavigation({ resource }: { resource: PageControl }) {
  return (
    <span className="button-row" aria-label="列表分页">
      {resource.error && (
        <button
          type="button"
          className="button small"
          onClick={() => void resource.retry().catch(() => {})}
        >
          重试
        </button>
      )}
      {(resource.hasPrevious || resource.hasNext) && (
        <>
          <button
            type="button"
            className="button small"
            disabled={resource.loading || !!resource.error || !resource.hasPrevious}
            onClick={() => void resource.previous().catch(() => {})}
            aria-label="上一页"
          >
            <ArrowLeft size={14} />
          </button>
          <span>第 {resource.page} 页</span>
          <button
            type="button"
            className="button small"
            disabled={resource.loading || !!resource.error || !resource.hasNext}
            onClick={() => void resource.next().catch(() => {})}
            aria-label="下一页"
          >
            <ArrowRight size={14} />
          </button>
        </>
      )}
    </span>
  );
}
