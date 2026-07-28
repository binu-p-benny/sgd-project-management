import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { EditProjectForm } from "@/components/projects/EditProjectForm";

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !isAdminEditor(session)) {
    redirect(`/projects/${id}`);
  }

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) notFound();

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Edit project</h1>
      <EditProjectForm
        projectId={project.id}
        initial={{
          name: project.name,
          clientName: project.clientName,
          clientPhone: project.clientPhone,
          clientAddress: project.clientAddress,
          roughDesignCompletedAt: project.roughDesignCompletedAt?.toISOString().slice(0, 10) ?? "",
          notes: project.notes ?? "",
        }}
      />
    </div>
  );
}
