import { useEffect, useState } from 'react';
import { aggregatedOrderFlowEngine } from './tradeStreamEngine';

export function useAggregatedOrderFlow(timeframe = '24H', gap = 100) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    aggregatedOrderFlowEngine.start();
    return aggregatedOrderFlowEngine.subscribe(() => setVersion((value) => value + 1));
  }, []);
  return aggregatedOrderFlowEngine.getSnapshot(timeframe, gap);
}
