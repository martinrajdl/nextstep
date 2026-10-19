import { useEffect, useRef, useState } from 'react';

type Layout = 'table' | 'board';
const valid = (value: unknown): value is Layout => value === 'table' || value === 'board';

export function useCollectionLayout(collectionId: string, fallback: Layout, canBoard: boolean) {
  const key = `nextstep-layout:${collectionId}`;
  const normalize = (value: Layout) => value === 'board' && !canBoard ? 'table' : value;
  const [layout, update] = useState<Layout>(() => {
    try {
      const stored = window.nextstepDesktop ? null : localStorage.getItem(key);
      return normalize(valid(stored) ? stored : fallback);
    } catch { return normalize(fallback); }
  });
  const edited = useRef(false);
  useEffect(() => {
    let cancelled = false;
    // Electron uses a different loopback port each launch. Its preference bridge
    // keeps the selection across origins and scopes it to the selected database.
    void window.nextstepDesktop?.getCollectionLayout(collectionId).then(value => {
      if (!cancelled && !edited.current && valid(value)) update(value === 'board' && !canBoard ? 'table' : value);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [collectionId, canBoard]);
  function setLayout(value: Layout) {
    edited.current = true;
    const next = normalize(value);
    update(next);
    try { localStorage.setItem(key, next); } catch { /* Storage may be disabled. */ }
    void window.nextstepDesktop?.setCollectionLayout(collectionId, next).catch(() => {});
  }
  return [layout, setLayout] as const;
}
