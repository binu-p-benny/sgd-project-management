import { useState, type Dispatch, type SetStateAction } from "react";

/**
 * A local editable draft that resyncs to `serverValue` whenever it changes underneath this
 * component instance — e.g. a sibling action triggers router.refresh() and React reuses this
 * same instance (same key) rather than remounting it, so a plain useState would only ever
 * seed from the first render and go stale.
 *
 * Adjusts state during render rather than in a useEffect — the pattern React recommends for
 * "adjusting state when a prop changes" (https://react.dev/learn/you-might-not-need-an-effect
 * #adjusting-state-when-a-prop-changes): it avoids the extra render+commit an effect would
 * cost, and this project's lint config (react-hooks/set-state-in-effect) forbids the effect
 * form outright.
 */
export function useSyncedDraft<TServer, TDraft>(
  serverValue: TServer,
  toDraft: (value: TServer) => TDraft
): [TDraft, Dispatch<SetStateAction<TDraft>>] {
  const [lastSynced, setLastSynced] = useState(serverValue);
  const [draft, setDraft] = useState<TDraft>(() => toDraft(serverValue));

  if (serverValue !== lastSynced) {
    setLastSynced(serverValue);
    setDraft(toDraft(serverValue));
  }

  return [draft, setDraft];
}
