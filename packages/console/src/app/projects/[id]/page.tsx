import { BoardView } from "@/components/board-view";

interface ProjectPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { id } = await params;
  return <BoardView projectId={id} />;
}
