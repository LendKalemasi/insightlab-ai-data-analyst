import { StatusProvider } from '@/components/app/chrome';
import { WorkspaceProvider } from '@/components/workspace/context';
import { WorkspaceShell } from '@/components/workspace/shell';

export default async function DatasetLayout({ children, params }: LayoutProps<'/datasets/[id]'>) {
  const { id } = await params;
  return (
    <StatusProvider>
      <WorkspaceProvider id={id}>
        <WorkspaceShell>{children}</WorkspaceShell>
      </WorkspaceProvider>
    </StatusProvider>
  );
}
