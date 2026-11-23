import { TaskConversation } from "@/components/task-conversation";
import { decodeRouteParam } from "@/lib/project-link";

interface TaskPageProps {
  params: Promise<{ id: string; taskId: string }>;
}

export default async function TaskPage({ params }: TaskPageProps) {
  const { id, taskId } = await params;
  return <TaskConversation projectId={decodeRouteParam(id)} taskId={decodeRouteParam(taskId)} />;
}
