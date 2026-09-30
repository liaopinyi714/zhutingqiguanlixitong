// Call only after the server has confirmed a successful write. A failed read
// must not reopen a creation form or invite the user to submit the write again.
export async function refreshAfterWrite<T>(
  refresh: () => Promise<T>,
  reportError: (message: string) => void,
) {
  try {
    return await refresh();
  } catch {
    reportError('操作已保存，但最新资料暂时无法加载。请刷新页面查看，勿重复提交。');
  }
}
