import { StatusProvider } from '@/components/app/chrome';
import { Home } from '@/components/import/home';

export default function Page() {
  return (
    <StatusProvider>
      <Home />
    </StatusProvider>
  );
}
