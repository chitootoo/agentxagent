import { TaskConversation } from "@/components/task-conversation";

interface TaskPageProps {
  params: Promise<{ id: string; taskId: string }>;
}

export default async function TaskPage({ params }: TaskPageProps) {
  const { id, taskId } = await params;
  return <TaskConversation projectId={id} taskId={taskId} />;
}
