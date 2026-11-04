import { CreateTaskForm } from "@/components/create-task-form";

interface NewTaskPageProps {
  params: Promise<{ id: string }>;
}

export default async function NewTaskPage({ params }: NewTaskPageProps) {
  const { id } = await params;
  return <CreateTaskForm projectId={id} />;
}
