import { Suspense } from 'react';
import { DataView } from '@/components/workspace/data-view';

export const metadata = { title: 'Data' };

export default function Page() {
  return (
    <Suspense>
      <DataView />
    </Suspense>
  );
}
