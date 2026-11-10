import { useCallback, useEffect, useRef, useState } from "react";
import { publicApi } from "../api";
import type { CallLogRow, Hold, HoldProposal } from "../types";

const POLL_MS = 2500;

/**
 * Live view of one request: call log, hold proposals and holds.
 * Polls the server every 2.5 s while a request is active.
 */
export function useRequestLive() {
  const [requestId, setRequestId] = useState<string | null>(null);
  const [log, setLog] = useState<CallLogRow[]>([]);
  const [proposals, setProposals] = useState<HoldProposal[]>([]);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [callsEnabled, setCallsEnabled] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const idRef = useRef<string | null>(null);
  const seqRef = useRef(0);

  const refetch = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    const seq = ++seqRef.current;
    try {
      const s = await publicApi.requestState(id);
      // Ignore answers for an older request, or ones overtaken by a newer fetch.
      if (idRef.current !== id || seq !== seqRef.current) return;
      setLoadError(null);
      // `request` is null until dispatch has created it; the lists are simply empty then.
      setLog(s.call_log ?? []);
      setProposals(s.proposals ?? []);
      setHolds(s.holds ?? []);
      if (typeof s.calls_enabled === "boolean") setCallsEnabled(s.calls_enabled);
    } catch {
      if (idRef.current !== id || seq !== seqRef.current) return;
      setLoadError("We are having trouble refreshing live updates. We will keep trying.");
    }
  }, []);

  /** Start following a new request. Polling begins straight away. */
  const start = useCallback((id: string) => {
    idRef.current = id;
    setRequestId(id);
    setLog([]);
    setProposals([]);
    setHolds([]);
    setLoadError(null);
  }, []);

  // Fetch once immediately, then poll; stops on unmount or when the request changes.
  useEffect(() => {
    if (!requestId) return;
    void refetch();
    const t = window.setInterval(() => void refetch(), POLL_MS);
    return () => window.clearInterval(t);
  }, [requestId, refetch]);

  useEffect(
    () => () => {
      idRef.current = null;
    },
    [],
  );

  return { requestId, log, proposals, holds, callsEnabled, loadError, start, refetch };
}
