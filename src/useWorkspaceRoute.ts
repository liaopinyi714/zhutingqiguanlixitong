import { useEffect, useRef, useState } from 'react';
import { readRoute, routeHash, type WorkspaceRoute } from './workspace';

export function useWorkspaceRoute(beforeNavigate: () => boolean) {
  const [route, setRoute] = useState(() => readRoute(window.location.hash));
  const routeRef = useRef(route);
  const guardRef = useRef(beforeNavigate);
  guardRef.current = beforeNavigate;
  routeRef.current = route;
  useEffect(() => {
    const hash = routeHash(route);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }, [route]);
  useEffect(() => {
    const restore = () => {
      if (!guardRef.current()) {
        window.history.pushState(null, '', routeHash(routeRef.current));
        return;
      }
      setRoute(readRoute(window.location.hash));
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  function update(patch: Partial<WorkspaceRoute>) {
    setRoute((previous) => ({ ...previous, ...patch }));
  }
  return { route, update };
}
