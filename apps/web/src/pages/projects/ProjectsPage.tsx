import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, FolderOpen, Pencil, Trash2, ChevronRight, FolderKanban } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { useForm } from 'react-hook-form'
import { useAuthStore } from '@/stores/auth'
import { usePermissions } from '@/hooks/usePermissions'
import { projectsApi, type Project } from '@/api/projects'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog } from '@/components/ui/dialog'
import { Card } from '@/components/ui/card'
import { LoadingState } from '@/components/ui/spinner'
import { PageHeader } from '@/components/shared/PageHeader'

// Project form

interface ProjectFormValues {
  name: string
  description: string
}

function ProjectForm({
  initial, onSubmit, onClose, loading,
}: {
  initial?: Project
  onSubmit: (data: ProjectFormValues) => void
  onClose: () => void
  loading: boolean
}) {
  const { t } = useTranslation()
  const { register, handleSubmit, formState: { errors } } = useForm<ProjectFormValues>({
    defaultValues: {
      name: initial?.name ?? '',
      description: initial?.description ?? '',
    },
  })
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="proj-name">{t('projects.name')}</Label>
        <Input
          id="proj-name"
          placeholder={t('projects.namePlaceholder')}
          {...register('name', { required: true })}
        />
        {errors.name && <p className="text-xs text-destructive">{t('common.error')}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="proj-desc">{t('projects.description')}</Label>
        <Input
          id="proj-desc"
          placeholder={t('projects.descriptionPlaceholder')}
          {...register('description')}
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" loading={loading}>{t('common.save')}</Button>
      </div>
    </form>
  )
}

// Main page

export function ProjectsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const session = useAuthStore(s => s.session)
  const orgId = session?.org?.id ?? ''
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [deleteProject, setDeleteProject] = useState<Project | null>(null)

  const { can } = usePermissions()
  const canCreate = can('projects:create')
  const canUpdate = can('projects:update')
  const canDelete = can('projects:delete')

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', orgId],
    queryFn: () => projectsApi.list(orgId),
    enabled: !!orgId,
  })

  const create = useMutation({
    mutationFn: (data: ProjectFormValues) => projectsApi.create(orgId, {
      name: data.name,
      description: data.description || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', orgId] })
      setCreateOpen(false)
    },
  })

  const update = useMutation({
    mutationFn: (data: ProjectFormValues) => projectsApi.update(orgId, editProject!.id, {
      name: data.name,
      description: data.description || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', orgId] })
      setEditProject(null)
    },
  })

  const remove = useMutation({
    mutationFn: () => projectsApi.delete(orgId, deleteProject!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', orgId] })
      setDeleteProject(null)
    },
  })

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title={t('projects.title')}
        subtitle={t('projects.subtitle')}
        action={canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={14} />{t('projects.create')}
          </Button>
        )}
      />

      {/* List. */}
      <Card className="p-0 overflow-hidden">
        {/* Cabecera */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <FolderKanban size={16} className="text-primary" strokeWidth={1.6} />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">{t('projects.title')}</p>
              <p className="text-xs text-text-secondary">{t('projects.count', { count: projects.length })}</p>
            </div>
          </div>
        </div>

        {/* Content. */}
        <div className="border-t border-border">
          {isLoading ? (
            <LoadingState />
          ) : projects.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={t('projects.empty')}
              subtitle={t('projects.emptySubtitle')}
              action={canCreate ? { label: t('projects.create'), onClick: () => setCreateOpen(true), icon: <Plus size={13} /> } : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-text-disabled">{t('projects.name')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-disabled hidden sm:table-cell">{t('common.createdAt')}</th>
                    <th className="px-4 py-3 w-24" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {projects.map(project => (
                    <tr
                      key={project.id}
                      className="hover:bg-grey-50/40 transition-colors cursor-pointer group"
                      onClick={() => navigate(`/projects/${project.id}`)}
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <FolderOpen size={14} className="text-primary" strokeWidth={1.6} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-text-primary">{project.name}</p>
                            {project.description && (
                              <p className="text-xs text-text-secondary truncate max-w-xs">{project.description}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 hidden sm:table-cell">
                        <span className="text-xs text-text-secondary">
                          {new Date(project.createdAt).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          {(canUpdate || canDelete) && (
                            <>
                              {canUpdate && (
                                <Button
                                  variant="ghost" size="icon"
                                  className="h-7 w-7 text-text-disabled hover:text-text-primary transition-opacity"
                                  onClick={e => { e.stopPropagation(); setEditProject(project) }}
                                >
                                  <Pencil size={13} />
                                </Button>
                              )}
                              {canDelete && (
                                <Button
                                  variant="ghost" size="icon"
                                  className="h-7 w-7 text-text-disabled hover:text-destructive transition-opacity"
                                  onClick={e => { e.stopPropagation(); setDeleteProject(project) }}
                                >
                                  <Trash2 size={13} />
                                </Button>
                              )}
                            </>
                          )}
                          <ChevronRight size={14} className="text-text-disabled ml-1 shrink-0" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* Create modal. */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t('projects.createTitle')} description={t('projects.createSubtitle')}>
        <ProjectForm onSubmit={d => create.mutate(d)} onClose={() => setCreateOpen(false)} loading={create.isPending} />
      </Dialog>

      {/* Modal editar */}
      <Dialog open={!!editProject} onClose={() => setEditProject(null)} title={t('projects.editTitle')}>
        {editProject && (
          <ProjectForm initial={editProject} onSubmit={d => update.mutate(d)} onClose={() => setEditProject(null)} loading={update.isPending} />
        )}
      </Dialog>

      {/* Delete modal. */}
      <Dialog open={!!deleteProject} onClose={() => setDeleteProject(null)} title={t('projects.deleteTitle')} description={t('projects.deleteMsg')}>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setDeleteProject(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t('common.delete')}</Button>
        </div>
      </Dialog>
    </div>
  )
}
