import { InboxView } from "@/components/inbox-view";
import { decodeRouteParam } from "@/lib/project-link";

interface ProjectPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { id } = await params;
  return <InboxView initialProjectId={decodeRouteParam(id)} />;
}
