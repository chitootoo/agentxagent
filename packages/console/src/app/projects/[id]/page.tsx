import { InboxView } from "@/components/inbox-view";

interface ProjectPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { id } = await params;
  return <InboxView initialProjectId={id} />;
}
