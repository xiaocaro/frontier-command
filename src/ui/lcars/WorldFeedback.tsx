import { useEffect, useRef } from 'react';
import type { Snapshot } from '../../engine/types';
import { useLcars } from './LcarsProvider';
export function WorldFeedback({ world, branch }: { world: Snapshot; branch: string | null }) {
  const { audio } = useLcars();
  const previous = useRef<{
    branch: string | null;
    status: Snapshot['status'];
    communications: Set<number>;
  } | null>(null);
  useEffect(() => {
    const before = previous.current;
    if (before && before.branch !== branch) audio.cancelPending();
    if (before && before.branch === branch) {
      if (before.status !== 'commandLost' && world.status === 'commandLost')
        audio.play('terminal', `${branch}:command-lost`);
      else
        for (const communication of world.communications)
          if (
            !before.communications.has(communication.id) &&
            !communication.read &&
            communication.priority === 'urgent' &&
            !world.pauseReasons.some(
              (r) =>
                r.kind === 'newContact' &&
                r.entityId === communication.entityId &&
                r.time === communication.time,
            )
          )
            audio.play('alert', `${branch}:communication:${communication.id}`);
    }
    previous.current = {
      branch,
      status: world.status,
      communications: new Set(world.communications.map((c) => c.id)),
    };
  }, [world, branch, audio]);
  return null;
}
